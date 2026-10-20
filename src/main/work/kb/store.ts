import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KbChunk, KbDocument, KbIndex } from './types'

const INDEX_FILE = 'index.json'
const INDEX_DIR = 'knowledge-base'

function indexPath(): string {
  return join(app.getPath('userData'), INDEX_DIR, INDEX_FILE)
}

function emptyIndex(): KbIndex {
  return { version: 1, documents: [], chunks: [] }
}

function isDocument(value: unknown): value is KbDocument {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.path === 'string' &&
    typeof item.size === 'number' &&
    typeof item.chunkCount === 'number' &&
    typeof item.createdAt === 'number'
  )
}

function isChunk(value: unknown): value is KbChunk {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.docId === 'string' &&
    typeof item.index === 'number' &&
    typeof item.text === 'string'
  )
}

/** 只接受结构完整的索引；发现字段缺失时过滤掉坏条目，整体损坏则返回空索引 */
function asIndex(input: unknown): KbIndex | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (raw.version !== 1) return null
  if (!Array.isArray(raw.documents) || !Array.isArray(raw.chunks)) return null
  return {
    version: 1,
    documents: raw.documents.filter(isDocument),
    chunks: raw.chunks.filter(isChunk)
  }
}

/** 读取索引；文件不存在、解析失败或结构异常时统一返回空索引，不向上抛错 */
export async function loadIndex(): Promise<KbIndex> {
  try {
    const raw = await fs.readFile(indexPath(), 'utf-8')
    return asIndex(JSON.parse(raw)) ?? emptyIndex()
  } catch {
    return emptyIndex()
  }
}

/** 先写临时文件再原子替换，避免写入过程中把原索引写坏 */
export async function saveIndex(index: KbIndex): Promise<void> {
  const target = indexPath()
  const temp = `${target}.tmp`
  const data = JSON.stringify(index, null, 2)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, data, 'utf-8')
  await fs.rename(temp, target)
}

// 进程内串行队列：导入与删除都会经历「读索引—改索引—写索引」，必须互斥
let queue: Promise<unknown> = Promise.resolve()

/** 串行执行知识库写操作，避免并发写互相覆盖 */
export function withKbLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}
