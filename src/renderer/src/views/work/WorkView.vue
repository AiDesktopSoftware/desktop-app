<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  WorkChatMessage,
  WorkMessage,
  WorkSession,
  WorkSettingsStatus,
  WorkToolCall,
  WorkToolEvent
} from './types'

// 【工作模式】负责人：赵
// 当前阶段：DeepSeek Agent 工具循环 + 会话管理；工具轨迹在消息上方展示

const api = window.workApi

const TOOL_LABELS: Record<string, string> = {
  web_search: '联网搜索',
  fetch_url: '读取网页',
  list_files: '列目录',
  read_file: '读文件',
  write_file: '写文件',
  run_command: '执行命令'
}

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

const draft = ref('')
const busy = ref(false)
const busySessionId = ref('')
const stopping = ref(false)
const stopRequested = ref(false)
const currentRequestId = ref('')

const pendingDeleteId = ref('')
const streamEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)

const handlers = new Map<string, PendingRequest>()
let scrollTimer: number | undefined
let deleteTimer: number | undefined
let persistTimer: number | undefined
let offChunk: (() => void) | undefined
let offDone: (() => void) | undefined
let offError: (() => void) | undefined
let offTool: (() => void) | undefined

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

const collapsedTools = ref<Record<string, boolean>>({})

function toolsOpen(message: WorkMessage): boolean {
  const running = Boolean(message.tools?.some((tool) => tool.status === 'running'))
  return running || !collapsedTools.value[message.id]
}

function toggleTools(message: WorkMessage): void {
  collapsedTools.value[message.id] = toolsOpen(message) ? false : true
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
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
  } = {}
): Promise<RunResult> {
  const requestId = uid()
  currentRequestId.value = requestId
  return new Promise<RunResult>((resolve) => {
    const entry: PendingRequest = {
      text: '',
      onDelta: callbacks.onDelta,
      onTool: callbacks.onTool,
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

/**
 * Agent 对话：主进程负责工具循环，这里只负责消息、流式文字与轨迹状态。
 * assistant 传入时表示重试已有消息，不再新建消息。
 */
async function runAgent(
  question: string,
  session: WorkSession,
  options: { assistant?: WorkMessage } = {}
): Promise<void> {
  const assistant: WorkMessage =
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
  await runAgent(question, session, { assistant: message })
}

function newSession(): void {
  if (busy.value) return
  activeSessionId.value = ''
  draft.value = ''
  pendingDeleteId.value = ''
  scrollToBottom()
  void nextTick(() => textareaEl.value?.focus())
}

function selectSession(id: string): void {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  pendingDeleteId.value = ''
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
  }
  void persist()
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
  scrollToBottom()
})

onBeforeUnmount(() => {
  offChunk?.()
  offDone?.()
  offError?.()
  offTool?.()
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
          <div class="insp-block">
            <div class="insp-head">
              <h4>检索来源</h4>
              <span class="note">0 条</span>
            </div>
            <div class="panel-empty">
              <p>来源会标注在回答中</p>
              <span>Agent 联网搜索后会把来源 URL 写入回答，右侧暂不单独汇总证据。</span>
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
