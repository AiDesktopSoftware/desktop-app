// 工作模式（负责人：赵）的共享数据类型
// 主进程、预加载和渲染层都通过 type-only import 复用，避免类型漂移

import type { RagQuery, RagResult } from '../../../../main/work/rag/types'

export type {
  RagChunk,
  RagProviderId,
  RagQuery,
  RagResult,
  RagSource
} from '../../../../main/work/rag/types'

export type WorkRole = 'user' | 'assistant'
export type WorkToolStatus = 'running' | 'done' | 'failed'

/** 与主进程能力注册表一致的 6 个能力 id */
export type WorkCapabilityId =
  | 'web_search'
  | 'fetch_url'
  | 'list_files'
  | 'read_file'
  | 'write_file'
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

/** 证据链中的一条来源 */
export interface WorkEvidenceItem {
  title: string
  url: string
}

export interface WorkMessage {
  id: string
  role: WorkRole
  content: string
  createdAt: number
  /** 助手消息的执行轨迹（工具调用） */
  tools?: WorkToolCall[]
  /** 该轮回答自动汇总的检索来源，按 url 去重 */
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

/** 主进程推送的证据链增量（同一请求内已按 url 去重） */
export interface WorkEvidenceEvent {
  requestId: string
  items: WorkEvidenceItem[]
}

export interface WorkSettingsStatus {
  configured: boolean
  model: string
  /** 脱敏后的 Key，如 ****bae5 */
  keyHint?: string
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
}
