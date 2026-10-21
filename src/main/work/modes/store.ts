import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES } from '../capabilities'
import type { WorkMode } from './types'

// 模式库：4 个内置模式固定写死，用户自定义模式存到 userData/work-modes.json
const MODES_FILE = 'work-modes.json'
const CHAT_MODE_ID = 'mode-chat'
const MIN_TOP_K = 1
const MAX_TOP_K = 10
const PROVIDERS: WorkMode['ragProvider'][] = ['local', 'cloud', 'both']

/** 固定时间戳：内置模式不参与排序，也不允许被修改 */
const BUILTIN_TIME = 0

const BUILTIN_MODES: WorkMode[] = [
  {
    id: CHAT_MODE_ID,
    name: '普通问答',
    description: '直接回答，不调用外部工具，适合通用问题',
    builtin: true,
    systemPrompt: [
      '你是可靠的中文助手，直接回答问题，不调用任何外部工具。',
      '1. 基于已有知识作答，简明准确，必要时给出步骤或示例。',
      '2. 不确定、需要实时信息或本地资料时，明确说明并建议切换到「深度研究」或「RAG 检索」模式。',
      '3. 不编造事实、数据、来源或链接。'
    ].join('\n'),
    tools: [],
    temperature: 0.6,
    ragProvider: 'local',
    topK: 5,
    createdAt: BUILTIN_TIME,
    updatedAt: BUILTIN_TIME
  },
  {
    id: 'mode-research',
    name: '深度研究',
    description: '检索本地资料并联网交叉验证，标注来源',
    builtin: true,
    systemPrompt: [
      '你是深度研究助手：先查本地资料，再联网交叉验证，必要时读取原文。',
      '1. 优先用 kb_search 检索本地知识库，再用 web_search 补充外部信息。',
      '2. 只挑最有价值的 2 到 3 条链接用 fetch_url 读原文，不要重复抓取同一链接。',
      '3. 结论标注来源：本地写「来源：文件名 · 第N段」，联网写 URL；不许编造来源、链接或数据。',
      '4. 信息冲突或证据不足要指出，不要臆测。',
      '5. 工具调用要节制，拿到足够信息就给出结论；最终只呈现结论与来源。'
    ].join('\n'),
    tools: ['kb_search', 'web_search', 'fetch_url'],
    temperature: 0.3,
    ragProvider: 'both',
    topK: 8,
    createdAt: BUILTIN_TIME,
    updatedAt: BUILTIN_TIME
  },
  {
    id: 'mode-code',
    name: '编程辅助',
    description: '读写项目文件、执行命令，先读后改',
    builtin: true,
    systemPrompt: [
      '你是编程助手：可以查看目录、读取文件、写入文件并执行命令。',
      '1. 修改任何文件前必须先 read_file 读取现状，理解上下文后再动手。',
      '2. 改动保持最小，沿用项目现有风格与依赖，不擅自新增依赖。',
      '3. 报告时说明改了哪些文件、改动范围与原因。',
      '4. 执行命令后说明结果，失败要给出具体原因与下一步建议。',
      '5. 不执行删除项目、格式化磁盘这类危险或不可逆操作。'
    ].join('\n'),
    tools: ['list_files', 'read_file', 'write_file', 'run_command'],
    temperature: 0.2,
    ragProvider: 'local',
    topK: 5,
    createdAt: BUILTIN_TIME,
    updatedAt: BUILTIN_TIME
  },
  {
    id: 'mode-rag',
    name: 'RAG 检索',
    description: '只依据本地知识库作答，资料不足要明说',
    builtin: true,
    systemPrompt: [
      '你是知识库问答助手：只依据本地知识库的检索结果作答。',
      '1. 回答前先用 kb_search 检索相关片段。',
      '2. 只使用检索到的内容，引用时写「来源：文件名 · 第N段」。',
      '3. 知识库没有命中或资料不足时，直接说明「知识库中没有找到相关内容」，不得编造，也不得用库外知识补充。',
      '4. 不调用其他工具，不联网。'
    ].join('\n'),
    tools: ['kb_search'],
    temperature: 0.2,
    ragProvider: 'local',
    topK: 5,
    createdAt: BUILTIN_TIME,
    updatedAt: BUILTIN_TIME
  }
]

function modesFilePath(): string {
  return join(app.getPath('userData'), MODES_FILE)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeTools(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const known = new Set<string>(CAPABILITIES.map((capability) => capability.id))
  const result: string[] = []
  for (const item of input) {
    if (typeof item !== 'string' || !known.has(item) || result.includes(item)) continue
    result.push(item)
  }
  return result
}

function normalizeProvider(input: unknown): WorkMode['ragProvider'] {
  return typeof input === 'string' && PROVIDERS.includes(input as WorkMode['ragProvider'])
    ? (input as WorkMode['ragProvider'])
    : 'local'
}

function normalizeTemperature(input: unknown): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? input : 0.4
  return clampNumber(value, 0, 1)
}

function normalizeTopK(input: unknown): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? input : 5
  return clampNumber(Math.round(value), MIN_TOP_K, MAX_TOP_K)
}

/** 读取自定义模式；文件缺失、损坏或条目非法时丢弃坏条目，不向上抛错 */
async function readCustomModes(): Promise<WorkMode[]> {
  try {
    const raw = await fs.readFile(modesFilePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const list = (parsed as Record<string, unknown>).modes
    if (!Array.isArray(list)) return []

    const builtinIds = new Set(BUILTIN_MODES.map((mode) => mode.id))
    const seen = new Set<string>()
    const result: WorkMode[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const raw = item as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      // 自定义模式不得占用内置 id，也不允许重复 id
      if (!id || !name || builtinIds.has(id) || seen.has(id)) continue
      seen.add(id)
      result.push({
        id,
        name: name.slice(0, 40),
        description: clampText(raw.description, 200),
        builtin: false,
        systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
        tools: normalizeTools(raw.tools),
        temperature: normalizeTemperature(raw.temperature),
        ragProvider: normalizeProvider(raw.ragProvider),
        topK: normalizeTopK(raw.topK),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
      })
    }
    return result
  } catch {
    return []
  }
}

/** 原子写：先写临时文件再替换，避免中途失败把模式文件写坏 */
async function writeCustomModes(modes: WorkMode[]): Promise<void> {
  const target = modesFilePath()
  const temp = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, JSON.stringify({ version: 1, modes }, null, 2), 'utf-8')
  await fs.rename(temp, target)
}

// 进程内串行队列：保存、复制、删除都是「读文件—改文件—写文件」，必须互斥
let queue: Promise<unknown> = Promise.resolve()

function withModeLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

/** 模式列表：内置在前，自定义按更新时间倒序 */
export async function listModes(): Promise<WorkMode[]> {
  const custom = await readCustomModes()
  const sorted = [...custom].sort((a, b) => b.updatedAt - a.updatedAt)
  return [...BUILTIN_MODES, ...sorted]
}

/** 按 id 取模式，找不到时回退到普通问答 */
export async function getMode(id?: string): Promise<WorkMode> {
  if (!id) return BUILTIN_MODES[0]
  const custom = await readCustomModes()
  return (
    [...BUILTIN_MODES, ...custom].find((mode) => mode.id === id) ?? BUILTIN_MODES[0]
  )
}

/**
 * 保存自定义模式：id 为空时新建，否则更新同 id 的自定义模式。
 * 内置模式固定只读，抛中文错误由 IPC 转成失败结果。
 */
export async function saveMode(input: unknown): Promise<WorkMode> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('模式数据格式不正确')
  }
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (BUILTIN_MODES.some((mode) => mode.id === id)) {
    throw new Error('内置模式不能修改/删除，请先复制一份')
  }
  const name = clampText(raw.name, 40)
  if (!name) throw new Error('模式名称不能为空')

  const description = clampText(raw.description, 200)
  const systemPrompt =
    typeof raw.systemPrompt === 'string' ? raw.systemPrompt.slice(0, 8000) : ''
  const tools = normalizeTools(raw.tools)
  const temperature = normalizeTemperature(raw.temperature)
  const ragProvider = normalizeProvider(raw.ragProvider)
  const topK = normalizeTopK(raw.topK)

  return withModeLock(async () => {
    const custom = await readCustomModes()
    const existing = id ? custom.find((mode) => mode.id === id) : undefined
    const now = Date.now()
    const mode: WorkMode = {
      id: existing ? existing.id : `mode-${randomUUID()}`,
      name,
      description,
      builtin: false,
      systemPrompt,
      tools,
      temperature,
      ragProvider,
      topK,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const next = existing
      ? custom.map((item) => (item.id === mode.id ? mode : item))
      : [...custom, mode]
    await writeCustomModes(next)
    return mode
  })
}

/** 复制内置或自定义模式为「xxx 副本」，复制结果始终是自定义模式 */
export async function duplicateMode(sourceId: string): Promise<WorkMode> {
  return withModeLock(async () => {
    const custom = await readCustomModes()
    const source = [...BUILTIN_MODES, ...custom].find((mode) => mode.id === sourceId)
    if (!source) throw new Error('未找到要复制的模式')

    const now = Date.now()
    const mode: WorkMode = {
      ...source,
      id: `mode-${randomUUID()}`,
      name: `${source.name} 副本`.slice(0, 40),
      builtin: false,
      tools: [...source.tools],
      createdAt: now,
      updatedAt: now
    }
    await writeCustomModes([...custom, mode])
    return mode
  })
}

/** 删除自定义模式；内置模式固定只读 */
export async function removeMode(id: string): Promise<void> {
  if (BUILTIN_MODES.some((mode) => mode.id === id)) {
    throw new Error('内置模式不能修改/删除，请先复制一份')
  }
  await withModeLock(async () => {
    const custom = await readCustomModes()
    if (!custom.some((mode) => mode.id === id)) throw new Error('未找到该模式')
    await writeCustomModes(custom.filter((mode) => mode.id !== id))
  })
}

export { CHAT_MODE_ID }
