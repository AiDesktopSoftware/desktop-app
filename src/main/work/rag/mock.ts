// P0 演示数据：只用于验证检索契约与界面，不代表真实检索结果
import type { RagChunk, RagProviderId } from './types'

interface MockDoc {
  title: string
  url: string
  text: string
}

const MOCK_DOCS: MockDoc[] = [
  {
    title: '检索增强生成（RAG）的基本流程',
    url: 'https://example.org/rag/overview',
    text: '检索增强生成把外部知识检索与语言模型生成结合起来：先把文档切分为片段并建立向量索引，再按问题召回相关片段，最后把片段与问题一起交给模型作答。它能在不重新训练模型的前提下补充事实知识，降低幻觉，但效果高度依赖切分质量、召回精度与上下文拼接方式。'
  },
  {
    title: 'Agent 工具调用循环与停止条件',
    url: 'https://example.org/agent/tool-loop',
    text: '研究型 Agent 通常按“规划—调用工具—观察结果”的循环推进：模型先判断是否需要搜索或读取文件，再根据返回内容修正下一步。为避免无限循环，工程上会限制最大轮数和同一工具重复调用，并在信息足够时强制收尾，同时要求关键结论标注来源。'
  },
  {
    title: '多源信息采集与清洗流程',
    url: 'https://example.org/collect/pipeline',
    text: '多源信息采集需要统一处理网页、PDF 与办公文档：先抓取原始内容，再去除脚本、导航和广告，随后按正文结构清洗空白与重复段落。每篇文档应保留标题、来源地址、采集时间和原始文件路径，最终以 JSONL 交付，便于后续切分、嵌入与追溯。'
  },
  {
    title: '检索效果评估的常用指标',
    url: 'https://example.org/rag/evaluation',
    text: '检索评估不能只看单个案例。常用做法是构造一批覆盖不同意图的问题，人工标注相关片段，再统计 Recall@K、Precision@K、MRR 与 nDCG。除了排序指标，还要检查答案引用是否真正支持结论，避免检索片段看似相关却无法支撑生成内容。'
  },
  {
    title: '向量嵌入与语义召回',
    url: 'https://example.org/rag/embedding',
    text: '向量嵌入把查询与文档片段映射到同一语义空间，通过余弦相似度召回相近内容。中文场景可选用 bge-m3 一类多语种模型，并控制片段长度在几百字以内。嵌入模型、切分规则和相似度阈值需要一起调优，否则容易出现语义漂移或召回过多噪声。'
  },
  {
    title: '文档切分策略与元数据',
    url: 'https://example.org/rag/chunking',
    text: '文档切分决定检索的基本粒度。固定长度切分实现简单，但可能截断论证；按标题与段落切分更符合语义，却需要处理过长章节。常见折中是先按结构切分，再对超长段落做带重叠的二次切分，并为每个片段保留文档编号、标题与位置信息。'
  },
  {
    title: '双路检索的分数融合与去重',
    url: 'https://example.org/rag/hybrid',
    text: '本地私有库与云端公共库的分数尺度往往不同，直接相加会偏袒某一侧。工程上可先分别归一化，再用加权和或倒数排名融合合并结果，并按文本指纹去重。融合后仍要保留片段来源，方便用户判断结论来自私有资料还是公共知识库。'
  },
  {
    title: '引用溯源与幻觉控制',
    url: 'https://example.org/rag/citation',
    text: '让生成结果可核查的关键是引用溯源：每个片段都应有稳定的编号、标题和来源地址，回答中的事实性陈述要能对应到具体片段。若检索结果不足或相互冲突，系统应明确说明信息缺口，而不是补写看似合理的内容，从流程上降低幻觉风险。'
  }
]

/** 去掉标点与空白，统一小写后再做 2 字滑窗 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function bigrams(text: string): string[] {
  const chars = Array.from(normalize(text))
  if (chars.length < 2) return chars
  const terms = new Set<string>()
  for (let index = 0; index < chars.length - 1; index++) {
    terms.add(`${chars[index]}${chars[index + 1]}`)
  }
  return Array.from(terms)
}

/**
 * 按查询词与演示文本的 2 字滑窗重合度粗排，返回 topK 条。
 * both 模式把结果交替标记为本地与云端，方便界面同时展示两种来源标签。
 */
export function searchMock(
  query: string,
  topK: number,
  provider: RagProviderId
): RagChunk[] {
  const terms = bigrams(query)
  if (terms.length === 0) return []

  const ranked = MOCK_DOCS.map((doc) => {
    const content = normalize(doc.text)
    const hits = terms.filter((term) => content.includes(term)).length
    return { doc, score: hits / terms.length }
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = Math.min(Math.max(Math.floor(topK) || 5, 1), 10)
  return ranked.slice(0, limit).map(({ doc, score }, index) => {
    const chunkProvider: 'local' | 'cloud' =
      provider === 'both' ? (index % 2 === 0 ? 'local' : 'cloud') : provider
    return {
      chunkId: `demo-${chunkProvider}-${index + 1}`,
      text: doc.text,
      score: Math.round(score * 100) / 100,
      provider: chunkProvider,
      source: { title: doc.title, url: doc.url },
      demo: true
    }
  })
}
