import {
  chatWithTools,
  type LlmAgentMessage,
  type LlmMessage,
  type LlmToolCall
} from './llm'
import { executeTool, TOOL_SCHEMAS } from './tools'

const MAX_ROUNDS = 10
const MAX_TOOLS = 14
const CHUNK_SIZE = 24
const CHUNK_INTERVAL_MS = 12
const TOOL_OUTPUT_LIMIT = 300
const TOOL_RESULT_LIMIT = 8000

const AGENT_SYSTEM = [
  '你是一名严谨的中文研究助手，可以调用工具完成任务。工作原则：',
  '1. 需要最新信息、时事、具体数据或不确定的事实时，使用 web_search 检索；只挑最有价值的 2 到 3 条链接用 fetch_url 阅读原文。',
  '2. 结论中标注来源 URL；不许编造来源、链接、数据或引用。',
  '3. 需要引用本地资料时使用 read_file，需要查看目录时使用 list_files。',
  '4. 需要计算、整理数据或检查本机环境时，可以使用 run_command。',
  '5. 需要输出报告或保存结果时，使用 write_file。',
  '6. 信息不足或工具失败时明确说明，不要臆测。',
  '7. 工具调用要节制：整体不超过 6 次调用，同一条链接不要重复抓取；拿到足够信息就立即给出结论。',
  '8. 回答使用中文，结构清晰；最终回答只呈现结论与来源，不要罗列工具调用过程。'
].join('\n')

export type AgentSend = (channel: string, payload: unknown) => void

export interface AgentRunOptions {
  requestId: string
  messages: LlmMessage[]
  model?: string
  temperature?: number
  send: AgentSend
  signal: AbortSignal
}

interface ToolEventPayload {
  requestId: string
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'failed'
  output?: string
}

interface EvidenceItem {
  title: string
  url: string
}

/**
 * 从联网搜索/网页抓取的返回文本中提取来源。
 * web_search 是编号列表（标题行 + "URL: " 行），fetch_url 头部是 "标题：/URL："。
 */
function parseEvidence(name: string, content: string): EvidenceItem[] {
  const items: EvidenceItem[] = []
  if (name === 'web_search') {
    const pattern = /(?:^|\n)\s*\d+\.\s*([^\n]+)\n\s*URL[:：]\s*(\S+)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      items.push({ title: match[1].trim(), url: match[2].trim() })
    }
  } else if (name === 'fetch_url') {
    const matched = content.match(/标题[:：]\s*([^\n]*)\n\s*URL[:：]\s*(\S+)/)
    if (matched) items.push({ title: matched[1].trim(), url: matched[2].trim() })
  }
  return items.filter((item) => /^https?:\/\//i.test(item.url))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArguments(raw: string): { ok: true; args: Record<string, unknown> } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
    return { ok: true, args: parsed as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}

/** 按 24 字左右切片，模拟流式输出，渲染层无需区分 Agent 与普通对话 */
async function emitText(
  text: string,
  requestId: string,
  send: AgentSend,
  signal: AbortSignal
): Promise<void> {
  const chars = Array.from(text)
  for (let index = 0; index < chars.length; index += CHUNK_SIZE) {
    if (signal.aborted) return
    send('work:chat:chunk', {
      requestId,
      delta: chars.slice(index, index + CHUNK_SIZE).join('')
    })
    await sleep(CHUNK_INTERVAL_MS)
  }
}

/**
 * 轮次用尽后，要求模型基于已有工具结果直接给出最终回答（不再开放工具）。
 * 失败时返回空串，由调用方兜底。
 */
async function forceFinalAnswer(
  conversation: LlmAgentMessage[],
  options: AgentRunOptions
): Promise<string> {
  try {
    const result = await chatWithTools({
      messages: [
        ...conversation,
        {
          role: 'user',
          content: '工具调用已结束。请只基于上面已经获得的信息，直接给出最终回答；不要再调用任何工具，无法确认的内容要说明。'
        }
      ],
      model: options.model,
      temperature: options.temperature ?? 0.3,
      signal: options.signal
    })
    return result.content.trim()
  } catch {
    return ''
  }
}

/**
 * Agent 主循环：模型自主调用工具，最终把结论切片推送给渲染层。
 * 中止时保留已发送内容，并按正常结束处理。
 */
export async function runAgent(options: AgentRunOptions): Promise<void> {
  const { requestId, send, signal } = options
  const history: LlmAgentMessage[] = options.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) =>
      message.role === 'system'
        ? { role: 'system', content: message.content }
        : message.role === 'user'
          ? { role: 'user', content: message.content }
          : { role: 'assistant', content: message.content }
    )
  const conversation: LlmAgentMessage[] = [
    { role: 'system', content: AGENT_SYSTEM },
    ...history
  ]

  let lastContent = ''
  let finalContent = ''
  let exhausted = true
  let toolCount = 0
  const seenCalls = new Set<string>()
  const seenEvidence = new Set<string>()

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) {
        send('work:chat:done', { requestId })
        return
      }

      const result = await chatWithTools({
        messages: conversation,
        tools: TOOL_SCHEMAS,
        toolChoice: 'auto',
        model: options.model,
        temperature: options.temperature ?? 0.3,
        signal
      })
      lastContent = result.content.trim()

      if (result.toolCalls.length === 0) {
        finalContent = result.content
        exhausted = false
        break
      }

      // 统一补全工具调用 id，保证 assistant 消息与 tool 结果一一对应
      const calls: LlmToolCall[] = result.toolCalls.map((call, index) => ({
        ...call,
        id: call.id || `call_${round}_${index}`
      }))
      conversation.push({
        role: 'assistant',
        content: result.content,
        tool_calls: calls
      })

      for (const call of calls) {
        if (signal.aborted) {
          send('work:chat:done', { requestId })
          return
        }

        const name = call.function.name
        const parsed = parseArguments(call.function.arguments)
        const args = parsed.ok ? parsed.args : {}
        const signature = `${name}:${JSON.stringify(args)}`

        // 超量或完全重复的调用直接跳过，避免模型陷入循环
        if (toolCount >= MAX_TOOLS || seenCalls.has(signature)) {
          const skipped: ToolEventPayload = {
            requestId,
            id: call.id,
            name,
            args,
            status: 'failed',
            output: seenCalls.has(signature) ? '重复调用已跳过' : '工具调用次数已达上限'
          }
          send('work:agent:tool', skipped)
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: seenCalls.has(signature)
              ? '该调用与之前完全重复，已跳过。请基于已有信息给出结论。'
              : '工具调用次数已达上限，请直接基于已有信息给出结论。'
          })
          continue
        }

        toolCount += 1
        seenCalls.add(signature)

        const running: ToolEventPayload = {
          requestId,
          id: call.id,
          name,
          args,
          status: 'running'
        }
        send('work:agent:tool', running)

        const outcome = parsed.ok
          ? await executeTool(name, args, signal)
          : { ok: false, content: '工具参数不是合法的 JSON 对象' }
        const finished: ToolEventPayload = {
          requestId,
          id: call.id,
          name,
          args,
          status: outcome.ok ? 'done' : 'failed',
          output: outcome.content.slice(0, TOOL_OUTPUT_LIMIT)
        }
        send('work:agent:tool', finished)

        // 联网类工具成功后自动汇总来源，同一请求内按 url 去重
        if (outcome.ok && (name === 'web_search' || name === 'fetch_url')) {
          const fresh = parseEvidence(name, outcome.content).filter(
            (item) => !seenEvidence.has(item.url)
          )
          if (fresh.length > 0) {
            for (const item of fresh) seenEvidence.add(item.url)
            send('work:agent:evidence', { requestId, items: fresh })
          }
        }

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: outcome.content.slice(0, TOOL_RESULT_LIMIT)
        })
      }
    }

    if (exhausted) {
      // 轮次用尽：强制模型不再调用工具，直接基于已有信息收尾
      finalContent = await forceFinalAnswer(conversation, options)
      if (!finalContent.trim()) finalContent = lastContent || '信息收集已到上限，请补充更具体的问题再试。'
    }
    if (!finalContent.trim()) finalContent = '模型未返回内容，请稍后重试。'

    await emitText(finalContent, requestId, send, signal)
    send('work:chat:done', { requestId })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      // 用户停止：已发出的分片保留，按正常结束处理
      send('work:chat:done', { requestId })
      return
    }
    throw error
  }
}
