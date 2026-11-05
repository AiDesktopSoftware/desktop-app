/**
 * 开题答辩 PPT · 学术版（白底、深蓝、衬线标题）
 */
const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
const SLIDE_W = 10, SLIDE_H = 5.625;
const M = 0.5, CW = SLIDE_W - 2*M;

// ===== 学术风配色 =====
const C = {
  navy:    '1E3A5F',  // 深蓝主色（标题、强调）
  blue:    '2563EB',  // 亮蓝（链接、次强调）
  slate:   '334155',  // 深灰蓝（正文标题）
  text:    '1F2937',  // 正文
  dim:     '64748B',  // 次要文字
  border:  'CBD5E1',  // 边框
  bg:      'F8FAFC',  // 浅底
  green:   '16A34A',  // 已完成项（低调深绿）
  accent:  '475569',  // 强调灰（替代黄色，低调）
  divider: 'E2E8F0',
};
const TF = 'Cambria';        // 衬线标题（serif）
const BF = 'Calibri';        // 正文

// ===== HELPER =====
function newSlide() {
  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };
  // 顶部细线 + 左侧装饰竖线
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.06, fill: { color: C.navy }, line: { color: C.navy } });
  return s;
}
function title(s, main, sub) {
  // 左侧装饰竖线
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 0.05, w: 0.08, h: 0.55, fill: { color: C.navy }, line: { color: C.navy } });
  s.addText(main, { x: M + 0.2, y: M, w: 8, h: 0.6, fontSize: 28, bold: true, fontFace: TF, color: C.navy, charSpacing: 1 });
  if (sub) s.addText(sub, { x: M + 0.2, y: M + 0.55, w: 8, h: 0.3, fontSize: 13, fontFace: BF, color: C.dim });
  // 底部分隔线
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 0.92, w: CW, h: 0.015, fill: { color: C.divider }, line: { color: C.divider } });
}
function num(s, n, total) {
  s.addText(n + ' / ' + total, { x: SLIDE_W - 0.8, y: SLIDE_H - 0.35, w: 0.7, h: 0.25, fontSize: 9, fontFace: BF, color: C.dim, align: 'right' });
}
function box(s, x, y, w, h, opts) {
  opts = opts || {};
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h,
    fill: opts.fill || { color: 'FFFFFF' }, line: { color: opts.border || C.border, width: 1 }, radius: 0.05 });
}
function tag(s, text, x, y, color) {
  const w = text.length * 0.13 + 0.2;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.28, fill: { color: color + '20' }, line: { color, width: 1 }, radius: 0.04 });
  s.addText(text, { x, y: y + 0.02, w, h: 0.24, fontSize: 9, bold: true, fontFace: BF, color, align: 'center' });
}
const TOTAL = 11;

// ===== Slide 1: COVER =====
(function() {
  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.navy }, line: { color: C.navy } });

  s.addText('软件工程项目开题报告', { x: 1, y: 0.8, w: 8, h: 0.6, fontSize: 16, fontFace: BF, color: C.dim, align: 'center' });
  s.addText('面向研究场景的本地优先 AI 桌面助手', { x: 1, y: 1.3, w: 8, h: 0.4, fontSize: 14, italic: true, fontFace: TF, color: C.blue, align: 'center' });
  s.addText('智研台 Desk', { x: 1, y: 1.85, w: 8, h: 1.2, fontSize: 54, bold: true, fontFace: TF, color: C.navy, align: 'center', charSpacing: 3 });

  s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 3.15, w: 3, h: 0.02, fill: { color: C.navy }, line: { color: C.navy } });

  s.addText('项目名称', { x: 2, y: 3.35, w: 2, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim });
  s.addText('智研台 Desk — AI 多源信息采集与研究助手', { x: 4, y: 3.35, w: 5, h: 0.3, fontSize: 11, fontFace: BF, color: C.text });

  s.addText('课程名称', { x: 2, y: 3.7, w: 2, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim });
  s.addText('高级软件工程', { x: 4, y: 3.7, w: 5, h: 0.3, fontSize: 11, fontFace: BF, color: C.text });

  s.addText('小组成员', { x: 2, y: 4.05, w: 2, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim });
  s.addText('赵（研究侧 · 核心引擎 + 工作模式）    胡（数据侧 · 采集清洗 + 信息模式）', { x: 4, y: 4.05, w: 5.5, h: 0.3, fontSize: 11, fontFace: BF, color: C.text });

  s.addText('指导教师', { x: 2, y: 4.4, w: 2, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim });
  s.addText('吴云', { x: 4, y: 4.4, w: 5, h: 0.3, fontSize: 11, fontFace: BF, color: C.text });

  s.addText('2026 年 11 月', { x: 1, y: 5.0, w: 8, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim, align: 'center' });
})();

// ===== Slide 2: AGENDA =====
(function() {
  const s = newSlide();
  title(s, '汇报提纲', 'Agenda');
  const items = [
    ['一', '基本情况', '项目组成员、分工、研究内容简介'],
    ['二', '立论依据', '研究背景与意义、国内外研究现状、参考文献'],
    ['三', '研究方案', '目标与内容、技术路线、算法设计、可行性分析、研究计划、预期成果'],
    ['四', '特色与创新点', 'DIY 三层可配置、本地优先、端到端研究辅助'],
  ];
  items.forEach((it, i) => {
    const y = M + 1.2 + i * 1.05;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y, w: CW, h: 0.9, fill: { color: C.bg }, line: { color: C.border }, radius: 0.04 });
    s.addShape(pres.shapes.OVAL, { x: M + 0.15, y: y + 0.2, w: 0.5, h: 0.5, fill: { color: C.navy }, line: { color: C.navy } });
    s.addText(it[0], { x: M + 0.15, y: y + 0.2, w: 0.5, h: 0.5, fontSize: 14, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addText(it[1], { x: M + 0.8, y: y + 0.15, w: 3, h: 0.35, fontSize: 16, bold: true, fontFace: TF, color: C.navy });
    s.addText(it[2], { x: M + 0.8, y: y + 0.5, w: CW - 1.0, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim });
  });
  num(s, 2, TOTAL);
})();

// ===== Slide 3: 一、基本情况 =====
(function() {
  const s = newSlide();
  title(s, '一、基本情况', '团队成员与分工');

  s.addText('1. 项目组成员与分工', { x: M, y: M + 1.1, w: 4, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.slate });

  // 表头
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 1.45, w: CW, h: 0.32, fill: { color: C.navy }, line: { color: C.navy } });
  ['姓名', '模块', '核心职责'].forEach((h, i) => {
    const w = i === 0 ? 1.0 : i === 1 ? 2.2 : CW - 3.2;
    const x = M + (i === 0 ? 0.1 : i === 1 ? 1.1 : 3.3);
    s.addText(h, { x, y: M + 1.45, w, h: 0.32, fontSize: 11, bold: true, fontFace: BF, color: 'FFFFFF', valign: 'middle' });
  });

  const rows = [
    { name: '赵', module: '工作模式\n(views/work/)', duties: '主进程核心引擎：Agent、RAG 检索、知识库、工作流编排、研究报告生成\n对接云端 LLM API（OpenAI 兼容，如 DeepSeek）\n开发分支：feat/zhao-work', tag: C.green },
    { name: '胡', module: '信息模式\n(views/info/)', duties: '多源信息采集、爬虫、正文抽取、去重清洗\n按约定 JSONL 契约交付清洗后的数据\n开发分支：feat/hu-info', tag: C.accent },
  ];
  rows.forEach((r, i) => {
    const y = M + 1.77 + i * 1.0;
    s.addShape(pres.shapes.RECTANGLE, { x: M, y, w: CW, h: 0.95, fill: { color: i % 2 === 0 ? 'FFFFFF' : C.bg }, line: { color: C.border } });
    s.addText(r.name, { x: M + 0.1, y: y + 0.05, w: 0.9, h: 0.85, fontSize: 14, bold: true, fontFace: TF, color: r.tag, valign: 'middle' });
    s.addText(r.module, { x: M + 1.1, y: y + 0.05, w: 2.1, h: 0.85, fontSize: 11, fontFace: BF, color: C.text, valign: 'middle' });
    s.addText(r.duties, { x: M + 3.3, y: y + 0.1, w: CW - 3.5, h: 0.8, fontSize: 10.5, fontFace: BF, color: C.text });
  });

  // 研究简介
  s.addText('2. 项目研究内容简介', { x: M, y: M + 3.9, w: 4, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.slate });
  s.addText('本项目为一款本地优先的桌面端 AI 研究助手。研究侧（赵）负责主进程核心引擎，包括 Agent 工具调用、本地 RAG 知识库、可配置研究工作流编排和研究报告自动生成；数据侧（胡）负责多源信息采集与清洗，按 JSONL 数据契约交付。数据链路：胡采集 → 赵分析 → 云端大模型生成 → 输出研究报告。',
    { x: M, y: M + 4.25, w: CW, h: 1.0, fontSize: 11, fontFace: BF, color: C.text });
  num(s, 3, TOTAL);
})();

// ===== Slide 4: 背景意义 =====
(function() {
  const s = newSlide();
  title(s, '二、立论依据', '2-1 项目的研究背景和意义');

  s.addText('【研究背景】', { x: M, y: M + 1.1, w: 3, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });
  s.addText('在学术研究与行业调研场景中，研究人员需要面对海量多源信息（网页、学术论文、技术文档、本地文件等）。现有 AI 助手产品大多以 SaaS 形式提供服务，存在三方面局限：',
    { x: M, y: M + 1.4, w: CW, h: 0.7, fontSize: 11, fontFace: BF, color: C.text });

  const problems = [
    { t: '隐私安全风险', d: 'SaaS 平台要求上传敏感研究数据（选题、笔记、未发表成果），存在泄露隐患' },
    { t: '离线不可用', d: '无网络或网络受限环境下完全无法使用，断网即断辅助' },
    { t: '定制能力弱', d: '通用 AI 助手难以适配特定研究领域的检索策略、分析框架与报告格式' },
    { t: '成本持续累积', d: '按次/按量计费，长期高频使用下费用可观' },
  ];
  problems.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (CW / 2 + 0.05), y = M + 2.15 + row * 1.35;
    box(s, x, y, CW / 2 - 0.05, 1.2);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: CW / 2 - 0.05, h: 0.08, fill: { color: C.navy }, line: { color: C.navy } });
    s.addText(p.t, { x: x + 0.15, y: y + 0.2, w: CW / 2 - 0.35, h: 0.35, fontSize: 13, bold: true, fontFace: TF, color: C.navy });
    s.addText(p.d, { x: x + 0.15, y: y + 0.58, w: CW / 2 - 0.35, h: 0.55, fontSize: 10.5, fontFace: BF, color: C.dim });
  });

  s.addText('【研究意义】', { x: M, y: M + 4.85, w: 3, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });
  s.addText('构建本地优先的桌面端研究助手，核心价值在于：① 数据本地化存储，敏感信息不出本机；② 端到端覆盖采集→分析→报告完整研究链路；③ 架构可配置，DIY 三层设计（参数化模式 / 工作流编排 / 自定义能力）适配不同场景。',
    { x: M, y: M + 5.1, w: CW, h: 0.45, fontSize: 11, fontFace: BF, color: C.text });
  num(s, 4, TOTAL);
})();

// ===== Slide 5: 研究现状 =====
(function() {
  const s = newSlide();
  title(s, '二、立论依据', '2-2 项目的研究现状及分析');

  s.addText('【同类产品对比分析】', { x: M, y: M + 1.1, w: 4, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });

  // 表头
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 1.5, w: CW, h: 0.32, fill: { color: C.navy }, line: { color: C.navy } });
  ['产品', '形态', '优势', '不足'].forEach((h, i) => {
    const w = i === 0 ? 1.3 : i === 1 ? 1.3 : i === 2 ? 2.5 : CW - 5.1;
    const x = M + (i === 0 ? 0.1 : i === 1 ? 1.4 : i === 2 ? 2.7 : 5.2);
    s.addText(h, { x, y: M + 1.5, w, h: 0.32, fontSize: 11, bold: true, fontFace: BF, color: 'FFFFFF', valign: 'middle' });
  });

  const rows = [
    ['Perplexity', 'SaaS 网页', '多源检索质量好、带来源标注', '数据上云、按次计费、无离线'],
    ['Claude.ai', 'SaaS 网页', '长上下文、强代码能力', '无法接入本地知识库'],
    ['Dify', '开源平台', '可视化 RAG 工作流', '需部署后端、架构偏重'],
    ['Obsidian RAG', '本地笔记', '本地存储、插件生态', '需手动组装、无 Agent 闭环'],
    ['Codex / Trae', '桌面应用', 'Agent 工具闭环、DIY 配置', '面向编程场景，非研究场景'],
  ];
  rows.forEach((row, i) => {
    const y = M + 1.82 + i * 0.55;
    s.addShape(pres.shapes.RECTANGLE, { x: M, y, w: CW, h: 0.52, fill: { color: i % 2 === 0 ? 'FFFFFF' : C.bg }, line: { color: C.border } });
    row.forEach((cell, j) => {
      const w = j === 0 ? 1.2 : j === 1 ? 1.3 : j === 2 ? 2.5 : CW - 5.1;
      const x = M + (j === 0 ? 0.1 : j === 1 ? 1.4 : j === 2 ? 2.7 : 5.2);
      s.addText(cell, { x, y: y + 0.05, w, h: 0.42, fontSize: 10.5, fontFace: BF, color: j === 3 ? 'B85042' : C.text, valign: 'middle' });
    });
  });

  s.addText('通过对比可见，目前市场缺乏一款面向研究场景、本地优先、架构可配置的桌面 AI 助手。本项目借鉴 Codex/Trae 的成功架构，专注于研究辅助场景的垂直优化。',
    { x: M, y: M + 4.75, w: CW, h: 0.5, fontSize: 11, fontFace: BF, color: C.text, italic: true });

  s.addText('【参考文献】', { x: M, y: M + 5.25, w: 3, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });
  s.addText('[1] Lewis P, Perez E. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks[J]. NeurIPS, 2020.\n[2] Karpukhin V, et al. Dense Passage Retrieval for Open-Domain Question Answering[J]. EMNLP, 2020.\n[3] Electron. Electron Documentation[EB/OL]. https://www.electronjs.org/docs, 2025.',
    { x: M, y: M + 5.05, w: CW, h: 0.55, fontSize: 9, fontFace: BF, color: C.dim });
  num(s, 5, TOTAL);
})();

// ===== Slide 6: 技术路线（架构图 + 主界面截图） =====
(function() {
  const s = newSlide();
  title(s, '三、研究方案', '3-1 研究目标、内容与技术路线');

  // 左：原生 shapes 三层架构
  const ax = M, ay = M + 1.1, aw = 5.2;

  // 渲染层
  box(s, ax, ay, aw, 0.9, { fill: C.bg });
  s.addText('渲染层（Vue 3 + TypeScript）', { x: ax + 0.12, y: ay + 0.08, w: 4, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.navy });
  const l1y = ay + 0.4;
  box(s, ax + 0.12, l1y, 1.45, 0.38, { border: C.navy });
  s.addText('工作模式', { x: ax + 0.12, y: l1y + 0.04, w: 1.45, h: 0.3, fontSize: 10, bold: true, fontFace: BF, color: C.navy, align: 'center' });
  box(s, ax + 1.65, l1y, 1.45, 0.38);
  s.addText('信息模式', { x: ax + 1.65, y: l1y + 0.04, w: 1.45, h: 0.3, fontSize: 10, fontFace: BF, color: C.text, align: 'center' });
  box(s, ax + 3.18, l1y, 1.85, 0.38);
  s.addText('公共外壳', { x: ax + 3.18, y: l1y + 0.04, w: 1.85, h: 0.3, fontSize: 10, fontFace: BF, color: C.text, align: 'center' });
  s.addText('IPC 进程间通信 ⬇', { x: ax + aw/2 - 0.7, y: ay + 0.98, w: 1.4, h: 0.25, fontSize: 9, fontFace: BF, color: C.blue, align: 'center' });

  // 主进程层
  box(s, ax, ay + 1.25, aw, 1.6, { fill: C.bg });
  s.addText('主进程核心引擎（Node.js）', { x: ax + 0.12, y: ay + 1.33, w: 4, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.navy });
  const l2y = ay + 1.67;
  const mods = ['Agent', 'RAG 检索', '知识库', '工作流引擎', '能力中心'];
  const modW = (aw - 0.24) / 5;
  mods.forEach((m, i) => {
    box(s, ax + 0.12 + i * (modW + 0.03), l2y, modW - 0.03, 0.36, { border: C.navy });
    s.addText(m, { x: ax + 0.12 + i * (modW + 0.03), y: l2y + 0.05, w: modW - 0.03, h: 0.28, fontSize: 9.5, bold: true, fontFace: BF, color: C.navy, align: 'center' });
  });
  // DIY 亮点条：深蓝底白字，低调学术
  box(s, ax + 0.12, l2y + 0.44, aw - 0.24, 0.34, { fill: C.navy, border: C.navy });
  s.addText('★ DIY 三层可配置 → L1 参数化  |  L2 工作流编排  |  L3 自定义 HTTP',
    { x: ax + 0.2, y: l2y + 0.48, w: aw - 0.4, h: 0.26, fontSize: 9.5, bold: true, fontFace: BF, color: 'FFFFFF', align: 'center' });

  // 数据层
  box(s, ax, ay + 3.0, aw, 0.8, { fill: C.bg });
  s.addText('数据与服务层', { x: ax + 0.12, y: ay + 3.08, w: 3, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.navy });
  const l3y = ay + 3.38;
  const dmods = ['云端 LLM API', '本地向量索引', '本地文件系统', 'HTTP 工具'];
  const dw = (aw - 0.24) / 4;
  dmods.forEach((m, i) => {
    box(s, ax + 0.12 + i * (dw + 0.03), l3y, dw - 0.03, 0.34);
    s.addText(m, { x: ax + 0.12 + i * (dw + 0.03), y: l3y + 0.05, w: dw - 0.03, h: 0.26, fontSize: 9, fontFace: BF, color: C.text, align: 'center' });
  });

  // 右：主界面截图
  const rx = ax + aw + 0.25;
  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-1-main.png'),
    x: rx, y: ay, w: SLIDE_W - M - rx - M, h: 2.85 });
  s.addText('图 1 — 已实现的渲染层界面（工作模式主界面）', { x: rx, y: ay + 2.9, w: SLIDE_W - M - rx - M, h: 0.25, fontSize: 9, fontFace: BF, color: C.dim, align: 'center', italic: true });

  // 研究目标一句话（放在架构图下方，留够空间）
  box(s, M, ay + 3.92, CW, 0.55, { fill: C.bg, border: C.navy });
  s.addText('研究目标：构建本地优先的桌面端 AI 研究助手，实现从多源采集 → RAG 检索 → Agent 分析 → 研究报告生成的端到端闭环。',
    { x: M + 0.15, y: ay + 3.96, w: CW - 0.3, h: 0.47, fontSize: 10.5, bold: true, fontFace: BF, color: C.slate });
  num(s, 6, TOTAL);
})();

// ===== Slide 7: 算法设计 + DIY 亮点 =====
(function() {
  const s = newSlide();
  title(s, '三、研究方案', '3-1 算法设计');

  // RAG 流程图
  const fy = M + 1.1;
  s.addText('核心算法一：RAG 检索增强生成', { x: M, y: fy, w: 5, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });
  const ragY = fy + 0.4, ragW = (CW - 0.5) / 5;
  const ragNodes = [
    { t: '文档输入', c: C.bg, bc: C.border },
    { t: '500 字切片\n块间 80 字重叠', c: 'FFFFFF', bc: C.border },
    { t: 'BM25 索引构建', c: 'DBEAFE', bc: C.blue },
    { t: '相似度检索\nTop-K 片段召回', c: 'DBEAFE', bc: C.blue },
    { t: 'LLM 生成回答\n标注来源引用', c: C.bg, bc: C.navy }];
  ragNodes.forEach((n, i) => {
    const nx = M + i * (ragW + 0.1);
    box(s, nx, ragY, ragW - 0.05, 0.9, { fill: n.c, border: n.bc });
    s.addText(n.t, { x: nx, y: ragY + 0.12, w: ragW - 0.05, h: 0.66, fontSize: 9.5, bold: i >= 2, fontFace: BF, color: C.text, align: 'center', valign: 'middle' });
    if (i < ragNodes.length - 1) {
      s.addShape(pres.shapes.RIGHT_ARROW, { x: nx + ragW - 0.03, y: ragY + 0.38, w: 0.13, h: 0.14, fill: { color: C.blue }, line: { color: C.blue } });
    }
  });
  s.addText('注：BM25 算法纯 Node.js 实现，无外部 Python 依赖；标题命中加权 1.3 倍提升召回质量。',
    { x: M, y: ragY + 0.95, w: CW, h: 0.35, fontSize: 9, fontFace: BF, color: C.dim, italic: true });

  // DIY 三层 + 截图
  const diyY = ragY + 1.55;
  s.addText('核心机制：DIY 三层可配置设计（项目亮点）', { x: M, y: diyY, w: 6, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.navy });
  const shotY = diyY + 0.35, shotH = 1.35, shotW = (CW - 0.4) / 3;

  const diys = [
    { cap: 'L1 参数化模式', desc: '内置 4 个模式，可改提示词/工具白名单/温度', img: 'screenshot-3-prefs.png' },
    { cap: 'L2 工作流编排', desc: '内置 3 个研究模板，步骤可编辑/试运行/冻结', img: 'screenshot-5-workflow.png' },
    { cap: 'L3 自定义 HTTP 能力', desc: '填 HTTP 接口即可注册新工具，Agent 自动调用', img: 'screenshot-4-capability.png' },
  ];
  diys.forEach((d, i) => {
    const x = M + i * (shotW + 0.1);
    s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', d.img), x, y: shotY, w: shotW - 0.1, h: shotH });
    s.addText(d.cap, { x, y: shotY + shotH + 0.02, w: shotW - 0.1, h: 0.28, fontSize: 10.5, bold: true, fontFace: BF, color: C.navy });
    s.addText(d.desc, { x, y: shotY + shotH + 0.3, w: shotW - 0.1, h: 0.45, fontSize: 9, fontFace: BF, color: C.dim });
  });
  num(s, 7, TOTAL);
})();

// ===== Slide 8: 可行性 + 半成品 =====
(function() {
  const s = newSlide();
  title(s, '三、研究方案', '3-1 可行性分析（含半成品原型）');

  // 大字数据
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: M + 1.1, w: CW * 0.42, h: 1.0, fill: { color: C.navy }, line: { color: C.navy }, radius: 0.05 });
  s.addText('40+', { x: M, y: M + 1.15, w: CW * 0.21 - 0.05, h: 0.55, fontSize: 28, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center' });
  s.addText('源文件', { x: M, y: M + 1.65, w: CW * 0.21 - 0.05, h: 0.3, fontSize: 10, fontFace: BF, color: '94A3B8', align: 'center' });
  s.addText('20+', { x: M + CW * 0.21 + 0.05, y: M + 1.15, w: CW * 0.21 - 0.05, h: 0.55, fontSize: 28, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center' });
  s.addText('Git commits', { x: M + CW * 0.21 + 0.05, y: M + 1.65, w: CW * 0.21 - 0.05, h: 0.3, fontSize: 10, fontFace: BF, color: '94A3B8', align: 'center' });

  // 已完成清单
  const listX = M + CW * 0.42 + 0.15;
  s.addText('已实现的半成品功能', { x: listX, y: M + 1.15, w: CW * 0.56, h: 0.3, fontSize: 11, bold: true, fontFace: BF, color: C.green });
  const dones = [
    'Electron 骨架 + Vue3 双模式切换 + 自绘深色标题栏',
    'Agent Function Calling 工具循环（6 工具 + 安全护栏）',
    '本地 BM25 知识库（导入→检索→带来源标注）',
    'DIY 三层架构（模式 + 工作流 + 自定义 HTTP 能力）',
    '消息全套操作（分支 / 修改 / 删除 / 重新生成）',
    'Ctrl+Shift+P 命令面板 + @ 自动补全',
    '系统托盘（关闭窗口后台保留）',
    '静态审计修复（deny 模式危险工具拦截 bug）',
  ];
  dones.forEach((d, i) => {
    s.addText('✓  ' + d, { x: listX, y: M + 1.5 + i * 0.2, w: CW * 0.56, h: 0.2, fontSize: 9, fontFace: BF, color: C.text });
  });

  // 右：2 张截图
  const sx = M, shotH = 1.55, shotW = CW * 0.47;
  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-2-panel.png'), x: sx, y: M + 2.4, w: shotW, h: shotH });
  s.addText('图 2 — 本地知识库已导入文档，支持来源溯源', { x: sx, y: M + 2.4 + shotH, w: shotW, h: 0.25, fontSize: 9, fontFace: BF, color: C.dim, align: 'center', italic: true });

  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-6-result.png'), x: M + CW * 0.53, y: M + 2.4, w: shotW, h: shotH });
  s.addText('图 3 — Agent 执行闭环：检索来源 → 轨迹 → 3 份产物可导出', { x: M + CW * 0.53, y: M + 2.4 + shotH, w: shotW, h: 0.25, fontSize: 9, fontFace: BF, color: C.dim, align: 'center', italic: true });

  // 结论
  box(s, M, M + 4.3, CW, 0.6, { fill: C.bg, border: C.border });
  s.addText('结论：核心技术链路已完整跑通，上述功能均已在本地环境验证可用，证明技术路线完全可行。后续开发主要是功能扩展与体验打磨。',
    { x: M + 0.15, y: M + 4.35, w: CW - 0.3, h: 0.5, fontSize: 11, bold: true, fontFace: BF, color: C.slate });
  num(s, 8, TOTAL);
})();

// ===== Slide 9: 研发流程 + 预期文档 =====
(function() {
  const s = newSlide();
  title(s, '三、研究方案', '3-2 研究计划 · 3-3 研发流程 · 3-4 预期成果');

  // 5 阶段横排
  const fy = M + 1.1;
  const stages = [
    { n: '1', t: '需求分析', w: '第 2-3 周', out: '需求规格说明书', active: true },
    { n: '2', t: '概要设计', w: '第 4 周', out: '模块结构图' },
    { n: '3', t: '详细设计', w: '第 5 周', out: '类图 / 接口文档' },
    { n: '4', t: '编码实现', w: '第 6-10 周', out: '源代码（Git）' },
    { n: '5', t: '综合测试', w: '第 11 周', out: '测试报告' }];
  const sw = (CW - 0.4) / 5;
  stages.forEach((st, i) => {
    const sx = M + i * (sw + 0.1);
    // 编号圆
    s.addShape(pres.shapes.OVAL, { x: sx + sw/2 - 0.17, y: fy, w: 0.34, h: 0.34, fill: { color: st.active ? C.navy : C.border }, line: { color: st.active ? C.navy : C.border } });
    s.addText(st.n, { x: sx + sw/2 - 0.17, y: fy + 0.02, w: 0.34, h: 0.34, fontSize: 11, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', valign: 'middle' });
    // 阶段框
    box(s, sx, fy + 0.4, sw - 0.05, 0.55, { fill: st.active ? C.bg : 'FFFFFF', border: st.active ? C.navy : C.border });
    s.addText(st.t, { x: sx, y: fy + 0.42, w: sw - 0.05, h: 0.3, fontSize: 10.5, bold: true, fontFace: BF, color: C.text, align: 'center' });
    s.addText(st.w, { x: sx, y: fy + 0.68, w: sw - 0.05, h: 0.22, fontSize: 8.5, fontFace: BF, color: C.dim, align: 'center' });
    // 产出
    box(s, sx - 0.02, fy + 1.0, sw + 0.02, 0.32, { fill: C.bg, border: C.border });
    s.addText(st.out, { x: sx - 0.02, y: fy + 1.02, w: sw + 0.02, h: 0.28, fontSize: 8.5, fontFace: BF, color: C.dim, align: 'center' });
    // 箭头
    if (i < stages.length - 1) {
      s.addShape(pres.shapes.RIGHT_ARROW, { x: sx + sw - 0.02, y: fy + 0.58, w: 0.14, h: 0.14, fill: { color: C.blue }, line: { color: C.blue } });
    }
  });

  // 底部：协作 + 文档
  const by = fy + 1.55;
  box(s, M, by, CW / 2 - 0.1, 1.1);
  s.addText('协作模式', { x: M + 0.15, y: by + 0.1, w: CW / 2 - 0.3, h: 0.3, fontSize: 12, bold: true, fontFace: TF, color: C.navy });
  s.addText('赵：feat/zhao-work → PR 合入 main', { x: M + 0.15, y: by + 0.45, w: CW / 2 - 0.3, h: 0.22, fontSize: 10, fontFace: BF, color: C.text });
  s.addText('胡：feat/hu-info，通过 JSONL 契约协作', { x: M + 0.15, y: by + 0.67, w: CW / 2 - 0.3, h: 0.22, fontSize: 10, fontFace: BF, color: C.text });
  s.addText('公共外壳改动 → main 分支（影响两人）', { x: M + 0.15, y: by + 0.89, w: CW / 2 - 0.3, h: 0.22, fontSize: 10, fontFace: BF, color: C.text });

  box(s, M + CW / 2 + 0.1, by, CW / 2 - 0.1, 1.1);
  s.addText('预期文档清单', { x: M + CW / 2 + 0.25, y: by + 0.1, w: CW / 2 - 0.3, h: 0.3, fontSize: 12, bold: true, fontFace: TF, color: C.navy });
  const docs = ['需求规格说明书', '设计文档（总体 + 详细 + 数据库）', '测试报告（单元 + 系统）', '用户说明书 + GitHub README'];
  docs.forEach((d, i) => {
    s.addText('▸  ' + d, { x: M + CW / 2 + 0.25, y: by + 0.45 + i * 0.18, w: CW / 2 - 0.3, h: 0.18, fontSize: 9.5, fontFace: BF, color: C.text });
  });
  num(s, 9, TOTAL);
})();

// ===== Slide 10: 特色创新 =====
(function() {
  const s = newSlide();
  title(s, '四、项目的特色和创新点', '');

  const features = [
    { t: '本地优先的隐私保护架构', d: '知识库、检索索引、对话记录全部存储于本机 userData 目录，敏感研究数据不出设备；仅 LLM 调用时产生网络请求。' },
    { t: 'DIY 三层可配置设计哲学', d: '借鉴 Codex/Trae，将 Agent 能力拆解为 L1 参数化模式、L2 工作流编排、L3 自定义 HTTP 能力三层可配置组件。' },
    { t: '面向研究场景的端到端覆盖', d: '从多源采集 → RAG 检索 → Agent 分析 → 研究报告生成，一个工具覆盖完整研究辅助链路。' },
    { t: '轻量无 Python 依赖的本地检索', d: 'BM25 算法纯 Node.js 实现，SQLite 文件存储索引，免去 Python 运行时和向量数据库服务的部署负担。' },
    { t: '双模块松耦合协作', d: '研究侧（Agent/RAG/工作流）与数据侧（采集/清洗）通过 JSONL 数据契约协作，接口清晰、独立开发、独立交付。' },
    { t: '半成品原型已验证可行性', d: '40+ 源文件、20+ 次 commit，核心链路全部跑通并截图记录，开题时已具备可演示的半成品系统。' },
  ];
  const fc = 2;
  features.forEach((f, i) => {
    const col = i % fc, row = Math.floor(i / fc);
    const x = M + col * (CW / fc + 0.08), y = M + 1.1 + row * 1.45;
    box(s, x, y, CW / fc - 0.05, 1.35);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h: 1.35, fill: { color: C.navy }, line: { color: C.navy } });
    s.addText(f.t, { x: x + 0.2, y: y + 0.1, w: CW / fc - 0.35, h: 0.35, fontSize: 13, bold: true, fontFace: TF, color: C.navy });
    s.addText(f.d, { x: x + 0.2, y: y + 0.5, w: CW / fc - 0.35, h: 0.75, fontSize: 10.5, fontFace: BF, color: C.text });
  });
  num(s, 10, TOTAL);
})();

// ===== Slide 11: THANK YOU =====
(function() {
  const s = pres.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.navy }, line: { color: C.navy } });
  s.addText('感谢各位老师的聆听', { x: 1, y: 2.0, w: 8, h: 0.8, fontSize: 32, bold: true, fontFace: TF, color: C.navy, align: 'center', charSpacing: 2 });
  s.addText('恳请批评指正', { x: 1, y: 2.9, w: 8, h: 0.4, fontSize: 16, fontFace: BF, color: C.blue, align: 'center' });
  s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 3.5, w: 3, h: 0.02, fill: { color: C.border }, line: { color: C.border } });
  s.addText('指导教师：吴云    小组成员：赵、胡', { x: 1, y: 3.7, w: 8, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim, align: 'center' });
  s.addText('智研台 Desk — AI 多源信息采集与研究助手', { x: 1, y: 4.1, w: 8, h: 0.3, fontSize: 11, fontFace: BF, color: C.dim, align: 'center', italic: true });
})();

// ===== OUTPUT =====
const outDir = path.join(__dirname, '..', 'docs', 'proposal-ppt');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '开题答辩-智研台Desk.pptx');

pres.writeFile({ fileName: outPath }).then(() => {
  const stat = fs.statSync(outPath);
  console.log('✅ 学术版 PPT 已生成: ' + outPath);
  console.log('   文件大小: ' + (stat.size / 1024).toFixed(1) + ' KB');
  console.log('   总页数: ' + TOTAL + ' 页');
  console.log('   主题: 白底 + 深蓝(Cambria) + 衬线标题');
}).catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
