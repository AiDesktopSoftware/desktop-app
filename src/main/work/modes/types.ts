// 工作模式的模式数据：模式只决定 Agent 怎么工作，不限定用户问什么
// 主进程、预加载与渲染层共用这一份结构定义

export interface WorkMode {
  id: string
  name: string
  description: string
  builtin: boolean
  /** 该模式的角色与工作要求，追加在基础规则之后 */
  systemPrompt: string
  /** 允许 Agent 调用的能力 id；空数组表示不允许任何工具 */
  tools: string[]
  /** 0-1 */
  temperature: number
  /** 该模式默认的检索来源 */
  ragProvider: 'local' | 'cloud' | 'both'
  /** 1-10 */
  topK: number
  createdAt: number
  updatedAt: number
}
