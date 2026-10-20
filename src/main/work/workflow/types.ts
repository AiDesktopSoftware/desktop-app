// 工作流编排（L1：模板 + 参数 + 运行 + 进度 + 结果）的共享数据结构
// 主进程、预加载与渲染层都通过 type-only import 复用，避免字段漂移

/** 运行前由用户填写的变量 */
export interface WorkflowVariable {
  key: string
  label: string
  placeholder?: string
  required?: boolean
}

/** 工作流中的一个顺序节点 */
export interface WorkflowStep {
  id: string
  type: string
  label: string
  args: Record<string, string>
  enabled: boolean
  onEmpty?: 'skip' | 'fail'
}

/** 工作流定义：内置模板与用户自定义共用同一结构 */
export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  version: 1
  builtin: boolean
  variables: WorkflowVariable[]
  steps: WorkflowStep[]
  createdAt: number
  updatedAt: number
}

export type RunStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 一次运行中某个节点的状态 */
export interface RunStep {
  id: string
  label: string
  status: RunStepStatus
  output?: string
  error?: string
  startedAt?: number
  endedAt?: number
}

/** 一次运行的完整记录 */
export interface WorkflowRun {
  id: string
  workflowId: string
  name: string
  status: 'running' | 'done' | 'failed' | 'aborted'
  variables: Record<string, string>
  steps: RunStep[]
  result?: string
  createdAt: number
  endedAt?: number
}
