/**
 * 开题答辩 PPT 生成（试验版）
 */
const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
const SLIDE_W = 10, SLIDE_H = 5.625;
const M = 0.45;
const CW = SLIDE_W - 2*M;

const C = {
  primary: '065A82', secondary: '1C7293', accent: '21295C', dark: '0A2E3C',
  light: 'F0F7FA', bgLight: 'FFFFFF', text: '21295C', textDim: '64748B',
  brandGreen: '22C55E', brandGreenLight: 'DCFCE7', yellow: 'FEF9C3',
  yellowBorder: 'CA8A04', grayLine: 'CBD5E1', grayBg: 'F1F5F9',
};
const TF = 'Cambria', BF = 'Calibri';

function sectionBar(slide, text, num) {
  slide.addShape(pres.shapes.RECTANGLE, { x: M, y: M, w: 0.12, h: 0.55, fill: { color: C.primary }, line: { color: C.primary } });
  slide.addText(text, { x: M + 0.25, y: M, w: 4, h: 0.55, fontSize: 22, bold: true, fontFace: TF, color: C.text });
  slide.addText(num, { x: SLIDE_W - 1.2, y: M + 0.05, w: 0.8, h: 0.4, fontSize: 12, color: C.textDim, align: 'right', fontFace: BF });
}
function card(slide, x, y, w, h, opts) {
  opts = opts || {};
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h,
    fill: opts.fill || { color: C.bgLight }, line: opts.line || { color: C.grayLine, width: 1 }, radius: 0.08 });
}
function arrow(slide, x1, y, x2) {
  slide.addShape(pres.shapes.RIGHT_ARROW, { x: x1, y: y - 0.08, w: x2 - x1 - 0.1, h: 0.16, fill: { color: C.secondary }, line: { color: C.secondary } });
}

// ===== 1. COVER =====
(function() {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.dark } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 2.2, w: SLIDE_W, h: 0.04, fill: { color: C.secondary } });
  s.addText('智研台 Desk', { x: 1, y: 1.0, w: 8, h: 1.0, fontSize: 44, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', charSpacing: 2 });
  s.addText('AI 多源信息采集与研究助手', { x: 1, y: 1.9, w: 8, h: 0.5, fontSize: 20, fontFace: BF, color: C.secondary, align: 'center' });
  s.addText('高级软件工程 · 开题答辩', { x: 1, y: 2.7, w: 8, h: 0.4, fontSize: 14, fontFace: BF, color: '94A3B8', align: 'center' });
  s.addText('赵（研究侧）    胡（数据侧）', { x: 1, y: 3.7, w: 8, h: 0.35, fontSize: 13, fontFace: BF, color: 'E2E8F0', align: 'center' });
  s.addText('指导教师：吴云    2026 年 11 月', { x: 1, y: 4.25, w: 8, h: 0.35, fontSize: 12, fontFace: BF, color: '64748B', align: 'center' });
})();

// ===== 2. AGENDA =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '汇报提纲', '01');
  const items = [['一', '基本情况', '项目名称、团队分工、研究内容简介'],
    ['二', '立论依据', '研究背景意义、同类产品对比、参考文献'],
    ['三', '研究方案', '目标、技术路线、算法设计、可行性（含半成品）、研究计划、预期成果'],
    ['四', '特色创新', 'DIY 三层可配置、本地优先、端到端研究辅助']];
  items.forEach((it, i) => {
    const y = M + 0.9 + i * 1.0;
    card(s, M, y, CW, 0.85, { fill: { color: C.grayBg } });
    s.addShape(pres.shapes.OVAL, { x: M + 0.15, y: y + 0.15, w: 0.55, h: 0.55, fill: { color: C.primary }, line: { color: C.primary } });
    s.addText(it[0], { x: M + 0.15, y: y + 0.15, w: 0.55, h: 0.55, fontSize: 16, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addText(it[1], { x: M + 0.85, y: y + 0.08, w: 3, h: 0.35, fontSize: 16, bold: true, fontFace: TF, color: C.text });
    s.addText(it[2], { x: M + 0.85, y: y + 0.45, w: CW - 1.0, h: 0.3, fontSize: 11, fontFace: BF, color: C.textDim });
  });
})();

// ===== 3. 一、基本情况 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '一、基本情况', '02');
  s.addText('分工表（定稿）', { x: M, y: M + 0.7, w: 4, h: 0.35, fontSize: 14, bold: true, fontFace: BF, color: C.text });
  // 表头
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 1.1, w: CW, h: 0.35, fill: { color: C.primary }, line: { color: C.primary } });
  ['姓名', '模块', '核心职责'].forEach((h, i) => {
    const w = i === 0 ? 1.2 : i === 1 ? 2.2 : CW - 3.4;
    const x = M + (i === 0 ? 0.1 : i === 1 ? 1.3 : 3.5);
    s.addText(h, { x, y: M + 1.1, w, h: 0.35, fontSize: 12, bold: true, fontFace: BF, color: 'FFFFFF', valign: 'middle' });
  });
  // 赵
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 1.45, w: CW, h: 0.9, fill: { color: C.brandGreenLight }, line: { color: C.grayLine } });
  s.addText('赵', { x: M + 0.1, y: M + 1.45, w: 1.1, h: 0.9, fontSize: 14, bold: true, fontFace: BF, color: C.brandGreen, valign: 'middle' });
  s.addText('工作模式\n(views/work/)', { x: M + 1.3, y: M + 1.45, w: 2.1, h: 0.9, fontSize: 11, fontFace: BF, color: C.text, valign: 'middle' });
  s.addText('主进程核心引擎：Agent、RAG 检索、知识库、工作流编排、研究报告生成\n对接云端 LLM API（DeepSeek） | 分支：feat/zhao-work', { x: M + 3.5, y: M + 1.5, w: CW - 3.7, h: 0.8, fontSize: 10.5, fontFace: BF, color: C.text });
  // 胡
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 2.35, w: CW, h: 0.9, fill: { color: 'FEF3C7' }, line: { color: C.grayLine } });
  s.addText('胡', { x: M + 0.1, y: M + 2.35, w: 1.1, h: 0.9, fontSize: 14, bold: true, fontFace: BF, color: C.yellowBorder, valign: 'middle' });
  s.addText('信息模式\n(views/info/)', { x: M + 1.3, y: M + 2.35, w: 2.1, h: 0.9, fontSize: 11, fontFace: BF, color: C.text, valign: 'middle' });
  s.addText('多源信息采集、爬虫、正文抽取、去重清洗\n按约定 JSONL 契约交付数据 | 分支：feat/hu-info', { x: M + 3.5, y: M + 2.4, w: CW - 3.7, h: 0.8, fontSize: 10.5, fontFace: BF, color: C.text });
  // 研究简介
  s.addText('研究内容简介', { x: M, y: M + 3.45, w: 4, h: 0.35, fontSize: 14, bold: true, fontFace: BF, color: C.text });
  s.addText('本地优先的桌面端 AI 研究助手。数据链路：胡采集 JSONL → 赵用 RAG+Agent 分析 → 云端大模型生成 → 输出研究报告。两个模式独立开发，JSONL 契约协作。',
    { x: M, y: M + 3.85, w: CW, h: 1.2, fontSize: 12, fontFace: BF, color: C.textDim });
})();

// ===== 4. 背景意义 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '二、立论依据 · 背景意义', '03');
  s.addText('痛点：写论文/做调研时，你是否遇到过…', { x: M, y: M + 0.7, w: CW, h: 0.4, fontSize: 15, italic: true, fontFace: BF, color: C.secondary });
  const pains = [['📚', '信息爆炸', '文献、网页、文档到处都是，手动检索整理效率极低'],
    ['🔒', '隐私担忧', 'SaaS AI 助手把选题和笔记上传云端，科研数据不安全'],
    ['🔌', '离线残疾', '实验室没网/信号差时，AI 助手直接不能用'],
    ['💰', '成本累积', '按次按量计费，长期使用费用可观']];
  pains.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (CW / 2 + 0.05), y = M + 1.25 + row * 1.7;
    card(s, x, y, CW / 2 - 0.05, 1.55);
    s.addText(p[0], { x: x + 0.15, y: y + 0.1, w: 0.6, h: 0.6, fontSize: 28 });
    s.addText(p[1], { x: x + 0.75, y: y + 0.15, w: 4, h: 0.35, fontSize: 15, bold: true, fontFace: TF, color: C.text });
    s.addText(p[2], { x: x + 0.75, y: y + 0.55, w: CW / 2 - 0.9, h: 0.85, fontSize: 11, fontFace: BF, color: C.textDim });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: SLIDE_H - 1.0, w: CW, h: 0.7, fill: { color: C.brandGreen }, line: { color: C.brandGreen }, radius: 0.08 });
  s.addText('💡 智研台 Desk 定位：本地优先的桌面端 AI 研究助手，数据不出本机，端到端覆盖采集→分析→报告',
    { x: M + 0.15, y: SLIDE_H - 0.95, w: CW - 0.3, h: 0.6, fontSize: 13, bold: true, fontFace: BF, color: 'FFFFFF', valign: 'middle' });
})();

// ===== 5. 研究现状 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '二、立论依据 · 研究现状', '04');
  const hdrX = [M + 0.1, M + 1.6, M + 3.0, M + 5.3];
  const hdrW = [1.4, 1.3, 2.2, CW - 6.0];
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: M + 0.75, w: CW, h: 0.32, fill: { color: C.primary }, line: { color: C.primary } });
  ['产品', '形态', '优势', '不足'].forEach((h, i) => {
    s.addText(h, { x: hdrX[i], y: M + 0.75, w: hdrW[i], h: 0.32, fontSize: 12, bold: true, fontFace: BF, color: 'FFFFFF', valign: 'middle' });
  });
  const rows = [
    ['Perplexity', 'SaaS 网页', '多源检索好、带来源', '数据上云、按次计费'],
    ['Claude.ai', 'SaaS 网页', '长上下文、强代码', '无法接本地知识库'],
    ['Dify', '开源平台', '可视化 RAG 工作流', '需部署后端、偏重'],
    ['Obsidian RAG', '本地笔记', '本地存储、插件生态', '需手动组装、无 Agent'],
    ['Codex / Trae', '桌面应用', 'Agent 闭环、DIY 配置', '面向编程，非研究场景']];
  rows.forEach((row, i) => {
    const y = M + 1.07 + i * 0.62;
    s.addShape(pres.shapes.RECTANGLE, { x: M, y, w: CW, h: 0.6, fill: { color: i % 2 === 0 ? C.bgLight : C.grayBg }, line: { color: C.grayLine } });
    row.forEach((cell, j) => {
      s.addText(cell, { x: hdrX[j], y: y + 0.08, w: hdrW[j], h: 0.45, fontSize: 10.5, fontFace: BF, color: j === 3 ? 'B85042' : C.text, valign: 'middle' });
    });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: M + 4.3, w: CW, h: 0.7, fill: { color: 'FEF9C3' }, line: { color: C.yellowBorder }, radius: 0.08 });
  s.addText('✅ 市场空白：面向研究场景 + 本地优先 + DIY 可配置 的桌面 AI 助手，目前尚无同类产品',
    { x: M + 0.15, y: M + 4.35, w: CW - 0.3, h: 0.6, fontSize: 12, bold: true, fontFace: BF, color: '854D0E', valign: 'middle' });
})();

// ===== 6. 技术路线（架构图 + 主界面截图） =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '三、研究方案 · 技术路线', '05');

  const ax = M, ay = M + 0.75, aw = 5.5;
  // 渲染层
  card(s, ax, ay, aw, 0.95, { fill: { color: C.light } });
  s.addText('渲染层（Vue 3 + TypeScript）', { x: ax + 0.12, y: ay + 0.08, w: 4, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.primary });
  const l1y = ay + 0.4;
  card(s, ax + 0.12, l1y, 1.55, 0.42, { fill: { color: C.brandGreenLight }, line: { color: C.brandGreen } });
  s.addText('工作模式', { x: ax + 0.12, y: l1y + 0.04, w: 1.55, h: 0.35, fontSize: 10, bold: true, fontFace: BF, color: C.brandGreen, align: 'center' });
  card(s, ax + 1.75, l1y, 1.55, 0.42);
  s.addText('信息模式', { x: ax + 1.75, y: l1y + 0.04, w: 1.55, h: 0.35, fontSize: 10, fontFace: BF, color: C.text, align: 'center' });
  card(s, ax + 3.38, l1y, 1.98, 0.42);
  s.addText('公共外壳', { x: ax + 3.38, y: l1y + 0.04, w: 1.98, h: 0.35, fontSize: 10, fontFace: BF, color: C.text, align: 'center' });
  s.addText('IPC ⬇', { x: ax + aw/2 - 0.3, y: ay + 1.02, w: 0.6, h: 0.25, fontSize: 9, fontFace: BF, color: C.secondary, align: 'center' });

  // 主进程层
  card(s, ax, ay + 1.3, aw, 1.95, { fill: { color: C.light } });
  s.addText('主进程核心引擎（Node.js）', { x: ax + 0.12, y: ay + 1.38, w: 4, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.primary });
  const l2y = ay + 1.72;
  const mods = ['Agent', 'RAG 检索', '知识库', '工作流', '能力中心'];
  const modW = (aw - 0.24) / 5;
  mods.forEach((m, i) => {
    card(s, ax + 0.12 + i * (modW + 0.03), l2y, modW - 0.03, 0.4, { fill: { color: C.brandGreenLight }, line: { color: C.brandGreen } });
    s.addText(m, { x: ax + 0.12 + i * (modW + 0.03), y: l2y + 0.04, w: modW - 0.03, h: 0.34, fontSize: 9.5, bold: true, fontFace: BF, color: C.brandGreen, align: 'center' });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ax + 0.12, y: l2y + 0.52, w: aw - 0.24, h: 0.42, fill: { color: C.yellow }, line: { color: C.yellowBorder }, radius: 0.08 });
  s.addText('⭐ DIY 三层亮点 → L1 参数化  |  L2 工作流编排  |  L3 自定义 HTTP',
    { x: ax + 0.2, y: l2y + 0.56, w: aw - 0.4, h: 0.34, fontSize: 10, bold: true, fontFace: BF, color: '854D0E', align: 'center' });
  s.addShape(pres.shapes.DOWN_ARROW, { x: ax + aw/2 - 0.15, y: ay + 3.28, w: 0.3, h: 0.25, fill: { color: C.secondary }, line: { color: C.secondary } });

  // 数据层
  card(s, ax, ay + 3.6, aw, 0.95, { fill: { color: C.light } });
  s.addText('数据与服务层', { x: ax + 0.12, y: ay + 3.68, w: 3, h: 0.3, fontSize: 11, bold: true, fontFace: TF, color: C.primary });
  const l3y = ay + 4.02;
  const dmods = ['云端 LLM', '本地向量索引', '本地文件系统', 'HTTP 工具'];
  const dw = (aw - 0.24) / 4;
  dmods.forEach((m, i) => {
    card(s, ax + 0.12 + i * (dw + 0.03), l3y, dw - 0.03, 0.4);
    s.addText(m, { x: ax + 0.12 + i * (dw + 0.03), y: l3y + 0.04, w: dw - 0.03, h: 0.34, fontSize: 9.5, fontFace: BF, color: C.text, align: 'center' });
  });

  // 右：主界面截图
  const rx = ax + aw + 0.25;
  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-1-main.png'),
    x: rx, y: ay, w: SLIDE_W - M - rx - M, h: 2.95 });
  s.addText('↑ 已实现的渲染层界面', { x: rx, y: ay + 3.0, w: SLIDE_W - M - rx - M, h: 0.3, fontSize: 10, fontFace: BF, color: C.textDim, align: 'center' });
})();

// ===== 7. 算法设计 + DIY 亮点 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '三、研究方案 · 算法设计 + DIY 亮点', '06');

  // RAG 流程图
  const fy = M + 0.75;
  s.addText('核心算法一：RAG 检索增强生成', { x: M, y: fy, w: 5, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.primary });
  const ragY = fy + 0.4, ragW = (CW - 0.5) / 5;
  const ragNodes = [
    { t: '文档导入', c: 'FEF3C7', bc: 'D97706' },
    { t: '500字切片\n标题加权1.3×', c: 'FFFFFF', bc: '94A3B8' },
    { t: 'BM25 索引', c: C.brandGreenLight, bc: C.brandGreen },
    { t: '相似度检索\nTop-K 召回', c: C.brandGreenLight, bc: C.brandGreen },
    { t: 'LLM 生成\n带来源回答', c: 'DBEAFE', bc: '2563EB' }];
  ragNodes.forEach((n, i) => {
    const nx = M + i * (ragW + 0.1);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: nx, y: ragY, w: ragW - 0.05, h: 0.95,
      fill: { color: n.c }, line: { color: n.bc, width: 1.5 }, radius: 0.08 });
    s.addText(n.t, { x: nx, y: ragY + 0.15, w: ragW - 0.05, h: 0.65, fontSize: 10, bold: i >= 2, fontFace: BF, color: C.text, align: 'center', valign: 'middle' });
    if (i < ragNodes.length - 1) arrow(s, nx + ragW - 0.03, ragY + 0.47, nx + ragW + 0.05);
  });

  // DIY 三层 + 截图
  const diyY = ragY + 1.2;
  s.addText('⭐ DIY 三层可配置（本项目核心亮点）', { x: M, y: diyY, w: 6, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.yellowBorder });
  const shotY = diyY + 0.4, shotH = 1.6, shotW = (CW - 0.4) / 3;

  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-3-prefs.png'),
    x: M, y: shotY, w: shotW - 0.1, h: shotH });
  s.addText('L1 参数化：4 个内置模式，可改提示词/工具白名单/温度', { x: M, y: shotY + shotH + 0.05, w: shotW - 0.1, h: 0.55, fontSize: 9.5, fontFace: BF, color: C.textDim });

  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-5-workflow.png'),
    x: M + shotW + 0.1, y: shotY, w: shotW - 0.1, h: shotH });
  s.addText('L2 工作流：3 个研究模板，步骤可编辑、试运行、冻结', { x: M + shotW + 0.1, y: shotY + shotH + 0.05, w: shotW - 0.1, h: 0.55, fontSize: 9.5, fontFace: BF, color: C.textDim });

  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-4-capability.png'),
    x: M + 2 * (shotW + 0.1), y: shotY, w: shotW - 0.1, h: shotH });
  s.addText('L3 自定义：填 HTTP 接口即可注册新工具，Agent 自动调用', { x: M + 2 * (shotW + 0.1), y: shotY + shotH + 0.05, w: shotW - 0.1, h: 0.55, fontSize: 9.5, fontFace: BF, color: C.textDim });
})();

// ===== 8. 可行性 + 半成品 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '三、研究方案 · 可行性 + 半成品 ⭐', '07');

  const lx = M, ly = M + 0.75, lw = CW * 0.42;
  // 大字数据
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: lx, y: ly, w: lw, h: 1.1, fill: { color: C.brandGreen }, line: { color: C.brandGreen }, radius: 0.1 });
  s.addText('40+', { x: lx, y: ly + 0.05, w: lw / 2, h: 0.6, fontSize: 28, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center' });
  s.addText('源文件', { x: lx, y: ly + 0.62, w: lw / 2, h: 0.35, fontSize: 11, fontFace: BF, color: 'DCFCE7', align: 'center' });
  s.addText('20+', { x: lx + lw / 2, y: ly + 0.05, w: lw / 2, h: 0.6, fontSize: 28, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center' });
  s.addText('commit', { x: lx + lw / 2, y: ly + 0.62, w: lw / 2, h: 0.35, fontSize: 11, fontFace: BF, color: 'DCFCE7', align: 'center' });

  // 已完成清单
  s.addText('✅ 已完成（半成品原型）', { x: lx, y: ly + 1.25, w: lw, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.brandGreen });
  const dones = ['Electron 骨架 + Vue3 双模式切换', 'Agent Function Calling 闭环（6 工具）', 'BM25 本地知识库（导入→检索→来源）', 'DIY 三层（模式+工作流+自定义HTTP）', '消息全套操作（分支/修改/重生成）', 'Ctrl+Shift+P 命令面板 + @ 补全', '系统托盘 + 自绘深色标题栏', '安全护栏（路径限定+危险命令拦截）'];
  dones.forEach((d, i) => {
    s.addText('• ' + d, { x: lx + 0.05, y: ly + 1.62 + i * 0.22, w: lw - 0.1, h: 0.22, fontSize: 9.5, fontFace: BF, color: C.text });
  });

  // 右：2 张截图
  const rx = lx + lw + 0.2, rw = SLIDE_W - M - rx, shotH = 1.95;
  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-2-panel.png'), x: rx, y: ly, w: rw, h: shotH });
  s.addText('本地知识库：已导入文档，支持检索 + 来源溯源', { x: rx, y: ly + shotH, w: rw, h: 0.3, fontSize: 10, fontFace: BF, color: C.textDim, align: 'center' });
  s.addImage({ path: path.join(__dirname, '..', 'docs', 'proposal-assets', 'screenshot-6-result.png'), x: rx, y: ly + shotH + 0.4, w: rw, h: shotH });
  s.addText('Agent 完整闭环：检索来源 → 执行轨迹 → 3 份产物可导出 Markdown',
    { x: rx, y: ly + 2 * shotH + 0.4, w: rw, h: 0.35, fontSize: 10, fontFace: BF, color: C.textDim, align: 'center' });
})();

// ===== 9. 研发流程 + 预期文档 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '三、研究方案 · 研发流程 + 预期成果', '08');

  // 5 阶段
  const fy = M + 0.8;
  s.addText('研发流程（5 阶段）', { x: M, y: fy, w: 4, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.primary });
  const stages = [
    { n: '1', t: '需求分析', w: '第 2-3 周', out: '需求规格说明书', active: true },
    { n: '2', t: '概要设计', w: '第 4 周', out: '模块结构图' },
    { n: '3', t: '详细设计', w: '第 5 周', out: '类图 / 接口文档' },
    { n: '4', t: '编码实现', w: '第 6-10 周', out: '源代码（Git 仓库）' },
    { n: '5', t: '综合测试', w: '第 11 周', out: '测试报告' }];
  const sw = (CW - 0.4) / 5;
  stages.forEach((st, i) => {
    const sx = M + i * (sw + 0.1);
    const bc = st.active ? C.brandGreen : C.grayLine;
    s.addShape(pres.shapes.OVAL, { x: sx + sw/2 - 0.18, y: fy + 0.4, w: 0.36, h: 0.36, fill: { color: bc }, line: { color: bc } });
    s.addText(st.n, { x: sx + sw/2 - 0.18, y: fy + 0.4, w: 0.36, h: 0.36, fontSize: 12, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: sx, y: fy + 0.85, w: sw - 0.05, h: 0.65,
      fill: { color: st.active ? C.brandGreenLight : C.bgLight }, line: { color: bc }, radius: 0.08 });
    s.addText(st.t, { x: sx, y: fy + 0.88, w: sw - 0.05, h: 0.3, fontSize: 11, bold: true, fontFace: BF, color: C.text, align: 'center' });
    s.addText(st.w, { x: sx, y: fy + 1.18, w: sw - 0.05, h: 0.28, fontSize: 9, fontFace: BF, color: C.textDim, align: 'center' });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: sx - 0.02, y: fy + 1.55, w: sw + 0.02, h: 0.42, fill: { color: C.grayBg }, line: { color: C.grayLine }, radius: 0.05 });
    s.addText(st.out, { x: sx - 0.02, y: fy + 1.58, w: sw + 0.02, h: 0.36, fontSize: 8.5, fontFace: BF, color: C.textDim, align: 'center' });
    if (i < stages.length - 1) arrow(s, sx + sw - 0.02, fy + 1.17, sx + sw + 0.07);
  });

  // 底部：协作 + 文档
  const by = fy + 2.15;
  card(s, M, by, CW / 2 - 0.1, 1.4);
  s.addText('🤝 协作模式', { x: M + 0.12, y: by + 0.1, w: CW / 2 - 0.3, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.yellowBorder });
  ['赵：feat/zhao-work → PR 合入 main', '胡：feat/hu-info，JSONL 契约协作', '公共外壳 → main 分支，影响两人'].forEach((t, i) => {
    s.addText('• ' + t, { x: M + 0.12, y: by + 0.45 + i * 0.25, w: CW / 2 - 0.3, h: 0.25, fontSize: 10, fontFace: BF, color: C.text });
  });

  card(s, M + CW / 2 + 0.1, by, CW / 2 - 0.1, 1.4);
  s.addText('📋 预期文档清单', { x: M + CW / 2 + 0.22, y: by + 0.1, w: CW / 2 - 0.3, h: 0.3, fontSize: 12, bold: true, fontFace: BF, color: C.yellowBorder });
  ['需求规格说明书', '设计文档（总体+详细+数据库）', '测试报告（单元+系统）', '用户说明书 + GitHub README'].forEach((d, i) => {
    s.addText('▸ ' + d, { x: M + CW / 2 + 0.22, y: by + 0.45 + i * 0.22, w: CW / 2 - 0.3, h: 0.22, fontSize: 10, fontFace: BF, color: C.text });
  });
})();

// ===== 10. 特色创新 =====
(function() {
  const s = pres.addSlide();
  sectionBar(s, '四、特色和创新点', '09');
  const features = [
    ['🔐', '本地优先', '知识库、索引、对话记录全部本机存储，敏感数据不出设备'],
    ['🛠️', 'DIY 三层可配置', 'L1 参数化模式 / L2 工作流 / L3 自定义 HTTP，按需组装'],
    ['🔄', '端到端覆盖', '采集 → RAG → Agent → 报告，一个工具覆盖完整研究链路'],
    ['⚡', '轻量无 Python', 'BM25 纯 Node.js，SQLite 文件存储，零外部服务依赖'],
    ['🤝', '双模块松耦合', '研究侧与数据侧通过 JSONL 契约协作，独立开发交付'],
    ['💡', '半成品已验证', '40+ 源文件、20+ commit，核心链路全部跑通可行']];
  const fc = 3;
  features.forEach((f, i) => {
    const col = i % fc, row = Math.floor(i / fc);
    const x = M + col * (CW / fc + 0.05), y = M + 0.8 + row * 2.15;
    card(s, x, y, CW / fc - 0.05, 2.0);
    s.addText(f[0], { x: x + 0.15, y: y + 0.15, w: 0.6, h: 0.5, fontSize: 24 });
    s.addText(f[1], { x: x + 0.8, y: y + 0.15, w: CW / fc - 1.0, h: 0.4, fontSize: 14, bold: true, fontFace: TF, color: C.text });
    s.addText(f[2], { x: x + 0.15, y: y + 0.65, w: CW / fc - 0.3, h: 1.2, fontSize: 11, fontFace: BF, color: C.textDim });
  });
})();

// ===== 11. THANK YOU =====
(function() {
  const s = pres.addSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.dark } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 2.0, w: SLIDE_W, h: 0.04, fill: { color: C.secondary } });
  s.addText('感谢聆听', { x: 1, y: 1.2, w: 8, h: 1.0, fontSize: 48, bold: true, fontFace: TF, color: 'FFFFFF', align: 'center', charSpacing: 3 });
  s.addText('欢迎老师提问', { x: 1, y: 2.5, w: 8, h: 0.5, fontSize: 18, fontFace: BF, color: C.secondary, align: 'center' });
  s.addText('智研台 Desk  |  赵 & 胡  |  指导教师：吴云', { x: 1, y: 4.5, w: 8, h: 0.4, fontSize: 12, fontFace: BF, color: '64748B', align: 'center' });
})();

// ===== OUTPUT =====
const outDir = path.join(__dirname, '..', 'docs', 'proposal-ppt');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '开题答辩-智研台Desk.pptx');

pres.writeFile({ fileName: outPath }).then(() => {
  const stat = fs.statSync(outPath);
  console.log('✅ PPT 已生成: ' + outPath);
  console.log('   文件大小: ' + (stat.size / 1024).toFixed(1) + ' KB');
  console.log('   总页数: 11 页');
}).catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
