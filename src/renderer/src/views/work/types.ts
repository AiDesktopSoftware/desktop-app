// 工作模式（负责人：赵）的共享数据类型
// 主进程、预加载和渲染层都通过 type-only import 复用，避免类型漂移

import type { RagQuery, RagResult } from '../../../../main/work/rag/types'
import type { KbDocument } from '../../../../main/work/kb/types'
import type { WorkPreferences } from '../../../../main/work/config'
import type { WorkflowDefinition, WorkflowRun } from '../../../../main/work/workflow/types'

export type {
  RagChunk,
  RagProviderId,
  RagQuery,
  RagResult,
  RagSource
} from '../../../../main/work/rag/types'

export type { KbChunk, KbDocument, KbIndex } from '../../../../main/work/kb/types'

export type { WorkPreferences }

export type {
  RunStep,
  RunStepStatus,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowVariable
} from '../../../../main/work/workflow/types'

export type WorkRole = 'user' | 'assistant'
export type WorkToolStatus = 'running' | 'done' | 'failed'

/** 与主进程能力注册表一致的 7 个能力 id */
export type WorkCapabilityId =
  | 'web_search'
  | 'fetch_url'
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'kb_search'
  | 'run_command'

export type WorkCapabilityPermission = 'read' | 'write' | 'exec'

/** 能力面板的表单字段 */
export interface WorkCapabilityField {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
}

/** 主进程下发的能力元数据（不含函数与 JSON Schema） */
export interface WorkCapability {
  id: WorkCapabilityId
  label: string
  description: string
  fields: WorkCapabilityField[]
  permission: WorkCapabilityPermission
  agentEnabled: boolean
}

export interface WorkCapabilityRunResult {
  ok: boolean
  content: string
}

/** Agent 执行轨迹中的一次工具调用 */
export interface WorkToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: WorkToolStatus
  output?: string
}

/** 证据链中的一条来源：联网来源带 url，本地资料带 path，至少有一个 */
export interface WorkEvidenceItem {
  title: string
  url?: string
  path?: string
}

export interface WorkMessage {
  id: string
  role: WorkRole
  content: string
  createdAt: number
  /** 助手消息的执行轨迹（工具调用） */
  tools?: WorkToolCall[]
  /** 该轮回答自动汇总的检索来源，按 url 或 path 去重 */
  evidence?: WorkEvidenceItem[]
  /** 仅运行时使用，持久化时剔除 */
  streaming?: boolean
  error?: string
}

export interface WorkSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: WorkMessage[]
}

/** 发送给模型的对话消息 */
export interface WorkChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface WorkChatStartPayload {
  requestId: string
  messages: WorkChatMessage[]
  mode: 'chat' | 'plan' | 'agent'
  model?: string
  temperature?: number
}

/** 主进程推送的工具执行事件 */
export interface WorkToolEvent {
  requestId: string
  id: string
  name: string
  args: Record<string, unknown>
  status: WorkToolStatus
  output?: string
}

/** 主进程推送的证据链增量（同一请求内已按 url 或 path 去重） */
export interface WorkEvidenceEvent {
  requestId: string
  items: WorkEvidenceItem[]
}

/** 偏好设置读写结果，失败时只返回中文原因 */
export interface WorkPreferencesResult {
  ok: boolean
  preferences?: WorkPreferences
  message?: string
}

export interface WorkSettingsStatus {
  configured: boolean
  model: string
  /** 脱敏后的 Key，如 ****bae5 */
  keyHint?: string
}

/** 本地知识库列表：文档元数据 + 片段总数 */
export interface WorkKbListResult {
  ok: boolean
  documents: KbDocument[]
  chunkCount: number
  message?: string
}

/** 本地知识库导入结果：取消时 canceled 为 true，其余字段为空 */
export interface WorkKbImportResult {
  ok: boolean
  canceled?: boolean
  added: KbDocument[]
  skipped: { path: string; reason: string }[]
  message?: string
}

export interface WorkKbRemoveResult {
  ok: boolean
  message?: string
}

// ---------------- 工作流编排 ----------------

/** 工作流列表结果 */
export interface WorkFlowListResult {
  ok: boolean
  workflows: WorkflowDefinition[]
  message?: string
}

export interface WorkFlowSaveResult {
  ok: boolean
  workflow?: WorkflowDefinition
  message?: string
}

export interface WorkFlowRemoveResult {
  ok: boolean
  message?: string
}

export interface WorkFlowRunResult {
  ok: boolean
  runId?: string
  message?: string
}

export interface WorkFlowRunsResult {
  ok: boolean
  runs: WorkflowRun[]
  message?: string
}

/** 主进程推送的单步状态事件 */
export interface WorkFlowStepEvent {
  runId: string
  stepId: string
  status: WorkflowRun['steps'][number]['status']
  output?: string
  message?: string
}

/** 主进程推送的运行结束事件 */
export interface WorkFlowDoneEvent {
  runId: string
  ok: boolean
  result?: string
  message?: string
}

/** 预加载脚本暴露到 window.workApi 的接口 */
export interface WorkApi {
  chatStart(payload: WorkChatStartPayload): Promise<{ ok: boolean; message?: string }>
  chatAbort(requestId: string): Promise<void>
  onChunk(cb: (payload: { requestId: string; delta: string }) => void): () => void
  onDone(cb: (payload: { requestId: string }) => void): () => void
  onError(cb: (payload: { requestId: string; message: string }) => void): () => void
  onTool(cb: (payload: WorkToolEvent) => void): () => void
  onEvidence(cb: (payload: WorkEvidenceEvent) => void): () => void
  settingsStatus(): Promise<WorkSettingsStatus>
  loadSessions(): Promise<WorkSession[]>
  saveSessions(sessions: WorkSession[]): Promise<void>
  listCapabilities(): Promise<WorkCapability[]>
  runCapability(
    id: WorkCapabilityId,
    args: Record<string, unknown>
  ): Promise<WorkCapabilityRunResult>
  searchRag(query: RagQuery): Promise<RagResult>
  kbList(): Promise<WorkKbListResult>
  kbImport(paths?: string[]): Promise<WorkKbImportResult>
  kbRemove(docId: string): Promise<WorkKbRemoveResult>
  prefsGet(): Promise<WorkPreferencesResult>
  prefsSet(patch: Partial<WorkPreferences>): Promise<WorkPreferencesResult>
  flowList(): Promise<WorkFlowListResult>
  flowSave(workflow: WorkflowDefinition): Promise<WorkFlowSaveResult>
  flowRemove(id: string): Promise<WorkFlowRemoveResult>
  flowRun(payload: {
    workflowId: string
    variables: Record<string, string>
    runId: string
  }): Promise<WorkFlowRunResult>
  flowAbort(runId: string): Promise<void>
  flowRuns(): Promise<WorkFlowRunsResult>
  onFlowStep(cb: (payload: WorkFlowStepEvent) => void): () => void
  onFlowDone(cb: (payload: WorkFlowDoneEvent) => void): () => void
}
