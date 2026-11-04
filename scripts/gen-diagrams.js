/**
 * 生成开题答辩 PPT 所需的 3 张 SVG 图（优化版：更宽松、中文不换行）
 * 输出到 docs/diagrams/
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'docs', 'diagrams');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ========== 图1：技术路线分层架构图（更宽松版） ==========
const diagram1 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560" width="800" height="560">
  <defs>
    <style>
      .layer { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 2; rx: 14; }
      .box { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 10; }
      .box-accent { fill: #dcfce7; stroke: #16a34a; stroke-width: 1.5; rx: 10; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 15px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 13px; fill: #475569; }
      .layer-title { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 14px; fill: #16a34a; font-weight: 700; }
      .arrow { stroke: #64748b; stroke-width: 2.5; fill: none; marker-end: url(#arrowhead); }
      .ipc { stroke: #2563eb; stroke-width: 2; stroke-dasharray: 6 4; fill: none; }
      .diy-tag { fill: #fef9c3; stroke: #ca8a04; stroke-width: 1.5; rx: 12; }
    </style>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="400" y="32" text-anchor="middle" class="label" style="font-size:18px; fill:#16a34a;">智研台 Desk — 技术路线分层架构图</text>

  <!-- ===== 第一层：渲染层 ===== -->
  <rect x="40" y="55" width="720" height="120" class="layer"/>
  <text x="60" y="82" class="layer-title">渲染层（Vue 3 + TypeScript）</text>

  <!-- 工作模式 -->
  <rect x="75" y="95" width="215" height="62" class="box-accent"/>
  <text x="182" y="120" text-anchor="middle" class="label">工作模式</text>
  <text x="182" y="140" text-anchor="middle" class="label-sm">RAG 知识库 + Agent + 工作流</text>

  <!-- 信息模式 -->
  <rect x="308" y="95" width="215" height="62" class="box"/>
  <text x="415" y="120" text-anchor="middle" class="label">信息模式</text>
  <text x="415" y="140" text-anchor="middle" class="label-sm">多源采集 + 清洗</text>

  <!-- 公共外壳 -->
  <rect x="541" y="95" width="195" height="62" class="box"/>
  <text x="638" y="120" text-anchor="middle" class="label">公共外壳</text>
  <text x="638" y="140" text-anchor="middle" class="label-sm">侧栏 / 主题 / 托盘</text>

  <!-- IPC 虚线 -->
  <line x1="400" y1="175" x2="400" y2="200" class="ipc"/>
  <rect x="320" y="178" width="160" height="22" rx="11" fill="#dbeafe" stroke="#2563eb" stroke-width="1"/>
  <text x="400" y="194" text-anchor="middle" class="label-sm" style="fill:#1d4ed8; font-weight:600;">⬇ IPC 进程间通信</text>

  <!-- ===== 第二层：主进程核心引擎 ===== -->
  <rect x="40" y="205" width="720" height="165" class="layer"/>
  <text x="60" y="232" class="layer-title">主进程核心引擎（Node.js）</text>

  <!-- 5 个核心引擎模块，每个加宽 -->
  <rect x="55" y="248" width="130" height="55" class="box-accent"/>
  <text x="120" y="271" text-anchor="middle" class="label">Agent</text>
  <text x="120" y="288" text-anchor="middle" class="label-sm">Function Calling</text>

  <rect x="200" y="248" width="130" height="55" class="box-accent"/>
  <text x="265" y="271" text-anchor="middle" class="label">RAG 检索</text>
  <text x="265" y="288" text-anchor="middle" class="label-sm">BM25 相似度</text>

  <rect x="345" y="248" width="130" height="55" class="box-accent"/>
  <text x="410" y="271" text-anchor="middle" class="label">知识库</text>
  <text x="410" y="288" text-anchor="middle" class="label-sm">导入 / 切片 / 索引</text>

  <rect x="490" y="248" width="130" height="55" class="box-accent"/>
  <text x="555" y="271" text-anchor="middle" class="label">工作流引擎</text>
  <text x="555" y="288" text-anchor="middle" class="label-sm">DAG 节点执行</text>

  <rect x="635" y="248" width="110" height="55" class="box"/>
  <text x="690" y="271" text-anchor="middle" class="label">能力中心</text>
  <text x="690" y="288" text-anchor="middle" class="label-sm">7 工具 + DIY</text>

  <!-- DIY 亮点条（更宽更突出） -->
  <rect x="55" y="318" width="690" height="40" rx="20" class="diy-tag"/>
  <text x="400" y="343" text-anchor="middle" class="label" style="font-size:14px; fill:#854d0e; font-weight:700;">⭐ DIY 三层亮点 → ① L1 参数化模式  ② L2 工作流编排  ③ L3 自定义 HTTP 能力</text>

  <!-- 向下箭头 -->
  <line x1="400" y1="370" x2="400" y2="398" class="arrow"/>

  <!-- ===== 第三层：数据服务层 ===== -->
  <rect x="40" y="405" width="720" height="110" class="layer"/>
  <text x="60" y="432" class="layer-title">数据与服务层</text>

  <rect x="75" y="448" width="165" height="50" class="box"/>
  <text x="157" y="470" text-anchor="middle" class="label">云端 LLM API</text>
  <text x="157" y="486" text-anchor="middle" class="label-sm">DeepSeek / OpenAI 兼容</text>

  <rect x="258" y="448" width="165" height="50" class="box"/>
  <text x="340" y="470" text-anchor="middle" class="label">本地向量索引</text>
  <text x="340" y="486" text-anchor="middle" class="label-sm">BM25 + SQLite</text>

  <rect x="441" y="448" width="165" height="50" class="box"/>
  <text x="523" y="470" text-anchor="middle" class="label">本地文件系统</text>
  <text x="523" y="486" text-anchor="middle" class="label-sm">userData 隔离存储</text>

  <rect x="624" y="448" width="110" height="50" class="box"/>
  <text x="679" y="470" text-anchor="middle" class="label">HTTP 工具</text>
  <text x="679" y="486" text-anchor="middle" class="label-sm">搜索 / 抓网页</text>

  <!-- 底部图例 -->
  <rect x="40" y="528" width="720" height="24" rx="6" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="1"/>
  <rect x="55" y="533" width="14" height="14" fill="#dcfce7" stroke="#16a34a" stroke-width="1" rx="3"/>
  <text x="77" y="545" class="label-sm" style="fill:#475569;">主进程核心引擎模块（赵负责）</text>
  <rect x="260" y="533" width="14" height="14" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.5" rx="3"/>
  <text x="282" y="545" class="label-sm" style="fill:#475569;">DIY 三层可配置（本项目亮点）</text>
</svg>`;

// ========== 图2：RAG 算法流程图（更宽松版） ==========
const diagram2 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" width="800" height="420">
  <defs>
    <style>
      .node { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 12; }
      .node-in { fill: #fef3c7; stroke: #d97706; stroke-width: 1.5; rx: 12; }
      .node-core { fill: #dcfce7; stroke: #16a34a; stroke-width: 2; rx: 12; }
      .node-out { fill: #dbeafe; stroke: #2563eb; stroke-width: 1.5; rx: 12; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 14px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 12px; fill: #64748b; }
      .arrow { stroke: #64748b; stroke-width: 2.5; fill: none; marker-end: url(#rag-arrow); }
      .group-label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 13px; fill: #94a3b8; font-weight: 700; }
    </style>
    <marker id="rag-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="400" y="32" text-anchor="middle" class="label" style="font-size:18px; fill:#16a34a;">RAG 检索增强生成 — 流程图</text>

  <!-- ===== 左列：数据输入 + 预处理 ===== -->
  <text x="155" y="62" text-anchor="middle" class="group-label">📥 数据输入</text>
  <rect x="70" y="70" width="170" height="58" class="node-in"/>
  <text x="155" y="94" text-anchor="middle" class="label">文档导入</text>
  <text x="155" y="113" text-anchor="middle" class="label-sm">md / txt / pdf / 网页</text>

  <text x="155" y="150" text-anchor="middle" class="group-label">⚙️ 预处理</text>
  <rect x="70" y="158" width="170" height="54" class="node"/>
  <text x="155" y="181" text-anchor="middle" class="label">500 字切片</text>
  <text x="155" y="198" text-anchor="middle" class="label-sm">块间 80 字重叠</text>

  <rect x="70" y="225" width="170" height="54" class="node"/>
  <text x="155" y="248" text-anchor="middle" class="label">标题命中加权 1.3×</text>
  <text x="155" y="265" text-anchor="middle" class="label-sm">关键词加权提升召回</text>

  <rect x="70" y="292" width="170" height="54" class="node-core"/>
  <text x="155" y="315" text-anchor="middle" class="label">BM25 索引构建</text>
  <text x="155" y="332" text-anchor="middle" class="label-sm">纯 Node.js，无需 Python</text>

  <!-- ===== 中列：存储 + 查询 ===== -->
  <text x="400" y="62" text-anchor="middle" class="group-label">💾 存储</text>
  <rect x="315" y="70" width="170" height="58" class="node"/>
  <text x="400" y="94" text-anchor="middle" class="label">本地索引存储</text>
  <text x="400" y="113" text-anchor="middle" class="label-sm">SQLite 文件，轻量无服务</text>

  <text x="400" y="150" text-anchor="middle" class="group-label">🔍 查询</text>
  <rect x="315" y="158" width="170" height="54" class="node-in"/>
  <text x="400" y="181" text-anchor="middle" class="label">用户查询</text>
  <text x="400" y="198" text-anchor="middle" class="label-sm">自然语言问题</text>

  <rect x="315" y="225" width="170" height="54" class="node-core"/>
  <text x="400" y="248" text-anchor="middle" class="label">BM25 相似度检索</text>
  <text x="400" y="265" text-anchor="middle" class="label-sm">Top-K 相关片段召回</text>

  <!-- ===== 右列：生成 ===== -->
  <text x="645" y="62" text-anchor="middle" class="group-label">✨ 生成</text>
  <rect x="560" y="70" width="170" height="58" class="node"/>
  <text x="645" y="94" text-anchor="middle" class="label">拼接 Prompt</text>
  <text x="645" y="113" text-anchor="middle" class="label-sm">指令 + 检索片段 + 问题</text>

  <rect x="560" y="158" width="170" height="58" class="node-core"/>
  <text x="645" y="182" text-anchor="middle" class="label">LLM 生成</text>
  <text x="645" y="201" text-anchor="middle" class="label-sm">云端 API（DeepSeek 等）</text>

  <rect x="560" y="245" width="170" height="60" class="node-out"/>
  <text x="645" y="270" text-anchor="middle" class="label">带来源标注的回答</text>
  <text x="645" y="288" text-anchor="middle" class="label-sm">标注文档 + 片段位置</text>

  <!-- ===== 连接线 ===== -->
  <line x1="155" y1="128" x2="155" y2="158" class="arrow"/>
  <line x1="155" y1="212" x2="155" y2="225" class="arrow"/>
  <line x1="155" y1="279" x2="155" y2="292" class="arrow"/>
  <line x1="240" y1="319" x2="315" y2="252" class="arrow"/>
  <line x1="240" y1="99" x2="315" y2="99" class="arrow"/>
  <line x1="400" y1="128" x2="400" y2="158" class="arrow"/>
  <line x1="400" y1="212" x2="400" y2="225" class="arrow"/>
  <line x1="485" y1="252" x2="560" y2="99" class="arrow"/>
  <line x1="645" y1="128" x2="645" y2="158" class="arrow"/>
  <line x1="645" y1="216" x2="645" y2="245" class="arrow"/>

  <!-- 底部本地优先强调条 -->
  <rect x="70" y="365" width="660" height="36" rx="18" fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/>
  <text x="400" y="388" text-anchor="middle" class="label" style="font-size:13px; fill:#15803d; font-weight:700;">⭐ 本地优先：索引存在本机 SQLite，LLM 调用时才联网，敏感数据不出设备</text>
</svg>`;

// ========== 图3：研发流程框架图（更宽松版） ==========
const diagram3 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 340" width="800" height="340">
  <defs>
    <style>
      .phase { fill: #fff; stroke: #94a3b8; stroke-width: 1.5; rx: 12; }
      .phase-active { fill: #dcfce7; stroke: #16a34a; stroke-width: 2; rx: 12; }
      .outcome { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 1; rx: 8; }
      .label { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 14px; fill: #1f2937; font-weight: 600; }
      .label-sm { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 12px; fill: #64748b; }
      .arrow { stroke: #64748b; stroke-width: 2.5; fill: none; marker-end: url(#dev-arrow); }
      .num { font-family: Arial, sans-serif; font-size: 16px; fill: #16a34a; font-weight: 700; }
    </style>
    <marker id="dev-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="400" y="32" text-anchor="middle" class="label" style="font-size:18px; fill:#16a34a;">研发流程框架图</text>

  <!-- ===== 阶段1：需求分析 ===== -->
  <circle cx="100" cy="72" r="22" fill="#dcfce7" stroke="#16a34a" stroke-width="2.5"/>
  <text x="100" y="78" text-anchor="middle" class="num">1</text>
  <rect x="30" y="100" width="140" height="60" class="phase-active"/>
  <text x="100" y="124" text-anchor="middle" class="label">需求分析</text>
  <text x="100" y="142" text-anchor="middle" class="label-sm">第 2-3 周</text>
  <rect x="28" y="168" width="144" height="28" class="outcome"/>
  <text x="100" y="186" text-anchor="middle" class="label-sm">需求规格说明书</text>

  <!-- ===== 阶段2：概要设计 ===== -->
  <circle cx="260" cy="72" r="22" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="260" y="78" text-anchor="middle" class="num" style="fill:#64748b;">2</text>
  <rect x="190" y="100" width="140" height="60" class="phase"/>
  <text x="260" y="124" text-anchor="middle" class="label">概要设计</text>
  <text x="260" y="142" text-anchor="middle" class="label-sm">第 4 周</text>
  <rect x="188" y="168" width="144" height="28" class="outcome"/>
  <text x="260" y="186" text-anchor="middle" class="label-sm">模块结构图</text>

  <!-- ===== 阶段3：详细设计 ===== -->
  <circle cx="420" cy="72" r="22" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="420" y="78" text-anchor="middle" class="num" style="fill:#64748b;">3</text>
  <rect x="350" y="100" width="140" height="60" class="phase"/>
  <text x="420" y="124" text-anchor="middle" class="label">详细设计</text>
  <text x="420" y="142" text-anchor="middle" class="label-sm">第 5 周</text>
  <rect x="348" y="168" width="144" height="28" class="outcome"/>
  <text x="420" y="186" text-anchor="middle" class="label-sm">类图 / 流程图 / 接口文档</text>

  <!-- ===== 阶段4：编码实现 ===== -->
  <circle cx="580" cy="72" r="22" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="580" y="78" text-anchor="middle" class="num" style="fill:#64748b;">4</text>
  <rect x="510" y="100" width="140" height="60" class="phase"/>
  <text x="580" y="124" text-anchor="middle" class="label">编码实现</text>
  <text x="580" y="142" text-anchor="middle" class="label-sm">第 6-10 周</text>
  <rect x="508" y="168" width="144" height="28" class="outcome"/>
  <text x="580" y="186" text-anchor="middle" class="label-sm">源代码（Git 仓库）</text>

  <!-- ===== 阶段5：综合测试 ===== -->
  <circle cx="740" cy="72" r="22" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="740" y="78" text-anchor="middle" class="num" style="fill:#64748b;">5</text>
  <rect x="670" y="100" width="120" height="60" class="phase"/>
  <text x="730" y="124" text-anchor="middle" class="label">综合测试</text>
  <text x="730" y="142" text-anchor="middle" class="label-sm">第 11 周</text>
  <rect x="668" y="168" width="124" height="28" class="outcome"/>
  <text x="730" y="186" text-anchor="middle" class="label-sm">测试报告</text>

  <!-- ===== 阶段间箭头 ===== -->
  <line x1="170" y1="130" x2="190" y2="130" class="arrow"/>
  <line x1="330" y1="130" x2="350" y2="130" class="arrow"/>
  <line x1="490" y1="130" x2="510" y2="130" class="arrow"/>
  <line x1="650" y1="130" x2="670" y2="130" class="arrow"/>

  <!-- ===== 底部协作模式 ===== -->
  <rect x="30" y="215" width="740" height="95" rx="12" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.5"/>
  <text x="50" y="240" class="label" style="font-size:14px; fill:#854d0e;">🤝 协作模式：</text>

  <rect x="50" y="252" width="220" height="42" rx="10" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="160" y="270" text-anchor="middle" class="label-sm" style="fill:#854d0e;">赵：feat/zhao-work 分支</text>
  <text x="160" y="286" text-anchor="middle" class="label-sm" style="fill:#854d0e;">功能完成后 PR 合入 main</text>

  <rect x="285" y="252" width="220" height="42" rx="10" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="395" y="270" text-anchor="middle" class="label-sm" style="fill:#854d0e;">胡：feat/hu-info 分支</text>
  <text x="395" y="286" text-anchor="middle" class="label-sm" style="fill:#854d0e;">与赵通过 JSONL 契约协作</text>

  <rect x="520" y="252" width="240" height="42" rx="10" fill="#fefce8" stroke="#eab308" stroke-width="1"/>
  <text x="640" y="270" text-anchor="middle" class="label-sm" style="fill:#854d0e;">公共外壳改动 → main 分支</text>
  <text x="640" y="286" text-anchor="middle" class="label-sm" style="fill:#854d0e;">影响两人，需同步沟通</text>

  <text x="50" y="328" class="label-sm" style="fill:#854d0e;">🔁 每个阶段可回溯前序阶段修正，迭代式开发，持续集成到 main 分支</text>
</svg>`;

fs.writeFileSync(path.join(outDir, 'fig1-architecture.svg'), diagram1);
fs.writeFileSync(path.join(outDir, 'fig2-rag-flow.svg'), diagram2);
fs.writeFileSync(path.join(outDir, 'fig3-dev-process.svg'), diagram3);

console.log('✅ 3 张图已优化并重新生成到 docs/diagrams/');
console.log('   优化点：viewBox 加大、方框加宽、层间距增加、中文不换行');
fs.readdirSync(outDir).forEach(f => {
  const s = fs.statSync(path.join(outDir, f));
  console.log(`   ${f.padEnd(35)} ${(s.size/1024).toFixed(1)} KB`);
});
