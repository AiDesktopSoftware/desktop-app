<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  KbDocument,
  RagChunk,
  RagProviderId,
  RagResult,
  WorkCapability,
  WorkCapabilityPermission,
  WorkChatMessage,
  WorkEvidenceEvent,
  WorkEvidenceItem,
  WorkMessage,
  WorkSession,
  WorkSettingsStatus,
  WorkToolCall,
  WorkToolEvent
} from './types'

// 【工作模式】负责人：赵
// 当前阶段：DeepSeek Agent 工具循环 + 会话管理；工具轨迹在消息上方展示
// 能力注册表由主进程统一下发，界面直接执行与 Agent 调用共用同一份定义

const api = window.workApi

const SUGGESTIONS = [
  '梳理 2024 年以来多模态大模型在检索增强方向的进展',
  '对比 RAG 与长上下文两种方案在工程落地上的差异',
  '为我的课程设计写一份研究计划，包含目标、方法、验证方式'
]

interface RunResult {
  ok: boolean
  text: string
  message?: string
  aborted: boolean
}

interface PendingRequest {
  text: string
  onDelta?: (delta: string) => void
  onTool?: (event: WorkToolEvent) => void
  onEvidence?: (items: WorkEvidenceItem[]) => void
  settled: boolean
  aborted: boolean
  resolve: (result: RunResult) => void
}

const sessions = ref<WorkSession[]>([])
const activeSessionId = ref('')
const settings = ref<WorkSettingsStatus>({ configured: false, model: 'deepseek-flash' })
const settingsError = ref('')

const keyword = ref('')
const panelOpen = ref(true)
const tab = ref<'evidence' | 'artifacts'>('evidence')

// 知识库检索只作为当前视图状态，不写入会话持久化
const ragQuery = ref('')
const ragProvider = ref<RagProviderId>('local')
const ragLoading = ref(false)
const ragResult = ref<RagResult | null>(null)
const ragError = ref('')
let ragRequestToken = 0

// 本地知识库：资料列表与导入/删除状态，只保留在当前视图，不写入会话
const kbDocuments = ref<KbDocument[]>([])
const kbChunkCount = ref(0)
const kbImporting = ref(false)
const kbError = ref('')
const kbNotice = ref('')

const draft = ref('')
const busy = ref(false)
const busySessionId = ref('')
const stopping = ref(false)
const stopRequested = ref(false)
const currentRequestId = ref('')

const pendingDeleteId = ref('')
const streamEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)

// 能力面板（Ctrl + K）：列表 -> 参数表单 -> 执行结果
const capabilities = ref<WorkCapability[]>([])
const capOpen = ref(false)
const capSelected = ref<WorkCapability | null>(null)
const capArgs = ref<Record<string, string>>({})
const capRunning = ref(false)
const capResult = ref<{ ok: boolean; content: string } | null>(null)
const capPanelEl = ref<HTMLElement | null>(null)
const capFormEl = ref<HTMLElement | null>(null)

const handlers = new Map<string, PendingRequest>()
let scrollTimer: number | undefined
let deleteTimer: number | undefined
let persistTimer: number | undefined
let offChunk: (() => void) | undefined
let offDone: (() => void) | undefined
let offError: (() => void) | undefined
let offTool: (() => void) | undefined
let offEvidence: (() => void) | undefined

const activeSession = computed(
  () => sessions.value.find((session) => session.id === activeSessionId.value) ?? null
)
const activeMessages = computed(() => activeSession.value?.messages ?? [])

const filteredSessions = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return sessions.value
  return sessions.value.filter(
    (session) =>
      session.title.toLowerCase().includes(key) ||
      session.messages.some((message) => message.content.toLowerCase().includes(key))
  )
})

const groupedSessions = computed(() => {
  const groups = new Map<string, WorkSession[]>()
  const list = [...filteredSessions.value].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of list) {
    const name = dayGroup(session.updatedAt)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(session)
  }
  return Array.from(groups, ([name, items]) => ({ name, items }))
})

const currentTools = computed<WorkToolCall[]>(() => {
  const messages = activeMessages.value
  for (let i = messages.length - 1; i >= 0; i--) {
    const tools = messages[i].tools
    if (tools && tools.length > 0) return tools
  }
  return []
})

const doneToolCount = computed(
  () => currentTools.value.filter((tool) => tool.status === 'done').length
)

/** 右栏证据链：当前会话最后一条带来源的助手消息 */
const currentEvidence = computed<WorkEvidenceItem[]>(() => {
  const messages = activeMessages.value
  for (let i = messages.length - 1; i >= 0; i--) {
    const evidence = messages[i].evidence
    if (evidence && evidence.length > 0) return evidence
  }
  return []
})

const capResultText = computed(() => {
  if (!capResult.value) return ''
  const content = capResult.value.content
  return content.length > 2000 ? `${content.slice(0, 2000)}\n……` : content
})

function evidenceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function ragOrigin(chunk: RagChunk): string {
  if (chunk.source.url) return evidenceDomain(chunk.source.url)
  if (chunk.source.path) return fileName(chunk.source.path)
  return '来源未标注'
}

/** 从完整路径中取文件名，用于窄栏里的来源展示 */
function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

/** 刷新本地知识库列表；失败时只在区块内提示，不影响对话 */
async function refreshKb(): Promise<void> {
  try {
    const result = await api.kbList()
    if (!result.ok) {
      kbError.value = result.message || '读取本地知识库失败'
      return
    }
    kbDocuments.value = Array.isArray(result.documents) ? result.documents : []
    kbChunkCount.value = result.chunkCount
  } catch (error) {
    kbError.value = error instanceof Error ? error.message : '读取本地知识库失败'
  }
}

async function importKb(): Promise<void> {
  if (kbImporting.value) return
  kbImporting.value = true
  kbError.value = ''
  kbNotice.value = ''
  try {
    const result = await api.kbImport()
    if (!result.ok) {
      kbError.value = result.message || '导入失败'
      return
    }
    if (result.canceled) return
    await refreshKb()

    const skipped = Array.isArray(result.skipped) ? result.skipped : []
    let notice = `新增 ${result.added.length} 篇`
    if (skipped.length > 0) {
      const first = skipped[0]
      const name = fileName(first.path) || '未知文件'
      notice += `，跳过 ${skipped.length} 篇：${name}（${first.reason}）`
    }
    kbNotice.value = notice
  } catch (error) {
    kbError.value = error instanceof Error ? error.message : '导入失败'
  } finally {
    kbImporting.value = false
  }
}

/** 点击即删除，不弹确认；删除后刷新列表 */
async function removeKb(docId: string): Promise<void> {
  if (!docId) return
  kbError.value = ''
  kbNotice.value = ''
  try {
    const result = await api.kbRemove(docId)
    if (!result.ok) kbError.value = result.message || '删除失败'
  } catch (error) {
    kbError.value = error instanceof Error ? error.message : '删除失败'
  }
  await refreshKb()
}

/** 切换会话或新建会话时清空检索视图，并让仍在途的请求失效 */
function resetRagSearch(): void {
  ragRequestToken += 1
  ragQuery.value = ''
  ragProvider.value = 'local'
  ragLoading.value = false
  ragResult.value = null
  ragError.value = ''
}

function onRagEnter(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  void searchKnowledge()
}

async function searchKnowledge(): Promise<void> {
  const text = ragQuery.value.trim()
  if (!text || ragLoading.value) return
  const token = ++ragRequestToken
  ragLoading.value = true
  ragResult.value = null
  ragError.value = ''
  try {
    const result = await api.searchRag({ query: text, provider: ragProvider.value, topK: 5 })
    if (token !== ragRequestToken) return
    if (result.ok) {
      ragResult.value = result
    } else {
      ragError.value = result.message || '检索失败'
    }
  } catch (error) {
    if (token !== ragRequestToken) return
    ragError.value = error instanceof Error ? error.message : '检索失败'
  } finally {
    if (token === ragRequestToken) ragLoading.value = false
  }
}

const collapsedTools = ref<Record<string, boolean>>({})

function toolsOpen(message: WorkMessage): boolean {
  const running = Boolean(message.tools?.some((tool) => tool.status === 'running'))
  return running || !collapsedTools.value[message.id]
}

function toggleTools(message: WorkMessage): void {
  collapsedTools.value[message.id] = toolsOpen(message) ? false : true
}

/** 工具中文名同样来自能力注册表，渲染层不再重复维护映射 */
const capabilityLabels = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const capability of capabilities.value) map[capability.id] = capability.label
  return map
})

function toolLabel(name: string): string {
  return capabilityLabels.value[name] ?? name
}

function permissionText(permission: WorkCapabilityPermission): string {
  if (permission === 'write') return '写入'
  if (permission === 'exec') return '执行'
  return '只读'
}

function toolArgSummary(args: Record<string, unknown>): string {
  const keys = ['query', 'url', 'path', 'dir', 'command']
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      const single = value.replace(/\s+/g, ' ').trim()
      return single.length > 40 ? `${single.slice(0, 40)}…` : single
    }
  }
  return ''
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function dayGroup(timestamp: number): string {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (timestamp >= startOfToday) return '今天'
  if (timestamp >= startOfToday - 86_400_000) return '昨天'
  return '更早'
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (new Date().toDateString() === date.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return `${date.getMonth() + 1}-${date.getDate()}`
}

function statusText(status: WorkToolCall['status']): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'done':
      return '完成'
    default:
      return '失败'
  }
}

function scrollToBottom(smooth = false): void {
  void nextTick(() => {
    const el = streamEl.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  })
}

function scheduleScroll(): void {
  if (scrollTimer !== undefined) return
  scrollTimer = window.setTimeout(() => {
    scrollTimer = undefined
    scrollToBottom()
  }, 80)
}

/** 订阅主进程的流式事件，按 requestId 分发，避免多个请求串台 */
function settle(requestId: string, result: RunResult): void {
  const entry = handlers.get(requestId)
  if (!entry || entry.settled) return
  entry.settled = true
  handlers.delete(requestId)
  if (currentRequestId.value === requestId) currentRequestId.value = ''
  entry.resolve(result)
}

function startRequest(
  mode: 'chat' | 'agent',
  messages: WorkChatMessage[],
  callbacks: {
    onDelta?: (delta: string) => void
    onTool?: (event: WorkToolEvent) => void
    onEvidence?: (items: WorkEvidenceItem[]) => void
  } = {}
): Promise<RunResult> {
  const requestId = uid()
  currentRequestId.value = requestId
  return new Promise<RunResult>((resolve) => {
    const entry: PendingRequest = {
      text: '',
      onDelta: callbacks.onDelta,
      onTool: callbacks.onTool,
      onEvidence: callbacks.onEvidence,
      settled: false,
      aborted: false,
      resolve
    }
    handlers.set(requestId, entry)

    api
      .chatStart({ requestId, messages, mode })
      .then((result) => {
        settle(requestId, {
          ok: result.ok,
          text: entry.text,
          message: result.message,
          aborted: entry.aborted
        })
      })
      .catch((error: unknown) => {
        settle(requestId, {
          ok: false,
          text: entry.text,
          message: error instanceof Error ? error.message : '请求发送失败',
          aborted: entry.aborted
        })
      })
  })
}

function makeTitle(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (!single) return '新的研究'
  return single.length > 22 ? `${single.slice(0, 22)}…` : single
}

function buildHistory(session: WorkSession, assistantId: string): WorkChatMessage[] {
  const index = session.messages.findIndex((message) => message.id === assistantId)
  const prior = index >= 0 ? session.messages.slice(0, index) : session.messages
  return prior
    .filter((message) => message.content.trim().length > 0)
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 6000)
    }))
}

/** 把仍在运行的工具标记为中断，避免界面一直转圈 */
function markInterruptedTools(assistant: WorkMessage): void {
  if (!assistant.tools) return
  for (const tool of assistant.tools) {
    if (tool.status === 'running') {
      tool.status = 'failed'
      tool.output = tool.output || '执行被中断'
    }
  }
}

function finishAborted(assistant: WorkMessage, session: WorkSession): void {
  markInterruptedTools(assistant)
  if (!assistant.content.trim()) assistant.content = '已停止生成。'
  assistant.streaming = false
  session.updatedAt = Date.now()
}

/** 按 requestId 把主进程推送的工具状态合并进当前助手消息 */
function applyToolEvent(assistant: WorkMessage, event: WorkToolEvent): void {
  if (!assistant.tools) assistant.tools = []
  const existing = assistant.tools.find((tool) => tool.id === event.id)
  if (existing) {
    existing.name = event.name
    existing.args = event.args
    existing.status = event.status
    if (event.output !== undefined) existing.output = event.output
  } else {
    assistant.tools.push({
      id: event.id,
      name: event.name,
      args: event.args,
      status: event.status,
      ...(event.output !== undefined ? { output: event.output } : {})
    })
  }
}

/** 把主进程推送的来源追加到助手消息，渲染层再按 url 兜底去重 */
function applyEvidence(assistant: WorkMessage, items: WorkEvidenceItem[]): void {
  if (!assistant.evidence) assistant.evidence = []
  for (const item of items) {
    if (!item || typeof item.url !== 'string' || !item.url) continue
    if (assistant.evidence.some((existing) => existing.url === item.url)) continue
    assistant.evidence.push({ title: item.title || item.url, url: item.url })
  }
}

/**
 * Agent 对话：主进程负责工具循环，这里只负责消息、流式文字与轨迹状态。
 * assistant 传入时表示重试已有消息，不再新建消息。
 */
async function runAgent(
  question: string,
  session: WorkSession,
  options: { assistant?: WorkMessage } = {}
): Promise<void> {
  let assistant: WorkMessage =
    options.assistant ??
    ({
      id: uid(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true
    } satisfies WorkMessage)

  if (!options.assistant) {
    session.messages.push(assistant)
    // 同样取回代理对象，保证流式文字、工具轨迹与证据链能实时刷新
    assistant = session.messages[session.messages.length - 1]
  }
  assistant.streaming = true
  session.updatedAt = Date.now()

  busy.value = true
  busySessionId.value = session.id
  stopping.value = false
  stopRequested.value = false
  await persist()
  scrollToBottom()

  try {
    const history = buildHistory(session, assistant.id)
    const messages: WorkChatMessage[] =
      history.length > 0 ? history : [{ role: 'user', content: question }]

    const result = await startRequest('agent', messages, {
      onDelta: (delta) => {
        assistant.content += delta
        scheduleScroll()
      },
      onTool: (event) => {
        if (stopRequested.value) return
        applyToolEvent(assistant, event)
        session.updatedAt = Date.now()
        scheduleScroll()
        schedulePersist()
      },
      onEvidence: (items) => {
        if (stopRequested.value) return
        applyEvidence(assistant, items)
        session.updatedAt = Date.now()
        schedulePersist()
      }
    })

    if (result.aborted || stopRequested.value) {
      finishAborted(assistant, session)
      return
    }
    if (!result.ok) {
      assistant.error = result.message || '生成失败'
    } else if (!assistant.content.trim() && !assistant.tools?.length) {
      assistant.error = '模型未返回内容，请重试。'
    }
    session.updatedAt = Date.now()
    await persist()
  } catch (error) {
    assistant.error = error instanceof Error ? error.message : '未知错误'
  } finally {
    markInterruptedTools(assistant)
    assistant.streaming = false
    session.updatedAt = Date.now()
    busy.value = false
    busySessionId.value = ''
    stopping.value = false
    currentRequestId.value = ''
    await persist()
    scrollToBottom()
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || busy.value) return
  draft.value = ''

  let session = activeSession.value
  if (!session) {
    session = {
      id: uid(),
      title: makeTitle(text),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    }
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    // 取回响应式代理：直接持有新建的原始对象时，后续字段变更不会触发渲染
    session = sessions.value[0]
  }
  if (!session.messages.some((message) => message.role === 'user')) {
    session.title = makeTitle(text)
  }

  session.messages.push({
    id: uid(),
    role: 'user',
    content: text,
    createdAt: Date.now()
  })
  session.updatedAt = Date.now()

  await runAgent(text, session)
}

function onEnterKey(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  void send()
}

async function stopGeneration(): Promise<void> {
  if (!busy.value || stopping.value) return
  stopping.value = true
  stopRequested.value = true
  const requestId = currentRequestId.value
  if (requestId) {
    const entry = handlers.get(requestId)
    if (entry) entry.aborted = true
    try {
      await api.chatAbort(requestId)
    } catch {
      // 中断失败时让流程自然结束
    }
  }
}

async function retryMessage(message: WorkMessage): Promise<void> {
  if (busy.value || message.role !== 'assistant') return
  const session = activeSession.value
  if (!session) return

  const index = session.messages.findIndex((item) => item.id === message.id)
  if (index < 0) return
  let userIndex = index - 1
  while (userIndex >= 0 && session.messages[userIndex].role !== 'user') userIndex--
  if (userIndex < 0) return

  const question = session.messages[userIndex].content
  message.content = ''
  message.error = undefined
  message.tools = undefined
  message.evidence = undefined
  await runAgent(question, session, { assistant: message })
}

function newSession(): void {
  if (busy.value) return
  activeSessionId.value = ''
  draft.value = ''
  pendingDeleteId.value = ''
  resetRagSearch()
  scrollToBottom()
  void nextTick(() => textareaEl.value?.focus())
}

function selectSession(id: string): void {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  pendingDeleteId.value = ''
  resetRagSearch()
  scrollToBottom()
}

function useSuggestion(text: string): void {
  draft.value = text
  void nextTick(() => textareaEl.value?.focus())
}

function requestDelete(id: string): void {
  if (busy.value && busySessionId.value === id) return
  pendingDeleteId.value = id
  if (deleteTimer !== undefined) window.clearTimeout(deleteTimer)
  deleteTimer = window.setTimeout(() => {
    pendingDeleteId.value = ''
    deleteTimer = undefined
  }, 3000)
}

function cancelDelete(): void {
  pendingDeleteId.value = ''
  if (deleteTimer !== undefined) {
    window.clearTimeout(deleteTimer)
    deleteTimer = undefined
  }
}

function confirmDelete(id: string): void {
  if (busy.value && busySessionId.value === id) return
  sessions.value = sessions.value.filter((session) => session.id !== id)
  cancelDelete()
  if (activeSessionId.value === id) {
    const next = [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    activeSessionId.value = next?.id ?? ''
    resetRagSearch()
  }
  void persist()
}

// ---------------- 能力面板 ----------------

function openCaps(): void {
  capOpen.value = true
  capSelected.value = null
  capArgs.value = {}
  capResult.value = null
  void nextTick(() => capPanelEl.value?.focus())
}

function closeCaps(): void {
  capOpen.value = false
  capSelected.value = null
  capResult.value = null
}

function toggleCaps(): void {
  if (capOpen.value) {
    closeCaps()
  } else {
    openCaps()
  }
}

function selectCapability(capability: WorkCapability): void {
  capSelected.value = capability
  capResult.value = null
  const values: Record<string, string> = {}
  for (const field of capability.fields) values[field.key] = ''
  capArgs.value = values
  void nextTick(() => {
    capFormEl.value?.querySelector<HTMLElement>('input, textarea')?.focus()
  })
}

function backToCapList(): void {
  capSelected.value = null
  capResult.value = null
  void nextTick(() => capPanelEl.value?.focus())
}

function clearCapResult(): void {
  capResult.value = null
}

/** 与 Agent 调用同一条执行路径，直接走主进程 executeTool，不做逐次确认 */
async function executeCapability(): Promise<void> {
  const capability = capSelected.value
  if (!capability || capRunning.value) return

  const args: Record<string, unknown> = {}
  for (const field of capability.fields) {
    args[field.key] = (capArgs.value[field.key] ?? '').trim()
  }

  capRunning.value = true
  capResult.value = null
  try {
    const result = await api.runCapability(capability.id, args)
    capResult.value = { ok: result.ok, content: result.content }
  } catch (error) {
    capResult.value = {
      ok: false,
      content: error instanceof Error ? error.message : '能力执行失败'
    }
  } finally {
    capRunning.value = false
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    toggleCaps()
    return
  }
  if (event.key === 'Escape' && capOpen.value) {
    event.preventDefault()
    closeCaps()
  }
}

function serializeSessions(): WorkSession[] {
  return sessions.value.map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.tools?.length
        ? {
            tools: message.tools.map((tool) => ({
              id: tool.id,
              name: tool.name,
              args: { ...tool.args },
              status: tool.status,
              ...(tool.output ? { output: tool.output.slice(0, 300) } : {})
            }))
          }
        : {}),
      ...(message.evidence?.length
        ? {
            evidence: message.evidence.map((item) => ({
              title: item.title,
              url: item.url
            }))
          }
        : {}),
      ...(message.error ? { error: message.error } : {})
    }))
  }))
}

let persistQueue: Promise<void> = Promise.resolve()

function persist(): Promise<void> {
  persistQueue = persistQueue.then(async () => {
    try {
      await api.saveSessions(serializeSessions())
    } catch (error) {
      console.warn('会话保存失败', error)
    }
  })
  return persistQueue
}

function schedulePersist(): void {
  if (persistTimer !== undefined) return
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined
    void persist()
  }, 300)
}

function restoreSession(raw: WorkSession): WorkSession {
  const messages = Array.isArray(raw.messages) ? raw.messages : []
  return {
    ...raw,
    messages: messages.map((message) => ({
      ...message,
      streaming: false,
      tools: Array.isArray(message.tools)
        ? message.tools.map((tool) =>
            tool.status === 'running'
              ? {
                  ...tool,
                  status: 'failed' as const,
                  output: tool.output || '上次执行被中断'
                }
              : tool
          )
        : undefined
    }))
  }
}

onMounted(async () => {
  offChunk = api.onChunk(({ requestId, delta }) => {
    const entry = handlers.get(requestId)
    if (!entry) return
    entry.text += delta
    entry.onDelta?.(delta)
  })
  offDone = api.onDone(({ requestId }) => {
    const entry = handlers.get(requestId)
    if (!entry) return
    settle(requestId, {
      ok: true,
      text: entry.text,
      aborted: entry.aborted
    })
  })
  offError = api.onError(({ requestId, message }) => {
    const entry = handlers.get(requestId)
    if (!entry) return
    settle(requestId, {
      ok: false,
      text: entry.text,
      message,
      aborted: entry.aborted
    })
  })
  offTool = api.onTool((event) => {
    const entry = handlers.get(event.requestId)
    if (!entry) return
    entry.onTool?.(event)
  })
  offEvidence = api.onEvidence((event: WorkEvidenceEvent) => {
    const entry = handlers.get(event.requestId)
    if (!entry) return
    entry.onEvidence?.(event.items)
  })
  window.addEventListener('keydown', onGlobalKeydown)

  // 能力元数据加载失败时面板给出提示，不影响会话与对话
  api
    .listCapabilities()
    .then((list) => {
      capabilities.value = Array.isArray(list) ? list : []
    })
    .catch(() => {
      capabilities.value = []
    })

  try {
    const [status, list] = await Promise.all([api.settingsStatus(), api.loadSessions()])
    settings.value = status
    sessions.value = Array.isArray(list) ? list.map(restoreSession) : []
    if (sessions.value.length > 0) {
      const latest = [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      activeSessionId.value = latest.id
    }
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '读取配置失败'
  }
  void refreshKb()
  scrollToBottom()
})

onBeforeUnmount(() => {
  offChunk?.()
  offDone?.()
  offError?.()
  offTool?.()
  offEvidence?.()
  window.removeEventListener('keydown', onGlobalKeydown)
  if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
  if (deleteTimer !== undefined) window.clearTimeout(deleteTimer)
  if (persistTimer !== undefined) window.clearTimeout(persistTimer)
  const requestId = currentRequestId.value
  if (requestId) void api.chatAbort(requestId)
})
</script>

<template>
  <section class="work" :class="{ 'is-inspector-hidden': !panelOpen }">
    <!-- 左：会话列表 -->
    <aside class="rail">
      <div class="rail-head">
        <button class="new-btn" :disabled="busy" @click="newSession">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新建研究
        </button>
      </div>

      <label class="rail-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <circle cx="11" cy="11" r="6" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input v-model="keyword" type="text" placeholder="搜索会话" />
      </label>

      <div class="rail-scroll">
        <div v-if="groupedSessions.length === 0" class="rail-empty">
          {{ sessions.length === 0 ? '还没有会话，从右侧提问开始' : '没有匹配的会话' }}
        </div>

        <div v-for="group in groupedSessions" :key="group.name" class="rail-section">
          <div class="rail-label">{{ group.name }}</div>
          <div
            v-for="session in group.items"
            :key="session.id"
            class="rail-item session"
            :class="{ 'is-active': activeSessionId === session.id }"
            @click="selectSession(session.id)"
          >
            <span class="rail-item-text" :title="session.title">{{ session.title }}</span>
            <span v-if="pendingDeleteId !== session.id" class="rail-item-count">
              {{ formatSessionTime(session.updatedAt) }}
            </span>
            <button
              v-if="pendingDeleteId !== session.id"
              class="del-btn"
              title="删除会话"
              @click.stop="requestDelete(session.id)"
            >
              ×
            </button>
            <template v-else>
              <button class="del-confirm" @click.stop="confirmDelete(session.id)">确认</button>
              <button class="del-cancel" @click.stop="cancelDelete">取消</button>
            </template>
          </div>
        </div>
      </div>

      <div class="rail-foot" :title="settings.keyHint ? `Key ${settings.keyHint}` : ''">
        <span class="dot" :class="{ 'is-off': !settings.configured }" />
        <span v-if="settingsError">{{ settingsError }}</span>
        <span v-else-if="settings.configured">已连接 · {{ settings.model }}</span>
        <span v-else>未配置 API Key</span>
      </div>
    </aside>

    <!-- 中：对话流 -->
    <section class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="live-dot" :class="{ 'is-busy': busy }" />
          <h2>{{ activeSession?.title || '新的研究任务' }}</h2>
          <span class="tag">Agent</span>
        </div>
        <div class="top-actions">
          <span class="pill">模型 · {{ settings.model }}</span>
          <span class="pill" :class="{ 'is-warn': !settings.configured }">
            {{ settings.configured ? 'API 已配置' : 'API 未配置' }}
          </span>
          <button class="cap-btn" title="打开能力面板（Ctrl + K）" @click="toggleCaps">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
            能力
            <span class="cap-kbd">Ctrl K</span>
          </button>
          <button
            class="icon-btn"
            :class="{ 'is-on': panelOpen }"
            :title="panelOpen ? '收起右侧面板' : '展开右侧面板'"
            @click="panelOpen = !panelOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <path d="M15 4.5v15" />
            </svg>
          </button>
        </div>
      </header>

      <div ref="streamEl" class="stream">
        <div v-if="activeMessages.length === 0" class="empty">
          <div class="empty-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />
              <path d="M12 12v8.5M12 12 4 8M12 12l8-4" />
            </svg>
          </div>
          <h3>开始一个研究任务</h3>
          <p>
            描述研究问题，Agent 会自动联网搜索、读取网页、读写本地文件或执行命令，
            最后给出带来源的结论，全程无需逐步确认。
          </p>
          <div class="suggests">
            <button
              v-for="item in SUGGESTIONS"
              :key="item"
              class="suggest"
              @click="useSuggestion(item)"
            >
              {{ item }}
            </button>
          </div>
        </div>

        <template v-for="message in activeMessages" :key="message.id">
          <div v-if="message.role === 'user'" class="msg user">
            <div class="bubble">{{ message.content }}</div>
          </div>

          <div v-else class="msg agent">
            <div class="avatar">
              <span class="avatar-core" />
            </div>
            <div class="agent-body">
              <div v-if="message.tools && message.tools.length" class="agent-trace">
                <button class="at-head" @click="toggleTools(message)">
                  <span class="at-title">执行轨迹</span>
                  <span class="at-count">{{ message.tools.length }} 步</span>
                  <span class="at-caret" :class="{ 'is-open': toolsOpen(message) }">▾</span>
                </button>
                <ul v-if="toolsOpen(message)" class="at-list">
                  <li
                    v-for="tool in message.tools"
                    :key="tool.id"
                    class="at-item"
                    :class="'is-' + tool.status"
                  >
                    <span class="at-dot" />
                    <div class="at-body">
                      <div class="at-line">
                        <span class="at-name">{{ toolLabel(tool.name) }}</span>
                        <span class="at-state">{{ statusText(tool.status) }}</span>
                      </div>
                      <p v-if="toolArgSummary(tool.args)" class="at-arg">
                        {{ toolArgSummary(tool.args) }}
                      </p>
                      <p
                        v-if="tool.status === 'failed' && tool.output"
                        class="at-error"
                        :title="tool.output"
                      >
                        {{ tool.output }}
                      </p>
                    </div>
                  </li>
                </ul>
              </div>

              <div v-if="message.content || message.streaming" class="bubble agent-bubble">
                {{ message.content }}
                <span v-if="message.streaming" class="caret" />
              </div>

              <div v-if="message.error" class="msg-error">
                <span class="err-text">{{ message.error }}</span>
                <button class="retry-btn" :disabled="busy" @click="retryMessage(message)">
                  重试
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <footer class="composer">
        <div class="composer-box">
          <div class="composer-chips">
            <span class="chip">联网搜索 · 自动</span>
            <span class="chip">文件读写 · 自动</span>
            <span class="chip">本机命令 · 自动</span>
          </div>
          <textarea
            ref="textareaEl"
            v-model="draft"
            rows="2"
            placeholder="描述研究问题，Enter 发送，Shift + Enter 换行"
            @keydown.enter.exact="onEnterKey"
          />
          <div class="composer-foot">
            <span class="hint">
              {{ busy ? '正在执行，可随时停止' : 'Agent 自动调用工具，请核对关键来源' }}
            </span>
            <button v-if="busy" class="stop-btn" :disabled="stopping" @click="stopGeneration">
              <span class="stop-icon" />
              停止
            </button>
            <button v-else class="send-btn" :disabled="!draft.trim()" @click="send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h13M13 6l6 6-6 6" />
              </svg>
              发送
            </button>
          </div>
        </div>
      </footer>
    </section>

    <!-- 右：证据 / 产物 -->
    <aside v-if="panelOpen" class="inspector">
      <div class="tabs">
        <button :class="{ 'is-active': tab === 'evidence' }" @click="tab = 'evidence'">证据链</button>
        <button :class="{ 'is-active': tab === 'artifacts' }" @click="tab = 'artifacts'">产物</button>
      </div>

      <div class="insp-scroll">
        <template v-if="tab === 'evidence'">
          <div class="insp-block kb-block">
            <div class="insp-head kb-head">
              <h4>本地知识库</h4>
              <span class="note">{{ kbDocuments.length }} 篇 · {{ kbChunkCount }} 片段</span>
              <button class="kb-import" :disabled="kbImporting" @click="importKb">
                {{ kbImporting ? '导入中…' : '导入文件' }}
              </button>
            </div>

            <div v-if="kbError" class="rag-error">{{ kbError }}</div>
            <div v-if="kbNotice" class="kb-notice">{{ kbNotice }}</div>

            <ul v-if="kbDocuments.length" class="kb-list">
              <li v-for="doc in kbDocuments" :key="doc.id" class="kb-item">
                <div class="kb-line">
                  <span class="kb-title" :title="doc.title">{{ doc.title }}</span>
                  <button class="kb-del" title="删除该资料" @click="removeKb(doc.id)">×</button>
                </div>
                <div class="kb-line kb-sub">
                  <span class="kb-count">{{ doc.chunkCount }} 片段</span>
                  <span class="kb-file" :title="doc.path">{{ fileName(doc.path) }}</span>
                </div>
              </li>
            </ul>
            <div v-else class="kb-empty">尚未导入资料，支持 txt / md / html / json / csv</div>
          </div>

          <div class="insp-block rag-block">
            <div class="insp-head">
              <h4>知识库检索</h4>
              <span class="note">{{ ragResult?.chunks.length ?? 0 }} 条</span>
            </div>
            <div class="rag-form">
              <input
                v-model="ragQuery"
                type="text"
                placeholder="输入检索问题，Enter 检索"
                :disabled="ragLoading"
                @keydown.enter="onRagEnter"
              />
              <select v-model="ragProvider" :disabled="ragLoading">
                <option value="local">本地库</option>
                <option value="cloud">云端公共库</option>
                <option value="both">双路合并</option>
              </select>
              <button
                class="rag-run"
                :disabled="ragLoading || !ragQuery.trim()"
                @click="searchKnowledge"
              >
                {{ ragLoading ? '检索中…' : '检索' }}
              </button>
            </div>

            <div v-if="ragError" class="rag-error">{{ ragError }}</div>

            <div v-if="ragResult && ragResult.chunks.length" class="rag-results">
              <article
                v-for="chunk in ragResult.chunks"
                :key="chunk.chunkId"
                class="rag-item"
                :class="{ 'has-demo': chunk.demo }"
              >
                <span v-if="chunk.demo" class="rag-demo-badge">演示</span>
                <p class="rag-item-text">{{ chunk.text }}</p>
                <div class="rag-source">
                  <a
                    v-if="chunk.source.url"
                    class="rag-source-title"
                    :href="chunk.source.url"
                    target="_blank"
                    rel="noreferrer"
                    :title="chunk.source.title"
                  >
                    {{ chunk.source.title }}
                  </a>
                  <span v-else class="rag-source-title" :title="chunk.source.title">
                    {{ chunk.source.title }}
                  </span>
                  <span class="rag-origin">{{ ragOrigin(chunk) }}</span>
                </div>
                <div class="rag-foot">
                  <span class="rag-provider" :class="'is-' + chunk.provider">
                    {{ chunk.provider === 'local' ? '本地' : '云端' }}
                  </span>
                  <span class="rag-score">分数 {{ chunk.score.toFixed(2) }}</span>
                </div>
              </article>
            </div>

            <div v-if="ragResult?.note" class="rag-note">{{ ragResult.note }}</div>
            <div
              v-else-if="!ragLoading && ragResult && ragResult.chunks.length === 0"
              class="rag-empty"
            >
              没有匹配的片段。
            </div>
          </div>

          <div class="insp-block">
            <div class="insp-head">
              <h4>检索来源</h4>
              <span class="note">{{ currentEvidence.length }} 条</span>
            </div>
            <ul v-if="currentEvidence.length" class="evidence">
              <li v-for="item in currentEvidence" :key="item.url">
                <a :href="item.url" target="_blank" rel="noreferrer" :title="item.url">
                  <span class="ev-title">{{ item.title }}</span>
                  <span class="ev-host">{{ evidenceDomain(item.url) }}</span>
                </a>
              </li>
            </ul>
            <div v-else class="panel-empty">
              <p>来源会标注在回答中</p>
              <span>Agent 联网搜索或读取网页后，来源会自动汇总到这里。</span>
            </div>
          </div>

          <div v-if="currentTools.length" class="insp-block">
            <div class="insp-head">
              <h4>执行轨迹</h4>
              <span class="note">{{ doneToolCount }} / {{ currentTools.length }}</span>
            </div>
            <ul class="trace">
              <li
                v-for="tool in currentTools"
                :key="tool.id"
                :class="'is-' + tool.status"
              >
                <span class="trace-dot" />
                <span class="trace-title">
                  {{ toolLabel(tool.name) }}
                  <template v-if="toolArgSummary(tool.args)">
                    · {{ toolArgSummary(tool.args) }}
                  </template>
                </span>
                <span class="trace-state">{{ statusText(tool.status) }}</span>
              </li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="insp-block">
            <div class="insp-head">
              <h4>产物</h4>
              <span class="note">0 项</span>
            </div>
            <div class="panel-empty">
              <p>暂无可导出的产物</p>
              <span>报告导出与证据清单将在后续阶段提供。</span>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <!-- 能力面板：列表 / 参数表单 / 执行结果 -->
    <div v-if="capOpen" class="cap-mask" @click.self="closeCaps">
      <div ref="capPanelEl" class="cap-panel" tabindex="-1">
        <header class="cap-head">
          <h4>能力面板</h4>
          <span class="cap-kbd">Ctrl + K</span>
          <button class="cap-close" title="关闭" @click="closeCaps">×</button>
        </header>

        <div v-if="!capSelected" class="cap-list">
          <button
            v-for="capability in capabilities"
            :key="capability.id"
            class="cap-item"
            @click="selectCapability(capability)"
          >
            <span class="cap-item-top">
              <span class="cap-name">{{ capability.label }}</span>
              <span class="cap-perm" :class="'is-' + capability.permission">
                {{ permissionText(capability.permission) }}
              </span>
            </span>
            <span class="cap-desc">{{ capability.description }}</span>
          </button>
          <div v-if="capabilities.length === 0" class="cap-tip">
            能力列表尚未加载，请稍后重试。
          </div>
        </div>

        <template v-else>
          <div ref="capFormEl" class="cap-form">
            <button class="cap-back" @click="backToCapList">← 返回能力列表</button>
            <div class="cap-form-title">
              <span class="cap-name">{{ capSelected.label }}</span>
              <span class="cap-perm" :class="'is-' + capSelected.permission">
                {{ permissionText(capSelected.permission) }}
              </span>
            </div>
            <p class="cap-desc">{{ capSelected.description }}</p>

            <label v-for="field in capSelected.fields" :key="field.key" class="cap-field">
              <span class="cap-field-label">{{ field.label }}</span>
              <textarea
                v-if="field.multiline"
                v-model="capArgs[field.key]"
                rows="3"
                :placeholder="field.placeholder || ''"
                @keydown.enter.ctrl.prevent="executeCapability"
              />
              <input
                v-else
                v-model="capArgs[field.key]"
                type="text"
                :placeholder="field.placeholder || ''"
                @keydown.enter.prevent="executeCapability"
              />
            </label>

            <div class="cap-actions">
              <button class="cap-run" :disabled="capRunning" @click="executeCapability">
                {{ capRunning ? '执行中…' : '执行' }}
              </button>
              <span class="cap-hint">回车执行，多行字段用 Ctrl + Enter</span>
            </div>
          </div>

          <div v-if="capResult" class="cap-result" :class="capResult.ok ? 'is-ok' : 'is-error'">
            <div class="cap-result-head">
              <span class="cap-result-state">{{ capResult.ok ? '执行成功' : '执行失败' }}</span>
              <span v-if="capResult.content.length > 2000" class="cap-result-note">
                仅显示前 2000 字
              </span>
              <button class="cap-result-close" title="关闭结果" @click="clearCapResult">×</button>
            </div>
            <pre class="cap-result-body">{{ capResultText }}</pre>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.work {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 300px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.work.is-inspector-hidden {
  grid-template-columns: 236px minmax(0, 1fr);
}

/* ---------------- 左栏 ---------------- */

.rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.022), transparent 42%), var(--bg-1);
  border-right: 1px solid var(--line);
}

.rail-head {
  padding: 14px 12px 8px;
}

.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: #0b0d11;
  background: var(--accent);
  border-radius: var(--radius-sm);
  transition: filter 0.18s ease, opacity 0.18s ease;
}

.new-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.new-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.new-btn svg {
  width: 14px;
  height: 14px;
}

.rail-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 12px 10px;
  padding: 6px 9px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.rail-search:focus-within {
  border-color: var(--line-2);
  color: var(--text-2);
}

.rail-search svg {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
}

.rail-search input {
  width: 100%;
  font-size: 12px;
  color: var(--text);
  background: none;
  border: 0;
  outline: none;
}

.rail-search input::placeholder {
  color: var(--text-3);
}

.rail-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 10px;
}

.rail-empty {
  padding: 18px 10px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
}

.rail-section + .rail-section {
  margin-top: 14px;
}

.rail-label {
  padding: 0 6px 5px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-3);
  text-transform: uppercase;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  border-radius: 7px;
  transition: background 0.16s ease, color 0.16s ease;
}

.rail-item:hover {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text);
}

.rail-item.is-active {
  color: #fff;
  background: var(--accent-soft);
}

.rail-item-text {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rail-item-count {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--text-3);
}

.del-btn {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-3);
  opacity: 0;
  border-radius: 4px;
  transition: opacity 0.14s ease, color 0.14s ease;
}

.rail-item:hover .del-btn,
.del-btn:focus-visible {
  opacity: 1;
}

.del-btn:hover {
  color: #ff7a7a;
}

.del-confirm,
.del-cancel {
  flex: 0 0 auto;
  padding: 1px 5px;
  font-size: 10px;
  border-radius: 4px;
}

.del-confirm {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.16);
}

.del-cancel {
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.06);
}

.rail-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
  border-top: 1px solid var(--line);
}

.dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 99px;
}

.dot.is-off {
  background: #ff6b6b;
}

/* ---------------- 中栏 ---------------- */

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px;
  background: rgba(11, 13, 17, 0.5);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.live-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  background: var(--accent);
  border-radius: 99px;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.live-dot.is-busy {
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
    box-shadow: 0 0 0 5px var(--accent-soft);
  }
}

.crumb h2 {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag {
  flex: 0 0 auto;
  padding: 1px 7px;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.top-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.pill {
  padding: 3px 9px;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 99px;
}

.pill.is-warn {
  color: #ffb0b0;
  border-color: rgba(255, 107, 107, 0.3);
}

.cap-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 99px;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.cap-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
  border-color: var(--line-2);
}

.cap-btn svg {
  width: 13px;
  height: 13px;
}

.cap-kbd {
  padding: 1px 5px;
  font-size: 9.5px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 4px;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-3);
  border-radius: 7px;
  transition: background 0.16s ease, color 0.16s ease;
}

.icon-btn:hover,
.icon-btn.is-on {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.stream {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 26px;
}

.msg {
  display: flex;
  gap: 10px;
  animation: rise 0.24s ease both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}

.msg.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.72;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 12px;
}

.msg.user .bubble {
  color: #eaf7f0;
  background: linear-gradient(180deg, rgba(61, 220, 151, 0.22), rgba(61, 220, 151, 0.12));
  border: 1px solid rgba(61, 220, 151, 0.28);
  border-bottom-right-radius: 4px;
}

.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-top: 2px;
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.32);
  border-radius: 8px;
}

.avatar-core {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 2px;
  transform: rotate(45deg);
}

.agent-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: 84%;
}

.agent-bubble {
  max-width: 100%;
  color: var(--text);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-top-left-radius: 4px;
}

.caret {
  display: inline-block;
  width: 6px;
  height: 13px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--accent);
  border-radius: 1px;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* ---------------- 执行轨迹 ---------------- */

.agent-trace {
  padding: 8px 11px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.at-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0 0 2px;
  color: var(--text-2);
  text-align: left;
}

.at-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.at-count {
  flex: 1;
  font-size: 10.5px;
  color: var(--text-3);
}

.at-caret {
  font-size: 10px;
  color: var(--text-3);
  transition: transform 0.16s ease;
}

.at-caret.is-open {
  transform: rotate(180deg);
}

.at-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 7px;
  list-style: none;
}

.at-item {
  position: relative;
  padding-left: 16px;
}

.at-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 12px;
  bottom: -8px;
  width: 1px;
  background: var(--line-2);
}

.at-dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 7px;
  height: 7px;
  background: var(--bg-1);
  border: 1px solid var(--text-3);
  border-radius: 99px;
}

.at-item.is-running .at-dot {
  background: var(--accent);
  border-color: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}

.at-item.is-done .at-dot {
  background: var(--accent);
  border-color: var(--accent);
}

.at-item.is-failed .at-dot {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.at-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.at-name {
  font-size: 12px;
  color: var(--text);
}

.at-state {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}

.at-item.is-running .at-state {
  color: var(--accent);
}

.at-item.is-failed .at-state {
  color: #ff8b8b;
}

.at-arg {
  margin-top: 1px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.at-error {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.55;
  color: #ff9a9a;
  word-break: break-word;
}

/* ---------------- 错误与重试 ---------------- */

.msg-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 11px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #ffb4b4;
  background: rgba(255, 107, 107, 0.09);
  border: 1px solid rgba(255, 107, 107, 0.24);
  border-radius: var(--radius-sm);
}

.err-text {
  flex: 1;
  word-break: break-word;
}

.retry-btn {
  flex: 0 0 auto;
  padding: 2px 9px;
  font-size: 11px;
  color: #ffd0d0;
  background: rgba(255, 107, 107, 0.18);
  border-radius: 5px;
  transition: background 0.16s ease;
}

.retry-btn:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.3);
}

.retry-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------------- 空状态 ---------------- */

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}

.empty-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 4px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--line-2);
  border-radius: 12px;
}

.empty-mark svg {
  width: 24px;
  height: 24px;
}

.empty h3 {
  font-size: 15px;
  font-weight: 600;
}

.empty p {
  max-width: 420px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.suggests {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.suggest {
  max-width: 100%;
  padding: 6px 11px;
  font-size: 11.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: 99px;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.suggest:hover {
  color: var(--text);
  border-color: var(--line-2);
}

/* ---------------- 输入区 ---------------- */

.composer {
  padding: 10px 20px 16px;
  border-top: 1px solid var(--line);
}

.composer-box {
  padding: 9px 11px 8px;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.composer-box:focus-within {
  border-color: rgba(61, 220, 151, 0.45);
  box-shadow: 0 0 0 3px rgba(61, 220, 151, 0.08);
}

.composer-chips {
  display: flex;
  gap: 6px;
  padding-bottom: 6px;
}

.chip {
  padding: 1px 8px;
  font-size: 10.5px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.035);
  border-radius: 99px;
}

.composer-box textarea {
  width: 100%;
  min-height: 48px;
  max-height: 160px;
  padding: 2px 2px 4px;
  font: inherit;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
  background: none;
  border: 0;
  outline: none;
  resize: none;
}

.composer-box textarea::placeholder {
  color: var(--text-3);
}

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.hint {
  font-size: 10.5px;
  color: var(--text-3);
}

.send-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 13px;
  font-size: 12.5px;
  font-weight: 500;
  color: #07120c;
  background: var(--accent);
  border-radius: 8px;
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.send-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn svg {
  width: 14px;
  height: 14px;
}

.stop-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  font-size: 12.5px;
  font-weight: 500;
  color: #ffd0d0;
  background: rgba(255, 107, 107, 0.16);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 8px;
  transition: background 0.16s ease, opacity 0.16s ease;
}

.stop-btn:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.26);
}

.stop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop-icon {
  width: 8px;
  height: 8px;
  background: #ff8b8b;
  border-radius: 2px;
}

/* ---------------- 右栏 ---------------- */

.inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 40%), var(--bg-1);
  border-left: 1px solid var(--line);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}

.tabs button {
  position: relative;
  padding: 6px 10px 9px;
  font-size: 12.5px;
  color: var(--text-3);
  transition: color 0.16s ease;
}

.tabs button:hover {
  color: var(--text-2);
}

.tabs button.is-active {
  color: var(--text);
}

.tabs button.is-active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}

.insp-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 12px 18px;
}

.insp-block + .insp-block {
  margin-top: 18px;
}

.insp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 8px;
}

.insp-head h4 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-2);
}

.note {
  font-size: 10.5px;
  color: var(--text-3);
}

.panel-empty {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
}

.panel-empty p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}

.panel-empty span {
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
}

/* ---------------- 本地知识库 ---------------- */

.kb-head {
  align-items: center;
}

.kb-head .note {
  margin-left: auto;
  margin-right: 8px;
}

.kb-import {
  flex: 0 0 auto;
  padding: 3px 8px;
  font-size: 10.5px;
  color: var(--text-2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 6px;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.kb-import:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--line-2);
}

.kb-import:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kb-notice {
  margin-bottom: 7px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-2);
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.24);
  border-radius: var(--radius-sm);
  word-break: break-word;
}

.kb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
}

.kb-item {
  padding: 7px 9px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: border-color 0.16s ease;
}

.kb-item:hover {
  border-color: var(--line-2);
}

.kb-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.kb-sub {
  margin-top: 3px;
}

.kb-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kb-count {
  flex: 0 0 auto;
  font-size: 9.5px;
  color: var(--text-3);
}

.kb-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 9.5px;
  color: var(--text-3);
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kb-del {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 4px;
  transition: color 0.14s ease, background 0.14s ease;
}

.kb-del:hover {
  color: #ff8b8b;
  background: rgba(255, 107, 107, 0.14);
}

.kb-empty {
  padding: 12px 10px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
  background: rgba(255, 255, 255, 0.018);
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
}

/* ---------------- 知识库检索 ---------------- */

.rag-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78px 46px;
  gap: 5px;
}

.rag-form input,
.rag-form select,
.rag-run {
  height: 30px;
  min-width: 0;
  font-size: 11px;
  border-radius: 6px;
}

.rag-form input {
  padding: 0 8px;
  color: var(--text);
  background: var(--bg-2);
  border: 1px solid var(--line);
  outline: none;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.rag-form input::placeholder {
  color: var(--text-3);
}

.rag-form input:focus,
.rag-form select:focus {
  border-color: var(--accent);
}

.rag-form select {
  padding: 0 2px;
  color: var(--text-2);
  background: var(--bg-2);
  border: 1px solid var(--line);
  outline: none;
  cursor: pointer;
}

.rag-form select option {
  color: var(--text);
  background: var(--bg-2);
}

.rag-form input:disabled,
.rag-form select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rag-run {
  font-weight: 500;
  color: #0b0d11;
  background: var(--accent);
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.rag-run:hover:not(:disabled) {
  filter: brightness(1.08);
}

.rag-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rag-results {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 9px;
}

.rag-item {
  position: relative;
  padding: 8px 9px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: border-color 0.16s ease;
}

.rag-item:hover {
  border-color: var(--line-2);
}

.rag-item.has-demo {
  padding-top: 24px;
}

.rag-item-text {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-2);
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.rag-demo-badge {
  position: absolute;
  top: 6px;
  right: 7px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 600;
  line-height: 16px;
  color: #201203;
  background: #ffb04d;
  border-radius: 99px;
  box-shadow: 0 0 0 1px rgba(255, 176, 77, 0.35);
}

.rag-source {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
}

.rag-source-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-2);
  text-decoration: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

a.rag-source-title:hover {
  color: var(--accent);
}

.rag-origin {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  font-size: 9.5px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rag-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}

.rag-provider {
  padding: 0 6px;
  font-size: 9px;
  line-height: 16px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.rag-provider.is-cloud {
  color: #8fb4ff;
  background: rgba(96, 145, 255, 0.14);
}

.rag-score {
  margin-left: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 9.5px;
  color: var(--text-3);
}

.rag-note {
  margin-top: 8px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.022);
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
}

.rag-error {
  margin-top: 8px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.28);
  border-radius: var(--radius-sm);
}

.rag-empty {
  margin-top: 8px;
  padding: 10px 9px;
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  background: rgba(255, 255, 255, 0.018);
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
}

.trace {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px;
  list-style: none;
}

.trace li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-2);
}

.trace-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: transparent;
  border: 1px solid var(--text-3);
  border-radius: 99px;
}

.trace li.is-running .trace-dot {
  background: var(--accent);
  border-color: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}

.trace li.is-done .trace-dot {
  background: var(--accent);
  border-color: var(--accent);
}

.trace li.is-failed .trace-dot {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.trace-title {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trace-state {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}

/* ---------------- 证据链来源 ---------------- */

.evidence {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 0 2px;
  list-style: none;
}

.evidence a {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.evidence a:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--line-2);
}

.ev-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-2);
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ev-host {
  font-size: 10px;
  color: var(--accent);
}

/* ---------------- 能力面板 ---------------- */

.cap-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 11vh 24px 24px;
  background: rgba(5, 7, 10, 0.62);
  backdrop-filter: blur(3px);
}

.cap-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(620px, 100%);
  max-height: 72vh;
  padding: 14px 14px 16px;
  overflow: auto;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  outline: none;
}

.cap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 2px;
}

.cap-head h4 {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text);
}

.cap-close {
  width: 22px;
  height: 22px;
  font-size: 15px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 6px;
  transition: color 0.16s ease, background 0.16s ease;
}

.cap-close:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.cap-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  text-align: left;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: background 0.16s ease, border-color 0.16s ease;
}

.cap-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--line-2);
}

.cap-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
}

.cap-perm {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px 7px;
  font-size: 9.5px;
  border-radius: 99px;
}

.cap-perm.is-read {
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.06);
}

.cap-perm.is-write {
  color: #ffc98a;
  background: rgba(255, 169, 77, 0.14);
}

.cap-perm.is-exec {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.14);
}

.cap-desc {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}

.cap-tip {
  padding: 18px 8px;
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
}

.cap-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cap-back {
  align-self: flex-start;
  padding: 2px 0;
  font-size: 10.5px;
  color: var(--text-3);
  transition: color 0.16s ease;
}

.cap-back:hover {
  color: var(--accent);
}

.cap-form-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cap-field-label {
  font-size: 10.5px;
  color: var(--text-3);
}

.cap-field input,
.cap-field textarea {
  width: 100%;
  padding: 7px 9px;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 7px;
  outline: none;
  transition: border-color 0.16s ease;
}

.cap-field input:focus,
.cap-field textarea:focus {
  border-color: rgba(61, 220, 151, 0.45);
}

.cap-field input::placeholder,
.cap-field textarea::placeholder {
  color: var(--text-3);
}

.cap-field textarea {
  resize: vertical;
  min-height: 62px;
}

.cap-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 2px;
}

.cap-run {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  color: #07120c;
  background: var(--accent);
  border-radius: 8px;
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.cap-run:hover:not(:disabled) {
  filter: brightness(1.08);
}

.cap-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cap-hint {
  font-size: 10px;
  color: var(--text-3);
}

.cap-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
}

.cap-result.is-ok {
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.28);
}

.cap-result.is-error {
  background: rgba(255, 107, 107, 0.09);
  border: 1px solid rgba(255, 107, 107, 0.24);
}

.cap-result-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-result-state {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
}

.cap-result.is-ok .cap-result-state {
  color: var(--accent);
}

.cap-result.is-error .cap-result-state {
  color: #ff9a9a;
}

.cap-result-note {
  flex: 1;
  font-size: 9.5px;
  color: var(--text-3);
}

.cap-result-close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-left: auto;
  font-size: 14px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 5px;
}

.cap-result-close:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
}

.cap-result-body {
  max-height: 210px;
  margin: 0;
  overflow: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------------- 窄窗口 ---------------- */

@media (max-width: 1180px) {
  .work,
  .work.is-inspector-hidden {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .inspector {
    display: none;
  }
}

@media (max-width: 900px) {
  .work,
  .work.is-inspector-hidden {
    grid-template-columns: minmax(0, 1fr);
  }

  .rail {
    display: none;
  }
}
</style>
