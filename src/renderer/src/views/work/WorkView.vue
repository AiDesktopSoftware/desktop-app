<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

// 【工作模式】负责人：赵
// 本模块承载：知识库管理、RAG 检索、Agent 分析、研究报告输出
// 当前为前端骨架：数据全部本地 mock，后端接口接入后替换

type Role = 'user' | 'agent'
type InspectorTab = 'evidence' | 'artifacts'

interface Message {
  id: number
  role: Role
  text: string
  meta?: string
}

interface Session {
  id: string
  title: string
  time: string
  group: string
}

const bases = [
  { name: '论文库 · 2024-2026', docs: 128 },
  { name: '技术博客采集', docs: 64 }
]

const sessions: Session[] = [
  { id: 's1', title: '多模态大模型检索增强进展', time: '14:32', group: '今天' },
  { id: 's2', title: 'RAG 检索策略对比', time: '11:05', group: '今天' },
  { id: 's3', title: '开源向量库选型', time: '昨天', group: '更早' },
  { id: 's4', title: 'Agent 工具调用综述', time: '10-18', group: '更早' }
]

const groupedSessions = computed(() => {
  const groups = new Map<string, Session[]>()
  for (const s of sessions) {
    if (!groups.has(s.group)) groups.set(s.group, [])
    groups.get(s.group)!.push(s)
  }
  return Array.from(groups, ([name, items]) => ({ name, items }))
})

const activeSessionId = ref('s1')
const activeSession = computed(() => sessions.find((s) => s.id === activeSessionId.value))

const activeBase = ref(bases[0].name)
const keyword = ref('')

const panelOpen = ref(true)
const tab = ref<InspectorTab>('evidence')

const messages = ref<Message[]>([
  {
    id: 1,
    role: 'user',
    text:
      '帮我梳理 2024 年以来多模态大模型在「检索增强」方向的主要进展，重点关注图文联合检索与证据可溯源两个方面。'
  },
  {
    id: 2,
    role: 'agent',
    meta: '已拆解 4 个步骤 · 检索 128 个片段 · 命中 9 篇文献',
    text:
      '根据知识库检索结果，可以按三条主线归纳：\n\n' +
      '1. 图文联合检索：多模态编码器统一到同一向量空间后，检索粒度从「整篇文档」下沉到「图-文片段对」，召回率提升明显。\n' +
      '2. 证据可溯源：主流做法是给每个生成句绑定来源片段 ID，生成后做一致性校验，降低无依据表述。\n' +
      '3. 工具化 Agent：把检索、重排、摘要拆成可调用工具，由 Agent 按研究问题动态编排。\n\n' +
      '需要的话，我可以基于这些证据直接生成一份结构化研究简报。'
  }
])

const draft = ref('')
const streamEl = ref<HTMLElement | null>(null)
let nextId = 3

const evidence = [
  { id: 1, title: 'Retrieval-Augmented Generation for Multimodal LLMs', source: 'arXiv · 2024', score: 0.91 },
  { id: 2, title: 'Fine-grained Image-Text Retrieval with Unified Embeddings', source: 'ACL · 2024', score: 0.87 },
  { id: 3, title: 'Citation-aware Generation for Verifiable Answers', source: 'EMNLP · 2025', score: 0.82 }
]

const artifacts = [
  { name: '研究简报 v1.md', meta: '草稿 · 12 分钟前', kind: '报告' },
  { name: '引用清单.csv', meta: '已导出 · 12 分钟前', kind: '数据' },
  { name: '检索片段集.json', meta: '128 条 · 14 分钟前', kind: '数据' }
]

const suggestions = ['梳理某个方向的研究进展', '对比两篇论文的方法差异', '从知识库生成研究简报']

function selectSession(id: string) {
  activeSessionId.value = id
}

function newResearch() {
  messages.value = []
  activeSessionId.value = ''
  draft.value = ''
}

async function send() {
  const text = draft.value.trim()
  if (!text) return
  messages.value.push({ id: nextId++, role: 'user', text })
  messages.value.push({
    id: nextId++,
    role: 'agent',
    meta: '前端演示 · 未接入模型与检索接口',
    text: '已收到研究问题。当前为界面骨架，接入 RAG 检索与 Agent 服务后会在此返回拆解步骤、证据片段与研究结论。'
  })
  draft.value = ''
  await nextTick()
  streamEl.value?.scrollTo({ top: streamEl.value.scrollHeight, behavior: 'smooth' })
}
</script>

<template>
  <section class="work" :class="{ 'is-inspector-hidden': !panelOpen }">
    <!-- 左：知识库 / 会话 -->
    <aside class="rail">
      <div class="rail-head">
        <button class="new-btn" @click="newResearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新建研究
        </button>
      </div>

      <label class="rail-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <circle cx="11" cy="11" r="6" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input v-model="keyword" type="text" placeholder="搜索会话 / 知识库" />
      </label>

      <div class="rail-scroll">
        <div class="rail-section">
          <div class="rail-label">知识库</div>
          <button
            v-for="base in bases"
            :key="base.name"
            class="rail-item"
            :class="{ 'is-active': activeBase === base.name }"
            @click="activeBase = base.name"
          >
            <span class="rail-item-icon" />
            <span class="rail-item-text">{{ base.name }}</span>
            <span class="rail-item-count">{{ base.docs }}</span>
          </button>
        </div>

        <div v-for="group in groupedSessions" :key="group.name" class="rail-section">
          <div class="rail-label">{{ group.name }}</div>
          <button
            v-for="s in group.items"
            :key="s.id"
            class="rail-item session"
            :class="{ 'is-active': activeSessionId === s.id }"
            @click="selectSession(s.id)"
          >
            <span class="rail-item-text">{{ s.title }}</span>
            <span class="rail-item-count">{{ s.time }}</span>
          </button>
        </div>
      </div>

      <div class="rail-foot">
        <span class="dot" />
        <span>索引就绪 · 2 个知识库</span>
      </div>
    </aside>

    <!-- 中：Agent 对话流 -->
    <section class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="live-dot" />
          <h2>{{ activeSession ? activeSession.title : '新的研究任务' }}</h2>
          <span class="tag">Agent</span>
        </div>
        <div class="top-actions">
          <span class="pill">模型 · 待接入</span>
          <span class="pill">知识库 · {{ activeBase }}</span>
          <button
            class="icon-btn"
            :class="{ 'is-on': panelOpen }"
            :title="panelOpen ? '收起证据面板' : '展开证据面板'"
            @click="panelOpen = !panelOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <path d="M15 4.5v15" />
            </svg>
          </button>
        </div>
      </header>

      <div ref="streamEl" class="stream">
        <div v-if="messages.length === 0" class="empty">
          <div class="empty-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />
              <path d="M12 12v8.5M12 12 4 8M12 12l8-4" />
            </svg>
          </div>
          <h3>开始一个研究任务</h3>
          <p>描述研究问题，Agent 会拆解步骤、检索知识库并给出可溯源的结论。</p>
          <div class="suggests">
            <button v-for="s in suggestions" :key="s" class="suggest" @click="draft = s">{{ s }}</button>
          </div>
        </div>

        <template v-for="msg in messages" :key="msg.id">
          <div v-if="msg.role === 'user'" class="msg user">
            <div class="bubble">{{ msg.text }}</div>
          </div>
          <div v-else class="msg agent">
            <div class="avatar">
              <span class="avatar-core" />
            </div>
            <div class="agent-body">
              <div v-if="msg.meta" class="agent-meta">{{ msg.meta }}</div>
              <div class="bubble agent-bubble">{{ msg.text }}</div>
              <div v-if="msg.meta && !msg.meta.includes('演示')" class="cites">
                <span class="cite">[1] arXiv 2403.xxxx</span>
                <span class="cite">[2] ACL 2024</span>
                <span class="cite">[3] EMNLP 2025</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <footer class="composer">
        <div class="composer-box">
          <div class="composer-chips">
            <span class="chip">@ {{ activeBase }}</span>
            <span class="chip">联网检索 · 关闭</span>
          </div>
          <textarea
            v-model="draft"
            rows="2"
            placeholder="描述研究问题，Enter 发送，Shift + Enter 换行"
            @keydown.enter.exact.prevent="send"
          />
          <div class="composer-foot">
            <span class="hint">内容仅本地演示，接口接入后生效</span>
            <button class="send-btn" :disabled="!draft.trim()" @click="send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h13M13 6l6 6-6 6" />
              </svg>
              发送
            </button>
          </div>
        </div>
      </footer>
    </section>

    <!-- 右：证据 / 产物 -->
    <aside v-if="panelOpen" class="inspector">
      <div class="tabs">
        <button :class="{ 'is-active': tab === 'evidence' }" @click="tab = 'evidence'">证据链</button>
        <button :class="{ 'is-active': tab === 'artifacts' }" @click="tab = 'artifacts'">产物</button>
      </div>

      <div class="insp-scroll">
        <template v-if="tab === 'evidence'">
          <div class="insp-block">
            <div class="insp-head">
              <h4>检索来源</h4>
              <span class="note">{{ evidence.length }} 条</span>
            </div>
            <article v-for="item in evidence" :key="item.id" class="source">
              <div class="source-top">
                <span class="source-id">{{ item.id }}</span>
                <span class="source-score">{{ item.score.toFixed(2) }}</span>
              </div>
              <p class="source-title">{{ item.title }}</p>
              <span class="source-meta">{{ item.source }}</span>
            </article>
          </div>

          <div class="insp-block">
            <div class="insp-head">
              <h4>运行时状态</h4>
            </div>
            <ul class="steps">
              <li><span class="step-dot is-done" />问题拆解完成</li>
              <li><span class="step-dot is-done" />知识库检索完成</li>
              <li><span class="step-dot is-done" />证据去重与重排</li>
              <li><span class="step-dot" />生成研究报告</li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="insp-block">
            <div class="insp-head">
              <h4>产物</h4>
              <span class="note">3 项</span>
            </div>
            <article v-for="item in artifacts" :key="item.name" class="artifact">
              <span class="artifact-kind">{{ item.kind }}</span>
              <div class="artifact-text">
                <p>{{ item.name }}</p>
                <span>{{ item.meta }}</span>
              </div>
            </article>
          </div>

          <div class="insp-block">
            <div class="insp-head">
              <h4>导出</h4>
            </div>
            <button class="ghost-btn wide">导出 Markdown</button>
            <button class="ghost-btn wide">导出引用清单</button>
          </div>
        </template>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.work {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 300px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.work.is-inspector-hidden {
  grid-template-columns: 236px minmax(0, 1fr);
}

/* ---------------- 左栏 ---------------- */

.rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.022), transparent 42%), var(--bg-1);
  border-right: 1px solid var(--line);
}

.rail-head {
  padding: 14px 12px 8px;
}

.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: #0b0d11;
  background: var(--accent);
  border-radius: var(--radius-sm);
  transition: filter 0.18s ease;
}

.new-btn:hover {
  filter: brightness(1.08);
}

.new-btn svg {
  width: 14px;
  height: 14px;
}

.rail-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 12px 10px;
  padding: 6px 9px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.rail-search:focus-within {
  border-color: var(--line-2);
  color: var(--text-2);
}

.rail-search svg {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
}

.rail-search input {
  width: 100%;
  font-size: 12px;
  color: var(--text);
  background: none;
  border: 0;
  outline: none;
}

.rail-search input::placeholder {
  color: var(--text-3);
}

.rail-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 10px;
}

.rail-section + .rail-section {
  margin-top: 14px;
}

.rail-label {
  padding: 0 6px 5px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-3);
  text-transform: uppercase;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 8px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  border-radius: 7px;
  transition: background 0.16s ease, color 0.16s ease;
}

.rail-item:hover {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text);
}

.rail-item.is-active {
  color: #fff;
  background: var(--accent-soft);
}

.rail-item-icon {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  background: var(--accent);
  border-radius: 2px;
  opacity: 0.75;
}

.rail-item-text {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rail-item-count {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--text-3);
}

.rail-item.session .rail-item-text {
  font-size: 12.5px;
}

.rail-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  font-size: 10.5px;
  color: var(--text-3);
  border-top: 1px solid var(--line);
}

.dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 99px;
}

/* ---------------- 中栏 ---------------- */

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px;
  background: rgba(11, 13, 17, 0.5);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.live-dot {
  width: 7px;
  height: 7px;
  background: var(--accent);
  border-radius: 99px;
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.crumb h2 {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag {
  padding: 1px 7px;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.top-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.pill {
  padding: 3px 9px;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 99px;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-3);
  border-radius: 7px;
  transition: background 0.16s ease, color 0.16s ease;
}

.icon-btn:hover,
.icon-btn.is-on {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.stream {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 26px;
}

.msg {
  display: flex;
  gap: 10px;
  animation: rise 0.24s ease both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}

.msg.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.72;
  white-space: pre-wrap;
  border-radius: 12px;
}

.msg.user .bubble {
  color: #eaf7f0;
  background: linear-gradient(180deg, rgba(61, 220, 151, 0.22), rgba(61, 220, 151, 0.12));
  border: 1px solid rgba(61, 220, 151, 0.28);
  border-bottom-right-radius: 4px;
}

.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-top: 2px;
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.32);
  border-radius: 8px;
}

.avatar-core {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 2px;
  transform: rotate(45deg);
}

.agent-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  max-width: 84%;
}

.agent-meta {
  font-size: 10.5px;
  color: var(--text-3);
}

.agent-bubble {
  max-width: 100%;
  color: var(--text);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-top-left-radius: 4px;
}

.cites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cite {
  padding: 2px 8px;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
}

/* ---------------- 空状态 ---------------- */

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}

.empty-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 4px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--line-2);
  border-radius: 12px;
}

.empty-mark svg {
  width: 24px;
  height: 24px;
}

.empty h3 {
  font-size: 15px;
  font-weight: 600;
}

.empty p {
  max-width: 380px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.suggests {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.suggest {
  padding: 6px 11px;
  font-size: 11.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: 99px;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.suggest:hover {
  color: var(--text);
  border-color: var(--line-2);
}

/* ---------------- 输入区 ---------------- */

.composer {
  padding: 10px 20px 16px;
  border-top: 1px solid var(--line);
}

.composer-box {
  padding: 9px 11px 8px;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.composer-box:focus-within {
  border-color: rgba(61, 220, 151, 0.45);
  box-shadow: 0 0 0 3px rgba(61, 220, 151, 0.08);
}

.composer-chips {
  display: flex;
  gap: 6px;
  padding-bottom: 6px;
}

.chip {
  padding: 1px 8px;
  font-size: 10.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.045);
  border-radius: 99px;
}

.composer-box textarea {
  width: 100%;
  min-height: 48px;
  max-height: 160px;
  padding: 2px 2px 4px;
  font: inherit;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
  background: none;
  border: 0;
  outline: none;
  resize: none;
}

.composer-box textarea::placeholder {
  color: var(--text-3);
}

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.hint {
  font-size: 10.5px;
  color: var(--text-3);
}

.send-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 13px;
  font-size: 12.5px;
  font-weight: 500;
  color: #07120c;
  background: var(--accent);
  border-radius: 8px;
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.send-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn svg {
  width: 14px;
  height: 14px;
}

/* ---------------- 右栏 ---------------- */

.inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 40%), var(--bg-1);
  border-left: 1px solid var(--line);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}

.tabs button {
  position: relative;
  padding: 6px 10px 9px;
  font-size: 12.5px;
  color: var(--text-3);
  transition: color 0.16s ease;
}

.tabs button:hover {
  color: var(--text-2);
}

.tabs button.is-active {
  color: var(--text);
}

.tabs button.is-active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}

.insp-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 12px 18px;
}

.insp-block + .insp-block {
  margin-top: 18px;
}

.insp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 8px;
}

.insp-head h4 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-2);
}

.note {
  font-size: 10.5px;
  color: var(--text-3);
}

.source {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  transition: border-color 0.16s ease;
}

.source:hover {
  border-color: var(--line-2);
}

.source + .source {
  margin-top: 7px;
}

.source-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.source-id {
  display: grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
}

.source-score {
  font-size: 10px;
  color: var(--text-3);
}

.source-title {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}

.source-meta {
  font-size: 10.5px;
  color: var(--text-3);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px;
  list-style: none;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-2);
}

.step-dot {
  width: 6px;
  height: 6px;
  border: 1px solid var(--text-3);
  border-radius: 99px;
}

.step-dot.is-done {
  background: var(--accent);
  border-color: var(--accent);
}

.artifact {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.artifact + .artifact {
  margin-top: 7px;
}

.artifact-kind {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
}

.artifact-text p {
  font-size: 12px;
  color: var(--text);
}

.artifact-text span {
  font-size: 10.5px;
  color: var(--text-3);
}

.ghost-btn {
  padding: 6px 11px;
  font-size: 11.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: color 0.16s ease, border-color 0.16s ease;
}

.ghost-btn:hover {
  color: var(--text);
  border-color: var(--line-2);
}

.ghost-btn.wide {
  width: 100%;
  margin-top: 6px;
}

/* ---------------- 窄窗口 ---------------- */

@media (max-width: 1180px) {
  .work,
  .work.is-inspector-hidden {
    grid-template-columns: 208px minmax(0, 1fr);
  }

  .inspector {
    display: none;
  }
}

@media (max-width: 900px) {
  .work,
  .work.is-inspector-hidden {
    grid-template-columns: minmax(0, 1fr);
  }

  .rail {
    display: none;
  }
}
</style>
