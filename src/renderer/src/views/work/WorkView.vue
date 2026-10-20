<script setup lang="ts">
// 【工作模式】负责人：赵
// 本模块承载：知识库管理、RAG 检索、Agent 分析、研究报告输出
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div class="view-title">
        <h1>工作</h1>
        <span class="owner-badge">赵</span>
      </div>
      <p class="view-sub">知识库 · 检索 · Agent 分析 · 研究报告</p>
    </header>

    <!-- 功能入口占位 -->
    <div class="grid">
      <article class="card">
        <span class="card-icon" data-kind="kb" />
        <h2>知识库</h2>
        <p>导入采集结果，建立可检索的向量索引</p>
        <span class="card-meta">0 个知识库</span>
      </article>

      <article class="card">
        <span class="card-icon" data-kind="search" />
        <h2>检索</h2>
        <p>混合检索，查看命中片段与来源</p>
        <span class="card-meta">待接入</span>
      </article>

      <article class="card">
        <span class="card-icon" data-kind="agent" />
        <h2>Agent 分析</h2>
        <p>按研究问题拆解步骤，逐步取证与归纳</p>
        <span class="card-meta">待接入</span>
      </article>

      <article class="card">
        <span class="card-icon" data-kind="report" />
        <h2>研究报告</h2>
        <p>汇总证据链，生成可溯源的结构化报告</p>
        <span class="card-meta">0 份报告</span>
      </article>
    </div>

    <!-- 最近任务占位 -->
    <div class="panel">
      <div class="panel-head">
        <h3>最近任务</h3>
        <span class="note">暂无执行记录</span>
      </div>
      <div class="rows">
        <div v-for="n in 3" :key="n" class="row">
          <span class="skeleton w-40" />
          <span class="skeleton w-16" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  transition: border-color 0.18s ease, transform 0.18s ease, background 0.18s ease;
}

.card:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  border-color: var(--line-2);
  transform: translateY(-2px);
}

.card h2 {
  font-size: 14px;
  font-weight: 600;
}

.card p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}

.card-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--accent);
}

.card-icon {
  position: relative;
  width: 26px;
  height: 26px;
  margin-bottom: 4px;
  background: var(--accent-soft);
  border: 1px solid var(--line-2);
  border-radius: 8px;
}

.card-icon::after {
  content: "";
  position: absolute;
  inset: 7px;
  border: 1.5px solid var(--accent);
  border-radius: 2px;
}

.card-icon[data-kind="kb"]::after {
  border-radius: 50%;
}

.card-icon[data-kind="agent"]::after {
  border-radius: 50% 50% 50% 2px;
}

.card-icon[data-kind="report"]::after {
  border-radius: 1px;
  border-left-width: 3px;
}

.panel {
  padding: 14px 16px 6px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 10px;
}

.panel-head h3 {
  font-size: 13px;
  font-weight: 600;
}

.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.skeleton {
  height: 8px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 99px;
}

.w-40 {
  width: 40%;
}

.w-16 {
  width: 16%;
}
</style>
