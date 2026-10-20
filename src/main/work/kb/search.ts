import { loadIndex } from './store'
import type { KbChunk, KbDocument } from './types'

export interface KbSearchHit {
  chunk: KbChunk
  score: number
  document: KbDocument
}

const K1 = 1.2
const B = 0.75
const TITLE_WEIGHT = 1.3
const MAX_NORMALIZED = 0.95
const MIN_NORMALIZED = 0.05

// 简单停用词表：查询里的虚词不参与打分，避免所有片段都被宽松命中
const STOPWORDS = new Set([
  '的',
  '了',
  '和',
  '与',
  '是',
  '在',
  '有',
  '就',
  '不',
  '也',
  '都',
  '而',
  '及',
  '或',
  '被',
  '把',
  '对',
  '从',
  '这',
  '那',
  '其',
  '之',
  '为',
  '以',
  '于',
  '中',
  '上',
  '下',
  '个',
  '我',
  '你',
  '他',
  '她',
  '它',
  '们',
  '请',
  '如何',
  '怎么',
  '怎样',
  '什么',
  '哪些',
  '为什么',
  '是否',
  '以及',
  '一个',
  '没有',
  '可以',
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'as',
  'at',
  'by',
  'from',
  'with',
  'can',
  'could',
  'should',
  'would',
  'what',
  'which',
  'how',
  'why',
  'do',
  'does',
  'did',
  'not',
  'no'
])

function isCjk(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}

function isAsciiWord(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
}

/** 中文按 2 字滑窗、英文与数字按连续串分词，统一小写并过滤停用词 */
function tokenize(text: string): string[] {
  const value = text.toLowerCase()
  const tokens: string[] = []
  let cursor = 0

  while (cursor < value.length) {
    const code = value.charCodeAt(cursor)
    if (isCjk(code)) {
      let end = cursor
      while (end < value.length && isCjk(value.charCodeAt(end))) end++
      const run = value.slice(cursor, end)
      if (run.length === 1) {
        tokens.push(run)
      } else {
        for (let index = 0; index < run.length - 1; index++) {
          tokens.push(run.slice(index, index + 2))
        }
      }
      cursor = end
      continue
    }

    if (isAsciiWord(value[cursor])) {
      let end = cursor
      while (end < value.length && isAsciiWord(value[end])) end++
      const word = value.slice(cursor, end)
      if (word.length >= 2) tokens.push(word)
      cursor = end
      continue
    }

    cursor++
  }

  return tokens.filter((token) => !STOPWORDS.has(token))
}

function termFrequency(tokens: string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const token of tokens) {
    result.set(token, (result.get(token) ?? 0) + 1)
  }
  return result
}

/**
 * 本地关键词检索：BM25 简化版（词频、逆文档频率、长度归一化），
 * 标题命中的片段额外乘 1.3，最后把分数线性映射到 0.05–0.95。
 */
export async function searchKb(query: string, topK: number): Promise<KbSearchHit[]> {
  const text = typeof query === 'string' ? query.trim() : ''
  if (!text) return []

  const limit = Math.min(Math.max(Math.floor(topK) || 5, 1), 10)
  const index = await loadIndex()
  if (index.chunks.length === 0) return []

  const queryTerms = Array.from(new Set(tokenize(text)))
  if (queryTerms.length === 0) return []

  const documentMap = new Map(index.documents.map((doc) => [doc.id, doc]))
  const chunkTokens = index.chunks.map((chunk) => tokenize(chunk.text))
  const chunkFrequencies = chunkTokens.map(termFrequency)
  const totalLength = chunkTokens.reduce((sum, tokens) => sum + tokens.length, 0)
  const averageLength = totalLength / index.chunks.length || 1

  const documentFrequency = new Map<string, number>()
  for (const frequencies of chunkFrequencies) {
    for (const term of frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const titleTerms = new Map<string, Set<string>>()
  for (const doc of index.documents) {
    titleTerms.set(doc.id, new Set(tokenize(doc.title)))
  }

  const totalChunks = index.chunks.length
  const scored: KbSearchHit[] = []

  index.chunks.forEach((chunk, position) => {
    const document = documentMap.get(chunk.docId)
    if (!document) return

    const frequencies = chunkFrequencies[position]
    const length = chunkTokens[position].length
    let score = 0

    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0
      if (frequency === 0) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5))
      const denominator = frequency + K1 * (1 - B + (B * length) / averageLength)
      score += idf * ((frequency * (K1 + 1)) / denominator)
    }

    if (score <= 0) return

    const title = titleTerms.get(chunk.docId)
    if (title && queryTerms.some((term) => title.has(term))) {
      score *= TITLE_WEIGHT
    }

    scored.push({ chunk, score, document })
  })

  if (scored.length === 0) return []

  scored.sort((left, right) => right.score - left.score)

  const highest = scored[0].score
  const lowest = scored[scored.length - 1].score
  const span = highest - lowest
  const normalized = scored.map((hit) => ({
    ...hit,
    score:
      span <= 0
        ? MAX_NORMALIZED
        : MIN_NORMALIZED + ((MAX_NORMALIZED - MIN_NORMALIZED) * (hit.score - lowest)) / span
  }))

  return normalized.slice(0, limit)
}
