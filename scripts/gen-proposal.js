/**
 * 开题报告生成脚本（赵的部分 + 总体公共部分）
 * 输出: 开题报告-智研台Desk-赵的部分.docx
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, HeadingLevel
} = require('docx');

const CJK = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' };

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: CJK, size: 24 } }
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: CJK },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0, keepNext: false, keepLines: false } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: CJK },
        paragraph: { spacing: { before: 200, after: 200 }, outlineLevel: 1, keepNext: false, keepLines: false } },
    ]
  },
  sections: [{
    properties: {
      page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    headers: {
      default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "高级软件工程课程设计 — 开题报告", font: CJK, size: 20 })] })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "第 ", font: CJK, size: 20 }),
        new TextRun({ children: [PageNumber.CURRENT], font: CJK, size: 20 }),
        new TextRun({ text: " 页", font: CJK, size: 20 })
      ] })] })
    },
    children: buildContent()
  }]
});

function buildContent() {
  const children = [];

  // ========== 封面 ==========
  children.push(new Paragraph({ spacing: { before: 600 } }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [
    new TextRun({ text: "软件工程项目开题报告", font: CJK, size: 52, bold: true })
  ]}));
  children.push(new Paragraph({ spacing: { before: 400 } }));

  const coverRows = [
    ["项目名称", "智研台 Desk — AI 多源信息采集与研究助手"],
    ["课程名称", "高级软件工程"],
    ["学院", "计算机科学与技术学院"],
    ["专业", "（待补充）"],
    ["年级", "2026级"],
    ["小组成员", "赵（研究侧）、胡（数据侧）"],
    ["指导教师", "吴云"],
  ];
  const coverRowsBuild = coverRows.map(([k, v]) => new TableRow({
    children: [
      new TableCell({ width: { size: 2400, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: k, font: CJK, bold: true, size: 22 })] })] }),
      new TableCell({ width: { size: 6626, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: v, font: CJK, size: 22 })] })] })
    ]
  }));
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: coverRowsBuild }));

  children.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: "2026 年 11 月", font: CJK, size: 24 })
  ]}));
  children.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })] }));

  // ========== 一、基本情况 ==========
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "一、基本情况", font: CJK })] }));

  // 项目组成员分工表
  children.push(new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: "1. 项目组成员与分工", font: CJK, bold: true, size: 24 })] }));

  const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const headerRow = new TableRow({ children: [
    tc("姓名", 1200, borders, true),
    tc("学院", 1800, borders, true),
    tc("学号", 1800, borders, true),
    tc("专业/班级", 1800, borders, true),
    tc("项目任务分工", 3426, borders, true),
  ]});

  const zhaoRow = new TableRow({ children: [
    tc("赵", 1200, borders),
    tc("计算机学院", 1800, borders),
    tc("（待补充）", 1800, borders),
    tc("（待补充）", 1800, borders),
    tc("研究侧：主进程核心引擎（Agent、RAG、知识库、工作流编排、研究报告生成）+ 工作模式模块（views/work/）", 3426, borders),
  ]});

  const huRow = new TableRow({ children: [
    tc("胡", 1200, borders),
    tc("计算机学院", 1800, borders),
    tc("（待补充）", 1800, borders),
    tc("（待补充）", 1800, borders),
    tc("数据侧：多源信息采集、爬虫、正文抽取、去重清洗 + 信息模式模块（views/info/），按 JSONL 契约交付数据", 3426, borders),
  ]});

  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, zhaoRow, huRow] }));

  // 研究内容简介
  children.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "2. 项目研究内容简介", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "本项目名称为智研台 Desk，是一款本地优先的桌面端 AI 研究助手。项目定位为一个轻量、可配置的研究辅助平台，覆盖从信息采集、检索分析到研究报告生成的端到端流程。产品采用 Electron + Vue 3 + TypeScript 技术栈，支持两个功能模式：工作模式提供 RAG 知识库、Agent 工具调用、可配置研究工作流等能力；信息模式负责多源数据采集、清洗与结构化交付。研究侧与数据侧通过约定的 JSONL 数据格式协作，各自模块独立开发、独立交付。"
  })] }));

  // ========== 二、立论依据 ==========
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "二、立论依据", font: CJK })] }));

  // 2-1 背景意义
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2-1 项目的研究背景和意义", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "【研究背景】在学术研究与行业调研场景中，研究人员需要面对海量多源信息——网页、学术论文、技术文档、本地文件等。传统的手动检索、下载、整理方式效率低下，而近年来迅速普及的 AI 助手产品（如 Perplexity、Claude.ai、Notion AI 等）大多以 SaaS 形式提供服务，存在以下问题：\n\n" +
    "（1）隐私安全：敏感研究数据上传至第三方云端，科研选题、未发表成果可能泄露；\n" +
    "（2）离线不可用：网络受限或无网环境下无法使用；\n" +
    "（3）定制能力弱：通用 AI 助手难以适配特定研究领域的检索策略与报告格式；\n" +
    "（4）成本持续累积：按次/按量计费，长期使用费用可观。\n\n" +
    "【研究意义】本项目旨在构建一款本地优先的桌面端 AI 研究助手，核心价值在于：\n\n" +
    "（1）数据本地化：知识库、检索索引、对话记录全部存储于本机，隐私数据不出设备；\n" +
    "（2）流程端到端：覆盖从信息采集 → 检索分析 → 报告生成的完整研究辅助链路；\n" +
    "（3）架构可配置：借鉴 Codex/Trae 的 DIY 设计哲学，将核心能力拆解为可配置组件，用户可按需组装研究工作流；\n" +
    "（4）可独立部署：开源可扩展，支持自定义数据源、自定义 LLM 接口，不依赖单一云服务。"
  })] }));

  // 2-2 研究现状
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2-2 项目的研究现状及分析", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "【同类产品对比】\n\n" +
    "| 产品 | 形态 | 优势 | 不足 |\n" +
    "|------|------|------|------|\n" +
    "| Perplexity | SaaS 网页 | 多源检索质量好、引用溯源 | 数据上云、按次计费、无离线 |\n" +
    "| Claude.ai | SaaS 网页 | 长上下文、强代码能力 | 无法接入本地知识库 |\n" +
    "| Dify | 开源平台 | 可视化 RAG 工作流 | 需部署后端、架构偏重 |\n" +
    "| Obsidian RAG | 本地笔记 | 本地存储、插件生态 | 需手动组装、无 AI Agent |\n" +
    "| Codex / Trae | 桌面应用 | Agent+工具调用闭环、DIY 配置 | 面向编程场景而非研究场景 |\n\n" +
    "通过对比可见，目前市场上缺乏一款**面向研究场景、本地优先、架构可配置**的桌面 AI 助手。本项目正是针对这一空白，借鉴 Codex/Trae 的成功架构，专注于研究辅助场景的垂直优化。\n\n" +
    "【参考文献】\n\n" +
    "[1] Lewis P, Perez E. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks[J]. NeurIPS, 2020.\n" +
    "[2] Karpukhin V, Oguz B, Min S, et al. Dense Passage Retrieval for Open-Domain Question Answering[J]. EMNLP, 2020.\n" +
    "[3] Bradbury J, Frostig R, Hawkins P, et al. JAX: Composable Transformations of Python+NumPy Programs[C]. OOPSLA, 2018.\n" +
    "[4] Griffiths A J C, et al. The Anthropic Claude 3 Model Family[J]. arXiv:2402.01311, 2024.\n" +
    "[5] Electron. Electron Documentation[EB/OL]. https://www.electronjs.org/docs, 2025.\n" +
    "[6] Vue.js Team. Vue 3 Documentation[EB/OL]. https://vuejs.org, 2025.\n"
  })] }));

  // ========== 三、研究方案 ==========
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "三、研究方案", font: CJK })] }));

  // 3-1 目标+内容+技术路线+算法+可行性
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3-1 项目研究的目标、内容、技术路线、算法设计和可行性分析", font: CJK })] }));

  // 研究目标
  children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "1. 研究目标", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "构建一款本地优先的桌面端 AI 研究助手，实现从多源信息采集、RAG 语义检索、Agent 工具调用到研究报告自动生成的端到端闭环。系统面向研究场景优化，核心能力拆解为可配置组件，用户可按需组装研究工作流。"
  })] }));

  // 研究内容
  children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "2. 研究内容", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "（1）本地优先的 RAG 知识库系统：文档切片、向量化索引、语义检索、来源溯源；\n" +
    "（2）Agent 工具调用框架：Function Calling 循环、安全护栏、可配置工具白名单；\n" +
    "（3）可配置研究工作流引擎：模板化流程、节点级编辑、试运行与冻结；\n" +
    "（4）研究报告自动生成：基于检索结果和 Agent 轨迹，结构化输出研究报告。"
  })] }));

  // 技术路线
  children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "3. 技术路线", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "整体采用分层架构设计，自上而下分为三层：\n\n" +
    "【渲染层】基于 Vue 3 + TypeScript，提供两个功能模式界面（工作模式、信息模式），通过 IPC 与主进程通信，实现热更新开发体验；\n\n" +
    "【主进程核心引擎】基于 Node.js，是系统的核心调度层，包含五大子模块：\n" +
    "  • Agent 模块：管理 Function Calling 工具调用循环（上限 10 轮、14 次工具调用）\n" +
    "  • RAG 检索模块：本地 BM25 索引 + 相似度检索，支持 Top-K 片段召回\n" +
    "  • 知识库模块：管理本地文档导入、切片、索引更新\n" +
    "  • 工作流引擎：DAG 拓扑执行、节点状态机流转\n" +
    "  • 能力注册中心：内置 6 个工具 + 用户自定义 HTTP 能力\n\n" +
    "【数据与服务层】包含：\n" +
    "  • 云端 LLM API：OpenAI 兼容接口（DeepSeek 等），主进程调用，Key 安全存储\n" +
    "  • 本地向量库：SQLite 扩展，BM25 索引，无外部 Python 依赖\n" +
    "  • 本地文件系统：用户数据隔离存储于 Electron userData 目录\n" +
    "  • HTTP 工具：联网搜索、网页抓取等外部信息获取\n\n" +
    "开发流程遵循标准软件工程生命周期：需求分析 → 概要设计 → 详细设计 → 编码实现 → 综合测试。"
  })] }));

  // 算法设计
  children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "4. 算法设计", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "本项目涉及三个核心算法/机制设计：\n\n" +
    "【算法一：RAG 检索增强生成】\n" +
    "  • 文档预处理：500 字分块，块间 80 字重叠，标题命中加权 1.3 倍\n" +
    "  • 索引构建：纯 Node.js 实现 BM25 评分函数（词频 tf、逆文档频率 idf、文档长度归一化）\n" +
    "  • 检索流程：用户查询 → BM25 相似度 → Top-K 相关片段 → 拼接进 Prompt 注入 LLM → 生成带来源标注的回答\n\n" +
    "【算法二：Agent 工具调用循环】\n" +
    "  • 基于 OpenAI Function Calling 协议，LLM 返回 JSON 格式的工具调用意图\n" +
    "  • 执行循环：发送 Prompt → LLM 返回（回答 或 工具调用）→ 工具执行 → 结果回传 LLM → 循环直到 LLM 给出最终回答\n" +
    "  • 安全机制：路径限定（项目根/userData/桌面/文档/下载）、危险命令黑名单（format、diskpart、shutdown、git reset --hard 等）\n\n" +
    "【算法三：可配置工作流引擎】\n" +
    "  • DAG 图拓扑排序执行，节点状态机：等待 → 运行 → 成功/失败\n" +
    "  • 三层 DIY 架构：L1 参数化模式（4 内置模式，可复制/改提示词/改工具白名单）、L2 工作流编排（3 内置模板，支持编辑步骤）、L3 自定义 HTTP 能力（用户填接口注册新工具）\n" +
    "  • 支持变量注入与模板化：研究主题、时间范围、指定来源等作为运行时变量\n"
  })] }));

  // 可行性分析
  children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "5. 可行性分析", font: CJK, bold: true, size: 24 })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "【技术可行性】\n" +
    "（1）Electron + Vue 3 技术栈生态成熟，社区文档完善，跨平台能力强；\n" +
    "（2）LLM API（DeepSeek 等）提供稳定的 OpenAI 兼容接口，Function Calling 协议成熟；\n" +
    "（3）本地向量检索采用 BM25 算法，纯 Node.js 实现无需 Python 依赖，降低部署复杂度；\n" +
    "（4）已有原型验证：Agent 工具调用闭环、BM25 知识库检索、DIY 三层配置均已实现并跑通测试。\n\n" +
    "【已有成果（半成品原型）】\n" +
    "（1）项目文件：40+ 个源文件，main 分支与 feat/zhao-work 分支累计 20+ 次 commit；\n" +
    "（2）核心功能已跑通：Agent Function Calling 工具循环（6 工具、安全护栏）、本地 BM25 知识库（导入→检索→带来源）、DIY 三层架构（模式+工作流+自定义 HTTP 能力）、消息操作全套（分支/修改/删除/重新生成）、Ctrl+Shift+P 命令面板、@ 自动补全、系统托盘、自绘深色标题栏；\n" +
    "（3）代码质量：electron-vite build 通过，核心模块经静态审计修复关键 bug。\n\n" +
    "结论：核心技术链路已完整跑通，证明技术路线完全可行，后续开发主要是功能扩展与体验打磨。"
  })] }));

  // 3-2 研究计划
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3-2 项目研究计划", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "| 阶段 | 时间 | 主要任务 | 产出 |\n" +
    "|------|------|----------|------|\n" +
    "| 选题讨论 | 第 1 周 | 开题答辩 | 开题报告 |\n" +
    "| 需求分析 | 第 2-3 周 | 需求收集、可行性研究、需求规格说明书 | 需求分析文档 |\n" +
    "| 软件设计 | 第 4-5 周 | 总体设计、详细设计、数据库设计 | 设计文档 |\n" +
    "| 编码实现 | 第 6-10 周 | 按分工编码、联调 | 可运行原型 |\n" +
    "| 测试验收 | 第 11 周 | 单元测试、系统测试、缺陷修复 | 测试报告 |\n" +
    "| 期末展示 | 第 12 周 | 文档整理、系统展示答辩 | 全套文档 + 安装包 |"
  })] }));

  // 3-3 研发流程框架
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3-3 项目研发流程框架", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "遵循软件工程规范的开发流程：\n\n" +
    "需求分析 ──→ 概要设计 ──→ 详细设计 ──→ 编码实现 ──→ 综合测试\n" +
    "  │              │              │              │              │\n" +
    "需求文档      模块结构图       类图/流程图    源代码        测试报告\n" +
    "             数据库设计       接口文档\n\n" +
    "团队协作方面：公共外壳改动进 main 分支；赵的所有开发在 feat/zhao-work 分支，完成后通过 PR 合入 main；两人模块通过约定的 JSONL 数据格式与 API 契约协作，不直接引用对方内部实现。"
  })] }));

  // 3-4 预期成果
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3-4 项目预期成果", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "（1）可运行的桌面软件：Electron 安装包，支持 Windows 平台；\n" +
    "（2）全套软件工程文档：\n" +
    "    • 需求分析文档（可行性研究 + 需求规格说明书）\n" +
    "    • 设计文档（总体设计 + 详细设计 + 数据库设计 + 接口文档）\n" +
    "    • 测试文档（单元测试报告 + 系统测试报告）\n" +
    "    • 用户说明书\n" +
    "（3）开源代码仓库：GitHub 公开仓库，含 README、构建说明、部署指南；\n" +
    "（4）期末公开答辩展示。"
  })] }));

  // ========== 四、特色和创新点 ==========
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "四、项目的特色和创新点", font: CJK })] }));
  children.push(new Paragraph({ spacing: { line: 360 }, children: [new TextRun({ font: CJK, size: 22, text:
    "（1）本地优先的隐私保护架构：知识库、检索索引、对话记录全部存储于本机 userData 目录，敏感研究数据不出设备；\n\n" +
    "（2）可配置的 DIY 设计哲学：借鉴 Codex/Trae，将 Agent 能力拆解为三层可配置组件（参数化模式 → 工作流编排 → 自定义 HTTP 能力），用户按需组装研究流程；\n\n" +
    "（3）面向研究场景的端到端覆盖：从多源采集 → RAG 检索 → Agent 分析 → 研究报告生成，一个工具覆盖完整研究辅助链路，区别于市面上仅提供单一能力的 AI 产品；\n\n" +
    "（4）轻量无 Python 依赖的本地检索：BM25 算法纯 Node.js 实现，SQLite 文件存储索引，免去 Python 运行时和向量数据库服务的部署负担；\n\n" +
    "（5）双模块松耦合协作：研究侧（Agent/RAG/工作流）与数据侧（采集/清洗）通过 JSONL 数据契约协作，接口清晰、各自独立开发、独立交付。"
  })] }));

  return children;
}

function tc(text, width, borders, isHeader = false) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: isHeader ? { fill: "E8E8E8", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, font: CJK, bold: isHeader, size: 20 })] })]
  });
}

// 输出
const outPath = path.join(__dirname, '..', '开题报告-智研台Desk-赵的部分.docx');
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ 开题报告已生成: ${outPath}`);
  console.log(`   文件大小: ${(buffer.length / 1024).toFixed(1)} KB`);
}).catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
