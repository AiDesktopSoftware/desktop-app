<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  WorkChatMessage,
  WorkMessage,
  WorkSession,
  WorkSettingsStatus,
  WorkStep
} from './types'

// 【工作模式】负责人：赵
// 当前阶段：接入 DeepSeek 流式对话 + 任务拆解执行；检索与知识库下一阶段接入

const api = window.workApi

const PLAN_SYSTEM = [
  '你是一名严谨的研究任务规划助手。请结合用户的最新问题，把任务拆解为 3 到 5 个可以依次执行的具体步骤。',
  '要求：',
  '1. 只输出一个 JSON 对象，不要输出 Markdown 代码块、解释或任何多余文字。',
  '2. 格式必须为 {"steps":[{"title":"步骤标题","detail":"该步骤要完成的内容"}]}。',
  '3. title 不超过 20 个字，detail 不超过 60 个字。',
  '4. 步骤要具体、互不重复，最后一步负责整合与形成结论。'
].join('\n')

const STEP_SYSTEM = [
  '你是一名严谨的研究助手。现在只需要完成用户指定的单个步骤，不要复述整个任务，也不要输出任务计划。',
  '请用中文给出该步骤的结果，结构清晰、内容具体；不确定的信息要明确说明，不要编造来源、数据或引用。'
].join('\n')

const FINAL_SYSTEM = [
  '你是一名严谨的研究助手。请基于对话上下文和已完成的步骤结果，输出一份结构化的综合回答。',
  '要求：',
  '1. 先用 3 到 5 条要点给出结论摘要。',
  '2. 再按主题分节展开，必要时使用小标题和列表。',
  '3. 不要编造来源、数据、作者或引用；没有检索来源时明确说明这是基于模型知识的分析。',
  '4. 使用中文，避免空话套话。'
].join('\n')

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
let offChunk: (() => void) | undefined
let offDone: (() => void) | undefined
let offError: (() => void) | undefined

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

const currentSteps = computed<WorkStep[]>(() => {
  const messages = activeMessages.value
  for (let i = messages.length - 1; i >= 0; i--) {
    const steps = messages[i].steps
    if (steps && steps.length > 0) return steps
  }
  return []
})

const doneStepCount = computed(
  () => currentSteps.value.filter((step) => step.status === 'done').length
)

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

function statusText(status: WorkStep['status']): string {
  switch (status) {
    case 'running':
      return '进行中'
    case 'done':
      return '完成'
    case 'failed':
      return '失败'
    default:
      return '待执行'
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
  mode: 'chat' | 'plan',
  messages: WorkChatMessage[],
  onDelta?: (delta: string) => void
): Promise<RunResult> {
  const requestId = uid()
  currentRequestId.value = requestId
  return new Promise<RunResult>((resolve) => {
    const entry: PendingRequest = {
      text: '',
      onDelta,
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

function parsePlan(raw: string): WorkStep[] {
  try {
    let text = raw.trim()
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) text = fence[1].trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return []

    const data = JSON.parse(text.slice(start, end + 1)) as { steps?: unknown }
    if (!Array.isArray(data.steps)) return []

    const steps: WorkStep[] = []
    for (const item of data.steps) {
      if (!item || typeof item !== 'object') continue
      const record = item as { title?: unknown; detail?: unknown }
      const title = typeof record.title === 'string' ? record.title.trim() : ''
      const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
      if (!title) continue
      steps.push({
        id: uid(),
        title: title.slice(0, 60),
        detail: detail ? detail.slice(0, 200) : undefined,
        status: 'pending'
      })
      if (steps.length >= 5) break
    }
    return steps.length >= 2 ? steps : []
  } catch {
    return []
  }
}

function buildFinalPrompt(question: string, steps: WorkStep[]): string {
  if (steps.length === 0) {
    return `请回答以下研究问题：\n${question}`
  }
  const lines = steps.map((step, index) => {
    const status =
      step.status === 'done' ? '完成' : step.status === 'failed' ? '失败' : '未完成'
    return `${index + 1}. ${step.title}（${status}）\n${(step.result || '无结果').slice(0, 3000)}`
  })
  return [
    `研究问题：\n${question}`,
    `已执行步骤与结果：\n${lines.join('\n\n')}`,
    '请基于以上内容给出综合回答。'
  ].join('\n\n')
}

function finishAborted(assistant: WorkMessage, session: WorkSession): void {
  if (!assistant.content.trim()) assistant.content = '已停止生成。'
  assistant.streaming = false
  session.updatedAt = Date.now()
}

/**
 * 完整编排：计划拆解 → 逐条执行 → 综合回答。
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

    // 第一阶段：生成结构化任务计划（偶发失败时重试一次）
    const planMessages: WorkChatMessage[] = [
      { role: 'system', content: PLAN_SYSTEM },
      ...history
    ]
    let planResult = await startRequest('plan', planMessages)
    if (!planResult.ok && !planResult.aborted && !stopRequested.value) {
      planResult = await startRequest('plan', planMessages)
    }
    if (planResult.aborted || stopRequested.value) {
      finishAborted(assistant, session)
      return
    }

    const steps = planResult.ok ? parsePlan(planResult.text) : []
    if (steps.length > 0) {
      assistant.steps = steps
      session.updatedAt = Date.now()
      await persist()
      scrollToBottom()
    }

    // 第二阶段：逐条执行步骤
    for (const step of steps) {
      if (stopRequested.value) {
        finishAborted(assistant, session)
        return
      }
      step.status = 'running'
      scheduleScroll()

      const stepPrompt = [
        `研究目标：\n${question}`,
        `当前步骤：${step.title}`,
        `步骤说明：${step.detail || '无'}`,
        '请直接给出这一步的结果。'
      ].join('\n\n')

      const stepResult = await startRequest('chat', [
        { role: 'system', content: STEP_SYSTEM },
        ...history,
        { role: 'user', content: stepPrompt }
      ])

      if (stepResult.aborted || stopRequested.value) {
        if (stepResult.text.trim()) {
          step.result = stepResult.text.trim()
          step.status = 'done'
        } else {
          step.status = 'pending'
        }
        finishAborted(assistant, session)
        return
      }

      if (stepResult.ok && stepResult.text.trim()) {
        step.status = 'done'
        step.result = stepResult.text.trim()
      } else {
        step.status = 'failed'
        step.result = stepResult.message || '该步骤未返回内容'
      }
      session.updatedAt = Date.now()
      scheduleScroll()
    }

    if (stopRequested.value) {
      finishAborted(assistant, session)
      return
    }

    // 第三阶段：流式输出综合回答
    const finalMessages: WorkChatMessage[] = [
      { role: 'system', content: FINAL_SYSTEM },
      ...history,
      { role: 'user', content: buildFinalPrompt(question, steps) }
    ]
    const finalResult = await startRequest('chat', finalMessages, (delta) => {
      assistant.content += delta
      scheduleScroll()
    })

    if (finalResult.aborted || stopRequested.value) {
      finishAborted(assistant, session)
      return
    }
    if (!finalResult.ok) {
      assistant.error = finalResult.message || '生成失败'
    } else if (!assistant.content.trim() && finalResult.text.trim()) {
      assistant.content = finalResult.text
    }
    session.updatedAt = Date.now()
    await persist()
  } catch (error) {
    assistant.error = error instanceof Error ? error.message : '未知错误'
  } finally {
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
  message.steps = undefined
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
      ...(message.steps?.length
        ? { steps: message.steps.map((step) => ({ ...step })) }
        : {}),
      ...(message.error ? { error: message.error } : {})
    }))
  }))
}

async function persist(): Promise<void> {
  try {
    await api.saveSessions(serializeSessions())
  } catch (error) {
    console.warn('会话保存失败', error)
  }
}

function restoreSession(raw: WorkSession): WorkSession {
  const messages = Array.isArray(raw.messages) ? raw.messages : []
  return {
    ...raw,
    messages: messages.map((message) => ({
      ...message,
      streaming: false,
      steps: Array.isArray(message.steps)
        ? message.steps.map((step) =>
            step.status === 'running'
              ? {
                  ...step,
                  status: 'failed' as const,
                  result: step.result || '上次执行被中断'
                }
              : step
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
  if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
  if (deleteTimer !== undefined) window.clearTimeout(deleteTimer)
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
            描述研究问题，Agent 会先拆解任务计划，再逐条执行，最后给出综合回答。
            当前阶段暂未接入检索与知识库，回答基于模型自身知识。
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
              <div v-if="message.steps && message.steps.length" class="plan">
                <div class="plan-head">
                  <span>任务计划</span>
                  <span class="plan-count">{{ message.steps.length }} 步</span>
                </div>
                <ol class="timeline">
                  <li
                    v-for="step in message.steps"
                    :key="step.id"
                    class="tl-item"
                    :class="'is-' + step.status"
                  >
                    <span class="tl-dot" />
                    <div class="tl-body">
                      <div class="tl-head">
                        <span class="tl-title">{{ step.title }}</span>
                        <span class="tl-state">{{ statusText(step.status) }}</span>
                      </div>
                      <p v-if="step.detail" class="tl-detail">{{ step.detail }}</p>
                      <p v-if="step.result" class="tl-result" :title="step.result">
                        {{ step.result }}
                      </p>
                    </div>
                  </li>
                </ol>
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
            <span class="chip">联网检索 · 下一阶段</span>
            <span class="chip">知识库 · 下一阶段</span>
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
              {{ busy ? '正在生成，可随时停止' : '回答由模型生成，未引用外部来源' }}
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
              <p>检索与知识库将在下一阶段接入</p>
              <span>当前回答完全由模型生成，未引用外部来源，因此这里没有可展示的证据。</span>
            </div>
          </div>

          <div v-if="currentSteps.length" class="insp-block">
            <div class="insp-head">
              <h4>执行轨迹</h4>
              <span class="note">{{ doneStepCount }} / {{ currentSteps.length }}</span>
            </div>
            <ul class="trace">
              <li
                v-for="step in currentSteps"
                :key="step.id"
                :class="'is-' + step.status"
              >
                <span class="trace-dot" />
                <span class="trace-title">{{ step.title }}</span>
                <span class="trace-state">{{ statusText(step.status) }}</span>
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

/* ---------------- 任务时间轴 ---------------- */

.plan {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-2);
}

.plan-count {
  font-weight: 400;
  color: var(--text-3);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
}

.tl-item {
  position: relative;
  padding-left: 20px;
}

.tl-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 16px;
  bottom: -8px;
  width: 1px;
  background: var(--line-2);
}

.tl-dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 9px;
  height: 9px;
  background: var(--bg-1);
  border: 1px solid var(--text-3);
  border-radius: 99px;
}

.tl-item.is-running .tl-dot {
  background: var(--accent);
  border-color: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}

.tl-item.is-done .tl-dot {
  background: var(--accent);
  border-color: var(--accent);
}

.tl-item.is-failed .tl-dot {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.tl-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tl-title {
  font-size: 12.5px;
  color: var(--text);
}

.tl-state {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}

.tl-item.is-running .tl-state {
  color: var(--accent);
}

.tl-item.is-failed .tl-state {
  color: #ff8b8b;
}

.tl-detail {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}

.tl-result {
  display: -webkit-box;
  margin-top: 4px;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.62;
  color: var(--text-2);
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
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
