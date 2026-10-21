import { basename } from 'node:path'
import {
  chatWithTools,
  type LlmAgentMessage,
  type LlmMessage,
  type LlmToolCall
} from './llm'
import { CAPABILITIES, capabilitySchemas } from './capabilities'
import { getPreferences, type WorkPreferences } from './config'
import { loadIndex } from './kb/store'
import { getMode } from './modes/store'
import type { WorkMode } from './modes/types'
import { executeTool } from './tools'

// 兜底默认：模式缺少执行控制字段时使用
const MAX_ROUNDS = 10
const MAX_TOOLS = 14
const CHUNK_SIZE = 24
const CHUNK_INTERVAL_MS = 12
const TOOL_OUTPUT_LIMIT = 300
const TOOL_RESULT_LIMIT = 8000

/** 输出格式约束：按模式追加在基础规则之后 */
const OUTPUT_STYLE_PROMPTS: Record<WorkMode['outputStyle'], string> = {
  free: '',
  bullets: '输出格式要求：结论用要点列表呈现，每条一句话，避免长段落与大段铺陈。',
  table: '输出格式要求：能表格化的内容优先用表格表达，表格列数不超过 5 列，表格外不再重复叙述。',
  report: '输出格式要求：按「摘要 / 分节正文 / 参考来源」三段结构组织回答，先给摘要，再分节展开，最后集中列出来源。'
}

/** 引用严格度约束 */
const CITATION_PROMPTS: Record<WorkMode['citationStrict'], string> = {
  required:
    '引用要求：每个事实性结论都必须标注来源，本地资料写「来源：文件名 · 第N段」，联网写 URL；找不到来源时要明确说明「暂无可靠来源」，不得省略标注。',
  preferred:
    '引用要求：尽量标注来源，本地资料写「来源：文件名 · 第N段」，联网写 URL；没有来源时不要强行编造。',
  off: '引用要求：不要求逐条标注来源，但不得编造事实、数据、链接或来源。'
}

/** 基础规则里的工具调用上限随模式变化，避免与可配置的 maxTools 冲突 */
function buildAgentSystem(maxTools: number): string {
  return [
    '你是一名严谨的中文研究助手，可以调用工具完成任务。工作原则：',
    '1. 涉及用户本地资料、课程文档、已导入文件的问题，先调用 kb_search 检索；引用本地内容时写成（来源：文件名 · 第N段）。本地库无结果时再用 web_search。',
    '2. 需要最新信息、时事、具体数据或不确定的事实时，使用 web_search 检索；只挑最有价值的 2 到 3 条链接用 fetch_url 阅读原文。',
    '3. 结论中标注来源 URL；引用本地资料时标注（来源：文件名 · 第N段）；不许编造来源、链接、数据或引用。',
    '4. 需要查看目录时使用 list_files，需要读取具体文件时使用 read_file。',
    '5. 需要计算、整理数据或检查本机环境时，可以使用 run_command。',
    '6. 需要输出报告或保存结果时，使用 write_file。',
    '7. 信息不足或工具失败时明确说明，不要臆测。',
    `8. 工具调用要节制：整体不超过 ${maxTools} 次调用，同一条链接不要重复抓取；拿到足够信息就立即给出结论。`,
    '9. 回答使用中文，结构清晰；最终回答只呈现结论与来源，不要罗列工具调用过程。'
  ].join('\n')
}

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

// -------- 工具审批（L1-1）--------

export interface ApprovalRequest {
  requestId: string
  toolName: string
  args: Record<string, unknown>
  reason: string
}

interface PendingApproval {
  resolve: (approved: boolean) => void
  timeout: NodeJS.Timeout
}

/** 等待用户审批的 Promise 表（key = requestId） */
const pendingApprovals = new Map<string, PendingApproval>()

/** 危险工具列表：这些工具可能修改文件或执行命令 */
const DANGEROUS_TOOLS = new Set(['write_file', 'run_command', 'run_shell'])

/**
 * 请求用户审批工具调用。
 * - auto 模式直接返回 true
 * - deny 模式直接返回 false
 * - ask 模式通过 send 发事件，等待渲染层回传（60s 超时自动 deny）
 */
async function askToolApproval(
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  policy: WorkPreferences['approvalPolicy'],
  send: AgentSend,
  signal?: AbortSignal
): Promise<boolean> {
  if (policy === 'auto') return true
  if (policy === 'deny') return false
  // ask 模式：非危险工具自动放行
  if (!DANGEROUS_TOOLS.has(toolName)) return true

  const reason =
    toolName === 'write_file'
      ? `将写入文件：${String(args.path ?? '(未知路径)')}`
      : `将执行命令：${String(args.command ?? '(未知命令)').slice(0, 80)}`

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(requestId)
      resolve(false) // 60s 超时自动 deny
    }, 60_000)

    pendingApprovals.set(requestId, { resolve, timeout })

    // 用户中止整个请求时，直接 deny
    if (signal) {
      const onAbort = () => {
        if (pendingApprovals.has(requestId)) {
          clearTimeout(timeout)
          pendingApprovals.delete(requestId)
          resolve(false)
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    send('work:tool:approve', {
      requestId,
      toolName,
      args,
      reason
    } satisfies ApprovalRequest)
  })
}

/** 渲染层回传审批结果时调用 */
export function resolveApproval(requestId: string, approved: boolean): void {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingApprovals.delete(requestId)
  pending.resolve(approved)
}

// ---------------- L5-4: [[...]] 引用展开 ----------------

/** 匹配 [[type:id]] 或 [[type:id|label]] 语法 */
const REF_PATTERN = /\[\[(\w+):([^\]|]+)(?:\|[^\]]+)?\]\]/g

/** 扫描并展开 user message 里的引用 */
async function expandReferences(content: string): Promise<string> {
  const matches = Array.from(content.matchAll(REF_PATTERN))
  if (matches.length === 0) return content

  let result = content
  for (const match of matches) {
    const [full, type, id] = match
    let expansion = `[引用类型 ${type} 暂未展开]`

    try {
      if (type === 'file') {
        // 读本地文件（最多 10000 字符，UTF-8）
        const { promises: fs } = await import('node:fs')
        const buf = await fs.readFile(id.trim())
        const text = buf.toString('utf-8').slice(0, 10000)
        expansion = `\n<引用文件 ${id.trim()}>\n${text}\n</引用>\n`
      } else if (type === 'mode') {
        expansion = `[模式切换提示：引用了模式 ${id.trim()}，Agent 会按该模式配置执行]`
      } else if (type === 'kb') {
        expansion = `[知识库引用：请用 kb_search 检索 docId=${id.trim()} 的内容]`
      } else if (type === 'session') {
        expansion = `[会话历史引用：请结合会话上下文理解 id=${id.trim()} 的消息]`
      }
    } catch {
      expansion = `[引用展开失败：${full}]`
    }

    result = result.replace(full, expansion)
  }
  return result
}

// ---------------- 证据来源接口 ----------------

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
  // 执行控制从模式读取，缺失字段回落到兜底常量
  const maxRounds = Number.isFinite(mode.maxRounds) ? mode.maxRounds : MAX_ROUNDS
  const maxTools = Number.isFinite(mode.maxTools) ? mode.maxTools : MAX_TOOLS
  const extraPrompt = preferences.extraSystemPrompt.trim()
  // 顺序：基础规则 → 输出格式/引用约束 → 模式提示词 → 全局提示词
  const behaviorPrompt = [
    OUTPUT_STYLE_PROMPTS[mode.outputStyle] ?? '',
    CITATION_PROMPTS[mode.citationStrict] ?? ''
  ]
    .filter((part) => part.length > 0)
    .join('\n')
  const promptParts = [
    buildAgentSystem(maxTools),
    behaviorPrompt,
    mode.systemPrompt.trim(),
    extraPrompt
  ].filter((part) => part.length > 0)
  const systemPrompt = promptParts.join('\n\n')
  // 模式工具为空时 capabilitySchemas 不收窄，这里显式给空数组，即纯对话
  const allowedToolIds = resolveToolIds(mode.tools, preferences.enabledTools)
  const toolSchemas =
    allowedToolIds.length > 0 ? await capabilitySchemas(allowedToolIds) : []

  // L5-4: 对 user message 展开 [[...]] 引用（文件/模式/KB/会话）
  const historyRaw: LlmAgentMessage[] = options.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) =>
      message.role === 'system'
        ? { role: 'system', content: message.content }
        : message.role === 'user'
          ? { role: 'user', content: message.content }
          : { role: 'assistant', content: message.content }
    )
  const history: LlmAgentMessage[] = []
  for (const msg of historyRaw) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: await expandReferences(msg.content) })
    } else {
      history.push(msg)
    }
  }
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
    for (let round = 0; round < maxRounds; round++) {
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
        if (toolCount >= maxTools || seenCalls.has(signature)) {
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

        // L1-1: 工具审批（ask 模式下危险操作需要用户确认）
        let outcome: { ok: boolean; content: string }
        if (parsed.ok && preferences.approvalPolicy === 'ask' && DANGEROUS_TOOLS.has(name)) {
          const approved = await askToolApproval(
            `${requestId}:${call.id}`,
            name,
            args,
            preferences.approvalPolicy,
            send,
            signal
          )
          if (!approved) {
            outcome = { ok: false, content: `用户拒绝了工具调用：${name}` }
            send('work:agent:tool', {
              requestId,
              id: call.id,
              name,
              args,
              status: 'failed' as const,
              output: outcome.content
            })
            continue
          }
        }

        outcome = parsed.ok
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
