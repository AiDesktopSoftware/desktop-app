// 知识库检索统一契约：本地库、云端公共库与演示通道共用同一组字段
export type RagProviderId = 'local' | 'cloud' | 'both'

export interface RagQuery {
  query: string
  provider?: RagProviderId
  topK?: number
}

export interface RagSource {
  title: string
  url?: string
  path?: string
}

export interface RagChunk {
  chunkId: string
  text: string
  score: number
  provider: 'local' | 'cloud'
  source: RagSource
  demo?: boolean
}

export interface RagResult {
  ok: boolean
  provider: RagProviderId
  chunks: RagChunk[]
  note?: string
  message?: string
}
