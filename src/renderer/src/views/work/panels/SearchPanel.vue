<script setup lang="ts">
// 知识库检索面板：默认来源与 topK 由当前模式/偏好决定，查询与结果只在本组件内维护
import { computed, ref, watch } from 'vue'
import type { RagProviderId, RagResult } from '../types'

interface ProviderOption {
  id: RagProviderId
  label: string
}

const props = defineProps<{
  /** 模式默认检索来源，切换模式后同步 */
  defaultProvider: RagProviderId
  /** 模式或偏好里的检索条数 */
  defaultTopK: number
  /** 下拉选项 */
  providers: ProviderOption[]
  /** 会话 id：切换会话时清空检索视图 */
  sessionKey: string
}>()

const api = window.workApi

const query = ref('')
const provider = ref<RagProviderId>(props.defaultProvider)
const loading = ref(false)
const result = ref<RagResult | null>(null)
const error = ref('')
// 递增令牌让在途请求在会话切换后失效，避免旧结果回填
let requestToken = 0

const chunkCount = computed(() => result.value?.chunks.length ?? 0)

watch(
  () => props.defaultProvider,
  (value) => {
    provider.value = value
  }
)

watch(
  () => props.sessionKey,
  () => {
    requestToken += 1
    query.value = ''
    provider.value = props.defaultProvider
    loading.value = false
    result.value = null
    error.value = ''
  }
)

function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  void search()
}

async function search(): Promise<void> {
  const text = query.value.trim()
  if (!text || loading.value) return
  const token = ++requestToken
  loading.value = true
  result.value = null
  error.value = ''
  try {
    const response = await api.searchRag({
      query: text,
      provider: provider.value,
      topK: props.defaultTopK
    })
    if (token !== requestToken) return
    if (response.ok) {
      result.value = response
    } else {
      error.value = response.message || '检索失败'
    }
  } catch (err) {
    if (token !== requestToken) return
    error.value = err instanceof Error ? err.message : '检索失败'
  } finally {
    if (token === requestToken) loading.value = false
  }
}

/** 结果来源：网页显示域名，本地资料显示文件名 */
function originOf(chunk: RagResult['chunks'][number]): string {
  const source = chunk.source
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return source.url
    }
  }
  if (source.path) {
    const parts = source.path.split(/[\\/]/).filter((part) => part.length > 0)
    return parts.length > 0 ? parts[parts.length - 1] : source.path
  }
  return '来源未标注'
}
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>知识库检索</h4>
      <span class="panel-note">{{ chunkCount }} 条</span>
    </div>

    <div class="rag-form">
      <input
        v-model="query"
        type="text"
        placeholder="输入检索问题，Enter 检索"
        :disabled="loading"
        @keydown.enter="onEnter"
      />
      <select v-model="provider" :disabled="loading">
        <option v-for="item in providers" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </select>
      <button class="rag-run" :disabled="loading || !query.trim()" @click="search">
        {{ loading ? '检索中…' : '检索' }}
      </button>
    </div>

    <div v-if="error" class="rag-error">{{ error }}</div>

    <div v-if="result && result.chunks.length" class="rag-results">
      <article
        v-for="chunk in result.chunks"
        :key="chunk.chunkId"
        class="rag-item"
        :class="{ 'has-demo': chunk.demo }"
      >
        <span v-if="chunk.demo" class="rag-demo-badge">演示</span>
        <p class="rag-item-text">{{ chunk.text }}</p>
        <div class="rag-source">
          <a
            v-if="chunk.source.url"
            class="rag-source-title"
            :href="chunk.source.url"
            target="_blank"
            rel="noreferrer"
            :title="chunk.source.title"
          >
            {{ chunk.source.title }}
          </a>
          <span v-else class="rag-source-title" :title="chunk.source.title">
            {{ chunk.source.title }}
          </span>
          <span class="rag-origin">{{ originOf(chunk) }}</span>
        </div>
        <div class="rag-foot">
          <span class="rag-provider" :class="'is-' + chunk.provider">
            {{ chunk.provider === 'local' ? '本地' : '云端' }}
          </span>
          <span class="rag-score">分数 {{ chunk.score.toFixed(2) }}</span>
        </div>
      </article>
    </div>

    <div v-if="result?.note" class="rag-note">{{ result.note }}</div>
    <div v-else-if="!loading && result && result.chunks.length === 0" class="rag-empty">
      没有匹配的片段。
    </div>
  </div>
</template>

<style scoped>
.panel-block {
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 8px;
}

.panel-head h4 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-2);
}

.panel-note {
  font-size: 10.5px;
  color: var(--text-3);
}

.rag-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78px 46px;
  gap: 5px;
}

.rag-form input,
.rag-form select,
.rag-run {
  height: 30px;
  min-width: 0;
  font-size: 11px;
  border-radius: 6px;
}

.rag-form input {
  padding: 0 8px;
  color: var(--text);
  background: var(--bg-2);
  border: 1px solid var(--line);
  outline: none;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.rag-form input::placeholder {
  color: var(--text-3);
}

.rag-form input:focus,
.rag-form select:focus {
  border-color: var(--accent);
}

.rag-form select {
  padding: 0 2px;
  color: var(--text-2);
  background: var(--bg-2);
  border: 1px solid var(--line);
  outline: none;
  cursor: pointer;
}

.rag-form select option {
  color: var(--text);
  background: var(--bg-2);
}

.rag-form input:disabled,
.rag-form select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rag-run {
  font-weight: 500;
  color: #0b0d11;
  background: var(--accent);
  transition: filter 0.16s ease, opacity 0.16s ease;
}

.rag-run:hover:not(:disabled) {
  filter: brightness(1.08);
}

.rag-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rag-results {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 9px;
}

.rag-item {
  position: relative;
  padding: 8px 9px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: border-color 0.16s ease;
}

.rag-item:hover {
  border-color: var(--line-2);
}

.rag-item.has-demo {
  padding-top: 24px;
}

.rag-item-text {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-2);
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.rag-demo-badge {
  position: absolute;
  top: 6px;
  right: 7px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 600;
  line-height: 16px;
  color: #201203;
  background: #ffb04d;
  border-radius: 99px;
  box-shadow: 0 0 0 1px rgba(255, 176, 77, 0.35);
}

.rag-source {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
}

.rag-source-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-2);
  text-decoration: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

a.rag-source-title:hover {
  color: var(--accent);
}

.rag-origin {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  font-size: 9.5px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rag-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}

.rag-provider {
  padding: 0 6px;
  font-size: 9px;
  line-height: 16px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 99px;
}

.rag-provider.is-cloud {
  color: #8fb4ff;
  background: rgba(96, 145, 255, 0.14);
}

.rag-score {
  margin-left: auto;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 9.5px;
  color: var(--text-3);
}

.rag-note {
  margin-top: 8px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.022);
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
}

.rag-error {
  margin-top: 8px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.28);
  border-radius: var(--radius-sm);
}

.rag-empty {
  margin-top: 8px;
  padding: 10px 9px;
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  background: rgba(255, 255, 255, 0.018);
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
}
</style>
