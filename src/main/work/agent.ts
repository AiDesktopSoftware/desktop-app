import { basename } from 'node:path'
import {
  chatWithTools,
  type LlmAgentMessage,
  type LlmMessage,
  type LlmToolCall
} from './llm'
import { CAPABILITIES, capabilitySchemas } from './capabilities'
import { getPreferences } from './config'
import { loadIndex } from './kb/store'
import { getMode } from './modes/store'
import { executeTool } from './tools'

const MAX_ROUNDS = 10
const MAX_TOOLS = 14
const CHUNK_SIZE = 24
const CHUNK_INTERVAL_MS = 12
const TOOL_OUTPUT_LIMIT = 300
const TOOL_RESULT_LIMIT = 8000

const AGENT_SYSTEM = [
  '你是一名严谨的中文研究助手，可以调用工具完成任务。工作原则：',
  '1. 涉及用户本地资料、课程文档、已导入文件的问题，先调用 kb_search 检索；引用本地内容时写成（来源：文件名 · 第N段）。本地库无结果时再用 web_search。',
  '2. 需要最新信息、时事、具体数据或不确定的事实时，使用 web_search 检索；只挑最有价值的 2 到 3 条链接用 fetch_url 阅读原文。',
  '3. 结论中标注来源 URL；引用本地资料时标注（来源：文件名 · 第N段）；不许编造来源、链接、数据或引用。',
  '4. 需要查看目录时使用 list_files，需要读取具体文件时使用 read_file。',
  '5. 需要计算、整理数据或检查本机环境时，可以使用 run_command。',
  '6. 需要输出报告或保存结果时，使用 write_file。',
  '7. 信息不足或工具失败时明确说明，不要臆测。',
  '8. 工具调用要节制：整体不超过 6 次调用，同一条链接不要重复抓取；拿到足够信息就立即给出结论。',
  '9. 回答使用中文，结构清晰；最终回答只呈现结论与来源，不要罗列工具调用过程。'
].join('\n')

export type AgentSend = (channel: string, payload: unknown) => void

export interface AgentRunOptions {
  requestId: string
  messages: LlmMessage[]
  /** 本次对话使用的模式；缺省时回退普通问答 */
  modeId?: string
  model?: string
  temperature?: number
  send: AgentSend
  signal: AbortSignal
}

/**
 * 工具白名单取「模式 tools」与「全局 enabledTools」的交集。
 * 全局 enabledTools 为空表示全部开放；模式 tools 为空则不开放任何工具。
 */
function resolveToolIds(modeTools: string[], enabledTools: string[]): string[] {
  const agentIds = CAPABILITIES.filter((capability) => capability.agentEnabled).map(
    (capability) => capability.id
  )
  const globalIds = enabledTools.length > 0 ? enabledTools : agentIds
  return modeTools.filter((id) => globalIds.includes(id))
}

interface ToolEventPayload {
  requestId: string
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'failed'
  output?: string
}

/** 证据来源：联网来源带 url，本地资料带 path，至少有一个 */
interface EvidenceItem {
  title: string
  url?: string
  path?: string
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
  return items.filter((item) => item.url && /^https?:\/\//i.test(item.url))
}

/**
 * 从 kb_search 的固定返回格式中解析来源：
 * 形如 "[1] 文件名.md · 第2段（相关度 0.83）"，文件名与索引中的绝对路径对应后补上 path。
 */
async function parseKbEvidence(content: string): Promise<EvidenceItem[]> {
  const pattern = /^\[\d+\]\s*(.+?)\s*·\s*第(\d+)段(?:（相关度\s*[\d.]+）)?\s*$/gm
  const found: { title: string; file: string }[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const file = match[1].trim()
    if (!file) continue
    found.push({ title: `${file} · 第${match[2]}段`, file })
  }
  if (found.length === 0) return []

  const pathMap = new Map<string, string>()
  try {
    const index = await loadIndex()
    for (const document of index.documents) {
      const name = basename(document.path)
      if (!pathMap.has(name)) pathMap.set(name, document.path)
    }
  } catch {
    // 索引读取失败时只保留标题，不阻断回答
  }

  const items: EvidenceItem[] = []
  for (const { title, file } of found) {
    const path = pathMap.get(file)
    if (path) items.push({ title, path })
  }
  return items
}

/** 证据去重键：联网来源按 url，本地来源按 path */
function evidenceKey(item: EvidenceItem): string {
  return item.url || item.path || ''
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
  options: AgentRunOptions,
  temperature: number
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
      temperature,
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
  // 偏好设置与模式每次请求重新读取，改完设置后无需重启应用
  const preferences = getPreferences()
  const mode = await getMode(options.modeId)
  // 调用方显式传温度时优先，否则用模式温度
  const temperature = options.temperature ?? mode.temperature
  const extraPrompt = preferences.extraSystemPrompt.trim()
  // 基础规则 + 模式职责 + 用户全局提示词
  const promptParts = [AGENT_SYSTEM, mode.systemPrompt.trim(), extraPrompt].filter(
    (part) => part.length > 0
  )
  const systemPrompt = promptParts.join('\n\n')
  // 模式工具为空时 capabilitySchemas 不收窄，这里显式给空数组，即纯对话
  const allowedToolIds = resolveToolIds(mode.tools, preferences.enabledTools)
  const toolSchemas =
    allowedToolIds.length > 0 ? capabilitySchemas(allowedToolIds) : []

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
    { role: 'system', content: systemPrompt },
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
        tools: toolSchemas,
        toolChoice: 'auto',
        model: options.model,
        temperature,
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

        // 联网与本地检索成功后自动汇总来源，同一请求内按 url 或 path 去重
        if (outcome.ok && (name === 'web_search' || name === 'fetch_url' || name === 'kb_search')) {
          const parsed =
            name === 'kb_search' ? await parseKbEvidence(outcome.content) : parseEvidence(name, outcome.content)
          const fresh = parsed.filter((item) => {
            const key = evidenceKey(item)
            return key.length > 0 && !seenEvidence.has(key)
          })
          if (fresh.length > 0) {
            for (const item of fresh) seenEvidence.add(evidenceKey(item))
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
      finalContent = await forceFinalAnswer(conversation, options, temperature)
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
