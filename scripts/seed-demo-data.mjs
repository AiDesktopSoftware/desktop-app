// 向 userData 注入演示会话，用于截图展示
// 运行: node scripts/seed-demo-data.mjs
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// 找到 Electron userData 路径：从 package.json 的 productName 推出
// Electron 默认 userData = %APPDATA%/<productName>
const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf-8'))
const productName = pkg.name || 'ai-desktop-software'
const userData = join(process.env.APPDATA, productName)
const sessionsFile = join(userData, 'work-sessions.json')
const modesFile = join(userData, 'work-modes.json')

console.log('userData:', userData)
console.log('sessionsFile:', sessionsFile)

const now = Date.now()
const h = (ms) => now - ms

const demoSessions = [
  {
    id: 'demo-rag-hybrid-001',
    title: '我们的混合检索权重是多少？引用格式是什么？',
    createdAt: h(3 * 3600_000),
    updatedAt: h(2 * 3600_000),
    messages: [
      {
        id: 'demo-u-001',
        role: 'user',
        content: '我们的混合检索权重是多少？引用格式是什么？',
        createdAt: h(3 * 3600_000)
      },
      {
        id: 'demo-a-001',
        role: 'assistant',
        content: '## 结论\n\n根据本地知识库中的《混合检索实践说明》文档：\n\n**混合检索权重**\n- 关键词通道（BM25，中文按两字滑动窗口切词）：权重 **0.4**\n- 语义通道（向量相似度召回）：权重 **0.6**\n- 两路结果采用加权分数融合；合并后先按片段文本哈希去重，再取前五条作为上下文\n\n**引用格式**\n- 统一为「文件名 · 第 N 段」\n\n（来源：kb-hybrid-retrieval.md · 第 1 段）\n\n## 补充说明\n\n混合检索的关键收益在于：**采集来的资料里机构名、产品型号、标准编号出现频繁，纯向量检索难以区分这类字符串**，所以用 BM25 给关键词再兜一层。',
        createdAt: h(2 * 3600_000),
        tools: [
          {
            id: 'call_00_hybrid_kbsearch',
            name: 'kb_search',
            args: { query: '混合检索权重 关键词检索 语义检索 权重配置', topK: 6 },
            status: 'done',
            output: '[1] kb-hybrid-retrieval.md · 第1段（相关度 0.95）\n混合检索实践说明\n\n本项目采用混合检索策略：关键词召回与语义召回并行，再用统一打分合并结果。之所以不只用向量检索，是因为采集来的资料中机构名、产品型号、标准编号出现频繁，纯向量对这些字符串的区分度不足。\n\n关键词通道使用 BM25，中文按二字滑窗切词，英文与数字按连续串切词，标题命中额外加权。\n\n合并策略采用加权分数融合，关键词权重 0.4，语义权重 0.6，去重依据片段文本哈希。合并后再送入重排模型，取前五条作为上下文。'
          }
        ],
        evidence: [
          { title: 'kb-hybrid-retrieval.md · 第 1 段', path: 'C:\\Users\\28931\\Documents\\kb-hybrid-retrieval.md' }
        ]
      }
    ]
  },
  {
    id: 'demo-websearch-ragas-002',
    title: '搜索 2025 年 RAG 评测框架 Ragas 的最新情况',
    createdAt: h(5 * 3600_000),
    updatedAt: h(4 * 3600_000),
    messages: [
      {
        id: 'demo-u-002',
        role: 'user',
        content: '搜索 2025 年 RAG 评测框架 Ragas 的最新情况，用两句话总结',
        createdAt: h(5 * 3600_000)
      },
      {
        id: 'demo-a-002',
        role: 'assistant',
        content: '**两句话总结**\n\n2025 年的 Ragas 已从单纯的 RAG 指标库发展成面向更广泛 LLM 应用的评测工具包：它采用"实验优先"的流程，包含实验管理、生产对齐的合成测试集生成，以及 LLM 与传统的非 LLM 指标；除忠实度、答案相关性、上下文精确率和上下文召回率之外，还新增 Agent 与工具调用类指标。\n\n当前代码仓库已迁移至 vibrantlabsai/ragas 组织，官方文档提供 v0.3 到 v0.4 的迁移指南，并新增 `ragas quickstart` 命令行脚手架，可以直接生成完整的 RAG 评测项目模板。\n\n来源：\n- Ragas 官方文档：https://docs.ragas.io/en/latest/\n- PyPI 包信息：https://pypi.org/pypi/ragas/json',
        createdAt: h(4 * 3600_000),
        tools: [
          {
            id: 'call_00_websearch_ragas',
            name: 'web_search',
            args: { query: 'Ragas RAG evaluation framework 2025 latest release', limit: 5 },
            status: 'done',
            output: '搜索「Ragas RAG evaluation framework 2025 latest release」结果：\n1. Ragas\n   URL: https://www.ragas.io/\n   摘要: Ragas is an open source framework for testing and evaluating LLM applications.\n\n2. Ragas 框架\n   URL: https://docs.ragas.org.cn/en/stable/\n   摘要: 2025年全面升级，新增 Agent 评测指标。'
          },
          {
            id: 'call_01_fetch_ragas',
            name: 'fetch_url',
            args: { url: 'https://docs.ragas.io/en/latest/' },
            status: 'done',
            output: '标题：Ragas\nURL：https://docs.ragas.io/en/latest/\n\n正文节选：v0.4 版本引入实验管理、合成测试集生成、Agent 指标集（工具调用准确率、目标达成率）。'
          }
        ],
        evidence: [
          { title: 'Ragas 官方文档', url: 'https://docs.ragas.io/en/latest/' },
          { title: 'Ragas PyPI 包', url: 'https://pypi.org/pypi/ragas/json' }
        ]
      }
    ]
  },
  {
    id: 'demo-project-tree-003',
    title: '看看项目根目录有哪些文件',
    createdAt: h(10 * 3600_000),
    updatedAt: h(9 * 3600_000),
    messages: [
      {
        id: 'demo-u-003',
        role: 'user',
        content: '看看项目根目录有哪些文件，总结一下项目结构',
        createdAt: h(10 * 3600_000)
      },
      {
        id: 'demo-a-003',
        role: 'assistant',
        content: '## 项目结构概览\n\n这是一个 **Electron + TypeScript** 桌面应用：\n\n```\nproject3P/\n├── src/\n│   ├── main/          # 主进程（TS）\n│   │   └── work/      #   Agent / RAG / 工作模式\n│   ├── preload/       # 预加载脚本（安全桥接）\n│   └── renderer/      # 渲染进程（Vue 3）\n├── scripts/           # 备份 / 注入脚本\n├── .githooks/         # Git pre-commit 自动备份\n├── config.local.json  # 本地密钥（不入库）\n├── electron.vite.config.ts\n├── package.json\n└── tsconfig.json\n```\n\n## 模块职责\n\n| 模块 | 负责人 | 说明 |\n|---|---|---|\n| `views/work/` | 赵 | 工作模式前端（RAG + Agent + DIY） |\n| `views/chat/` | 龙 | 对话模式 |\n| `views/info/` | 胡 | 信息/采集模式 |\n| `src/main/` / `preload/` | 公共 | 外壳、托盘、进程通信 |',
        createdAt: h(9 * 3600_000),
        tools: [
          {
            id: 'call_00_listfiles',
            name: 'list_files',
            args: { dir: '.' },
            status: 'done',
            output: '目录：E:\\programFiles\\traeCode\\project3P（共 14 项）\n[文件夹] .git, .githooks, .trae, node_modules, out, scripts, src\n[文件] .gitignore, config.local.json, electron.vite.config.ts, package.json, tsconfig.json'
          }
        ]
      }
    ]
  },
  {
    id: 'demo-plain-chat-004',
    title: '用一句话说明什么是向量检索',
    createdAt: h(20 * 3600_000),
    updatedAt: h(19 * 3600_000),
    messages: [
      {
        id: 'demo-u-004',
        role: 'user',
        content: '用一句话说明什么是向量检索',
        createdAt: h(20 * 3600_000)
      },
      {
        id: 'demo-a-004',
        role: 'assistant',
        content: '向量检索是把文本、图片等内容先通过模型转换成数值向量，再在向量空间中计算相似度（如余弦相似度），找出与查询向量最接近的结果的检索方式。',
        createdAt: h(19 * 3600_000)
      }
    ]
  },
  {
    id: 'demo-long-chat-005',
    title: '深度研究：RAG 与 Agent 的关系',
    createdAt: h(30 * 3600_000),
    updatedAt: h(25 * 3600_000),
    messages: [
      {
        id: 'demo-u-005-1',
        role: 'user',
        content: '帮我梳理一下 RAG 和 Agent 各自是什么，它们的关系是什么',
        createdAt: h(30 * 3600_000)
      },
      {
        id: 'demo-a-005-1',
        role: 'assistant',
        content: '## RAG（检索增强生成）\n\n**解决的问题**：大模型不知道最新信息、也不知道你的私有资料。\n\n**做法**：把资料切块 → 嵌入向量 → 存入向量库。提问时，先检索相关片段，把片段塞进 Prompt 让模型生成。\n\n## Agent（智能体）\n\n**解决的问题**：让模型能主动决定做什么、调用什么工具、分步完成。\n\n**做法**：给模型暴露一组工具（搜索、读文件、写文件、调用 API），让模型自主决定何时调用哪个工具、调几次、怎么串联。\n\n## 两者关系\n\nRAG 是 Agent 的**一种工具**。Agent 可以调 RAG 查知识库、调搜索引擎查外网、调代码执行器算数据——RAG 只是其中之一。\n\n```\nAgent 循环：\n  用户问题\n  → 模型判断需要什么工具\n  → 调用工具（可能是 RAG、搜索、执行命令……）\n  → 拿到工具结果\n  → 模型再判断是否够了\n  → 最终回答\n```\n\n**一句话总结**：RAG 是"给模型外挂知识库"，Agent 是"让模型学会自己干活"。RAG 是 Agent 最常用的外挂之一。',
        createdAt: h(28 * 3600_000)
      },
      {
        id: 'demo-u-005-2',
        role: 'user',
        content: '那 Agent 一定需要 RAG 吗？反过来 RAG 能独立存在吗？',
        createdAt: h(27 * 3600_000)
      },
      {
        id: 'demo-a-005-2',
        role: 'assistant',
        content: '**互相独立，互不依赖**。\n\n- **Agent 可以没有 RAG**：很多 Agent 只有"执行代码"或"调用 API"的工具，照样能工作。RAG 是"需要外部知识"时才需要的外挂。\n- **RAG 也可以独立存在**：不需要 Agent 循环，直接"检索 → 拼 Prompt → 生成"，就是朴素 RAG（Naive RAG），很多生产系统都停在这里。\n\n**什么时候合体**：当你需要"先问知识库、发现不够、再去搜外网、发现还是不够、再让模型自己想方向"这种多步推理时，就需要 Agent 把 RAG 和搜索串起来。\n\n**一个直观对比**：\n\n| 形态 | 复杂度 | 适用场景 |\n|---|---|---|\n| 纯模型 | 最低 | 闲聊、常识问答 |\n| RAG 独立 | 中 | 固定知识库、固定检索流程 |\n| Agent + RAG | 高 | 开放域研究、多步推理 |',
        createdAt: h(25 * 3600_000)
      }
    ]
  }
]

// 读现有 sessions，合并（保留原有 + 加 demo，demo id 带 demo- 前缀不会冲突）
let existing = []
try {
  const raw = await fs.readFile(sessionsFile, 'utf-8')
  existing = JSON.parse(raw)
} catch {
  // 不存在或损坏就从 [] 开始
}

const demoIds = new Set(demoSessions.map(s => s.id))
const merged = [
  ...existing.filter(s => !demoIds.has(s.id)),
  ...demoSessions
].sort((a, b) => b.updatedAt - a.updatedAt) // 最新的排前面

await fs.mkdir(dirname(sessionsFile), { recursive: true })
const tmpFile = sessionsFile + '.tmp'
await fs.writeFile(tmpFile, JSON.stringify(merged, null, 2), 'utf-8')
await fs.rename(tmpFile, sessionsFile)

console.log('✅ 注入完成：')
console.log(`   现有会话数：${existing.length}`)
console.log(`   新增 demo：${demoSessions.length}`)
console.log(`   合并后总计：${merged.length}`)

// 打印模式信息
try {
  const modes = JSON.parse(await fs.readFile(modesFile, 'utf-8'))
  console.log(`\n   现有模式数：${modes.modes?.length ?? 0}`)
  for (const m of (modes.modes || [])) {
    console.log(`   - ${m.name}（${m.tools?.length ?? 0} 个工具）`)
  }
} catch {}

console.log('\n🚀 重启 Electron 应用即可看到演示数据')
