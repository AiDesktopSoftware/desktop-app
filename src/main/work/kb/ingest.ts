import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { loadIndex, saveIndex, withKbLock } from './store'
import type { KbChunk, KbDocument } from './types'

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.json',
  '.csv',
  '.log'
])

const MAX_FILE_BYTES = 5 * 1024 * 1024
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 80
const MIN_CHUNK_SIZE = 60
const TITLE_MAX_LENGTH = 60

const BREAK_CHARS = new Set(['。', '！', '？', '；', '!', '?', ';', '\n'])

const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export interface KbImportResult {
  added: KbDocument[]
  skipped: { path: string; reason: string }[]
}

/** 解码常见 HTML 实体，同时支持十进制与十六进制数字实体 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match
  })
}

/** 去掉脚本、样式与标签，保留正文文本 */
function stripHtml(text: string): string {
  let output = text.replace(/<!--[\s\S]*?-->/g, ' ')
  output = output.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  output = output.replace(/<br\s*\/?>/gi, '\n')
  output = output.replace(
    /<\/(?:p|div|h[1-6]|li|tr|section|article|header|footer|blockquote)\s*>/gi,
    '\n'
  )
  output = output.replace(/<[^>]+>/g, ' ')
  return decodeEntities(output)
}

/** 统一换行并压缩连续空白，保留段落换行供切分使用 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isHtml(extension: string): boolean {
  return extension === '.html' || extension === '.htm'
}

/** UTF-8 优先；替换字符占比过高时按 GBK 再试一次，兼容常见的中文本地文件 */
function decodeBuffer(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  const replacement = (utf8.match(/\uFFFD/g) ?? []).length
  if (replacement > Math.max(16, utf8.length * 0.02)) {
    try {
      return new TextDecoder('gbk').decode(buffer)
    } catch {
      return utf8
    }
  }
  return utf8
}

/** 标题优先取正文第一行（去掉 Markdown 的 #），否则用文件名 */
function deriveTitle(text: string, filePath: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const cleaned = (firstLine ?? '').replace(/^#+\s*/, '').trim()
  const title = cleaned || basename(filePath, extname(filePath))
  return title.length > TITLE_MAX_LENGTH ? title.slice(0, TITLE_MAX_LENGTH) : title
}

/**
 * 约 500 字一段、重叠 80 字，尽量在句号或换行处断开。
 * 尾段过短时并入上一段，保证每个片段都有足够上下文。
 */
function splitText(text: string): string[] {
  const chunks: string[] = []
  const total = text.length
  let start = 0

  while (start < total) {
    let end = Math.min(start + CHUNK_SIZE, total)
    if (end < total) {
      const minBreak = start + Math.floor(CHUNK_SIZE * 0.6)
      for (let cursor = end; cursor > minBreak; cursor--) {
        if (BREAK_CHARS.has(text[cursor - 1])) {
          end = cursor
          break
        }
      }
    }

    const piece = text.slice(start, end).trim()
    if (piece) {
      if (piece.length < MIN_CHUNK_SIZE && chunks.length > 0) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n${piece}`.trim()
      } else {
        chunks.push(piece)
      }
    }

    if (end >= total) break
    start = Math.max(end - CHUNK_OVERLAP, start + 1)
  }

  return chunks
}

async function readTextFile(
  filePath: string,
  extension: string
): Promise<{ text: string; size: number }> {
  const buffer = await fs.readFile(filePath)
  const decoded = decodeBuffer(buffer)
  const text = isHtml(extension) ? stripHtml(decoded) : decoded
  return { text: normalizeWhitespace(text), size: buffer.length }
}

/** 导入本地文本文件：按路径去重，逐文件校验、清洗、切分，最后统一保存索引 */
export async function importFiles(paths: string[]): Promise<KbImportResult> {
  const added: KbDocument[] = []
  const skipped: { path: string; reason: string }[] = []

  if (!Array.isArray(paths) || paths.length === 0) {
    return { added, skipped }
  }

  return withKbLock(async () => {
    const index = await loadIndex()
    const existingPaths = new Set(index.documents.map((doc) => doc.path))
    const seen = new Set<string>()

    for (const raw of paths) {
      const input = typeof raw === 'string' ? raw.trim() : ''
      if (!input) {
        skipped.push({ path: '', reason: '路径为空' })
        continue
      }

      const filePath = resolve(input)
      if (seen.has(filePath)) {
        skipped.push({ path: filePath, reason: '重复选择' })
        continue
      }
      seen.add(filePath)

      const extension = extname(filePath).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        skipped.push({
          path: filePath,
          reason: '不支持的文件类型，仅支持 txt / md / markdown / html / htm / json / csv / log'
        })
        continue
      }

      if (existingPaths.has(filePath)) {
        skipped.push({ path: filePath, reason: '已导入' })
        continue
      }

      try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) {
          skipped.push({ path: filePath, reason: '不是普通文件' })
          continue
        }
        if (stat.size > MAX_FILE_BYTES) {
          skipped.push({ path: filePath, reason: '文件超过 5MB 上限' })
          continue
        }

        const { text, size } = await readTextFile(filePath, extension)
        if (!text) {
          skipped.push({ path: filePath, reason: '内容是空的，无法提取有效文本' })
          continue
        }

        const pieces = splitText(text)
        if (pieces.length === 0) {
          skipped.push({ path: filePath, reason: '未能切分出有效片段' })
          continue
        }

        const docId = randomUUID()
        const chunks: KbChunk[] = pieces.map((piece, order) => ({
          id: `${docId}-${order + 1}`,
          docId,
          index: order + 1,
          text: piece
        }))
        const document: KbDocument = {
          id: docId,
          title: deriveTitle(text, filePath),
          path: filePath,
          size,
          chunkCount: chunks.length,
          createdAt: Date.now()
        }

        index.documents.push(document)
        index.chunks.push(...chunks)
        existingPaths.add(filePath)
        added.push(document)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        skipped.push({ path: filePath, reason: `读取失败：${detail.slice(0, 120)}` })
      }
    }

    if (added.length > 0) {
      await saveIndex(index)
    }
    return { added, skipped }
  })
}

/** 删除文档及其全部片段，返回是否真的删除了内容 */
export async function removeDocument(docId: string): Promise<boolean> {
  return withKbLock(async () => {
    const index = await loadIndex()
    if (!index.documents.some((doc) => doc.id === docId)) return false
    index.documents = index.documents.filter((doc) => doc.id !== docId)
    index.chunks = index.chunks.filter((chunk) => chunk.docId !== docId)
    await saveIndex(index)
    return true
  })
}
