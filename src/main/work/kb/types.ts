// 本地知识库的持久化结构：文档元数据与切分后的片段分开存放
export interface KbDocument {
  id: string
  title: string
  path: string // 原始绝对路径
  size: number // 字节
  chunkCount: number
  createdAt: number
}

export interface KbChunk {
  id: string
  docId: string
  index: number // 文档内序号，从 1 开始
  text: string
}

export interface KbIndex {
  version: 1
  documents: KbDocument[]
  chunks: KbChunk[]
}
