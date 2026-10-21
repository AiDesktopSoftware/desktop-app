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
  /** Agent 最大轮数，2-20 */
  maxRounds: number
  /** 单次请求最多工具调用次数，1-30 */
  maxTools: number
  /** 携带最近多少条历史消息，0-30；0 表示不带历史 */
  historyMessages: number
  /** 每条历史消息截断字符数，500-20000 */
  contextChars: number
  /** 输出格式约束 */
  outputStyle: 'free' | 'bullets' | 'table' | 'report'
  /** 引用严格度 */
  citationStrict: 'required' | 'preferred' | 'off'
  createdAt: number
  updatedAt: number
}
