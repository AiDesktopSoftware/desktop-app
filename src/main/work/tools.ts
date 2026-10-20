import { app } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { LlmToolSchema } from './llm'

/** 工具统一返回结构：任何异常都转成 ok:false 的可读中文原因 */
export interface ToolResult {
  ok: boolean
  content: string
}

/** 工具执行结果，content 同时作为回传给模型的工具原文 */
export type ToolExecution = ToolResult

const MAX_SEARCH_RESULTS = 8
const DEFAULT_SEARCH_RESULTS = 5
const FETCH_TIMEOUT_MS = 20_000
const FETCH_MAX_BYTES = 300 * 1024
const FETCH_MAX_CHARS = 4000
const LIST_MAX_ITEMS = 200
const READ_MAX_BYTES = 200 * 1024
const COMMAND_TIMEOUT_MS = 60_000
const COMMAND_MAX_CHARS = 6000

// 明显破坏性的命令直接拒绝，宁可误拦也不执行
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /(^|[^\w-])format(?:\.com)?(\s+[a-z]:|\s*$)/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /remove-item\b[\s\S]*-recurse\b[\s\S]*-force\b[\s\S]*c:[\\/]/i,
  /\brd\s+\/s\s+\/q\s+c:[\\/]/i,
  /\bdel\s+\/f\s+\/s\s+\/q\s+c:[\\/]/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\breg\s+delete\b/i,
  /\bbcdedit\b/i,
  /\bnet\s+user\b/i
]

/** 6 个工具的 OpenAI function calling 定义 */
export const TOOL_SCHEMAS: LlmToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索，返回标题、链接与摘要列表。需要最新信息时优先使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回条数，默认 5，最多 8' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取网页正文，自动去掉脚本与标签，正文截断到 4000 字。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 http/https 地址' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出目录下的文件名、类型与大小，最多 200 条。',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '目录路径' }
        },
        required: ['dir']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本地文本文件，超过 200KB 只读取前 200KB。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入文本文件，自动创建父目录并覆盖原内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '要写入的完整文本' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在本机执行 PowerShell 命令，默认在项目根目录运行，60 秒超时。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '可选的工作目录，默认项目根目录' }
        },
        required: ['command']
      }
    }
  }
]

function projectRoot(): string {
  return resolve(app.getAppPath())
}

/** 路径白名单：项目根、应用数据目录、用户桌面/文档/下载 */
function allowedRoots(): string[] {
  const roots = [
    projectRoot(),
    resolve(process.cwd()),
    resolve(app.getPath('userData')),
    resolve(join(app.getPath('home'), 'Desktop')),
    resolve(join(app.getPath('home'), 'Documents')),
    resolve(join(app.getPath('home'), 'Downloads'))
  ]
  return Array.from(new Set(roots))
}

function isInside(target: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`
  return target === root || target.startsWith(normalizedRoot)
}

function inWhitelist(target: string): boolean {
  return allowedRoots().some((root) => isInside(target, root))
}

/** 统一路径检查，返回解析后的绝对路径或拒绝原因 */
function checkPath(input: string): { ok: true; path: string } | { ok: false; message: string } {
  const raw = input.trim()
  if (!raw) return { ok: false, message: '路径不能为空' }
  let target: string
  try {
    target = resolve(isAbsolute(raw) ? raw : join(projectRoot(), raw))
  } catch {
    return { ok: false, message: `路径无效：${raw}` }
  }
  if (!inWhitelist(target)) {
    return {
      ok: false,
      message: '该路径不在允许范围内（仅限项目目录、应用数据目录与用户的桌面/文档/下载）'
    }
  }
  return { ok: true, path: target }
}

function rejectWrite(target: string): string {
  const root = projectRoot()
  if (isInside(target, join(root, '.git'))) return '禁止写入项目根目录下的 .git/'
  if (isInside(target, join(root, 'node_modules'))) return '禁止写入项目根目录下的 node_modules/'
  return ''
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function truncate(text: string, max: number, hint: string): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n……${hint}`
}

/** Windows PowerShell 的输出可能是 GBK，UTF-8 解码失败时回退 */
function decodeOutput(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return utf8
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  return url
}

interface SearchItem {
  title: string
  url: string
  snippet: string
}

function parseBing(html: string): SearchItem[] {
  const items: SearchItem[] = []
  const blockPattern = /<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|$)/gi
  const blocks = html.match(blockPattern) ?? []
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    const snippetMatch =
      block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    items.push({
      title: stripTags(link[2]),
      url: absoluteUrl(link[1]),
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : ''
    })
  }
  if (items.length > 0) return items

  // 退化方案：直接找标题链接
  const linkPattern = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html)) !== null) {
    items.push({
      title: stripTags(match[2]),
      url: absoluteUrl(match[1]),
      snippet: ''
    })
  }
  return items
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function webSearch(
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return { ok: false, content: '搜索关键词不能为空' }

  const rawLimit = typeof args.limit === 'number' ? Math.floor(args.limit) : DEFAULT_SEARCH_RESULTS
  const limit = Math.min(Math.max(rawLimit || DEFAULT_SEARCH_RESULTS, 1), MAX_SEARCH_RESULTS)

  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      signal: withTimeout(signal, FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      return { ok: false, content: `搜索请求失败（HTTP ${response.status}），请稍后重试` }
    }
    const html = await response.text()
    const items = parseBing(html).slice(0, limit)
    if (items.length === 0) {
      return { ok: false, content: `没有解析到搜索结果：${query}` }
    }
    const lines = items.map((item, index) =>
      [
        `${index + 1}. ${item.title || '(无标题)'}`,
        `   URL: ${item.url}`,
        item.snippet ? `   摘要: ${item.snippet.slice(0, 300)}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    return { ok: true, content: `搜索「${query}」结果：\n${lines.join('\n\n')}` }
  } catch (error) {
    if (signal?.aborted) return { ok: false, content: '搜索已停止' }
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, content: '搜索请求超时（20 秒），请检查网络或稍后重试' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `搜索失败：${detail.slice(0, 160)}` }
  }
}

/** 按上限读取响应体，避免超大页面占满内存 */
async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let text = ''
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // 已结束时取消失败可忽略
    }
  }
  // 冲掉解码器里可能残留的半个多字节字符
  return `${text}${decoder.decode()}`
}

async function fetchUrl(
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const url = typeof args.url === 'string' ? args.url.trim() : ''
  if (!url) return { ok: false, content: 'URL 不能为空' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, content: `URL 格式无效：${url}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, content: '只允许抓取 http/https 地址' }
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      signal: withTimeout(signal, FETCH_TIMEOUT_MS),
      redirect: 'follow'
    })
    if (!response.ok) {
      return { ok: false, content: `网页请求失败（HTTP ${response.status}）：${url}` }
    }
    const contentType = response.headers.get('content-type') ?? ''
    const html = await readLimited(response, FETCH_MAX_BYTES)
    if (!html.trim()) {
      return { ok: false, content: `网页内容为空：${url}` }
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 200) : ''
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    const plain = decodeEntities(body.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    const clipped = truncate(
      plain,
      FETCH_MAX_CHARS,
      `正文已截断（原长度约 ${plain.length} 字，仅保留前 ${FETCH_MAX_CHARS} 字）`
    )
    const head = [`标题：${title || '(无标题)'}`, `URL：${url}`]
    if (contentType && !/text|html|xml|json/i.test(contentType)) {
      head.push(`内容类型：${contentType}`)
    }
    return {
      ok: true,
      content: `${head.join('\n')}\n\n正文节选：\n${clipped || '(未能提取正文)'}`
    }
  } catch (error) {
    if (signal?.aborted) return { ok: false, content: '读取网页已停止' }
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, content: `抓取网页超时（20 秒）：${url}` }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `抓取网页失败：${detail.slice(0, 160)}` }
  }
}

async function listFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const dir = typeof args.dir === 'string' ? args.dir : ''
  const checked = checkPath(dir)
  if (!checked.ok) return { ok: false, content: checked.message }

  try {
    const entries = await fs.readdir(checked.path, { withFileTypes: true })
    if (entries.length === 0) {
      return { ok: true, content: `目录为空：${checked.path}` }
    }
    const rows: string[] = []
    for (const entry of entries.slice(0, LIST_MAX_ITEMS)) {
      const full = join(checked.path, entry.name)
      let size = 0
      let isDir = entry.isDirectory()
      try {
        const stat = await fs.stat(full)
        size = stat.size
        isDir = stat.isDirectory()
      } catch {
        // 单个条目无权限时仍列出名称
      }
      rows.push(`${isDir ? '[文件夹]' : '[文件]'} ${entry.name}${isDir ? '' : ` · ${formatSize(size)}`}`)
    }
    const tip = entries.length > LIST_MAX_ITEMS ? `\n（共 ${entries.length} 项，仅列出前 ${LIST_MAX_ITEMS} 项）` : ''
    return {
      ok: true,
      content: `目录：${checked.path}（共 ${entries.length} 项）\n${rows.join('\n')}${tip}`
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `读取目录失败：${detail.slice(0, 160)}` }
  }
}

async function readFileTool(args: Record<string, unknown>): Promise<ToolResult> {
  const target = typeof args.path === 'string' ? args.path : ''
  const checked = checkPath(target)
  if (!checked.ok) return { ok: false, content: checked.message }

  try {
    const stat = await fs.stat(checked.path)
    if (stat.isDirectory()) {
      return { ok: false, content: `这是一个目录，请使用 list_files：${checked.path}` }
    }
    const limit = Math.min(stat.size, READ_MAX_BYTES)
    const handle = await fs.open(checked.path, 'r')
    let buffer = Buffer.alloc(0)
    try {
      buffer = Buffer.alloc(limit)
      const { bytesRead } = await handle.read(buffer, 0, limit, 0)
      buffer = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    if (buffer.includes(0)) {
      return { ok: false, content: `疑似二进制文件，无法按文本读取：${checked.path}` }
    }
    const text = buffer.toString('utf-8')
    const tip =
      stat.size > READ_MAX_BYTES
        ? `\n\n（文件共 ${formatSize(stat.size)}，仅读取前 200KB）`
        : ''
    return {
      ok: true,
      content: `文件：${checked.path}（${formatSize(stat.size)}）\n\n${text}${tip}`
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `读取文件失败：${detail.slice(0, 160)}` }
  }
}

async function writeFileTool(args: Record<string, unknown>): Promise<ToolResult> {
  const target = typeof args.path === 'string' ? args.path : ''
  const content = typeof args.content === 'string' ? args.content : ''
  const checked = checkPath(target)
  if (!checked.ok) return { ok: false, content: checked.message }
  const denied = rejectWrite(checked.path)
  if (denied) return { ok: false, content: denied }

  try {
    await fs.mkdir(dirname(checked.path), { recursive: true })
    const data = Buffer.from(content, 'utf-8')
    await fs.writeFile(checked.path, data)
    return {
      ok: true,
      content: `已写入 ${data.byteLength} 字节：${checked.path}`
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `写入文件失败：${detail.slice(0, 160)}` }
  }
}

function isDestructive(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))
}

async function runCommand(
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  if (!command) return { ok: false, content: '命令不能为空' }
  if (isDestructive(command)) {
    return { ok: false, content: '该命令被安全策略拒绝' }
  }

  const cwdInput = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : projectRoot()
  const checked = checkPath(cwdInput)
  if (!checked.ok) return { ok: false, content: checked.message }

  if (signal?.aborted) return { ok: false, content: '命令执行已停止' }

  try {
    const stat = await fs.stat(checked.path)
    if (!stat.isDirectory()) {
      return { ok: false, content: `工作目录不是文件夹：${checked.path}` }
    }
  } catch {
    return { ok: false, content: `工作目录不存在：${checked.path}` }
  }

  return await new Promise<ToolResult>((resolvePromise) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', command], {
      cwd: checked.path,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let finished = false
    let timedOut = false
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      child.kill()
    }
    signal?.addEventListener('abort', onAbort)

    // 先按字节收集再统一解码，避免多字节字符被分片截断
    const append = (chunk: Buffer): void => {
      if (bytes >= COMMAND_MAX_CHARS * 4) return
      chunks.push(chunk)
      bytes += chunk.byteLength
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, COMMAND_TIMEOUT_MS)

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const finish = (code: number | null): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        resolvePromise({ ok: false, content: '命令执行已停止' })
        return
      }
      const output = decodeOutput(Buffer.concat(chunks))
      const clipped = truncate(
        output.trim(),
        COMMAND_MAX_CHARS,
        `输出过长，仅保留前 ${COMMAND_MAX_CHARS} 字`
      )
      if (timedOut) {
        resolvePromise({
          ok: false,
          content: `命令执行超时（60 秒），已终止。\n退出码：${code ?? '未知'}\n输出：\n${clipped || '(无输出)'}`
        })
        return
      }
      resolvePromise({
        ok: code === 0,
        content: `退出码：${code ?? '未知'}\n输出：\n${clipped || '(无输出)'}`
      })
    }

    child.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolvePromise({
        ok: false,
        content: aborted ? '命令执行已停止' : `命令启动失败：${error.message.slice(0, 160)}`
      })
    })
    child.on('close', (code) => finish(code))
  })
}

/**
 * 执行指定工具，永不抛出异常。
 * args 由模型给出的 JSON 解析而来，缺字段时由各工具自行返回可读错误。
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolExecution> {
  try {
    switch (name) {
      case 'web_search':
        return await webSearch(args, signal)
      case 'fetch_url':
        return await fetchUrl(args, signal)
      case 'list_files':
        return await listFiles(args)
      case 'read_file':
        return await readFileTool(args)
      case 'write_file':
        return await writeFileTool(args)
      case 'run_command':
        return await runCommand(args, signal)
      default:
        return { ok: false, content: `未知工具：${name || '(空)'}` }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, content: `工具执行失败：${detail.slice(0, 160)}` }
  }
}
