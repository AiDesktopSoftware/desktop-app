// 工作流节点注册表：节点元数据 + 执行函数
// 检索与抓取直接复用 executeTool，不重复实现抓取逻辑；模型调用复用 chatOnce
import { basename } from 'node:path'
import { chatOnce } from '../llm'
import { executeTool } from '../tools'
import { loadIndex } from '../kb/store'

/** 节点产出的来源：联网来源带 url，本地资料带 path */
export interface NodeSource {
  title: string
  url?: string
  path?: string
}

/** 节点执行上下文：运行时变量 + 上一节点输出 + 已完成节点输出 */
export interface NodeContext {
  variables: Record<string, string>
  prev: string
  steps: Record<string, string>
}

/** 节点执行结果：异常一律转成 ok:false + 中文原因 */
export interface NodeResult {
  ok: boolean
  text: string
  sources?: NodeSource[]
  message?: string
}

/** 参数表单字段，供界面展示与保存时校验 */
export interface NodeField {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
}

export interface NodeDefinition {
  type: string
  label: string
  description: string
  fields: NodeField[]
  /** 必填参数名，用于空步骤判定与保存校验 */
  required: string[]
  run(
    args: Record<string, string>,
    context: NodeContext,
    signal: AbortSignal
  ): Promise<NodeResult>
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

/** 替换参数文本里的 {{变量名}} / {{prev}} / {{step.<节点id>}}，未提供的值替换为空串 */
export function renderText(text: string, context: NodeContext): string {
  return text.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (key === 'prev') return context.prev
    if (key.startsWith('step.')) return context.steps[key.slice(5)] ?? ''
    return context.variables[key] ?? ''
  })
}

/** 一次性替换某一步骤的全部参数 */
export function renderArgs(
  args: Record<string, string>,
  context: NodeContext
): Record<string, string> {
  const rendered: Record<string, string> = {}
  for (const [key, value] of Object.entries(args)) {
    rendered[key] = renderText(value ?? '', context)
  }
  return rendered
}

function failure(message: string): NodeResult {
  return { ok: false, text: '', message }
}

function clampNumber(value: string | undefined, min: number, max: number, fallback: number): number {
  const numeric = Number((value ?? '').trim())
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(Math.max(Math.round(numeric), min), max)
}

/** 温度需要保留小数，不能取整 */
function clampDecimal(value: string | undefined, min: number, max: number, fallback: number): number {
  const numeric = Number((value ?? '').trim())
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(Math.max(numeric, min), max)
}

function abortMessage(signal: AbortSignal, fallback: string): string {
  return signal.aborted ? '已停止运行' : fallback
}

/** 从 kb_search 的固定返回格式解析来源，并用索引补上完整路径 */
async function kbSources(content: string): Promise<NodeSource[]> {
  const pattern = /^\[\d+\]\s*(.+?)\s*·\s*第(\d+)段(?:（相关度\s*[\d.]+）)?\s*$/gm
  const found: { title: string; file: string }[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const file = match[1].trim()
    if (file) found.push({ title: `${file} · 第${match[2]}段`, file })
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
    // 索引读取失败时只保留标题，不影响节点输出
  }

  return found.map(({ title, file }) => {
    const path = pathMap.get(file)
    return path ? { title, path } : { title }
  })
}

/** 从联网搜索的编号列表里解析标题与链接 */
function webSources(content: string): NodeSource[] {
  const items: NodeSource[] = []
  const pattern = /(?:^|\n)\s*\d+\.\s*([^\n]+)\n\s*URL[:：]\s*(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const url = match[2].trim()
    if (!/^https?:\/\//i.test(url)) continue
    items.push({ title: match[1].trim() || url, url })
  }
  return items
}

async function runKbSearch(
  args: Record<string, string>,
  _context: NodeContext,
  signal: AbortSignal
): Promise<NodeResult> {
  const query = (args.query ?? '').trim()
  if (!query) return failure('检索问题不能为空')
  if (signal.aborted) return failure('已停止运行')

  const topK = clampNumber(args.topK, 1, 10, 5)
  try {
    const result = await executeTool('kb_search', { query, topK }, signal)
    if (!result.ok) return failure(result.content || '本地知识库检索失败')
    return { ok: true, text: result.content, sources: await kbSources(result.content) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(abortMessage(signal, `本地知识库检索失败：${detail.slice(0, 120)}`))
  }
}

async function runWebSearch(
  args: Record<string, string>,
  _context: NodeContext,
  signal: AbortSignal
): Promise<NodeResult> {
  const query = (args.query ?? '').trim()
  if (!query) return failure('搜索关键词不能为空')
  if (signal.aborted) return failure('已停止运行')

  const limit = clampNumber(args.limit, 1, 8, 5)
  try {
    const result = await executeTool('web_search', { query, limit }, signal)
    if (!result.ok) return failure(result.content || '联网搜索失败')
    return { ok: true, text: result.content, sources: webSources(result.content) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(abortMessage(signal, `联网搜索失败：${detail.slice(0, 120)}`))
  }
}

async function runFetchUrl(
  args: Record<string, string>,
  _context: NodeContext,
  signal: AbortSignal
): Promise<NodeResult> {
  const url = (args.url ?? '').trim()
  if (!url) return failure('网页地址不能为空')
  if (signal.aborted) return failure('已停止运行')

  try {
    const result = await executeTool('fetch_url', { url }, signal)
    if (!result.ok) return failure(result.content || '读取网页失败')
    const matched = result.content.match(/标题[:：]\s*([^\n]*)\n\s*URL[:：]\s*(\S+)/)
    const sources: NodeSource[] = matched
      ? [{ title: matched[1].trim() || url, url: matched[2].trim() }]
      : [{ title: url, url }]
    return { ok: true, text: result.content, sources }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(abortMessage(signal, `读取网页失败：${detail.slice(0, 120)}`))
  }
}

const NODE_SYSTEM =
  '你是一名严谨的中文研究助手。只依据给定材料作答，不编造事实、数据、链接或来源；材料不足时明确说明。'

const REPORT_SYSTEM =
  '你是一名严谨的中文研究报告撰写者。只依据给定材料写作，禁止编造来源、链接、数据或引用；材料不足时在正文中明确说明。'

async function runLlm(
  args: Record<string, string>,
  _context: NodeContext,
  signal: AbortSignal
): Promise<NodeResult> {
  const prompt = (args.prompt ?? '').trim()
  if (!prompt) return failure('提示词不能为空')
  if (signal.aborted) return failure('已停止运行')

  const temperature = clampDecimal(args.temperature, 0, 1, 0.4)
  try {
    const text = await chatOnce({
      messages: [
        { role: 'system', content: NODE_SYSTEM },
        { role: 'user', content: prompt }
      ],
      temperature,
      signal
    })
    const trimmed = text.trim()
    if (!trimmed) return failure('模型没有返回内容')
    return { ok: true, text: trimmed }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(abortMessage(signal, detail || '模型调用失败'))
  }
}

async function runReport(
  args: Record<string, string>,
  context: NodeContext,
  signal: AbortSignal
): Promise<NodeResult> {
  const title = (args.title ?? '').trim()
  if (!title) return failure('报告标题不能为空')
  if (signal.aborted) return failure('已停止运行')

  const instruction = (args.instruction ?? '').trim()
  const material = context.prev.trim() || '（没有可用的上游材料）'
  const prompt = [
    '请基于下面的材料撰写一份中文研究报告。',
    `报告标题：${title}`,
    instruction ? `额外要求：${instruction}` : '',
    '输出结构必须包含三部分：',
    '一、摘要：150 字以内概括核心结论；',
    '二、分节正文：按 2 到 4 个小节展开，每节给出小标题；',
    '三、参考来源：只列出材料中明确出现的本地文件名或网页链接；材料未提供时写“本次材料未提供可核验来源”。',
    '严禁编造来源、链接、数据或引用。',
    '',
    '材料：',
    material
  ]
    .filter(Boolean)
    .join('\n')

  const temperature = clampDecimal(args.temperature, 0, 1, 0.4)
  try {
    const text = await chatOnce({
      messages: [
        { role: 'system', content: REPORT_SYSTEM },
        { role: 'user', content: prompt }
      ],
      temperature,
      signal
    })
    const trimmed = text.trim()
    if (!trimmed) return failure('模型没有返回报告内容')
    return { ok: true, text: trimmed }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(abortMessage(signal, detail || '报告生成失败'))
  }
}

export const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'kb_search',
    label: '本地知识库检索',
    description: '在已导入的本地资料中检索片段，输出带文件名与段号的命中文本。',
    fields: [
      { key: 'query', label: '检索问题', placeholder: '例如：{{主题}}', multiline: true, required: true },
      { key: 'topK', label: '返回片段数', placeholder: '默认 5，最多 10' }
    ],
    required: ['query'],
    run: runKbSearch
  },
  {
    type: 'web_search',
    label: '联网搜索',
    description: '按关键词联网搜索，输出标题、链接与摘要。',
    fields: [
      { key: 'query', label: '搜索关键词', placeholder: '例如：{{主题}}', required: true },
      { key: 'limit', label: '返回条数', placeholder: '默认 5，最多 8' }
    ],
    required: ['query'],
    run: runWebSearch
  },
  {
    type: 'fetch_url',
    label: '读取网页',
    description: '抓取指定网页正文，输出标题、链接与正文节选。',
    fields: [{ key: 'url', label: '网页地址', placeholder: 'https://…', required: true }],
    required: ['url'],
    run: runFetchUrl
  },
  {
    type: 'llm',
    label: '模型分析',
    description: '把材料交给模型分析，输出中文结论；材料由 {{prev}} 或 {{step.节点id}} 引用。',
    fields: [
      { key: 'prompt', label: '提示词', placeholder: '结合 {{prev}} 回答 {{主题}}', multiline: true, required: true },
      { key: 'temperature', label: '温度', placeholder: '默认 0.4，范围 0–1' }
    ],
    required: ['prompt'],
    run: runLlm
  },
  {
    type: 'report',
    label: '生成报告',
    description: '基于上游材料生成「摘要 / 分节正文 / 参考来源」结构的中文报告。',
    fields: [
      { key: 'title', label: '报告标题', placeholder: '例如：{{主题}} 研究报告', required: true },
      { key: 'instruction', label: '额外要求', placeholder: '可选，例如：面向课程设计答辩', multiline: true }
    ],
    required: ['title'],
    run: runReport
  }
]

export function getNode(type: string): NodeDefinition | undefined {
  return NODE_DEFINITIONS.find((node) => node.type === type)
}

export function isNodeType(type: string): boolean {
  return NODE_DEFINITIONS.some((node) => node.type === type)
}
