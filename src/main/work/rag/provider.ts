// 检索统一入口：本地通道走真实关键词检索，云端通道留到 P2 阶段
import { loadIndex } from '../kb/store'
import { searchKb } from '../kb/search'
import type { RagChunk, RagProviderId, RagQuery, RagResult } from './types'

const CLOUD_NOTE = '云端知识库尚未配置（P2 阶段接入），当前没有可展示的片段。'
const EMPTY_NOTE = '本地知识库为空，请先导入文本资料。'
const NO_MATCH_NOTE = '本地知识库没有匹配片段，请先导入资料或换个问法。'
const CLOUD_TAIL = '云端公共库尚未接入。'

interface LocalSearchOutcome {
  chunks: RagChunk[]
  empty: boolean
}

/** 搜索本地索引并映射到统一的 RagChunk；索引为空时用 empty 标记区分「空库」与「无命中」 */
async function searchLocal(text: string, topK: number): Promise<LocalSearchOutcome> {
  const index = await loadIndex()
  if (index.chunks.length === 0) {
    return { chunks: [], empty: true }
  }

  const hits = await searchKb(text, topK)
  return {
    empty: false,
    chunks: hits.map((hit) => ({
      chunkId: hit.chunk.id,
      text: hit.chunk.text,
      score: Math.round(hit.score * 100) / 100,
      provider: 'local',
      source: { title: hit.document.title, path: hit.document.path }
    }))
  }
}

export async function searchRag(query: RagQuery): Promise<RagResult> {
  const rawProvider = query?.provider
  const provider: RagProviderId =
    rawProvider === 'cloud' || rawProvider === 'both' ? rawProvider : 'local'
  const rawTopK =
    typeof query?.topK === 'number' && Number.isFinite(query.topK) ? Math.floor(query.topK) : 5
  const topK = Math.min(Math.max(rawTopK, 1), 10)

  try {
    const text = typeof query?.query === 'string' ? query.query.trim() : ''
    if (!text) {
      return { ok: false, provider, chunks: [], message: '检索内容不能为空' }
    }

    if (provider === 'cloud') {
      return { ok: true, provider, chunks: [], note: CLOUD_NOTE }
    }

    if (provider === 'local') {
      const local = await searchLocal(text, topK)
      if (local.empty) {
        return { ok: true, provider, chunks: [], note: EMPTY_NOTE }
      }
      return {
        ok: true,
        provider,
        chunks: local.chunks,
        ...(local.chunks.length === 0 ? { note: NO_MATCH_NOTE } : {})
      }
    }

    // both：本地结果优先，云端尚未接入时只给出提示，不返回演示片段
    const local = await searchLocal(text, topK)
    const note = local.empty
      ? `${EMPTY_NOTE}${CLOUD_TAIL}`
      : local.chunks.length === 0
        ? `${NO_MATCH_NOTE}${CLOUD_TAIL}`
        : `以下为本地知识库结果；${CLOUD_TAIL}`
    return { ok: true, provider, chunks: local.chunks, note }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      provider,
      chunks: [],
      message: `检索失败：${detail.slice(0, 160)}`
    }
  }
}
