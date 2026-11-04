/**
 * 生成开题答辩 PPT 所需的 3 张 SVG 图
 * 输出到 docs/diagrams/
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'docs', 'diagrams');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ========== 图1：技术路线分层架构图 ==========
const diagram1 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480" width="720" height="480">
  <defs>
    <style>
      .layer { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 2; rx: 12; }
      .box { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 8; }
      .box-accent { fill: #dcfce7; stroke: #16a34a; stroke-width: 1.5; rx: 8; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 14px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 12px; fill: #475569; }
      .layer-title { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 13px; fill: #16a34a; font-weight: 700; }
      .arrow { stroke: #64748b; stroke-width: 2; fill: none; marker-end: url(#arrowhead); }
      .ipc { stroke: #2563eb; stroke-width: 2; stroke-dasharray: 6 4; fill: none; }
    </style>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="360" y="28" text-anchor="middle" class="label" style="font-size:16px; fill:#16a34a;">智研台 Desk — 技术路线分层架构图</text>

  <!-- 第一层：渲染层 -->
  <rect x="40" y="50" width="640" height="100" class="layer"/>
  <text x="55" y="72" class="layer-title">渲染层（Vue 3 + TypeScript）</text>

  <rect x="80" y="85" width="180" height="50" class="box-accent"/>
  <text x="170" y="108" text-anchor="middle" class="label">工作模式</text>
  <text x="170" y="124" text-anchor="middle" class="label-sm">RAG + Agent + 工作流</text>

  <rect x="260" y="85" width="180" height="50" class="box"/>
  <text x="350" y="108" text-anchor="middle" class="label">信息模式</text>
  <text x="350" y="124" text-anchor="middle" class="label-sm">多源采集 + 清洗</text>

  <rect x="440" y="85" width="200" height="50" class="box"/>
  <text x="540" y="108" text-anchor="middle" class="label">公共外壳</text>
  <text x="540" y="124" text-anchor="middle" class="label-sm">侧栏 / 主题 / 托盘</text>

  <!-- IPC 标注 -->
  <line x1="360" y1="150" x2="360" y2="170" class="ipc"/>
  <text x="360" y="165" text-anchor="middle" class="label-sm" style="fill:#2563eb;">IPC 进程间通信</text>

  <!-- 第二层：主进程核心引擎 -->
  <rect x="40" y="175" width="640" height="140" class="layer"/>
  <text x="55" y="197" class="layer-title">主进程核心引擎（Node.js）</text>

  <rect x="60" y="210" width="120" height="45" class="box-accent"/>
  <text x="120" y="230" text-anchor="middle" class="label">Agent</text>
  <text x="120" y="245" text-anchor="middle" class="label-sm">Function Calling</text>

  <rect x="195" y="210" width="120" height="45" class="box-accent"/>
  <text x="255" y="230" text-anchor="middle" class="label">RAG 检索</text>
  <text x="255" y="245" text-anchor="middle" class="label-sm">BM25 + 语义</text>

  <rect x="330" y="210" width="120" height="45" class="box-accent"/>
  <text x="390" y="230" text-anchor="middle" class="label">知识库</text>
  <text x="390" y="245" text-anchor="middle" class="label-sm">导入 / 切片 / 索引</text>

  <rect x="465" y="210" width="120" height="45" class="box-accent"/>
  <text x="525" y="230" text-anchor="middle" class="label">工作流引擎</text>
  <text x="525" y="245" text-anchor="middle" class="label-sm">DAG 节点执行</text>

  <rect x="600" y="210" width="70" height="45" class="box"/>
  <text x="635" y="230" text-anchor="middle" class="label">能力中心</text>
  <text x="635" y="245" text-anchor="middle" class="label-sm">7 工具 + DIY</text>

  <!-- DIY 高亮条 -->
  <rect x="60" y="268" width="610" height="38" rx="8" fill="#fef9c3" stroke="#ca8a04" stroke-width="1"/>
  <text x="365" y="292" text-anchor="middle" class="label" style="font-size:13px; fill:#854d0e;">⭐ DIY 亮点：三层可配置 → L1 参数化模式 / L2 工作流编排 / L3 自定义 HTTP 能力</text>

  <!-- 向下箭头 -->
  <line x1="360" y1="315" x2="360" y2="345" class="arrow"/>

  <!-- 第三层：数据服务层 -->
  <rect x="40" y="350" width="640" height="100" class="layer"/>
  <text x="55" y="372" class="layer-title">数据与服务层</text>

  <rect x="80" y="385" width="140" height="48" class="box"/>
  <text x="150" y="405" text-anchor="middle" class="label">云端 LLM API</text>
  <text x="150" y="422" text-anchor="middle" class="label-sm">DeepSeek / OpenAI 兼容</text>

  <rect x="240" y="385" width="140" height="48" class="box"/>
  <text x="310" y="405" text-anchor="middle" class="label">本地向量索引</text>
  <text x="310" y="422" text-anchor="middle" class="label-sm">BM25 + SQLite</text>

  <rect x="400" y="385" width="140" height="48" class="box"/>
  <text x="470" y="405" text-anchor="middle" class="label">本地文件系统</text>
  <text x="470" y="422" text-anchor="middle" class="label-sm">userData 隔离存储</text>

  <rect x="560" y="385" width="100" height="48" class="box"/>
  <text x="610" y="405" text-anchor="middle" class="label">HTTP 工具</text>
  <text x="610" y="422" text-anchor="middle" class="label-sm">搜索 / 抓网页</text>

  <!-- 右侧图例 -->
  <rect x="645" y="50" width="60" height="14" fill="#dcfce7" stroke="#16a34a" stroke-width="1" rx="3"/>
  <text x="645" y="75" class="label-sm">核心引擎模块</text>
</svg>`;

// ========== 图2：RAG 算法流程图 ==========
const diagram2 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 380" width="720" height="380">
  <defs>
    <style>
      .node { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 10; }
      .node-in { fill: #fef3c7; stroke: #d97706; stroke-width: 1.5; rx: 10; }
      .node-core { fill: #dcfce7; stroke: #16a34a; stroke-width: 2; rx: 10; }
      .node-out { fill: #dbeafe; stroke: #2563eb; stroke-width: 1.5; rx: 10; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 13px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 11px; fill: #64748b; }
      .arrow { stroke: #64748b; stroke-width: 2; fill: none; marker-end: url(#rag-arrow); }
      .group-label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 12px; fill: #94a3b8; font-weight: 700; }
    </style>
    <marker id="rag-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="360" y="28" text-anchor="middle" class="label" style="font-size:16px; fill:#16a34a;">RAG 检索增强生成 — 流程图</text>

  <!-- 数据输入（左） -->
  <text x="130" y="58" text-anchor="middle" class="group-label">📥 数据输入</text>
  <rect x="60" y="65" width="140" height="50" class="node-in"/>
  <text x="130" y="85" text-anchor="middle" class="label">文档导入</text>
  <text x="130" y="102" text-anchor="middle" class="label-sm">md / txt / pdf / 网页</text>

  <!-- 预处理 -->
  <text x="130" y="140" text-anchor="middle" class="group-label">⚙️ 预处理</text>
  <rect x="60" y="148" width="140" height="48" class="node"/>
  <text x="130" y="168" text-anchor="middle" class="label">500 字切片</text>
  <text x="130" y="184" text-anchor="middle" class="label-sm">块间 80 字重叠</text>

  <rect x="60" y="210" width="140" height="48" class="node"/>
  <text x="130" y="230" text-anchor="middle" class="label">标题加权 1.3×</text>
  <text x="130" y="246" text-anchor="middle" class="label-sm">关键词命中加权</text>

  <rect x="60" y="272" width="140" height="48" class="node-core"/>
  <text x="130" y="292" text-anchor="middle" class="label">BM25 索引构建</text>
  <text x="130" y="308" text-anchor="middle" class="label-sm">纯 Node.js，无 Python 依赖</text>

  <!-- 存储 -->
  <text x="360" y="58" text-anchor="middle" class="group-label">💾 存储</text>
  <rect x="280" y="65" width="160" height="50" class="node"/>
  <text x="360" y="85" text-anchor="middle" class="label">本地索引存储</text>
  <text x="360" y="102" text-anchor="middle" class="label-sm">SQLite 文件，轻量无服务</text>

  <!-- 查询 -->
  <text x="360" y="140" text-anchor="middle" class="group-label">🔍 查询</text>
  <rect x="280" y="148" width="160" height="48" class="node-in"/>
  <text x="360" y="168" text-anchor="middle" class="label">用户查询</text>
  <text x="360" y="184" text-anchor="middle" class="label-sm">自然语言问题</text>

  <rect x="280" y="210" width="160" height="48" class="node-core"/>
  <text x="360" y="230" text-anchor="middle" class="label">BM25 相似度检索</text>
  <text x="360" y="246" text-anchor="middle" class="label-sm">Top-K 相关片段召回</text>

  <!-- 生成 -->
  <text x="590" y="58" text-anchor="middle" class="group-label">✨ 生成</text>
  <rect x="500" y="65" width="180" height="50" class="node"/>
  <text x="590" y="85" text-anchor="middle" class="label">拼 Prompt</text>
  <text x="590" y="102" text-anchor="middle" class="label-sm">指令 + 检索片段 + 问题</text>

  <rect x="500" y="148" width="180" height="50" class="node-core"/>
  <text x="590" y="168" text-anchor="middle" class="label">LLM 生成</text>
  <text x="590" y="185" text-anchor="middle" class="label-sm">云端 API（DeepSeek 等）</text>

  <rect x="500" y="230" width="180" height="50" class="node-out"/>
  <text x="590" y="250" text-anchor="middle" class="label">带来源标注的回答</text>
  <text x="590" y="267" text-anchor="middle" class="label-sm">标注文档 + 片段位置</text>

  <!-- 连接线 -->
  <line x1="130" y1="115" x2="130" y2="148" class="arrow"/>
  <line x1="130" y1="196" x2="130" y2="210" class="arrow"/>
  <line x1="130" y1="258" x2="130" y2="272" class="arrow"/>
  <line x1="200" y1="296" x2="280" y2="196" class="arrow"/>
  <line x1="200" y1="90" x2="280" y2="90" class="arrow"/>
  <line x1="360" y1="115" x2="360" y2="148" class="arrow"/>
  <line x1="360" y1="196" x2="360" y2="210" class="arrow"/>
  <line x1="440" y1="234" x2="500" y2="90" class="arrow"/>
  <line x1="590" y1="115" x2="590" y2="148" class="arrow"/>
  <line x1="590" y1="198" x2="590" y2="230" class="arrow"/>

  <!-- 底部说明 -->
  <rect x="60" y="340" width="600" height="30" rx="8" fill="#f0fdf4" stroke="#86efac" stroke-width="1"/>
  <text x="360" y="360" text-anchor="middle" class="label" style="font-size:12px; fill:#15803d;">⭐ 本地优先：索引存在本机 SQLite，LLM 调用时才联网，敏感数据不出设备</text>
</svg>`;

// ========== 图3：研发流程框架图 ==========
const diagram3 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 300" width="720" height="300">
  <defs>
    <style>
      .phase { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 10; }
      .phase-active { fill: #dcfce7; stroke: #16a34a; stroke-width: 2; rx: 10; }
      .outcome { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 1; rx: 6; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 13px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 11px; fill: #64748b; }
      .arrow { stroke: #64748b; stroke-width: 2; fill: none; marker-end: url(#dev-arrow); }
      .num { font-family: Arial, sans-serif; font-size: 14px; fill: #16a34a; font-weight: 700; }
    </style>
    <marker id="dev-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="360" y="28" text-anchor="middle" class="label" style="font-size:16px; fill:#16a34a;">研发流程框架图</text>

  <!-- 阶段1：需求分析 -->
  <circle cx="92" cy="70" r="18" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <text x="92" y="75" text-anchor="middle" class="num">1</text>
  <rect x="40" y="95" width="105" height="55" class="phase-active"/>
  <text x="92" y="115" text-anchor="middle" class="label">需求分析</text>
  <text x="92" y="132" text-anchor="middle" class="label-sm">第 2-3 周</text>
  <rect x="35" y="160" width="115" height="26" class="outcome"/>
  <text x="92" y="177" text-anchor="middle" class="label-sm">需求规格说明书</text>

  <!-- 阶段2：概要设计 -->
  <circle cx="228" cy="70" r="18" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="228" y="75" text-anchor="middle" class="num" style="fill:#64748b;">2</text>
  <rect x="175" y="95" width="105" height="55" class="phase"/>
  <text x="228" y="115" text-anchor="middle" class="label">概要设计</text>
  <text x="228" y="132" text-anchor="middle" class="label-sm">第 4 周</text>
  <rect x="170" y="160" width="115" height="26" class="outcome"/>
  <text x="228" y="177" text-anchor="middle" class="label-sm">模块结构图</text>

  <!-- 阶段3：详细设计 -->
  <circle cx="364" cy="70" r="18" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="364" y="75" text-anchor="middle" class="num" style="fill:#64748b;">3</text>
  <rect x="311" y="95" width="105" height="55" class="phase"/>
  <text x="364" y="115" text-anchor="middle" class="label">详细设计</text>
  <text x="364" y="132" text-anchor="middle" class="label-sm">第 5 周</text>
  <rect x="306" y="160" width="115" height="26" class="outcome"/>
  <text x="364" y="177" text-anchor="middle" class="label-sm">类图 / 流程图 / 接口文档</text>

  <!-- 阶段4：编码实现 -->
  <circle cx="500" cy="70" r="18" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="500" y="75" text-anchor="middle" class="num" style="fill:#64748b;">4</text>
  <rect x="447" y="95" width="105" height="55" class="phase"/>
  <text x="500" y="115" text-anchor="middle" class="label">编码实现</text>
  <text x="500" y="132" text-anchor="middle" class="label-sm">第 6-10 周</text>
  <rect x="442" y="160" width="115" height="26" class="outcome"/>
  <text x="500" y="177" text-anchor="middle" class="label-sm">源代码（Git 仓库）</text>

  <!-- 阶段5：综合测试 -->
  <circle cx="636" cy="70" r="18" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="636" y="75" text-anchor="middle" class="num" style="fill:#64748b;">5</text>
  <rect x="583" y="95" width="105" height="55" class="phase"/>
  <text x="636" y="115" text-anchor="middle" class="label">综合测试</text>
  <text x="636" y="132" text-anchor="middle" class="label-sm">第 11 周</text>
  <rect x="578" y="160" width="115" height="26" class="outcome"/>
  <text x="636" y="177" text-anchor="middle" class="label-sm">测试报告</text>

  <!-- 箭头 -->
  <line x1="145" y1="122" x2="175" y2="122" class="arrow"/>
  <line x1="280" y1="122" x2="311" y2="122" class="arrow"/>
  <line x1="416" y1="122" x2="447" y2="122" class="arrow"/>
  <line x1="552" y1="122" x2="583" y2="122" class="arrow"/>

  <!-- 底部：协作模式 -->
  <rect x="40" y="210" width="640" height="70" rx="10" fill="#fef9c3" stroke="#ca8a04" stroke-width="1"/>
  <text x="60" y="232" class="label" style="font-size:12px; fill:#854d0e;">🤝 协作模式：</text>
  <rect x="140" y="222" width="160" height="18" rx="4" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="220" y="235" text-anchor="middle" class="label-sm" style="fill:#854d0e;">赵：feat/zhao-work 分支 → PR 合入 main</text>
  <rect x="310" y="222" width="160" height="18" rx="4" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="390" y="235" text-anchor="middle" class="label-sm" style="fill:#854d0e;">胡：feat/hu-info 分支，JSONL 契约协作</text>
  <rect x="480" y="222" width="180" height="18" rx="4" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="570" y="235" text-anchor="middle" class="label-sm" style="fill:#854d0e;">公共外壳 → main 分支，影响两人</text>

  <text x="60" y="260" class="label-sm" style="fill:#854d0e;">🔁 迭代：每个阶段可回溯前序阶段修正，持续集成到 main 分支</text>
</svg>`;

fs.writeFileSync(path.join(outDir, 'fig1-architecture.svg'), diagram1);
fs.writeFileSync(path.join(outDir, 'fig2-rag-flow.svg'), diagram2);
fs.writeFileSync(path.join(outDir, 'fig3-dev-process.svg'), diagram3);

console.log('✅ 3 张图已生成到 docs/diagrams/');
console.log('   fig1-architecture.svg  — 技术路线分层架构图');
console.log('   fig2-rag-flow.svg      — RAG 算法流程图');
console.log('   fig3-dev-process.svg   — 研发流程框架图');

// 列出文件大小
fs.readdirSync(outDir).forEach(f => {
  const s = fs.statSync(path.join(outDir, f));
  console.log(`   ${f.padEnd(35)} ${(s.size/1024).toFixed(1)} KB`);
});
