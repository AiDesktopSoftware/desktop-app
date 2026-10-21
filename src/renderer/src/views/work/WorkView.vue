<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MessageActions from './MessageActions.vue'
import { PANELS, type PanelDefinition } from './panels/registry'
import type {
  KbDocument,
  RagProviderId,
  RunStep,
  WorkCapability,
  WorkCapabilityPermission,
  WorkChatMessage,
  WorkEvidenceEvent,
  WorkEvidenceItem,
  WorkMessage,
  WorkMode,
  WorkPreferences,
  WorkSession,
  WorkSettingsStatus,
  WorkToolCall,
  WorkToolEvent,
  WorkflowDefinition,
  WorkflowRun
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

// ---------------- 三栏宽度拖拽 ----------------
// 左栏与右栏宽度由 CSS 变量控制，拖动两侧分隔条调整，双击拖拽条恢复默认
const SESSION_DEFAULT = 236
const INSPECTOR_DEFAULT = 300
const SESSION_MIN = 180
const SESSION_MAX = 420
const INSPECTOR_MIN = 280
const INSPECTOR_MAX = 640
const MAIN_MIN = 360
const HANDLE_WIDTH = 5
const SESSION_WIDTH_KEY = 'work.session-width'
const INSPECTOR_WIDTH_KEY = 'work.inspector-width'
const ACTIVE_SESSION_KEY = 'work.active-session'

const workEl = ref<HTMLElement | null>(null)
const workWidth = ref(0)
const sessionWidth = ref(
  readStoredWidth(SESSION_WIDTH_KEY, SESSION_DEFAULT, SESSION_MIN, SESSION_MAX)
)
const inspectorWidth = ref(
  readStoredWidth(INSPECTOR_WIDTH_KEY, INSPECTOR_DEFAULT, INSPECTOR_MIN, INSPECTOR_MAX)
)
const resizing = ref<'' | 'session' | 'inspector'>('')
const resizeStart = { x: 0, width: 0 }
let activeResizeCleanup: (() => void) | undefined
let workObserver: ResizeObserver | undefined

/** 读取持久化宽度：内容缺失或损坏时回退默认，超出范围收敛到合法区间 */
function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null || raw.trim() === '') return fallback
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    return Math.round(clampInput(value, min, max, fallback))
  } catch {
    return fallback
  }
}

/** 两侧拖拽条总宽：右侧面板收起时只剩左侧一条 */
function handleTotal(): number {
  return panelOpen.value ? HANDLE_WIDTH * 2 : HANDLE_WIDTH
}

/** 左栏动态上限：容器不足时收紧，保证中间对话区至少保留 360px */
function sessionLimit(): number {
  if (!workWidth.value) return SESSION_MAX
  const inspector = panelOpen.value
    ? clampInput(inspectorWidth.value, INSPECTOR_MIN, INSPECTOR_MAX, INSPECTOR_DEFAULT)
    : 0
  const dynamic = workWidth.value - handleTotal() - MAIN_MIN - inspector
  return Math.max(SESSION_MIN, Math.min(SESSION_MAX, dynamic))
}

/** 右栏动态上限：左栏越宽，右栏可用的最大宽度越小 */
function inspectorLimit(): number {
  if (!workWidth.value) return INSPECTOR_MAX
  const session = clampInput(sessionWidth.value, SESSION_MIN, SESSION_MAX, SESSION_DEFAULT)
  const dynamic = workWidth.value - handleTotal() - MAIN_MIN - session
  return Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, dynamic))
}

/** 实际渲染宽度：持久化值收敛到当前容器允许的范围 */
function renderedSession(): number {
  return clampInput(sessionWidth.value, SESSION_MIN, sessionLimit(), SESSION_DEFAULT)
}

function renderedInspector(): number {
  return clampInput(inspectorWidth.value, INSPECTOR_MIN, inspectorLimit(), INSPECTOR_DEFAULT)
}

const workStyle = computed<Record<string, string>>(() => ({
  '--session-w': `${Math.round(renderedSession())}px`,
  '--inspector-w': `${Math.round(renderedInspector())}px`
}))

function persistWidths(): void {
  try {
    window.localStorage.setItem(SESSION_WIDTH_KEY, String(Math.round(sessionWidth.value)))
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(Math.round(inspectorWidth.value)))
  } catch {
    // 本地存储不可用时只在本次运行内生效
  }
}

/** 开始拖动：在 document 上监听移动与抬起，避免指针移出拖拽条后中断 */
function startResize(kind: 'session' | 'inspector', event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  activeResizeCleanup?.()
  resizing.value = kind
  resizeStart.x = event.clientX
  resizeStart.width = kind === 'session' ? renderedSession() : renderedInspector()

  const onMove = (moveEvent: PointerEvent): void => {
    const delta = moveEvent.clientX - resizeStart.x
    if (kind === 'session') {
      // 右拖增大会话栏，左拖减小
      sessionWidth.value = Math.round(
        clampInput(resizeStart.width + delta, SESSION_MIN, sessionLimit(), SESSION_DEFAULT)
      )
    } else {
      // 左拖增大右侧面板，右拖减小
      inspectorWidth.value = Math.round(
        clampInput(resizeStart.width - delta, INSPECTOR_MIN, inspectorLimit(), INSPECTOR_DEFAULT)
      )
    }
  }
  const onEnd = (): void => {
    activeResizeCleanup?.()
    activeResizeCleanup = undefined
    resizing.value = ''
    persistWidths()
  }
  const cleanup = (): void => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onEnd)
    document.removeEventListener('pointercancel', onEnd)
  }
  activeResizeCleanup = cleanup
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onEnd)
  document.addEventListener('pointercancel', onEnd)
}

/** 双击拖拽条恢复该侧默认宽度 */
function resetWidth(kind: 'session' | 'inspector'): void {
  if (kind === 'session') {
    sessionWidth.value = SESSION_DEFAULT
  } else {
    inspectorWidth.value = INSPECTOR_DEFAULT
  }
  persistWidths()
}

// 右侧面板：注册表驱动，布局（打开的 id 与当前激活 id）持久化到 localStorage
const PANEL_LAYOUT_KEY = 'work-panel-layout'
const DEFAULT_PANEL_IDS = ['sources', 'trace', 'knowledge', 'search', 'artifacts']
const PANEL_IDS = new Set(PANELS.map((panel) => panel.id))
const storedPanelLayout = loadPanelLayout()
const openPanelIds = ref<string[]>(storedPanelLayout.open)
const activePanelId = ref(storedPanelLayout.active)
const panelMenuOpen = ref(false)
const panelMenuEl = ref<HTMLElement | null>(null)

// 检索来源下拉选项：注册顺序即展示顺序
const RAG_PROVIDER_OPTIONS: { id: RagProviderId; label: string }[] = [
  { id: 'local', label: '本地库' },
  { id: 'cloud', label: '云端公共库' },
  { id: 'both', label: '双路合并' }
]

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
const sessionMenuId = ref('')  // 当前弹出菜单所属的 session id；空串表示菜单关闭
const streamEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)

// 消息内联编辑：同一时刻只允许一条用户消息处于编辑态
const editingId = ref('')
const editingText = ref('')
const editTextareaEl = ref<HTMLTextAreaElement | null>(null)

/** 编辑框位于 v-for 内，用函数 ref 取当前唯一激活的 textarea */
function setEditTextarea(el: unknown): void {
  editTextareaEl.value = el instanceof HTMLTextAreaElement ? el : null
}

// 能力面板（Ctrl + K）：列表 -> 参数表单 -> 执行结果
const capabilities = ref<WorkCapability[]>([])
const capOpen = ref(false)

// ---- 命令面板 Ctrl+Shift+P ----
interface CommandItem {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteIndex = ref(0)
const paletteInputRef = ref<HTMLInputElement | null>(null)

// 打开命令面板后自动 focus 输入框
watch(paletteOpen, (open) => {
  if (open) {
    void nextTick(() => paletteInputRef.value?.focus())
  }
})

/** 按当前状态动态生成命令列表 */
function buildCommands(): CommandItem[] {
  const cmds: CommandItem[] = [
    { id: 'new-session', label: '新建会话', hint: 'Ctrl + N', group: '会话', run: () => newSession() },
    { id: 'switch-mode', label: '切换模式…', group: '会话', run: () => { modeMenuOpen.value = true; paletteOpen.value = false } },
    { id: 'export-session', label: '导出当前会话', group: '会话', run: () => { activeSession.value && exportSession(activeSession.value.id) } },
    { id: 'import-kb', label: '导入知识库文档', group: '知识', run: () => void importKb() },
    { id: 'toggle-caps', label: '打开能力面板', hint: 'Ctrl + K', group: '能力', run: () => { paletteOpen.value = false; toggleCaps() } },
    { id: 'manage-custom', label: '管理自定义 HTTP 能力', group: '能力', run: () => { paletteOpen.value = false; activatePanel('custom-caps') } },
    { id: 'run-workflow', label: '运行工作流…', group: '工作流', run: () => { paletteOpen.value = false; openFlows() } },
    { id: 'open-prefs', label: '偏好设置', hint: 'Ctrl + ,', group: '设置', run: () => { paletteOpen.value = false; openPrefs() } }
  ]
  return cmds
}

const paletteFiltered = computed(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  if (!q) return buildCommands()
  return buildCommands().filter((c) =>
    c.label.toLowerCase().includes(q) ||
    c.group.toLowerCase().includes(q) ||
    (c.hint ?? '').toLowerCase().includes(q)
  )
})

function openPalette(): void {
  paletteQuery.value = ''
  paletteIndex.value = 0
  paletteOpen.value = true
}
function closePalette(): void {
  paletteOpen.value = false
}
function runPaletteCommand(cmd: CommandItem): void {
  paletteOpen.value = false
  paletteQuery.value = ''
  cmd.run()
}
const capSelected = ref<WorkCapability | null>(null)
const capArgs = ref<Record<string, string>>({})
const capRunning = ref(false)
const capResult = ref<{ ok: boolean; content: string } | null>(null)
const capPanelEl = ref<HTMLElement | null>(null)
const capFormEl = ref<HTMLElement | null>(null)

// 偏好设置弹层：工具开关、默认检索来源、topK、温度、自定义提示词
const DEFAULT_PREFS: WorkPreferences = {
  enabledTools: [],
  defaultProvider: 'local',
  topK: 5,
  temperature: 0.4,
  extraSystemPrompt: ''
}
const prefs = ref<WorkPreferences>({ ...DEFAULT_PREFS })
const prefsDraft = ref<WorkPreferences>({ ...DEFAULT_PREFS })
const prefsOpen = ref(false)
const prefsLoading = ref(false)
const prefsSaving = ref(false)
const prefsError = ref('')
const prefsSaved = ref(false)
const prefsPanelEl = ref<HTMLElement | null>(null)

// 模式：决定 Agent 怎么工作（系统提示词、可用工具、温度、默认检索来源），不限定提问内容
const MODE_STORAGE_KEY = 'work-mode-id'
const modes = ref<WorkMode[]>([])
const currentModeId = ref(storedModeId())
const modeMenuOpen = ref(false)
const modeOpen = ref(false)
const modeLoading = ref(false)
const modeSaving = ref(false)
const modeError = ref('')
const modeNotice = ref('')
const modeSelectedId = ref('')
const modeDraft = ref<WorkMode | null>(null)
const modePanelEl = ref<HTMLElement | null>(null)
const modePickerEl = ref<HTMLElement | null>(null)

// 工作流弹层：模板选择 -> 填变量 -> 顺序运行 -> 步骤进度与结果
const flowOpen = ref(false)
const flowList = ref<WorkflowDefinition[]>([])
const flowSelected = ref<WorkflowDefinition | null>(null)
const flowVars = ref<Record<string, string>>({})
const flowRunning = ref(false)
const flowStopping = ref(false)
const flowRunId = ref('')
const flowSteps = ref<RunStep[]>([])
const flowResult = ref('')
const flowError = ref('')
const flowDone = ref(false)
const flowStartedAt = ref(0)
const flowElapsed = ref(0)
const flowRuns = ref<WorkflowRun[]>([])
const flowDetailRun = ref<WorkflowRun | null>(null)
const flowExpanded = ref<Record<string, boolean>>({})
const flowPanelEl = ref<HTMLElement | null>(null)

const handlers = new Map<string, PendingRequest>()
let scrollTimer: number | undefined
let deleteTimer: number | undefined
let persistTimer: number | undefined
let prefsSavedTimer: number | undefined
let offChunk: (() => void) | undefined
let offDone: (() => void) | undefined
let offError: (() => void) | undefined
let offTool: (() => void) | undefined
let offEvidence: (() => void) | undefined
let offFlowStep: (() => void) | undefined
let offFlowDone: (() => void) | undefined

const activeSession = computed(
  () => sessions.value.find((session) => session.id === activeSessionId.value) ?? null
)
const activeMessages = computed(() => activeSession.value?.messages ?? [])

/** 当前模式：列表未加载或 id 失效时回退第一个模式 */
const currentMode = computed<WorkMode | null>(
  () => modes.value.find((mode) => mode.id === currentModeId.value) ?? modes.value[0] ?? null
)
const currentModeName = computed(() => currentMode.value?.name ?? '普通问答')
const currentModeDescription = computed(
  () => currentMode.value?.description ?? '直接回答，不调用外部工具'
)
const builtinModes = computed(() => modes.value.filter((mode) => mode.builtin))
const customModes = computed(() => modes.value.filter((mode) => !mode.builtin))

/** 输入框上方的能力提示：按当前模式实际可用的工具生成 */
const modeToolLabels = computed(() => {
  const ids = currentMode.value?.tools ?? []
  if (ids.length === 0) return ['纯对话 · 不调用工具']
  return ids.map((id) => `${capabilityLabels.value[id] ?? id} · 自动`)
})

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
  // 置顶会话单独成组放最前，其余按日期分组
  const pinned: WorkSession[] = []
  const rest: WorkSession[] = []
  for (const s of filteredSessions.value) {
    if (s.pinned) pinned.push(s)
    else rest.push(s)
  }
  // pinned 内部按 updatedAt 倒序
  pinned.sort((a, b) => b.updatedAt - a.updatedAt)
  rest.sort((a, b) => b.updatedAt - a.updatedAt)
  const result: { name: string; items: WorkSession[] }[] = []
  if (pinned.length > 0) result.push({ name: '置顶', items: pinned })
  for (const session of rest) {
    const name = dayGroup(session.updatedAt)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(session)
  }
  for (const [name, items] of groups) {
    result.push({ name, items })
  }
  return result
})

const currentTools = computed<WorkToolCall[]>(() => {
  const messages = activeMessages.value
  for (let i = messages.length - 1; i >= 0; i--) {
    const tools = messages[i].tools
    if (tools && tools.length > 0) return tools
  }
  return []
})

/** 右栏证据链：当前会话最后一条带来源的助手消息 */
const currentEvidence = computed<WorkEvidenceItem[]>(() => {
  const messages = activeMessages.value
  for (let i = messages.length - 1; i >= 0; i--) {
    const evidence = messages[i].evidence
    if (evidence && evidence.length > 0) return evidence
  }
  return []
})

/** 检索面板的默认来源：模式优先，其次全局偏好 */
const searchDefaultProvider = computed<RagProviderId>(
  () => currentMode.value?.ragProvider ?? prefs.value.defaultProvider
)

/** 检索面板的默认条数：模式优先，其次全局偏好 */
const searchDefaultTopK = computed(() => currentMode.value?.topK ?? prefs.value.topK)

/** 已打开的面板，始终按注册顺序排列 */
const openPanels = computed<PanelDefinition[]>(() =>
  PANELS.filter((panel) => openPanelIds.value.includes(panel.id))
)

/** 未打开的面板，供「+」菜单选择 */
const closedPanels = computed<PanelDefinition[]>(() =>
  PANELS.filter((panel) => !openPanelIds.value.includes(panel.id))
)

const activePanelDefinition = computed<PanelDefinition>(() => {
  return PANELS.find((panel) => panel.id === activePanelId.value) ?? PANELS[0]
})

/** 当前激活面板需要的 props，容器不感知各面板内部状态 */
const activePanelProps = computed<Record<string, unknown>>(() => {
  switch (activePanelId.value) {
    case 'sources':
      return { items: currentEvidence.value }
    case 'trace':
      return { tools: currentTools.value, labels: capabilityLabels.value }
    case 'knowledge':
      return {
        documents: kbDocuments.value,
        chunkCount: kbChunkCount.value,
        importing: kbImporting.value,
        notice: kbNotice.value,
        error: kbError.value
      }
    case 'search':
      return {
        defaultProvider: searchDefaultProvider.value,
        defaultTopK: searchDefaultTopK.value,
        providers: RAG_PROVIDER_OPTIONS,
        sessionKey: activeSessionId.value
      }
    case 'mode':
      return { mode: currentMode.value, labels: capabilityLabels.value }
    case 'artifacts':
      return { runs: flowRuns.value }
    default:
      return {}
  }
})

/** 读取面板布局，非法或损坏时回到默认值 */
function loadPanelLayout(): { open: string[]; active: string } {
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { open?: unknown; active?: unknown }
      const open = Array.isArray(parsed.open)
        ? parsed.open.filter((id): id is string => typeof id === 'string' && PANEL_IDS.has(id))
        : []
      if (open.length > 0) {
        const active =
          typeof parsed.active === 'string' && open.includes(parsed.active)
            ? parsed.active
            : open[0]
        return { open, active }
      }
    }
  } catch {
    // 本地存储不可用或内容损坏时使用默认布局
  }
  return { open: [...DEFAULT_PANEL_IDS], active: DEFAULT_PANEL_IDS[0] }
}

function persistPanelLayout(): void {
  try {
    window.localStorage.setItem(
      PANEL_LAYOUT_KEY,
      JSON.stringify({ open: openPanelIds.value, active: activePanelId.value })
    )
  } catch {
    // 本地存储不可用时只在本次运行内生效
  }
}

watch([openPanelIds, activePanelId], persistPanelLayout, { deep: true })

function activatePanel(id: string): void {
  if (!PANEL_IDS.has(id)) return
  activePanelId.value = id
  panelMenuOpen.value = false
}

/** 关闭标签；pinnable 与 closable=false 的面板不响应 */
function closePanel(id: string): void {
  const panel = PANELS.find((item) => item.id === id)
  if (!panel || panel.pinnable || panel.closable === false) return
  const index = openPanelIds.value.indexOf(id)
  if (index < 0) return
  openPanelIds.value = openPanelIds.value.filter((item) => item !== id)
  if (activePanelId.value === id) {
    activePanelId.value = openPanelIds.value[0] ?? DEFAULT_PANEL_IDS[0]
  }
}

/** 从「+」菜单加入面板并激活 */
function addPanel(id: string): void {
  if (!PANEL_IDS.has(id)) return
  if (!openPanelIds.value.includes(id)) openPanelIds.value = [...openPanelIds.value, id]
  activePanelId.value = id
  panelMenuOpen.value = false
}

function togglePanelMenu(): void {
  if (!panelMenuOpen.value && modeMenuOpen.value) modeMenuOpen.value = false
  panelMenuOpen.value = !panelMenuOpen.value
}

const capResultText = computed(() => {
  if (!capResult.value) return ''
  const content = capResult.value.content
  return content.length > 2000 ? `${content.slice(0, 2000)}\n……` : content
})

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
      .chatStart({ requestId, messages, mode, modeId: currentMode.value?.id })
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
  // 历史窗口按当前模式的配置生效，切换模式后下一条消息立即使用新值
  const historyLimit = currentMode.value?.historyMessages ?? 10
  if (historyLimit <= 0) return []
  const charLimit = currentMode.value?.contextChars ?? 6000
  const index = session.messages.findIndex((message) => message.id === assistantId)
  const prior = index >= 0 ? session.messages.slice(0, index) : session.messages
  return prior
    .filter((message) => message.content.trim().length > 0)
    .slice(-historyLimit)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, charLimit)
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

/** 把主进程推送的来源追加到助手消息，渲染层再按 url 或 path 兜底去重 */
function applyEvidence(assistant: WorkMessage, items: WorkEvidenceItem[]): void {
  if (!assistant.evidence) assistant.evidence = []
  for (const item of items) {
    if (!item || typeof item.title !== 'string') continue
    const url = typeof item.url === 'string' && item.url ? item.url : ''
    const path = typeof item.path === 'string' && item.path ? item.path : ''
    if (!url && !path) continue
    const key = url || path
    if (assistant.evidence.some((existing) => (existing.url || existing.path) === key)) continue
    assistant.evidence.push({
      title: item.title || key,
      ...(url ? { url } : {}),
      ...(path ? { path } : {})
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

// ---------------- 消息操作：复制 / 分支 / 修改 / 删除 ----------------

/** 复制消息正文，剪贴板不可用时静默降级 */
async function copyMessage(message: WorkMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.content)
  } catch {
    // 没有剪贴板权限时不做提示，避免打断阅读
  }
}

/** 以当前消息为终点复制成新会话，原会话保持不变 */
async function branchMessage(message: WorkMessage): Promise<void> {
  if (busy.value) return
  const session = activeSession.value
  if (!session) return
  const index = session.messages.findIndex((item) => item.id === message.id)
  if (index < 0) return

  // 深拷贝并剔除运行时字段，同时换新 id，避免分支与原会话共享引用或状态
  const messages = JSON.parse(JSON.stringify(session.messages.slice(0, index + 1))) as WorkMessage[]
  for (const item of messages) {
    delete item.streaming
    item.id = uid()
  }

  const now = Date.now()
  const branch: WorkSession = {
    id: uid(),
    title: `${session.title} · 分支`,
    createdAt: now,
    updatedAt: now,
    messages
  }
  sessions.value.unshift(branch)
  activeSessionId.value = branch.id
  cancelEdit()
  await persist()
  scrollToBottom()
}

/** 进入内联编辑态，光标停在原文末尾 */
function startEdit(message: WorkMessage): void {
  if (busy.value || message.role !== 'user') return
  editingId.value = message.id
  editingText.value = message.content
  void nextTick(() => {
    const el = editTextareaEl.value
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  })
}

function cancelEdit(): void {
  editingId.value = ''
  editingText.value = ''
}

/** 保存修改：丢弃该消息之后的全部消息，再以当前会话重新执行 Agent */
async function saveEdit(): Promise<void> {
  if (busy.value) return
  const session = activeSession.value
  if (!session) return
  const index = session.messages.findIndex((item) => item.id === editingId.value)
  if (index < 0) return
  const message = session.messages[index]
  if (message.role !== 'user') return
  const text = editingText.value.trim()
  if (!text) return

  message.content = text
  session.messages.splice(index + 1)
  session.updatedAt = Date.now()
  cancelEdit()
  await persist()
  await runAgent(text, session)
}

/** 删除消息：用户消息连带紧随其后的助手消息，助手消息只删自己 */
async function deleteMessage(message: WorkMessage): Promise<void> {
  if (busy.value) return
  const session = activeSession.value
  if (!session) return
  const index = session.messages.findIndex((item) => item.id === message.id)
  if (index < 0) return

  if (message.role === 'user') {
    const next = session.messages[index + 1]
    session.messages.splice(index, next && next.role === 'assistant' ? 2 : 1)
  } else {
    session.messages.splice(index, 1)
  }
  if (editingId.value && !session.messages.some((item) => item.id === editingId.value)) {
    cancelEdit()
  }
  session.updatedAt = Date.now()
  await persist()
}

function newSession(): void {
  if (busy.value) return
  activeSessionId.value = ''
  draft.value = ''
  pendingDeleteId.value = ''
  cancelEdit()
  scrollToBottom()
  void nextTick(() => textareaEl.value?.focus())
}

function selectSession(id: string): void {
  if (activeSessionId.value === id) return
  activeSessionId.value = id
  pendingDeleteId.value = ''
  cancelEdit()
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
    cancelEdit()
    const next = [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    activeSessionId.value = next?.id ?? ''
  }
  void persist()
}

// ---------------- 会话快捷操作（P3：Trae 风格）----------------

function renameSession(id: string): void {
  const session = sessions.value.find((s) => s.id === id)
  if (!session) return
  const newName = prompt('重命名会话', session.title)
  if (!newName || !newName.trim() || newName.trim() === session.title) return
  session.title = newName.trim()
  session.updatedAt = Date.now()
  void persist()
}

function togglePinSession(id: string): void {
  const session = sessions.value.find((s) => s.id === id)
  if (!session) return
  session.pinned = !session.pinned
  session.updatedAt = Date.now()
  void persist()
}

function copySession(id: string): void {
  const session = sessions.value.find((s) => s.id === id)
  if (!session) return
  const now = Date.now()
  const cloned: WorkSession = {
    id: `s_${Math.random().toString(36).slice(2, 10)}`,
    title: `${session.title} · 副本`,
    pinned: session.pinned,
    createdAt: now,
    updatedAt: now,
    messages: session.messages.map((m) => ({
      ...m,
      streaming: false,
      error: undefined,
      tools: m.tools ? m.tools.map((t) => ({ ...t })) : undefined,
      evidence: m.evidence ? m.evidence.map((e) => ({ ...e })) : undefined
    }))
  }
  sessions.value = [cloned, ...sessions.value]
  activeSessionId.value = cloned.id
  void persist()
}

async function exportSession(id: string): Promise<void> {
  const session = sessions.value.find((s) => s.id === id)
  if (!session) return
  // 导出为 Markdown
  const lines: string[] = [`# ${session.title}`, '']
  lines.push(`> 创建于 ${new Date(session.createdAt).toLocaleString()}，最后更新 ${new Date(session.updatedAt).toLocaleString()}`, '')
  for (const msg of session.messages) {
    const role = msg.role === 'user' ? '**用户**' : '**助手**'
    lines.push(`## ${role}`, '')
    lines.push(msg.content.trim(), '')
    if (msg.tools && msg.tools.length > 0) {
      lines.push('<details><summary>工具调用</summary>', '')
      for (const t of msg.tools) {
        lines.push(`- \`${t.name}\`: \`\`\`json`)
        try { lines.push(JSON.stringify(t.args, null, 2)) } catch { lines.push(String(t.args)) }
        lines.push('```')
        if (t.output) lines.push(`  输出：${t.output.slice(0, 500)}`)
      }
      lines.push('</details>', '')
    }
    if (msg.evidence && msg.evidence.length > 0) {
      lines.push('**来源**：')
      for (const e of msg.evidence) {
        const label = e.url ? e.url : e.path || e.title
        lines.push(`- [${e.title}](${label})`)
      }
      lines.push('')
    }
  }
  const md = lines.join('\n')
  const safeName = session.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || '会话'
  try {
    const result = await api.workExport(md, `${safeName}.md`)
    if (result.ok && result.path) {
      alert(`已导出到：${result.path}`)
    } else if (result.message && result.message !== '已取消') {
      alert(result.message)
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : '导出失败')
  }
}

// ---------------- 模式 ----------------

function storedModeId(): string {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 切换模式立即生效，只影响下一条消息；选择写入 localStorage 便于下次启动恢复 */
function selectMode(mode: WorkMode): void {
  currentModeId.value = mode.id
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode.id)
  } catch {
    // 本地存储不可用时只在本次运行内生效
  }
  modeMenuOpen.value = false
}

function toggleModeMenu(): void {
  if (!modeMenuOpen.value) {
    if (capOpen.value) closeCaps()
    if (prefsOpen.value) closePrefs()
    if (flowOpen.value) closeFlows()
    if (modeOpen.value) closeModes()
  }
  modeMenuOpen.value = !modeMenuOpen.value
}

async function refreshModes(): Promise<void> {
  modeLoading.value = true
  try {
    const result = await api.modeList()
    if (!result.ok) {
      modeError.value = result.message || '读取模式失败'
      return
    }
    modes.value = Array.isArray(result.modes) ? result.modes : []
    if (!modes.value.some((mode) => mode.id === currentModeId.value)) {
      const stored = storedModeId()
      currentModeId.value = modes.value.some((mode) => mode.id === stored)
        ? stored
        : (modes.value[0]?.id ?? '')
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, currentModeId.value)
      } catch {
        // 本地存储不可用时只在本次运行内生效
      }
    }
    if (modeSelectedId.value && !modes.value.some((mode) => mode.id === modeSelectedId.value)) {
      modeSelectedId.value = ''
      modeDraft.value = null
    }
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : '读取模式失败'
  } finally {
    modeLoading.value = false
  }
}

function openModes(): void {
  if (capOpen.value) closeCaps()
  if (prefsOpen.value) closePrefs()
  if (flowOpen.value) closeFlows()
  modeMenuOpen.value = false
  modeOpen.value = true
  modeError.value = ''
  modeNotice.value = ''
  void nextTick(() => modePanelEl.value?.focus())
  void refreshModes().then(() => {
    const target =
      modes.value.find((mode) => mode.id === currentModeId.value) ?? modes.value[0] ?? null
    if (target) selectModeForEdit(target)
  })
}

function closeModes(): void {
  modeOpen.value = false
  modeError.value = ''
  modeNotice.value = ''
}

function selectModeForEdit(mode: WorkMode): void {
  modeSelectedId.value = mode.id
  modeDraft.value = { ...mode, tools: [...mode.tools] }
  modeError.value = ''
  modeNotice.value = ''
}

function toggleModeDraftTool(id: string): void {
  const draft = modeDraft.value
  if (!draft || draft.builtin) return
  draft.tools = draft.tools.includes(id)
    ? draft.tools.filter((item) => item !== id)
    : [...draft.tools, id]
}

async function saveModeDraft(): Promise<void> {
  const draft = modeDraft.value
  if (!draft || modeSaving.value) return
  if (draft.builtin) {
    modeError.value = '内置模式不可修改，复制后可自由调整'
    return
  }
  if (!draft.name.trim()) {
    modeError.value = '模式名称不能为空'
    return
  }

  modeSaving.value = true
  modeError.value = ''
  modeNotice.value = ''
  try {
    const result = await api.modeSave({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt,
      temperature: clampInput(Number(draft.temperature), 0, 1, 0.4),
      topK: clampInput(Number(draft.topK), 1, 10, 5),
      maxRounds: Math.round(clampInput(Number(draft.maxRounds), 2, 20, 4)),
      maxTools: Math.round(clampInput(Number(draft.maxTools), 1, 30, 4)),
      historyMessages: Math.round(clampInput(Number(draft.historyMessages), 0, 30, 10)),
      contextChars: Math.round(clampInput(Number(draft.contextChars), 500, 20000, 6000)),
      outputStyle: draft.outputStyle,
      citationStrict: draft.citationStrict
    })
    if (!result.ok || !result.mode) {
      modeError.value = result.message || '保存模式失败'
      return
    }
    await refreshModes()
    selectModeForEdit(result.mode)
    modeNotice.value = '已保存，新设置从下一条消息开始生效'
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : '保存模式失败'
  } finally {
    modeSaving.value = false
  }
}

async function duplicateModeDraft(): Promise<void> {
  const draft = modeDraft.value
  if (!draft || modeSaving.value) return

  modeSaving.value = true
  modeError.value = ''
  modeNotice.value = ''
  try {
    const result = await api.modeDuplicate(draft.id)
    if (!result.ok || !result.mode) {
      modeError.value = result.message || '复制模式失败'
      return
    }
    await refreshModes()
    selectModeForEdit(result.mode)
    modeNotice.value = `已复制为「${result.mode.name}」，可直接修改`
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : '复制模式失败'
  } finally {
    modeSaving.value = false
  }
}

async function removeModeDraft(): Promise<void> {
  const draft = modeDraft.value
  if (!draft || modeSaving.value) return
  if (draft.builtin) {
    modeError.value = '内置模式不能删除，请先复制一份'
    return
  }

  modeSaving.value = true
  modeError.value = ''
  modeNotice.value = ''
  try {
    const result = await api.modeRemove(draft.id)
    if (!result.ok) {
      modeError.value = result.message || '删除模式失败'
      return
    }
    await refreshModes()
    if (currentModeId.value === draft.id) {
      currentModeId.value = modes.value[0]?.id ?? ''
    }
    const next = modes.value.find((mode) => mode.id === currentModeId.value) ?? modes.value[0]
    if (next) selectModeForEdit(next)
    modeNotice.value = '已删除该模式'
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : '删除模式失败'
  } finally {
    modeSaving.value = false
  }
}

/** 内置模式只读，这里只是重新载入默认值，不做写操作 */
function restoreModeDefault(): void {
  const mode = modes.value.find((item) => item.id === modeSelectedId.value)
  if (!mode) return
  selectModeForEdit(mode)
  modeNotice.value = '内置模式为只读，已恢复为默认配置'
}

// ---------------- 能力面板 ----------------

function openCaps(): void {
  if (prefsOpen.value) closePrefs()
  if (flowOpen.value) closeFlows()
  if (modeOpen.value) closeModes()
  modeMenuOpen.value = false
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

// ---------------- 偏好设置 ----------------

/** Agent 可调工具：只列 agentEnabled 的能力 */
const agentCapabilities = computed(() => capabilities.value.filter((item) => item.agentEnabled))

/** 空数组表示全部放开，界面按「全部开启」展示 */
function effectiveEnabledTools(value: WorkPreferences): string[] {
  const available = agentCapabilities.value.map((item) => item.id)
  if (value.enabledTools.length === 0) return available
  return available.filter((id) => value.enabledTools.includes(id))
}

function applyPrefs(next: WorkPreferences): void {
  prefs.value = next
}

async function openPrefs(): Promise<void> {
  if (capOpen.value) closeCaps()
  if (flowOpen.value) closeFlows()
  if (modeOpen.value) closeModes()
  modeMenuOpen.value = false
  prefsOpen.value = true
  prefsSaved.value = false
  prefsError.value = ''
  prefsDraft.value = { ...prefs.value, enabledTools: effectiveEnabledTools(prefs.value) }
  void nextTick(() => prefsPanelEl.value?.focus())

  // 打开时向主进程取一次最新值，避免外部改动后界面与文件不一致
  prefsLoading.value = true
  try {
    const result = await api.prefsGet()
    if (result.ok && result.preferences) {
      const next = result.preferences
      prefs.value = next
      prefsDraft.value = { ...next, enabledTools: effectiveEnabledTools(next) }
    } else if (!result.ok) {
      prefsError.value = result.message || '读取偏好设置失败'
    }
  } catch (error) {
    prefsError.value = error instanceof Error ? error.message : '读取偏好设置失败'
  } finally {
    prefsLoading.value = false
  }
}

function closePrefs(): void {
  prefsOpen.value = false
  prefsSaved.value = false
  prefsError.value = ''
}

function togglePrefs(): void {
  if (prefsOpen.value) {
    closePrefs()
  } else {
    void openPrefs()
  }
}

function togglePrefTool(id: string): void {
  const list = prefsDraft.value.enabledTools
  prefsDraft.value.enabledTools = list.includes(id)
    ? list.filter((item) => item !== id)
    : [...list, id]
}

function clampInput(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

async function savePrefs(): Promise<void> {
  if (prefsSaving.value) return
  const draft = prefsDraft.value
  if (draft.enabledTools.length === 0) {
    prefsError.value = '请至少保留一个能力，否则 Agent 将无法调用任何工具'
    return
  }

  prefsSaving.value = true
  prefsError.value = ''
  try {
    const result = await api.prefsSet({
      enabledTools: [...draft.enabledTools],
      defaultProvider: draft.defaultProvider,
      topK: clampInput(Number(draft.topK), 1, 10, 5),
      temperature: clampInput(Number(draft.temperature), 0, 1, 0.4),
      extraSystemPrompt: draft.extraSystemPrompt
    })
    if (!result.ok || !result.preferences) {
      prefsError.value = result.message || '保存偏好设置失败'
      return
    }
    applyPrefs(result.preferences)
    prefsDraft.value = {
      ...result.preferences,
      enabledTools: effectiveEnabledTools(result.preferences)
    }
    prefsSaved.value = true
    if (prefsSavedTimer !== undefined) window.clearTimeout(prefsSavedTimer)
    prefsSavedTimer = window.setTimeout(() => {
      prefsSaved.value = false
      prefsSavedTimer = undefined
    }, 2000)
  } catch (error) {
    prefsError.value = error instanceof Error ? error.message : '保存偏好设置失败'
  } finally {
    prefsSaving.value = false
  }
}

// ---------------- 工作流 ----------------

const builtinFlows = computed(() => flowList.value.filter((workflow) => workflow.builtin))
const userFlows = computed(() => flowList.value.filter((workflow) => !workflow.builtin))
const flowRecentRuns = computed(() => flowRuns.value.slice(0, 3))

const flowCanRun = computed(() => {
  const workflow = flowSelected.value
  if (!workflow || flowRunning.value) return false
  return workflow.variables.every(
    (variable) => !variable.required || (flowVars.value[variable.key] ?? '').trim().length > 0
  )
})

const flowHint = computed(() =>
  flowRunning.value ? '正在按顺序执行，可随时停止' : '按顺序执行步骤，变量会替换到参数中'
)

const flowResultText = computed(() => {
  const text = flowResult.value
  return text.length > 4000 ? `${text.slice(0, 4000)}\n……` : text
})

function flowStatusText(status: RunStep['status']): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'done':
      return '完成'
    case 'failed':
      return '失败'
    case 'skipped':
      return '跳过'
    default:
      return '待运行'
  }
}

function flowRunStatusText(status: WorkflowRun['status']): string {
  switch (status) {
    case 'done':
      return '完成'
    case 'failed':
      return '失败'
    case 'aborted':
      return '已停止'
    default:
      return '运行中'
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(ms, 0) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`
}

function flowRunBrief(run: WorkflowRun): string {
  const text = (run.result ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.length > 36 ? `${text.slice(0, 36)}…` : text
  const done = run.steps.filter((step) => step.status === 'done').length
  return `${done} / ${run.steps.length} 步完成`
}

async function refreshFlows(): Promise<void> {
  try {
    const result = await api.flowList()
    if (!result.ok) {
      flowError.value = result.message || '读取工作流失败'
      return
    }
    flowList.value = Array.isArray(result.workflows) ? result.workflows : []
  } catch (error) {
    flowError.value = error instanceof Error ? error.message : '读取工作流失败'
  }
}

async function refreshFlowRuns(): Promise<void> {
  try {
    const result = await api.flowRuns()
    if (result.ok) flowRuns.value = Array.isArray(result.runs) ? result.runs : []
  } catch {
    // 运行记录读取失败不影响当前运行
  }
}

async function openFlows(): Promise<void> {
  if (prefsOpen.value) closePrefs()
  if (capOpen.value) closeCaps()
  if (modeOpen.value) closeModes()
  modeMenuOpen.value = false
  flowOpen.value = true
  flowError.value = ''
  void nextTick(() => flowPanelEl.value?.focus())

  await refreshFlows()
  await refreshFlowRuns()
  if (!flowSelected.value && flowList.value.length > 0) selectFlow(flowList.value[0])
}

function closeFlows(): void {
  // 运行仍在后台继续，事件会写入状态，重新打开即可看到最新进度
  flowOpen.value = false
}

function toggleFlows(): void {
  if (flowOpen.value) {
    closeFlows()
  } else {
    void openFlows()
  }
}

function selectFlow(workflow: WorkflowDefinition): void {
  if (flowRunning.value) return
  flowSelected.value = workflow
  const values: Record<string, string> = {}
  for (const variable of workflow.variables) values[variable.key] = ''
  flowVars.value = values
  flowSteps.value = workflow.steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: 'pending' as const
  }))
  flowResult.value = ''
  flowError.value = ''
  flowDone.value = false
  flowElapsed.value = 0
  flowDetailRun.value = null
  flowExpanded.value = {}
}

function toggleFlowStep(id: string): void {
  flowExpanded.value[id] = !flowExpanded.value[id]
}

async function runFlow(): Promise<void> {
  const workflow = flowSelected.value
  if (!workflow || flowRunning.value) return

  const missing = workflow.variables.filter(
    (variable) => variable.required && !(flowVars.value[variable.key] ?? '').trim()
  )
  if (missing.length > 0) {
    flowError.value = `请先填写：${missing.map((variable) => variable.label).join('、')}`
    return
  }

  flowError.value = ''
  flowResult.value = ''
  flowDone.value = false
  flowElapsed.value = 0
  flowDetailRun.value = null
  flowExpanded.value = {}
  flowSteps.value = workflow.steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: 'pending' as const
  }))

  const runId = uid()
  flowRunId.value = runId
  flowRunning.value = true
  flowStopping.value = false
  flowStartedAt.value = Date.now()

  try {
    const result = await api.flowRun({
      workflowId: workflow.id,
      variables: { ...flowVars.value },
      runId
    })
    if (!result.ok) {
      flowRunning.value = false
      flowRunId.value = ''
      flowError.value = result.message || '启动工作流失败'
    }
  } catch (error) {
    flowRunning.value = false
    flowRunId.value = ''
    flowError.value = error instanceof Error ? error.message : '启动工作流失败'
  }
}

async function stopFlow(): Promise<void> {
  if (!flowRunning.value || flowStopping.value) return
  flowStopping.value = true
  const runId = flowRunId.value
  if (!runId) return
  try {
    await api.flowAbort(runId)
  } catch {
    // 中断失败时等待主进程自行结束
  }
}

async function removeFlow(workflow: WorkflowDefinition): Promise<void> {
  if (flowRunning.value) return
  flowError.value = ''
  try {
    const result = await api.flowRemove(workflow.id)
    if (!result.ok) {
      flowError.value = result.message || '删除工作流失败'
      return
    }
    if (flowSelected.value?.id === workflow.id) flowSelected.value = null
    await refreshFlows()
    if (!flowSelected.value && flowList.value.length > 0) selectFlow(flowList.value[0])
  } catch (error) {
    flowError.value = error instanceof Error ? error.message : '删除工作流失败'
  }
}

// ---------------- 工作流编辑（P1）----------------

/** 节点类型元数据：与 backend NODE_DEFINITIONS 对齐，前端用来渲染添节点下拉和内联编辑表单 */
const FLOW_NODE_TYPES = [
  { type: 'kb_search', label: '本地知识库检索', fields: [{ key: 'query', label: '检索问题' }, { key: 'topK', label: '返回条数（可选）' }] },
  { type: 'web_search', label: '联网搜索', fields: [{ key: 'query', label: '搜索关键词' }, { key: 'limit', label: '返回条数（可选）' }] },
  { type: 'fetch_url', label: '读取网页', fields: [{ key: 'url', label: '网页地址' }] },
  { type: 'llm', label: '模型分析', fields: [{ key: 'prompt', label: '提示词' }, { key: 'temperature', label: '温度（可选）' }] },
  { type: 'report', label: '生成报告', fields: [{ key: 'title', label: '报告标题' }, { key: 'instruction', label: '额外要求（可选）' }] }
]

const flowEditing = ref(false)
const flowDraft = ref<WorkflowDefinition | null>(null)
const flowEditError = ref('')

function startFlowEdit(workflow: WorkflowDefinition): void {
  flowDraft.value = {
    ...workflow,
    steps: workflow.steps.map((step) => ({ ...step, args: { ...step.args } })),
    variables: workflow.variables.map((v) => ({ ...v }))
  }
  flowEditing.value = true
  flowEditError.value = ''
}

function duplicateAsNew(workflow: WorkflowDefinition): void {
  flowDraft.value = {
    ...workflow,
    id: '',  // 空 id 让 engine.ts 自动生成
    builtin: false,
    name: `${workflow.name} · 副本`,
    steps: workflow.steps.map((step) => ({ ...step, args: { ...step.args } })),
    variables: workflow.variables.map((v) => ({ ...v })),
    createdAt: 0,
    updatedAt: 0
  }
  flowEditing.value = true
  flowEditError.value = ''
}

function cancelFlowEdit(): void {
  flowEditing.value = false
  flowDraft.value = null
  flowEditError.value = ''
}

function addFlowStepToDraft(type: string): void {
  if (!flowDraft.value) return
  const nodeType = FLOW_NODE_TYPES.find((n) => n.type === type)
  if (!nodeType) return
  const idx = flowDraft.value.steps.length + 1
  const args: Record<string, string> = {}
  for (const field of nodeType.fields) {
    args[field.key] = ''
  }
  flowDraft.value.steps.push({
    id: `s${idx}`,
    type,
    label: nodeType.label,
    args,
    enabled: true,
    onEmpty: 'skip'
  })
}

function removeFlowStepFromDraft(index: number): void {
  if (!flowDraft.value) return
  flowDraft.value.steps.splice(index, 1)
}

function moveFlowStepInDraft(index: number, direction: -1 | 1): void {
  if (!flowDraft.value) return
  const steps = flowDraft.value.steps
  const target = index + direction
  if (target < 0 || target >= steps.length) return
  const temp = steps[index]
  steps[index] = steps[target]
  steps[target] = temp
}

async function saveFlowDraft(): Promise<void> {
  if (!flowDraft.value) return
  flowEditError.value = ''
  const draft = flowDraft.value
  if (!draft.name.trim()) {
    flowEditError.value = '名称必填'
    return
  }
  if (draft.steps.length === 0) {
    flowEditError.value = '至少需要一个步骤'
    return
  }
  try {
    const result = await api.flowSave(draft)
    if (!result.ok) {
      flowEditError.value = result.message || '保存失败'
      return
    }
    await refreshFlows()
    flowEditing.value = false
    flowDraft.value = null
    if (result.workflow) selectFlow(result.workflow)
  } catch (error) {
    flowEditError.value = error instanceof Error ? error.message : '保存失败'
  }
}

// ---------------- L2-3: 工作流单节点试运行 ----------------

/** 试运行结果缓存：key=step.id，value={ ok, content, loading } */
const stepTrialResults = ref<Record<string, { ok: boolean; content: string; loading?: boolean }>>({})

/** 哪些节点类型可以直接试运行（有对应的内置能力） */
const TRIALABLE_NODE_TYPES = new Set(['kb_search', 'web_search', 'fetch_url'])

async function runStepTrial(stepId: string, stepType: string, args: Record<string, string>): Promise<void> {
  if (!TRIALABLE_NODE_TYPES.has(stepType)) return
  stepTrialResults.value[stepId] = { ok: false, content: '运行中…', loading: true }
  try {
    const result = await api.runCapability(stepType, args as Record<string, unknown>)
    stepTrialResults.value[stepId] = {
      ok: result.ok,
      content: result.content.slice(0, 1200)
    }
  } catch (error) {
    stepTrialResults.value[stepId] = {
      ok: false,
      content: error instanceof Error ? error.message : String(error)
    }
  }
}

// ---------------- P2: Agent 轨迹冻结为工作流 ----------------

/** 把助手消息里的工具调用轨迹转成 WorkflowDefinition 并保存 */
async function saveMessageAsFlow(message: WorkMessage): Promise<void> {
  const tools = message.tools ?? []
  if (tools.length === 0) return

  const flowName = prompt('为这个工作流起个名字', `Agent 轨迹 · ${new Date().toLocaleString()}`)
  if (!flowName) return

  const steps = tools.map((toolCall, idx) => {
    const toolId = toolCall.name || `unknown_${idx + 1}`
    const toolArgs = toolCall.args ?? {}
    return {
      id: `s${idx + 1}`,
      type: toolId,
      label: toolId,
      args: Object.fromEntries(
        Object.entries(toolArgs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      ),
      enabled: true,
      onEmpty: 'skip' as const
    }
  })

  const newFlow: WorkflowDefinition = {
    id: '',
    version: 1,
    builtin: false,
    name: flowName.trim(),
    description: `由 Agent 自动轨迹生成，包含 ${steps.length} 步。可在编辑模式下调整。`,
    variables: [],
    steps,
    createdAt: 0,
    updatedAt: 0
  }

  try {
    const result = await api.flowSave(newFlow)
    if (!result.ok) {
      alert(result.message || '保存工作流失败')
      return
    }
    await refreshFlows()
    if (result.workflow) selectFlow(result.workflow)
    alert(`已保存为「${newFlow.name}」，可在工作流面板查看和编辑。`)
  } catch (error) {
    alert(error instanceof Error ? error.message : '保存工作流失败')
  }
}

/** 查看历史运行的步骤状态（只读），再点一次收起 */
function openRunDetail(run: WorkflowRun): void {
  flowDetailRun.value = flowDetailRun.value?.id === run.id ? null : run
}

/** 点击模式选择器或面板菜单以外的区域时收起下拉菜单 */
function onWindowClick(event: MouseEvent): void {
  if (panelMenuOpen.value) {
    const menu = panelMenuEl.value
    if (!menu || !(event.target instanceof Node) || !menu.contains(event.target)) {
      panelMenuOpen.value = false
    }
  }
  // 会话三项菜单：点击外部关闭
  if (sessionMenuId.value && event.target instanceof Node) {
    const rail = (event.target as HTMLElement).closest('.rail-item.session')
    if (!rail || !rail.classList.contains('menu-open')) {
      sessionMenuId.value = ''
    }
  }
  if (!modeMenuOpen.value) return
  const picker = modePickerEl.value
  if (picker && event.target instanceof Node && picker.contains(event.target)) return
  modeMenuOpen.value = false
}

function onGlobalKeydown(event: KeyboardEvent): void {
  // 命令面板 Ctrl+Shift+P（Trae 风格）
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    if (paletteOpen.value) closePalette()
    else openPalette()
    return
  }

  // 命令面板已打开时，拦截方向键和 Enter
  if (paletteOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
    }
    const total = paletteFiltered.value.length
    if (total === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      paletteIndex.value = (paletteIndex.value + 1) % total
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      paletteIndex.value = (paletteIndex.value - 1 + total) % total
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const cmd = paletteFiltered.value[paletteIndex.value]
      if (cmd) runPaletteCommand(cmd)
      return
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (prefsOpen.value) closePrefs()
    if (flowOpen.value) closeFlows()
    if (modeOpen.value) closeModes()
    modeMenuOpen.value = false
    panelMenuOpen.value = false
    toggleCaps()
    return
  }
  if (event.key === 'Escape') {
    if (panelMenuOpen.value) {
      event.preventDefault()
      panelMenuOpen.value = false
      return
    }
    if (modeMenuOpen.value) {
      event.preventDefault()
      modeMenuOpen.value = false
      return
    }
    if (modeOpen.value) {
      event.preventDefault()
      closeModes()
      return
    }
    if (prefsOpen.value) {
      event.preventDefault()
      closePrefs()
      return
    }
    if (capOpen.value) {
      event.preventDefault()
      closeCaps()
      return
    }
    if (flowOpen.value) {
      event.preventDefault()
      closeFlows()
    }
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
              ...(item.url ? { url: item.url } : {}),
              ...(item.path ? { path: item.path } : {})
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
      // 记住当前选中的会话，下次启动优先恢复
      if (activeSessionId.value) {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId.value)
      }
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
  offFlowStep = api.onFlowStep((event) => {
    if (event.runId !== flowRunId.value) return
    const step = flowSteps.value.find((item) => item.id === event.stepId)
    if (!step) return
    step.status = event.status
    if (event.output !== undefined) step.output = event.output
    if (event.message !== undefined) step.error = event.message
  })
  offFlowDone = api.onFlowDone((event) => {
    if (event.runId !== flowRunId.value) return
    flowRunning.value = false
    flowStopping.value = false
    flowDone.value = event.ok
    flowElapsed.value = Math.max(Date.now() - flowStartedAt.value, 0)
    flowResult.value = event.result ?? ''
    if (!event.ok && event.message) flowError.value = event.message
    flowRunId.value = ''
    void refreshFlowRuns()
  })
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('click', onWindowClick)

  // 记录三栏容器的实时宽度，窗口变化时按容器收紧两侧上限
  if (workEl.value) {
    workWidth.value = workEl.value.clientWidth
    workObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) workWidth.value = entry.contentRect.width
    })
    workObserver.observe(workEl.value)
  }

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
    const [status, list, prefsResult] = await Promise.all([
      api.settingsStatus(),
      api.loadSessions(),
      api.prefsGet()
    ])
    settings.value = status
    sessions.value = Array.isArray(list) ? list.map(restoreSession) : []
    if (prefsResult.ok && prefsResult.preferences) {
      // 检索来源的初始值优先取当前模式，其次偏好设置
      applyPrefs(prefsResult.preferences)
    }
    await refreshModes()
    if (sessions.value.length > 0) {
      // 优先恢复用户上次选中的会话，找不到再 fallback 到最新
      const lastId = window.localStorage.getItem(ACTIVE_SESSION_KEY) ?? ''
      const existing = lastId ? sessions.value.find((s) => s.id === lastId) : undefined
      activeSessionId.value =
        existing ? existing.id : [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
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
  offFlowStep?.()
  offFlowDone?.()
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('click', onWindowClick)
  activeResizeCleanup?.()
  activeResizeCleanup = undefined
  workObserver?.disconnect()
  workObserver = undefined
  if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
  if (deleteTimer !== undefined) window.clearTimeout(deleteTimer)
  if (persistTimer !== undefined) window.clearTimeout(persistTimer)
  if (prefsSavedTimer !== undefined) window.clearTimeout(prefsSavedTimer)
  const requestId = currentRequestId.value
  if (requestId) void api.chatAbort(requestId)
  const runId = flowRunId.value
  if (runId) void api.flowAbort(runId)
})
</script>

<template>
  <section
    ref="workEl"
    class="work"
    :class="{ 'is-inspector-hidden': !panelOpen, 'is-resizing': Boolean(resizing) }"
    :style="workStyle"
  >
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
            :class="{ 'is-active': activeSessionId === session.id, 'is-pinned': session.pinned, 'menu-open': sessionMenuId === session.id }"
            @click="selectSession(session.id)"
          >
            <svg v-if="session.pinned" class="rail-item-pin" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 3l5 5-3 1-1 5 3 3H4l3-3-1-5-1-1 5-1 5-4z" />
            </svg>
            <span class="rail-item-text" :title="session.title">{{ session.title }}</span>
            <span v-if="pendingDeleteId !== session.id && sessionMenuId !== session.id" class="rail-item-count">
              {{ formatSessionTime(session.updatedAt) }}
            </span>

            <!-- 三个点菜单按钮 -->
            <button
              v-if="pendingDeleteId !== session.id"
              class="rail-dots"
              title="会话操作"
              @click.stop="sessionMenuId = sessionMenuId === session.id ? '' : session.id"
            >
              <span /><span /><span />
            </button>

            <!-- 弹出菜单：跟 Trae 对齐（置顶 / 重命名 / 导出 / 复制 / 删除） -->
            <div
              v-if="sessionMenuId === session.id"
              class="rail-menu"
              @click.stop
            >
              <button class="rail-menu-item" @click="togglePinSession(session.id); sessionMenuId = ''">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 3l5 5-3 1-1 5 3 3H4l3-3-1-5-1-1 5-1 5-4z" />
                </svg>
                {{ session.pinned ? '取消置顶' : '置顶' }}
              </button>
              <button class="rail-menu-item" @click="renameSession(session.id); sessionMenuId = ''">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                重命名
              </button>
              <button class="rail-menu-item" @click="exportSession(session.id); sessionMenuId = ''">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                导出
              </button>
              <button class="rail-menu-item" @click="copySession(session.id); sessionMenuId = ''">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                复制会话
              </button>
              <div class="rail-menu-sep" />
              <button class="rail-menu-item danger" @click="requestDelete(session.id); sessionMenuId = ''">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                </svg>
                删除任务
              </button>
            </div>

            <!-- 删除确认 -->
            <template v-if="pendingDeleteId === session.id">
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

    <!-- 左分隔条：拖动调整会话列表宽度，双击恢复默认 -->
    <div
      class="resize-handle is-session"
      :class="{ 'is-active': resizing === 'session' }"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整会话列表宽度，双击恢复默认"
      @pointerdown="startResize('session', $event)"
      @dblclick="resetWidth('session')"
    />

    <!-- 中：对话流 -->
    <section class="main">
      <header class="topbar">
        <div ref="modePickerEl" class="mode-picker">
          <button
            class="mode-btn"
            :class="{ 'is-open': modeMenuOpen }"
            title="切换工作模式"
            @click="toggleModeMenu"
          >
            <span class="mode-btn-label">{{ currentModeName }}</span>
            <span class="mode-btn-caret">▾</span>
          </button>
          <div v-if="modeMenuOpen" class="mode-menu">
            <button
              v-for="mode in modes"
              :key="mode.id"
              class="mode-menu-item"
              :class="{ 'is-active': mode.id === currentModeId }"
              @click="selectMode(mode)"
            >
              <span class="mode-menu-top">
                <span class="mode-menu-name">{{ mode.name }}</span>
                <span v-if="!mode.builtin" class="mode-menu-badge">我的</span>
                <span v-if="mode.id === currentModeId" class="mode-menu-check">✓</span>
              </span>
              <span class="mode-menu-desc">{{ mode.description }}</span>
            </button>
            <div v-if="modes.length === 0" class="mode-menu-empty">模式列表加载中…</div>
            <div class="mode-menu-foot">
              <button class="mode-menu-manage" @click="openModes">管理模式…</button>
            </div>
          </div>
        </div>
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
          <button class="cap-btn" title="打开工作流（模板 / 参数 / 运行）" @click="toggleFlows">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M4 6h7M4 12h10M4 18h7" />
              <circle cx="16" cy="6" r="2" />
              <circle cx="18" cy="18" r="2" />
            </svg>
            工作流
          </button>
          <button
            class="icon-btn"
            :class="{ 'is-on': prefsOpen }"
            title="偏好设置"
            @click="togglePrefs"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" />
            </svg>
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
            {{ currentModeDescription }}。
            在下方直接描述你的问题，Agent 会按所选模式工作，不会强制走固定步骤。
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
            <div v-if="editingId === message.id" class="edit-box">
              <textarea
                :ref="setEditTextarea"
                v-model="editingText"
                class="edit-input"
                rows="3"
              />
              <div class="edit-actions">
                <button
                  class="edit-save"
                  :disabled="busy || !editingText.trim()"
                  @click="saveEdit"
                >
                  保存并重发
                </button>
                <button class="edit-cancel" @click="cancelEdit">取消</button>
              </div>
            </div>
            <template v-else>
              <div class="bubble">{{ message.content }}</div>
              <MessageActions
                v-if="!message.streaming"
                class="msg-actions"
                role="user"
                :disabled="busy"
                @copy="copyMessage(message)"
                @branch="branchMessage(message)"
                @edit="startEdit(message)"
                @delete="deleteMessage(message)"
              />
            </template>
          </div>

          <div v-else class="msg agent">
            <div class="avatar">
              <span class="avatar-core" />
            </div>
            <div class="agent-body">
              <div class="agent-meta">
                <span class="agent-role">Agent · {{ currentModeName }}</span>
                <span class="agent-time">{{ formatSessionTime(message.createdAt) }}</span>
              </div>
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

              <MessageActions
                v-if="!message.streaming"
                class="msg-actions"
                role="assistant"
                :disabled="busy"
                :retrying="busy"
                :hasTools="(message.tools?.length ?? 0) > 0"
                @copy="copyMessage(message)"
                @branch="branchMessage(message)"
                @delete="deleteMessage(message)"
                @retry="retryMessage(message)"
                @saveAsFlow="saveMessageAsFlow(message)"
              />
            </div>
          </div>
        </template>
      </div>

      <footer class="composer">
        <div class="composer-box">
          <div class="composer-mode" :title="currentModeDescription">
            <span class="composer-mode-name">{{ currentModeName }}</span>
            <span class="composer-mode-desc">{{ currentModeDescription }}</span>
          </div>
          <div class="composer-chips">
            <span v-for="label in modeToolLabels" :key="label" class="chip">{{ label }}</span>
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
            <button
              v-else
              class="send-btn"
              title="发送"
              :disabled="!draft.trim()"
              @click="send"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h13M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </section>

    <!-- 右分隔条：拖动调整右侧面板宽度，面板收起时不显示 -->
    <div
      v-if="panelOpen"
      class="resize-handle is-inspector"
      :class="{ 'is-active': resizing === 'inspector' }"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整右侧面板宽度，双击恢复默认"
      @pointerdown="startResize('inspector', $event)"
      @dblclick="resetWidth('inspector')"
    />

    <!-- 右：注册表驱动的面板容器 -->
    <aside v-if="panelOpen" class="inspector">
      <div class="panel-tabs">
        <div class="panel-tab-list">
          <div
            v-for="panel in openPanels"
            :key="panel.id"
            class="panel-tab"
            :class="{ 'is-active': activePanelId === panel.id }"
          >
            <button class="panel-tab-label" @click="activatePanel(panel.id)">
              {{ panel.label }}
            </button>
            <button
              v-if="!panel.pinnable && panel.closable !== false"
              class="panel-tab-close"
              title="关闭面板"
              @click.stop="closePanel(panel.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div ref="panelMenuEl" class="panel-add">
          <button class="panel-add-btn" title="新增面板" @click.stop="togglePanelMenu">+</button>
          <div v-if="panelMenuOpen" class="panel-menu">
            <button
              v-for="panel in closedPanels"
              :key="panel.id"
              class="panel-menu-item"
              @click="addPanel(panel.id)"
            >
              <span class="panel-menu-name">{{ panel.label }}</span>
              <span class="panel-menu-desc">{{ panel.description }}</span>
            </button>
            <div v-if="closedPanels.length === 0" class="panel-menu-empty">全部面板已打开</div>
          </div>
        </div>
      </div>

      <div class="insp-scroll">
        <KeepAlive>
          <component
            :is="activePanelDefinition.component"
            :key="activePanelId"
            v-bind="activePanelProps"
            @import="importKb"
            @remove="removeKb"
            @manage="openModes"
          />
        </KeepAlive>
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

    <!-- 偏好设置：把 Agent 已有行为的可调参数开放给用户 -->
    <div v-if="prefsOpen" class="cap-mask" @click.self="closePrefs">
      <div ref="prefsPanelEl" class="cap-panel prefs-panel" tabindex="-1">
        <header class="cap-head">
          <h4>偏好设置</h4>
          <span v-if="prefsSaved" class="prefs-saved">已保存</span>
          <button class="cap-close" title="关闭" @click="closePrefs">×</button>
        </header>

        <div v-if="prefsLoading" class="cap-tip">正在读取偏好设置…</div>

        <template v-else>
          <section class="prefs-section">
            <div class="prefs-label">
              <span>Agent 可用的能力</span>
              <span class="prefs-count">
                {{ prefsDraft.enabledTools.length }} / {{ agentCapabilities.length }} 开启
              </span>
            </div>
            <div class="prefs-tools">
              <div v-for="capability in agentCapabilities" :key="capability.id" class="prefs-tool">
                <div class="prefs-tool-text">
                  <span class="prefs-tool-name">{{ capability.label }}</span>
                  <span class="prefs-tool-desc">{{ capability.description }}</span>
                </div>
                <button
                  class="prefs-switch"
                  :class="{ 'is-on': prefsDraft.enabledTools.includes(capability.id) }"
                  :aria-pressed="prefsDraft.enabledTools.includes(capability.id)"
                  @click.prevent="togglePrefTool(capability.id)"
                >
                  <span class="prefs-knob" />
                </button>
              </div>
              <div v-if="agentCapabilities.length === 0" class="cap-tip">能力列表尚未加载。</div>
            </div>
          </section>

          <label class="prefs-field">
            <span class="prefs-label">默认检索来源</span>
            <select v-model="prefsDraft.defaultProvider">
              <option value="local">本地库</option>
              <option value="cloud">云端公共库</option>
              <option value="both">双路合并</option>
            </select>
          </label>

          <div class="prefs-row">
            <label class="prefs-field">
              <span class="prefs-label">检索条数 topK</span>
              <input v-model.number="prefsDraft.topK" type="number" min="1" max="10" step="1" />
            </label>
            <label class="prefs-field">
              <span class="prefs-label">温度</span>
              <input
                v-model.number="prefsDraft.temperature"
                type="number"
                min="0"
                max="1"
                step="0.1"
              />
            </label>
          </div>

          <label class="prefs-field">
            <span class="prefs-label">自定义提示词</span>
            <textarea
              v-model="prefsDraft.extraSystemPrompt"
              rows="4"
              placeholder="会追加到 Agent 系统提示词末尾"
            />
          </label>

          <div v-if="prefsError" class="rag-error">{{ prefsError }}</div>

          <div class="cap-actions">
            <button class="cap-run" :disabled="prefsSaving" @click="savePrefs">
              {{ prefsSaving ? '保存中…' : '保存' }}
            </button>
            <button class="prefs-cancel" @click="closePrefs">取消</button>
          </div>
        </template>
      </div>
    </div>
    <!-- 模式管理：内置只读，自定义可改；模式只决定 Agent 的工作方式 -->
    <div v-if="modeOpen" class="cap-mask" @click.self="closeModes">
      <div ref="modePanelEl" class="cap-panel mode-panel" tabindex="-1">
        <header class="cap-head">
          <h4>模式管理</h4>
          <span class="cap-kbd">模式决定 Agent 的工作方式</span>
          <button class="cap-close" title="关闭" @click="closeModes">×</button>
        </header>

        <div class="mode-body">
          <aside class="mode-side">
            <div class="rail-label">内置模式</div>
            <button
              v-for="mode in builtinModes"
              :key="mode.id"
              class="flow-item"
              :class="{ 'is-active': modeSelectedId === mode.id }"
              @click="selectModeForEdit(mode)"
            >
              <span class="flow-item-top">
                <span class="flow-name" :title="mode.name">{{ mode.name }}</span>
                <span class="flow-badge">内置</span>
              </span>
              <span class="flow-desc">{{ mode.description }}</span>
            </button>

            <div class="rail-label">我的模式</div>
            <button
              v-for="mode in customModes"
              :key="mode.id"
              class="flow-item"
              :class="{ 'is-active': modeSelectedId === mode.id }"
              @click="selectModeForEdit(mode)"
            >
              <span class="flow-item-top">
                <span class="flow-name" :title="mode.name">{{ mode.name }}</span>
                <span class="flow-badge is-custom">我的</span>
              </span>
              <span class="flow-desc">{{ mode.description || '自定义模式' }}</span>
            </button>
            <div v-if="customModes.length === 0" class="flow-tip">
              还没有自定义模式，可从内置模式复制一份再调整。
            </div>
            <div v-if="modeLoading && modes.length === 0" class="flow-tip">正在读取模式…</div>
          </aside>

          <div class="mode-main">
            <div v-if="!modeDraft" class="cap-tip">从左侧选择一个模式查看或编辑。</div>

            <template v-else>
              <div class="mode-title-row">
                <span class="flow-title">{{ modeDraft.name || '未命名模式' }}</span>
                <span class="flow-badge" :class="{ 'is-custom': !modeDraft.builtin }">
                  {{ modeDraft.builtin ? '内置' : '我的' }}
                </span>
                <span v-if="modeDraft.builtin" class="mode-readonly">
                  内置模式不可修改，复制后可自由调整
                </span>
              </div>

              <label class="cap-field">
                <span class="cap-field-label">名称</span>
                <input v-model="modeDraft.name" type="text" :disabled="modeDraft.builtin" />
              </label>

              <label class="cap-field">
                <span class="cap-field-label">说明</span>
                <input
                  v-model="modeDraft.description"
                  type="text"
                  placeholder="一句话说明这个模式适合什么任务"
                  :disabled="modeDraft.builtin"
                />
              </label>

              <label class="cap-field">
                <span class="cap-field-label">系统提示词</span>
                <textarea
                  v-model="modeDraft.systemPrompt"
                  rows="6"
                  placeholder="描述该模式的职责与边界，会追加到基础规则之后"
                  :disabled="modeDraft.builtin"
                />
              </label>

              <div class="prefs-section">
                <div class="prefs-label">
                  <span>可用工具</span>
                  <span class="prefs-count">关闭后该模式不能调用此工具</span>
                </div>
                <div class="prefs-tools">
                  <div v-for="capability in agentCapabilities" :key="capability.id" class="prefs-tool">
                    <div class="prefs-tool-text">
                      <span class="prefs-tool-name">{{ capability.label }}</span>
                      <span class="prefs-tool-desc">{{ capability.description }}</span>
                    </div>
                    <button
                      class="prefs-switch"
                      :class="{ 'is-on': modeDraft.tools.includes(capability.id) }"
                      :disabled="modeDraft.builtin"
                      :aria-pressed="modeDraft.tools.includes(capability.id)"
                      @click.prevent="toggleModeDraftTool(capability.id)"
                    >
                      <span class="prefs-knob" />
                    </button>
                  </div>
                  <div v-if="agentCapabilities.length === 0" class="cap-tip">能力列表尚未加载。</div>
                </div>
              </div>

              <div class="prefs-row">
                <label class="prefs-field">
                  <span class="prefs-label">温度 0-1</span>
                  <input
                    v-model.number="modeDraft.temperature"
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    :disabled="modeDraft.builtin"
                  />
                </label>
                <label class="prefs-field">
                  <span class="prefs-label">检索条数 topK</span>
                  <input
                    v-model.number="modeDraft.topK"
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    :disabled="modeDraft.builtin"
                  />
                </label>
              </div>

              <label class="prefs-field">
                <span class="prefs-label">默认检索来源</span>
                <select v-model="modeDraft.ragProvider" :disabled="modeDraft.builtin">
                  <option value="local">本地库</option>
                  <option value="cloud">云端公共库</option>
                  <option value="both">双路合并</option>
                </select>
              </label>

              <!-- 执行控制：把原先写死在代码里的 Agent 参数开放给用户调整 -->
              <div class="prefs-section">
                <div class="prefs-label">
                  <span>执行控制</span>
                  <span class="prefs-count">轮数、工具次数、历史窗口与输出风格</span>
                </div>

                <div class="prefs-row">
                  <label class="prefs-field">
                    <span class="prefs-label">Agent 最大轮数 2-20</span>
                    <input
                      v-model.number="modeDraft.maxRounds"
                      type="number"
                      min="2"
                      max="20"
                      step="1"
                      :disabled="modeDraft.builtin"
                    />
                  </label>
                  <label class="prefs-field">
                    <span class="prefs-label">最多工具调用 1-30</span>
                    <input
                      v-model.number="modeDraft.maxTools"
                      type="number"
                      min="1"
                      max="30"
                      step="1"
                      :disabled="modeDraft.builtin"
                    />
                  </label>
                </div>

                <div class="prefs-row">
                  <label class="prefs-field">
                    <span class="prefs-label">历史消息条数 0-30</span>
                    <input
                      v-model.number="modeDraft.historyMessages"
                      type="number"
                      min="0"
                      max="30"
                      step="1"
                      title="0 表示不带历史，只发送当前问题"
                      :disabled="modeDraft.builtin"
                    />
                  </label>
                  <label class="prefs-field">
                    <span class="prefs-label">单条上下文长度 500-20000</span>
                    <input
                      v-model.number="modeDraft.contextChars"
                      type="number"
                      min="500"
                      max="20000"
                      step="500"
                      :disabled="modeDraft.builtin"
                    />
                  </label>
                </div>

                <div class="prefs-row">
                  <label class="prefs-field">
                    <span class="prefs-label">输出格式</span>
                    <select v-model="modeDraft.outputStyle" :disabled="modeDraft.builtin">
                      <option value="free">自由文本</option>
                      <option value="bullets">要点列表</option>
                      <option value="table">表格优先</option>
                      <option value="report">结构化报告</option>
                    </select>
                  </label>
                  <label class="prefs-field">
                    <span class="prefs-label">引用严格度</span>
                    <select v-model="modeDraft.citationStrict" :disabled="modeDraft.builtin">
                      <option value="required">必须引用</option>
                      <option value="preferred">尽量引用</option>
                      <option value="off">不强制</option>
                    </select>
                  </label>
                </div>
              </div>

              <div v-if="modeError" class="rag-error">{{ modeError }}</div>
              <div v-if="modeNotice" class="kb-notice">{{ modeNotice }}</div>

              <div class="cap-actions">
                <button
                  v-if="!modeDraft.builtin"
                  class="cap-run"
                  :disabled="modeSaving"
                  @click="saveModeDraft"
                >
                  {{ modeSaving ? '保存中…' : '保存' }}
                </button>
                <button class="prefs-cancel" :disabled="modeSaving" @click="duplicateModeDraft">
                  复制为新模式
                </button>
                <button
                  v-if="!modeDraft.builtin"
                  class="mode-del"
                  :disabled="modeSaving"
                  @click="removeModeDraft"
                >
                  删除
                </button>
                <button v-else class="prefs-cancel" @click="restoreModeDefault">
                  恢复内置默认
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
    <!-- 工作流：模板 / 参数 / 步骤进度 / 结果 / 最近运行 -->
    <div v-if="flowOpen" class="cap-mask" @click.self="closeFlows">
      <div ref="flowPanelEl" class="cap-panel flow-panel" tabindex="-1">
        <header class="cap-head">
          <h4>工作流</h4>
          <span class="cap-kbd">模板编排 · MVP</span>
          <button class="cap-close" title="关闭" @click="closeFlows">×</button>
        </header>

        <div class="flow-body">
          <aside class="flow-side">
            <div class="flow-group">
              <div class="rail-label">内置模板</div>
              <div
                v-for="workflow in builtinFlows"
                :key="workflow.id"
                class="flow-item"
                :class="{
                  'is-active': flowSelected?.id === workflow.id,
                  'is-disabled': flowRunning && flowSelected?.id !== workflow.id
                }"
                role="button"
                tabindex="0"
                @click="selectFlow(workflow)"
                @keydown.enter="selectFlow(workflow)"
              >
                <span class="flow-item-top">
                  <span class="flow-name" :title="workflow.name">{{ workflow.name }}</span>
                  <span class="flow-badge">模板</span>
                </span>
                <span class="flow-desc">{{ workflow.description }}</span>
              </div>
              <div v-if="builtinFlows.length === 0" class="flow-tip">模板加载中…</div>
            </div>

            <div class="flow-group">
              <div class="rail-label">我的流程</div>
              <div
                v-for="workflow in userFlows"
                :key="workflow.id"
                class="flow-item"
                :class="{
                  'is-active': flowSelected?.id === workflow.id,
                  'is-disabled': flowRunning && flowSelected?.id !== workflow.id
                }"
                role="button"
                tabindex="0"
                @click="selectFlow(workflow)"
                @keydown.enter="selectFlow(workflow)"
              >
                <span class="flow-item-top">
                  <span class="flow-name" :title="workflow.name">{{ workflow.name }}</span>
                  <button
                    class="flow-del"
                    title="删除该流程"
                    :disabled="flowRunning"
                    @click.stop="removeFlow(workflow)"
                  >
                    ×
                  </button>
                </span>
                <span class="flow-desc">{{ workflow.description || '自定义流程' }}</span>
              </div>
              <div v-if="userFlows.length === 0" class="flow-tip">
                还没有自定义流程，内置模板可直接运行。
              </div>
            </div>
          </aside>

          <div class="flow-main">
            <div v-if="!flowSelected">
              <div class="cap-tip">从左侧选择一个工作流开始。</div>
              <div v-if="flowError" class="rag-error">{{ flowError }}</div>
            </div>

            <template v-else-if="!flowEditing">
              <div class="flow-title-row">
                <span class="flow-title">{{ flowSelected.name }}</span>
                <span v-if="flowSelected.builtin" class="flow-badge">模板</span>
                <span class="flow-step-count">{{ flowSteps.length }} 步</span>
                <div class="flow-edit-actions">
                  <button
                    v-if="flowSelected.builtin"
                    class="flow-edit-btn"
                    :disabled="flowRunning"
                    @click="duplicateAsNew(flowSelected)"
                  >另存为 → 编辑</button>
                  <button
                    v-else
                    class="flow-edit-btn"
                    :disabled="flowRunning"
                    @click="startFlowEdit(flowSelected)"
                  >编辑</button>
                </div>
              </div>
              <p class="flow-desc flow-desc-line">{{ flowSelected.description }}</p>

              <div v-if="flowSelected.variables.length" class="flow-vars">
                <label
                  v-for="variable in flowSelected.variables"
                  :key="variable.key"
                  class="cap-field"
                >
                  <span class="cap-field-label">
                    {{ variable.label }}
                    <em v-if="variable.required" class="flow-required">*</em>
                  </span>
                  <input
                    v-model="flowVars[variable.key]"
                    type="text"
                    :placeholder="variable.placeholder || ''"
                    :disabled="flowRunning"
                  />
                </label>
              </div>

              <ul class="flow-steps">
                <li
                  v-for="(step, index) in flowSteps"
                  :key="step.id"
                  class="flow-step"
                  :class="'is-' + step.status"
                >
                  <button class="flow-step-head" @click="toggleFlowStep(step.id)">
                    <span class="flow-step-index">{{ index + 1 }}</span>
                    <span class="flow-step-name" :title="step.label">{{ step.label }}</span>
                    <span class="flow-step-state">{{ flowStatusText(step.status) }}</span>
                    <span
                      v-if="step.output || step.error"
                      class="flow-step-caret"
                      :class="{ 'is-open': flowExpanded[step.id] }"
                    >
                      ▾
                    </span>
                  </button>
                  <pre
                    v-if="flowExpanded[step.id] && (step.output || step.error)"
                    class="flow-step-output"
                  >{{ step.error || step.output }}</pre>
                </li>
              </ul>

              <div class="cap-actions">
                <button class="cap-run" :disabled="!flowCanRun" @click="runFlow">
                  {{ flowRunning ? '运行中…' : '运行' }}
                </button>
                <button
                  v-if="flowRunning"
                  class="flow-stop"
                  :disabled="flowStopping"
                  @click="stopFlow"
                >
                  {{ flowStopping ? '停止中…' : '停止' }}
                </button>
                <span class="cap-hint">{{ flowHint }}</span>
              </div>

              <div v-if="flowError" class="rag-error">{{ flowError }}</div>

              <div v-if="flowResultText" class="flow-result" :class="{ 'is-error': !flowDone }">
                <div class="cap-result-head">
                  <span class="cap-result-state">{{ flowDone ? '运行完成' : '运行结束' }}</span>
                  <span v-if="flowElapsed > 0" class="flow-duration">
                    耗时 {{ formatDuration(flowElapsed) }}
                  </span>
                  <span v-if="flowResult.length > 4000" class="cap-result-note">
                    仅显示前 4000 字
                  </span>
                </div>
                <pre class="flow-result-body">{{ flowResultText }}</pre>
              </div>
            </template>

            <template v-else>
              <!-- 工作流编辑视图（P1） -->
              <div v-if="flowDraft" class="flow-edit">
                <div class="flow-edit-head">
                  <input v-model="flowDraft.name" type="text" class="flow-edit-name" placeholder="工作流名称" />
                  <button class="flow-edit-save" @click="saveFlowDraft">保存</button>
                  <button class="flow-edit-cancel" @click="cancelFlowEdit">取消</button>
                </div>
                <textarea v-model="flowDraft.description" class="flow-edit-desc" placeholder="描述这个工作流做什么（可选）" />

                <div class="flow-edit-section">
                  <div class="flow-edit-section-head">
                    <span>参数变量</span>
                    <button class="flow-edit-add" @click="flowDraft.variables.push({ key: '', label: '', placeholder: '', required: false })">+ 添加</button>
                  </div>
                  <div v-if="flowDraft.variables.length === 0" class="flow-edit-hint">这个工作流没有输入参数。</div>
                  <div v-for="(variable, idx) in flowDraft.variables" :key="idx" class="flow-edit-var">
                    <input v-model="variable.key" type="text" placeholder="变量名" :disabled="flowRunning" />
                    <input v-model="variable.label" type="text" placeholder="显示名" />
                    <input v-model="variable.placeholder" type="text" placeholder="占位提示（可选）" />
                    <label class="flow-edit-req"><input type="checkbox" v-model="variable.required" /> 必填</label>
                    <button class="flow-edit-del" @click="flowDraft.variables.splice(idx, 1)">×</button>
                  </div>
                </div>

                <div class="flow-edit-section">
                  <div class="flow-edit-section-head">
                    <span>执行步骤</span>
                    <select class="flow-edit-add-select" @change="addFlowStepToDraft(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
                      <option value="">+ 添加步骤…</option>
                      <option v-for="node in FLOW_NODE_TYPES" :key="node.type" :value="node.type">{{ node.label }}</option>
                    </select>
                  </div>
                  <div v-if="flowDraft.steps.length === 0" class="flow-edit-hint">至少添加一个步骤。</div>
                  <div v-for="(step, idx) in flowDraft.steps" :key="step.id" class="flow-edit-step">
                    <div class="flow-edit-step-head">
                      <span class="flow-edit-step-num">{{ idx + 1 }}</span>
                      <span class="flow-edit-step-type">{{ FLOW_NODE_TYPES.find(n => n.type === step.type)?.label || step.type }}</span>
                      <button
                        v-if="['kb_search','web_search','fetch_url'].includes(step.type)"
                        class="flow-edit-trial"
                        :disabled="stepTrialResults[step.id]?.loading"
                        :title="stepTrialResults[step.id]?.loading ? '运行中…' : '试运行这个节点'"
                        @click="runStepTrial(step.id, step.type, step.args)"
                      >试运行</button>
                      <button class="flow-edit-move" :disabled="idx === 0" @click="moveFlowStepInDraft(idx, -1)">↑</button>
                      <button class="flow-edit-move" :disabled="idx === flowDraft.steps.length - 1" @click="moveFlowStepInDraft(idx, 1)">↓</button>
                      <button class="flow-edit-del" @click="removeFlowStepFromDraft(idx)">×</button>
                    </div>
                    <div class="flow-edit-step-fields">
                      <div v-for="field in (FLOW_NODE_TYPES.find(n => n.type === step.type)?.fields || [])" :key="field.key" class="flow-edit-field">
                        <label>{{ field.label }}</label>
                        <textarea
                          v-if="field.key === 'prompt' || field.key === 'instruction' || field.key === 'query'"
                          v-model="step.args[field.key]"
                          :placeholder="'{{变量名}} ' + field.key + ' 的内容…'"
                          rows="2"
                        />
                        <input v-else v-model="step.args[field.key]" type="text" :placeholder="field.key" />
                      </div>
                    </div>
                    <!-- 试运行结果 -->
                    <div v-if="stepTrialResults[step.id]" class="flow-edit-trial-result" :class="{ 'is-ok': stepTrialResults[step.id].ok, 'is-err': !stepTrialResults[step.id].ok }">
                      <pre>{{ stepTrialResults[step.id].content }}</pre>
                    </div>
                  </div>
                </div>

                <div v-if="flowEditError" class="rag-error">{{ flowEditError }}</div>
              </div>
            </template>
          </div>
        </div>

        <div class="flow-runs">
          <div class="flow-runs-head">
            <span>最近运行</span>
            <span class="cap-hint">记录保留最近 20 条，点开可查看步骤状态</span>
          </div>
          <div v-if="flowRecentRuns.length === 0" class="flow-tip">还没有运行记录。</div>
          <button
            v-for="run in flowRecentRuns"
            :key="run.id"
            class="flow-run"
            :class="{ 'is-active': flowDetailRun?.id === run.id }"
            @click="openRunDetail(run)"
          >
            <span class="flow-run-time">{{ formatSessionTime(run.createdAt) }}</span>
            <span class="flow-run-state" :class="'is-' + run.status">
              {{ flowRunStatusText(run.status) }}
            </span>
            <span class="flow-run-name">{{ run.name }}</span>
            <span class="flow-run-brief">{{ flowRunBrief(run) }}</span>
          </button>

          <div v-if="flowDetailRun" class="flow-run-detail">
            <div class="flow-run-detail-head">
              <span class="flow-run-name">{{ flowDetailRun.name }}</span>
              <span class="flow-run-state" :class="'is-' + flowDetailRun.status">
                {{ flowRunStatusText(flowDetailRun.status) }}
              </span>
              <span v-if="flowDetailRun.endedAt" class="flow-duration">
                耗时 {{ formatDuration(flowDetailRun.endedAt - flowDetailRun.createdAt) }}
              </span>
            </div>
            <ul class="flow-run-steps">
              <li
                v-for="(step, index) in flowDetailRun.steps"
                :key="step.id"
                :class="'is-' + step.status"
              >
                <span class="flow-step-index">{{ index + 1 }}</span>
                <span class="flow-step-name" :title="step.label">{{ step.label }}</span>
                <span class="flow-step-state">{{ flowStatusText(step.status) }}</span>
              </li>
            </ul>
            <pre v-if="flowDetailRun.result" class="flow-run-result">{{ flowDetailRun.result }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 命令面板 Ctrl+Shift+P（Trae 风格） -->
    <Teleport to="body">
      <div v-if="paletteOpen" class="palette-mask" @click.self="closePalette">
        <div class="palette">
          <div class="palette-head">
            <svg class="palette-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref="paletteInputRef"
              v-model="paletteQuery"
              class="palette-input"
              placeholder="输入命令名…"
              @keydown.enter.prevent="paletteFiltered[paletteIndex] && runPaletteCommand(paletteFiltered[paletteIndex])"
              @keydown.escape.prevent="closePalette"
              @keydown.arrow-down.prevent="paletteIndex = (paletteIndex + 1) % Math.max(paletteFiltered.length, 1)"
              @keydown.arrow-up.prevent="paletteIndex = (paletteIndex - 1 + Math.max(paletteFiltered.length, 1)) % Math.max(paletteFiltered.length, 1)"
            />
            <span class="palette-kbd">Ctrl+Shift+P</span>
          </div>
          <div class="palette-body">
            <div v-if="paletteFiltered.length === 0" class="palette-empty">没找到匹配的命令</div>
            <div
              v-for="(cmd, idx) in paletteFiltered"
              :key="cmd.id"
              class="palette-item"
              :class="{ 'is-active': idx === paletteIndex }"
              @mouseenter="paletteIndex = idx"
              @click="runPaletteCommand(cmd)"
            >
              <span class="palette-group">{{ cmd.group }}</span>
              <span class="palette-label">{{ cmd.label }}</span>
              <span class="palette-hint">{{ cmd.hint }}</span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.work {
  --session-w: 236px;
  --inspector-w: 300px;

  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

/* 拖动分隔条期间禁用选中，避免选中文字 */
.work.is-resizing {
  user-select: none;
  cursor: col-resize;
}

/* ---------------- 分隔条 ---------------- */

.resize-handle {
  position: relative;
  flex: 0 0 5px;
  width: 5px;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
}

.resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: transparent;
  transition: background 0.15s ease;
}

.resize-handle:hover::after,
.resize-handle.is-active::after {
  background: var(--accent);
}

/* ---------------- 左栏 ---------------- */

.rail {
  display: flex;
  flex: 0 0 var(--session-w);
  flex-direction: column;
  width: var(--session-w);
  min-height: 0;
  background: var(--bg-1);
  border-right: 1px solid var(--line);
}

.rail-head {
  padding: 12px 10px 8px;
}

.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: #0b0d11;
  background: var(--accent);
  border-radius: 7px;
  transition: filter 0.15s ease, opacity 0.15s ease;
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
  gap: 6px;
  margin: 0 10px 8px;
  padding: 5px 8px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: border-color 0.15s ease, color 0.15s ease;
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
  padding: 14px 8px 6px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

.rail-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}

.rail-item + .rail-item {
  margin-top: 2px;
}

.rail-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}

.rail-item.is-active {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
}

.rail-item.is-active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 16px;
  background: var(--accent);
  border-radius: 99px;
  transform: translateY(-50%);
}

.rail-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rail-item-count {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--text-3);
}

/* 置顶标记 */
.rail-item-pin {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  color: var(--accent);
}

/* 三个点按钮 */
.rail-dots {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.12s ease;
  border-radius: 4px;
  cursor: pointer;
}
.rail-dots span {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-3);
}
.rail-item:hover .rail-dots,
.rail-item.menu-open .rail-dots,
.rail-dots:focus-visible {
  opacity: 1;
}
.rail-dots:hover {
  background: rgba(255, 255, 255, 0.08);
}
.rail-dots:hover span {
  background: var(--text);
}

/* 弹出菜单（Trae 风格） */
.rail-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 7px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.rail-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  font-size: 11.5px;
  color: var(--text-2);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}
.rail-menu-item:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
.rail-menu-item svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}
.rail-menu-item.danger {
  color: #c06a6a;
}
.rail-menu-item.danger:hover {
  color: #ff7a7a;
  background: rgba(192, 106, 106, 0.1);
}
.rail-menu-sep {
  height: 1px;
  margin: 3px 4px;
  background: var(--line);
}

.del-btn { display: none; } /* 保留兼容，不再使用 */

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
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.topbar {
  position: relative;
  /* 顶栏有 backdrop-filter 会形成独立层叠上下文，显式抬高整层，
     否则模式下拉菜单会被下方消息流盖住，文字穿透 */
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 16px;
  background: rgba(11, 13, 17, 0.5);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}

/* ---------------- 模式选择器 ---------------- */

.mode-picker {
  position: relative;
  flex: 0 0 auto;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  max-width: 132px;
  padding: 0 9px;
  font-size: 11px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 999px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-btn:hover,
.mode-btn.is-open {
  color: var(--text);
  background: rgba(255, 255, 255, 0.07);
  border-color: var(--line-2);
}

.mode-btn-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mode-btn-caret {
  flex: 0 0 auto;
  font-size: 9px;
  color: var(--text-3);
}

.mode-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 272px;
  max-height: 340px;
  padding: 7px;
  overflow: auto;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}

.mode-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 7px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.mode-menu-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.mode-menu-item.is-active {
  background: var(--accent-soft);
  border-color: rgba(61, 220, 151, 0.32);
}

.mode-menu-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-menu-name {
  font-size: 12.5px;
  color: var(--text);
}

.mode-menu-badge {
  flex: 0 0 auto;
  padding: 0 5px;
  font-size: 9px;
  line-height: 15px;
  color: #8fb4ff;
  background: rgba(96, 145, 255, 0.14);
  border-radius: 99px;
}

.mode-menu-check {
  margin-left: auto;
  font-size: 11px;
  color: var(--accent);
}

.mode-menu-desc {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-3);
}

.mode-menu-empty {
  padding: 10px 8px;
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}

.mode-menu-foot {
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.mode-menu-manage {
  width: 100%;
  padding: 6px 8px;
  font-size: 11.5px;
  color: var(--text-2);
  text-align: left;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
}

.mode-menu-manage:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.crumb {
  display: flex;
  flex: 1;
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
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag {
  flex: 0 0 auto;
  padding: 0 6px;
  font-size: 10px;
  line-height: 17px;
  color: var(--accent);
  background: rgba(61, 220, 151, 0.1);
  border-radius: 999px;
}

.top-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.pill.is-warn {
  color: #ffb0b0;
  border-color: rgba(255, 107, 107, 0.28);
}

.cap-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: 6px;
  transition: color 0.15s ease, background 0.15s ease;
}

.cap-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.cap-btn svg {
  width: 13px;
  height: 13px;
}

.cap-kbd {
  padding: 0 4px;
  font-size: 9px;
  line-height: 15px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--text-3);
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
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
  gap: 16px;
  padding: 18px 20px;
}

.msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  animation: rise 0.24s ease both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}

.msg.user {
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

/* 操作行默认隐藏，悬停消息或用键盘聚焦时显示 */
.msg-actions {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.msg:hover .msg-actions,
.msg:focus-within .msg-actions,
.msg-actions:focus-within {
  opacity: 1;
}

/* ---------------- 用户消息内联编辑 ---------------- */

.msg.user .edit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(78%, 620px);
  padding: 10px 14px;
  background: rgba(61, 220, 151, 0.06);
  border: 1px solid rgba(61, 220, 151, 0.18);
  border-radius: 12px;
}

.edit-input {
  width: 100%;
  min-height: 64px;
  padding: 2px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.edit-save,
.edit-cancel {
  height: 26px;
  padding: 0 12px;
  font-size: 11.5px;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.edit-save {
  color: #0d1b13;
  background: var(--accent);
}

.edit-save:hover:not(:disabled) {
  filter: brightness(1.08);
}

.edit-save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.edit-cancel {
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.05);
}

.edit-cancel:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.09);
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 12px;
}

.msg.user .bubble {
  color: var(--text);
  background: rgba(61, 220, 151, 0.1);
  border: 1px solid rgba(61, 220, 151, 0.16);
}

.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 7px;
}

.avatar-core {
  width: 7px;
  height: 7px;
  background: var(--accent);
  border-radius: 2px;
  transform: rotate(45deg);
}

.agent-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

/* 助手消息上方角色行：模式与时间，弱化到辅助信息层级 */
.agent-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-2);
}

.agent-role {
  font-weight: 500;
}

.agent-time {
  font-size: 10.5px;
  color: var(--text-3);
}

/* 助手正文不再用卡片承载，直接落在画布上 */
.agent-bubble {
  max-width: 100%;
  padding: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--text);
  background: none;
  border: 0;
  border-radius: 0;
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
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--line);
  border-radius: 8px;
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
  transition: transform 0.15s ease;
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
  transition: background 0.15s ease;
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
  transition: border-color 0.15s ease, color 0.15s ease;
}

.suggest:hover {
  color: var(--text);
  border-color: var(--line-2);
}

/* ---------------- 输入区 ---------------- */

.composer {
  padding: 6px 20px 14px;
}

.composer-box {
  padding: 10px 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 14px;
  transition: border-color 0.15s ease;
}

.composer-box:focus-within {
  border-color: rgba(61, 220, 151, 0.35);
}

.composer-mode {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 0 2px 4px;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.composer-mode-name {
  flex: 0 0 auto;
  font-weight: 500;
  color: var(--text-2);
}

.composer-mode-desc {
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 6px;
}

.chip {
  padding: 0 7px;
  font-size: 10px;
  line-height: 17px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 999px;
}

.composer-box textarea {
  width: 100%;
  min-height: 44px;
  max-height: 160px;
  padding: 0 2px 2px;
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
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #07120c;
  background: var(--accent);
  border-radius: 999px;
  transition: filter 0.15s ease, opacity 0.15s ease;
}

.send-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn svg {
  width: 15px;
  height: 15px;
}

.stop-btn {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  font-size: 11.5px;
  font-weight: 500;
  color: #ff9a9a;
  background: transparent;
  border: 1px solid rgba(255, 107, 107, 0.32);
  border-radius: 8px;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.stop-btn:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.12);
}

.stop-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop-icon {
  width: 7px;
  height: 7px;
  background: #ff8b8b;
  border-radius: 2px;
}

/* ---------------- 右栏 ---------------- */

.inspector {
  display: flex;
  flex: 0 0 var(--inspector-w);
  flex-direction: column;
  width: var(--inspector-w);
  min-height: 0;
  background: var(--bg-1);
  border-left: 1px solid var(--line);
}

.panel-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--line);
}

.panel-tab-list {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.panel-tab-list::-webkit-scrollbar {
  display: none;
}

.panel-tab {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  height: 100%;
  padding: 0 6px;
  color: var(--text-3);
  transition: color 0.15s ease;
}

.panel-tab:hover {
  color: var(--text-2);
}

.panel-tab.is-active {
  color: var(--text);
}

.panel-tab.is-active::after {
  content: "";
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}

.panel-tab-label {
  font-size: 11.5px;
  color: inherit;
}

.panel-tab-close {
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 4px;
  opacity: 0.55;
  transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.panel-tab:hover .panel-tab-close,
.panel-tab.is-active .panel-tab-close {
  opacity: 1;
}

.panel-tab-close:hover {
  color: #ff8b8b;
  background: rgba(255, 107, 107, 0.14);
}

.panel-add {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: 100%;
}

.panel-add-btn {
  width: 22px;
  height: 22px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 6px;
  transition: color 0.15s ease, background 0.15s ease;
}

.panel-add-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.panel-menu {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 20;
  width: 220px;
  padding: 5px;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}

.panel-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 9px;
  text-align: left;
  border-radius: 6px;
  transition: background 0.15s ease;
}

.panel-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.panel-menu-name {
  font-size: 12px;
  color: var(--text-2);
}

.panel-menu-desc {
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-3);
}

.panel-menu-empty {
  padding: 8px 9px;
  font-size: 10.5px;
  color: var(--text-3);
}

.insp-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 10px 16px;
}

/* ---------------- 滚动条：细窄、低对比 ---------------- */

.stream::-webkit-scrollbar,
.rail-scroll::-webkit-scrollbar,
.insp-scroll::-webkit-scrollbar,
.cap-panel::-webkit-scrollbar,
.cap-result-body::-webkit-scrollbar,
.flow-side::-webkit-scrollbar,
.flow-main::-webkit-scrollbar,
.flow-result-body::-webkit-scrollbar,
.flow-run-result::-webkit-scrollbar,
.flow-step-output::-webkit-scrollbar,
.mode-side::-webkit-scrollbar,
.mode-main::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.stream::-webkit-scrollbar-thumb,
.rail-scroll::-webkit-scrollbar-thumb,
.insp-scroll::-webkit-scrollbar-thumb,
.cap-panel::-webkit-scrollbar-thumb,
.cap-result-body::-webkit-scrollbar-thumb,
.flow-side::-webkit-scrollbar-thumb,
.flow-main::-webkit-scrollbar-thumb,
.flow-result-body::-webkit-scrollbar-thumb,
.flow-run-result::-webkit-scrollbar-thumb,
.flow-step-output::-webkit-scrollbar-thumb,
.mode-side::-webkit-scrollbar-thumb,
.mode-main::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 99px;
}

/* ---------------- 弹层通用提示（偏好 / 模式 / 工作流复用） ---------------- */

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
  transition: color 0.15s ease, background 0.15s ease;
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
  transition: background 0.15s ease, border-color 0.15s ease;
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
  transition: color 0.15s ease;
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
  transition: border-color 0.15s ease;
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
  transition: filter 0.15s ease, opacity 0.15s ease;
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

/* ---------------- 偏好设置 ---------------- */

.prefs-panel {
  width: min(560px, 100%);
  gap: 12px;
}

.prefs-saved {
  padding: 1px 7px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.prefs-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prefs-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-3);
}

.prefs-count {
  font-size: 9.5px;
  color: var(--text-3);
}

.prefs-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prefs-tool {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.prefs-tool-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.prefs-tool-name {
  font-size: 12px;
  color: var(--text);
}

.prefs-tool-desc {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-3);
}

.prefs-switch {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--line-2);
  border-radius: 99px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.prefs-switch.is-on {
  background: var(--accent-soft);
  border-color: rgba(61, 220, 151, 0.5);
}

.prefs-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--text-3);
  border-radius: 99px;
  transition: transform 0.15s ease, background 0.15s ease;
}

.prefs-switch.is-on .prefs-knob {
  background: var(--accent);
  transform: translateX(16px);
}

.prefs-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prefs-field select,
.prefs-field input,
.prefs-field textarea {
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
  transition: border-color 0.15s ease;
}

.prefs-field select {
  cursor: pointer;
}

.prefs-field select option {
  color: var(--text);
  background: var(--bg-2);
}

.prefs-field select:focus,
.prefs-field input:focus,
.prefs-field textarea:focus {
  border-color: rgba(61, 220, 151, 0.45);
}

.prefs-field input::placeholder,
.prefs-field textarea::placeholder {
  color: var(--text-3);
}

.prefs-field textarea {
  min-height: 72px;
  resize: vertical;
}

.prefs-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.prefs-cancel {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 8px;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.prefs-cancel:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--line-2);
}

/* ---------------- 工作流 ---------------- */

.flow-panel {
  width: min(900px, 100%);
  max-height: 84vh;
  gap: 12px;
}

.flow-body {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
}

.flow-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 52vh;
  padding-right: 10px;
  overflow: auto;
  border-right: 1px solid var(--line);
}

.flow-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flow-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.flow-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--line-2);
}

.flow-item.is-active {
  background: var(--accent-soft);
  border-color: rgba(61, 220, 151, 0.45);
}

.flow-item.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.flow-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.flow-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.flow-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 9.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.flow-desc {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-3);
}

.flow-desc-line {
  margin: 0;
}

.flow-tip {
  padding: 8px 6px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
}

.flow-del {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
}

.flow-del:hover:not(:disabled) {
  color: #ff7a7a;
  background: rgba(255, 107, 107, 0.12);
}

.flow-del:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.flow-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 52vh;
  min-height: 0;
  padding-right: 4px;
  overflow: auto;
}

/* ---- 工作流编辑（P1）---- */
.flow-edit { display: flex; flex-direction: column; gap: 10px; padding: 2px 0; }
.flow-edit-head { display: flex; align-items: center; gap: 6px; }
.flow-edit-name {
  flex: 1; padding: 6px 8px; font-size: 12px;
  color: var(--text); background: rgba(255,255,255,0.03);
  border: 1px solid var(--line); border-radius: 5px; outline: none;
}
.flow-edit-name:focus { border-color: var(--line-2); }
.flow-edit-desc {
  width: 100%; padding: 6px 8px; font-size: 10.5px; resize: vertical; min-height: 36px;
  color: var(--text); background: rgba(255,255,255,0.03);
  border: 1px solid var(--line); border-radius: 5px; outline: none;
  font-family: inherit; box-sizing: border-box;
}
.flow-edit-save, .flow-edit-cancel {
  padding: 5px 12px; font-size: 10.5px; border-radius: 5px; cursor: pointer;
  border: 1px solid var(--line);
}
.flow-edit-save {
  color: #0d1117; background: var(--lime); border-color: var(--lime);
}
.flow-edit-save:hover { filter: brightness(1.08); }
.flow-edit-cancel { color: var(--text-2); background: transparent; }
.flow-edit-cancel:hover { background: rgba(255,255,255,0.05); }

.flow-edit-section {
  display: flex; flex-direction: column; gap: 6px;
  padding: 9px 10px; background: rgba(255,255,255,0.02);
  border: 1px solid var(--line); border-radius: 7px;
}
.flow-edit-section-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10.5px; color: var(--text-3);
}
.flow-edit-add, .flow-edit-add-select {
  padding: 2px 8px; font-size: 10px; color: var(--text-2);
  background: rgba(255,255,255,0.05); border: 1px solid var(--line);
  border-radius: 4px; cursor: pointer;
}
.flow-edit-add:hover, .flow-edit-add-select:hover { color: var(--text); }
.flow-edit-add-select { padding: 2px 6px; font-size: 10px; }

.flow-edit-hint { font-size: 10px; color: var(--text-3); padding: 2px 0; }

.flow-edit-var {
  display: flex; gap: 5px; align-items: center;
}
.flow-edit-var input[type="text"] {
  padding: 4px 6px; font-size: 10.5px; color: var(--text);
  background: rgba(255,255,255,0.03); border: 1px solid var(--line);
  border-radius: 4px; outline: none;
}
.flow-edit-var input:first-child { flex: 0 0 100px; }
.flow-edit-var input:nth-child(2) { flex: 0 0 80px; }
.flow-edit-var input:nth-child(3) { flex: 1; }
.flow-edit-req { font-size: 10px; color: var(--text-3); white-space: nowrap; display: flex; align-items: center; gap: 2px; }

.flow-edit-step {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; background: rgba(255,255,255,0.025);
  border: 1px solid var(--line); border-radius: 6px;
}
.flow-edit-step-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px;
}
.flow-edit-step-num {
  width: 18px; height: 18px; line-height: 18px; text-align: center;
  font-size: 10px; font-weight: 600;
  color: var(--text-2); background: rgba(255,255,255,0.06); border-radius: 3px;
}
.flow-edit-step-type { font-weight: 600; color: var(--text); flex: 1; }
.flow-edit-move {
  padding: 1px 5px; font-size: 10px; color: var(--text-3);
  background: transparent; border: 1px solid var(--line); border-radius: 3px;
  cursor: pointer;
}
.flow-edit-move:hover:not(:disabled) { color: var(--text); border-color: var(--line-2); }
.flow-edit-move:disabled { opacity: 0.35; cursor: default; }
.flow-edit-del {
  width: 18px; height: 18px; line-height: 16px; text-align: center;
  font-size: 12px; color: var(--text-3); background: transparent;
  border: 1px solid transparent; border-radius: 3px; cursor: pointer;
}
.flow-edit-del:hover { color: #c06a6a; border-color: rgba(192,106,106,0.4); }

.flow-edit-trial {
  padding: 2px 7px; font-size: 10px; color: var(--lime);
  background: rgba(110, 180, 100, 0.1);
  border: 1px solid rgba(110, 180, 100, 0.35); border-radius: 3px;
  cursor: pointer; white-space: nowrap;
}
.flow-edit-trial:hover:not(:disabled) { background: rgba(110, 180, 100, 0.2); }
.flow-edit-trial:disabled { opacity: 0.5; cursor: default; }

.flow-edit-trial-result {
  margin-top: 6px; padding: 6px 8px; border-radius: 4px;
  font-size: 10.5px; overflow: auto; max-height: 180px;
}
.flow-edit-trial-result.is-ok {
  background: rgba(110, 180, 100, 0.08);
  border: 1px solid rgba(110, 180, 100, 0.25);
  color: var(--text-2);
}
.flow-edit-trial-result.is-err {
  background: rgba(192, 106, 106, 0.08);
  border: 1px solid rgba(192, 106, 106, 0.25);
  color: #d48b8b;
}
.flow-edit-trial-result pre {
  margin: 0; white-space: pre-wrap; word-break: break-all;
  font-family: inherit;
}

.flow-edit-step-fields {
  display: flex; flex-direction: column; gap: 4px;
  padding-left: 24px;
}
.flow-edit-field { display: flex; flex-direction: column; gap: 2px; }
.flow-edit-field > label { font-size: 10px; color: var(--text-3); }
.flow-edit-field input, .flow-edit-field textarea {
  padding: 4px 6px; font-size: 10.5px; color: var(--text);
  background: rgba(255,255,255,0.03); border: 1px solid var(--line);
  border-radius: 4px; outline: none; font-family: inherit; resize: vertical;
}

.flow-edit-actions { display: flex; gap: 6px; margin-left: auto; }
.flow-edit-btn {
  padding: 2px 9px; font-size: 10px; color: var(--text-2);
  background: rgba(255,255,255,0.04); border: 1px solid var(--line);
  border-radius: 4px; cursor: pointer;
}
.flow-edit-btn:hover:not(:disabled) { color: var(--text); border-color: var(--line-2); background: rgba(255,255,255,0.07); }
.flow-edit-btn:disabled { opacity: 0.35; cursor: default; }

.flow-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flow-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.flow-step-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-3);
}

.flow-vars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.flow-required {
  font-style: normal;
  color: #ff9a9a;
}

.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flow-step {
  overflow: hidden;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: border-color 0.15s ease, opacity 0.15s ease;
}

.flow-step.is-running {
  border-color: rgba(61, 220, 151, 0.4);
}

.flow-step.is-failed {
  border-color: rgba(255, 107, 107, 0.28);
}

.flow-step.is-skipped {
  opacity: 0.65;
}

.flow-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  text-align: left;
}

.flow-step-index {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 18px;
  height: 18px;
  font-size: 10px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 99px;
}

.flow-step.is-done .flow-step-index,
.flow-step.is-running .flow-step-index {
  color: var(--accent);
  background: var(--accent-soft);
}

.flow-step.is-failed .flow-step-index {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.14);
}

.flow-step-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.flow-step-state {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}

.flow-step.is-done .flow-step-state,
.flow-step.is-running .flow-step-state {
  color: var(--accent);
}

.flow-step.is-failed .flow-step-state {
  color: #ff9a9a;
}

.flow-step-caret {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
  transition: transform 0.15s ease;
}

.flow-step-caret.is-open {
  transform: rotate(180deg);
}

.flow-step-output {
  max-height: 160px;
  margin: 0;
  padding: 0 10px 9px 36px;
  overflow: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-word;
}

.flow-stop {
  padding: 6px 14px;
  font-size: 12px;
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.28);
  border-radius: 8px;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.flow-stop:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.2);
}

.flow-stop:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.flow-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.28);
  border-radius: var(--radius-sm);
}

.flow-result.is-error {
  background: rgba(255, 107, 107, 0.07);
  border-color: rgba(255, 107, 107, 0.22);
}

.flow-result .cap-result-state {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
}

.flow-result.is-error .cap-result-state {
  color: #ff9a9a;
}

.flow-duration {
  flex: 1;
  font-size: 9.5px;
  color: var(--text-3);
}

.flow-result-body {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.flow-runs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.flow-runs-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-3);
}

.flow-runs-head .cap-hint {
  margin-left: auto;
}

.flow-run {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  text-align: left;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.flow-run:hover,
.flow-run.is-active {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--line-2);
}

.flow-run-time {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}

.flow-run-state {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 9.5px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 99px;
}

.flow-run-state.is-done {
  color: var(--accent);
  background: var(--accent-soft);
}

.flow-run-state.is-failed {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.14);
}

.flow-run-state.is-aborted {
  color: #ffc98a;
  background: rgba(255, 169, 77, 0.14);
}

.flow-run-name {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-2);
}

.flow-run-brief {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.flow-run-detail {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.flow-run-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flow-run-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flow-run-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  font-size: 11px;
}

.flow-run-steps li.is-done .flow-step-index {
  color: var(--accent);
  background: var(--accent-soft);
}

.flow-run-steps li.is-failed .flow-step-index {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.14);
}

.flow-run-steps li.is-done .flow-step-state {
  color: var(--accent);
}

.flow-run-steps li.is-failed .flow-step-state {
  color: #ff9a9a;
}

.flow-run-result {
  max-height: 140px;
  margin: 0;
  overflow: auto;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------------- 模式管理 ---------------- */

.mode-panel {
  width: min(900px, 100%);
  max-height: 84vh;
  gap: 12px;
}

.mode-body {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
}

.mode-side {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 62vh;
  padding-right: 10px;
  overflow: auto;
  border-right: 1px solid var(--line);
}

.mode-main {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 62vh;
  min-height: 0;
  padding-right: 4px;
  overflow: auto;
}

.mode-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-readonly {
  overflow: hidden;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.flow-badge.is-custom {
  color: #8fb4ff;
  background: rgba(96, 145, 255, 0.14);
}

.prefs-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-del {
  padding: 6px 14px;
  font-size: 12px;
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.28);
  border-radius: 8px;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.mode-del:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.2);
}

.mode-del:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------------- 窄窗口 ---------------- */

@media (max-width: 1180px) {
  .inspector,
  .resize-handle.is-inspector {
    display: none;
  }
}

@media (max-width: 900px) {
  .rail,
  .resize-handle.is-session {
    display: none;
  }

  .flow-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode-side {
    max-height: 26vh;
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .mode-main {
    max-height: none;
  }

  .flow-side {
    max-height: 26vh;
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

/* ---- 命令面板 Ctrl+Shift+P ---- */
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);
  animation: palette-in 0.15s ease-out;
}
@keyframes palette-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.palette {
  width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  animation: palette-pop 0.18s ease-out;
}
@keyframes palette-pop {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.palette-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.palette-icon {
  width: 15px;
  height: 15px;
  color: var(--text-3);
  flex: 0 0 auto;
}
.palette-input {
  flex: 1;
  padding: 5px 0;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: none;
  outline: none;
}
.palette-input::placeholder {
  color: var(--text-3);
}
.palette-kbd {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--line);
  border-radius: 3px;
}
.palette-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.palette-empty {
  padding: 20px;
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}
.palette-item {
  display: grid;
  grid-template-columns: 60px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 7px 10px;
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
}
.palette-item:hover,
.palette-item.is-active {
  background: rgba(255, 255, 255, 0.08);
}
.palette-group {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-3);
  letter-spacing: 0.03em;
}
.palette-label {
  font-size: 12px;
  color: var(--text);
}
.palette-hint {
  font-size: 10px;
  color: var(--text-3);
}
</style>
