// 用户自定义 HTTP 能力：让用户把自己的外部 API 注册为可调用工具
// 存储模式照搬 workflow/engine.ts 的原子写 + 进程内串行队列
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

// ---- 安全上限 ----
const HTTP_TIMEOUT_MS = 30_000
const HTTP_MAX_BYTES = 500 * 1024
const HTTP_MAX_CHARS = 6000
const CUSTOM_MAX_COUNT = 20

// ---- 类型 ----

/** 工具参数的 JSON Schema（与内置 Capability 共用） */
export interface CustomParamSchema {
  type: 'string' | 'number' | 'boolean'
  description?: string
}

/** 用户自定义 HTTP 能力的完整定义 */
export interface CustomCapability {
  /** 唯一标识：custom_ 前缀，内部生成或用户填写 */
  id: string
  /** 中文名称，界面显示用 */
  name: string
  /** 描述：告诉 Agent 什么时候该用这个工具 */
  description: string
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** URL 模板，支持 {{param}} 占位 */
  url: string
  /** 请求头，值支持 {{param}} 占位 */
  headers?: Record<string, string>
  /** 请求体模板（仅 POST/PUT/PATCH），支持 {{param}} 占位；不填则发送 application/json */
  bodyTemplate?: string
  /** 请求体 MIME，默认 application/json */
  bodyMime?: string
  /** 参数定义：key → 参数 schema */
  paramsSchema: Record<string, CustomParamSchema>
  /** 必填参数名 */
  required?: string[]
  /** 响应提取：从 HTTP 响应中抽出一段可呈现文本的规则 */
  responsePath?: string
  /** 记录创建时间 */
  createdAt: number
  /** 最近更新时间 */
  updatedAt: number
}

export interface CustomCapabilitySaveResult {
  ok: boolean
  capability?: CustomCapability
  message?: string
}

export interface CustomCapabilityRemoveResult {
  ok: boolean
  message?: string
}

// ---- 存储层 ----

const CUSTOM_DIR = 'capabilities'
const CUSTOM_FILE = 'custom.json'

function customPath(): string {
  return join(app.getPath('userData'), CUSTOM_DIR, CUSTOM_FILE)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asSafeId(input: unknown, fallback: string): string {
  const raw = asText(input)
  if (!raw) return fallback
  // 限制字符：字母数字下划线短横线，custom_ 开头
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  if (!normalized.startsWith('custom_')) return `custom_${normalized || fallback}`
  return normalized
}

// 进程内串行队列：保存和删除都会读写文件
let queue: Promise<unknown> = Promise.resolve()
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

async function writeJson(target: string, data: unknown): Promise<void> {
  const temp = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(temp, target)
}

/** 读取并校验：至少有 id/name/description/method/url */
function normalizeCustom(input: unknown): CustomCapability | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const name = asText(raw.name)
  const description = asText(raw.description)
  const methodRaw = asText(raw.method).toUpperCase()
  if (!name || !description) return null
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(methodRaw)) return null

  const url = asText(raw.url)
  if (!url) return null

  const id = asSafeId(raw.id, `custom_${Date.now().toString(36)}`)
  const now = Date.now()

  const headers: Record<string, string> = {}
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      const k = asText(key)
      const v = asText(value)
      if (k && v) headers[k] = v
    }
  }

  const paramsSchema: Record<string, CustomParamSchema> = {}
  if (raw.paramsSchema && typeof raw.paramsSchema === 'object' && !Array.isArray(raw.paramsSchema)) {
    for (const [key, schema] of Object.entries(
      raw.paramsSchema as Record<string, Record<string, unknown>>
    )) {
      const k = asText(key)
      if (!k) continue
      const type = asText(schema?.type) as CustomParamSchema['type']
      if (!['string', 'number', 'boolean'].includes(type)) continue
      paramsSchema[k] = {
        type,
        ...(schema?.description ? { description: asText(schema.description) } : {})
      }
    }
  }
  if (Object.keys(paramsSchema).length === 0) return null // 至少声明一个参数

  const required: string[] = []
  if (Array.isArray(raw.required)) {
    for (const item of raw.required) {
      const key = asText(item)
      if (key && paramsSchema[key] && !required.includes(key)) required.push(key)
    }
  }

  return {
    id,
    name,
    description,
    method: methodRaw as CustomCapability['method'],
    url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    bodyTemplate: raw.bodyTemplate ? asText(raw.bodyTemplate) : undefined,
    bodyMime: raw.bodyMime ? asText(raw.bodyMime) : 'application/json',
    paramsSchema,
    required,
    responsePath: raw.responsePath ? asText(raw.responsePath) : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now
  }
}

async function readAll(): Promise<CustomCapability[]> {
  try {
    const raw = await fs.readFile(customPath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: CustomCapability[] = []
    for (const item of parsed) {
      const normalized = normalizeCustom(item)
      if (normalized && !result.some((existing) => existing.id === normalized.id)) {
        result.push(normalized)
      }
    }
    return result
  } catch {
    return []
  }
}

// ---- HTTP 执行器 ----

/** 把 URL/headers/bodyTemplate 里的 {{param}} 替换成实际值 */
function renderTemplate(text: string, args: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key: string) => {
    const trimmed = key.trim()
    return args[trimmed] !== undefined ? String(args[trimmed]) : ''
  })
}

/** 把 unknown 类型的参数值统一转成 string */
function stringifyArgs(args: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue
    result[key] = typeof value === 'string' ? value : String(value)
  }
  return result
}

/** 从响应文本里按 responsePath 提取片段；不填时直接返回全部文本 */
function extractResponse(text: string, path?: string): string {
  if (!path) return text
  // 简化 JSONPath：支持 $.a.b.c 和 $.items[0].title 两种
  try {
    const parsed = JSON.parse(text)
    // $.a.b.c
    const bracket = path.replace(/^\$/, '')
    const parts = bracket.split(/[.\[\]]+/).filter(Boolean)
    let current: unknown = parsed
    for (const part of parts) {
      if (current === null || current === undefined) return text
      if (Array.isArray(current)) {
        const index = Number(part)
        if (!Number.isFinite(index)) return text
        current = current[index]
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return text
      }
    }
    if (current !== undefined && current !== null) {
      return typeof current === 'string' ? current : JSON.stringify(current)
    }
    return text
  } catch {
    // 不是 JSON 或提取失败，返回全部
    return text
  }
}

/** URL 安全校验：只允许 http/https，禁止内网文件或本地 file:// */
function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function readLimitedResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let text = ''
  try {
    while (received < maxBytes) {
      if (signal?.aborted) return text
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // 已结束时忽略
    }
  }
  return `${text}${decoder.decode()}`
}

async function httpExecute(
  cap: CustomCapability,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; content: string }> {
  const strArgs = stringifyArgs(args)

  // 必填参数检查
  if (cap.required) {
    for (const key of cap.required) {
      if (!strArgs[key]) return { ok: false, content: `缺少必填参数：${key}` }
    }
  }

  const renderedUrl = renderTemplate(cap.url, strArgs)
  if (!isUrlAllowed(renderedUrl)) {
    return { ok: false, content: '自定义能力的 URL 不安全（只允许 http/https）' }
  }

  const renderedHeaders: Record<string, string> = {
    'User-Agent': 'ResearchAgent/1.0 (Electron)'
  }
  if (cap.headers) {
    for (const [k, v] of Object.entries(cap.headers)) {
      const key = k.trim()
      if (!key) continue
      renderedHeaders[key] = renderTemplate(v, strArgs)
    }
  }

  let renderedBody: string | undefined
  if (cap.method === 'POST' || cap.method === 'PUT' || cap.method === 'PATCH') {
    if (cap.bodyTemplate) {
      renderedBody = renderTemplate(cap.bodyTemplate, strArgs)
    } else if (Object.keys(strArgs).length > 0) {
      renderedBody = JSON.stringify(strArgs)
      renderedHeaders['Content-Type'] = cap.bodyMime || 'application/json'
    }
  }

  const timeoutSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)])
    : AbortSignal.timeout(HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(renderedUrl, {
      method: cap.method,
      headers: renderedHeaders,
      body: renderedBody,
      signal: timeoutSignal
    })

    if (!response.ok) {
      const bodyText = await readLimitedResponse(response, 2000, signal)
      return {
        ok: false,
        content: `自定义能力「${cap.name}」调用失败（HTTP ${response.status}）：${bodyText.slice(0, 400)}`
      }
    }

    const rawText = await readLimitedResponse(response, HTTP_MAX_BYTES, signal)
    const extracted = extractResponse(rawText, cap.responsePath)
    const clipped =
      extracted.length > HTTP_MAX_CHARS
        ? `${extracted.slice(0, HTTP_MAX_CHARS)}……（已截断）`
        : extracted
    return {
      ok: true,
      content: `自定义能力「${cap.name}」调用结果：\n${clipped}`
    }
  } catch (error) {
    if (signal?.aborted) return { ok: false, content: '自定义能力调用已停止' }
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, content: `自定义能力「${cap.name}」调用超时（30 秒）` }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      content: `自定义能力「${cap.name}」调用失败：${detail.slice(0, 200)}`
    }
  }
}

// ---- 导出的 API ----

export async function listCustomCapabilities(): Promise<CustomCapability[]> {
  return readAll()
}

export async function getCustomCapability(
  id: string
): Promise<CustomCapability | undefined> {
  const all = await readAll()
  return all.find((item) => item.id === id)
}

export async function saveCustomCapability(
  input: unknown
): Promise<CustomCapabilitySaveResult> {
  const draftInput =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : {}
  // 新建时自动补 id
  const withId =
    (draftInput as Record<string, unknown>).id
      ? draftInput
      : {
          ...draftInput,
          id: `custom_${Date.now().toString(36)}`
        }

  const draft = normalizeCustom(withId)
  if (!draft) {
    return {
      ok: false,
      message:
        '自定义能力格式不正确：名称/描述/URL 必填，至少声明一个参数，URL 必须是 http/https'
    }
  }

  return withLock(async () => {
    const existing = await readAll()
    // 数量上限（仅在新建时）
    const found = existing.find((item) => item.id === draft.id)
    if (!found && existing.length >= CUSTOM_MAX_COUNT) {
      return { ok: false, message: `自定义能力最多 ${CUSTOM_MAX_COUNT} 个` }
    }

    const now = Date.now()
    const saved: CustomCapability = {
      ...draft,
      createdAt: found ? found.createdAt : now,
      updatedAt: now
    }
    const next = found
      ? existing.map((item) => (item.id === saved.id ? saved : item))
      : [...existing, saved]
    await writeJson(customPath(), next)
    return { ok: true, capability: saved }
  })
}

export async function removeCustomCapability(
  id: string
): Promise<CustomCapabilityRemoveResult> {
  const target = asText(id)
  if (!target) return { ok: false, message: '缺少自定义能力标识' }
  if (!target.startsWith('custom_')) {
    return { ok: false, message: '这是内置能力，不可删除' }
  }

  return withLock(async () => {
    const existing = await readAll()
    const next = existing.filter((item) => item.id !== target)
    if (next.length === existing.length) {
      return { ok: false, message: '未找到该自定义能力' }
    }
    await writeJson(customPath(), next)
    return { ok: true }
  })
}

/** 执行指定自定义能力：先从存储加载（避免进程内缓存过期），再走 HTTP executor */
export async function executeCustomCapability(
  id: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; content: string }> {
  const cap = await getCustomCapability(id)
  if (!cap) {
    return { ok: false, content: `自定义能力不存在：${id}` }
  }
  return httpExecute(cap, args, signal)
}
