// 检索统一入口：P0 阶段只跑通契约，真实本地库与云端库分别留到 P1、P2
import { searchMock } from './mock'
import type { RagProviderId, RagQuery, RagResult } from './types'

const LOCAL_NOTE = '本地知识库服务尚未接入（P1 阶段实现），当前没有可展示的片段。'
const CLOUD_NOTE = '云端知识库尚未配置（P2 阶段接入），当前没有可展示的片段。'
const DEMO_NOTE = '以下为演示片段，用于验证检索契约与界面，不代表真实检索结果。'

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

    if (provider === 'local') {
      return { ok: true, provider, chunks: [], note: LOCAL_NOTE }
    }
    if (provider === 'cloud') {
      return { ok: true, provider, chunks: [], note: CLOUD_NOTE }
    }
    return {
      ok: true,
      provider,
      chunks: searchMock(text, topK, 'both'),
      note: DEMO_NOTE
    }
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
