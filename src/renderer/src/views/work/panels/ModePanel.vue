<script setup lang="ts">
// 当前模式面板：只读展示模式配置，修改入口通过 manage 事件交给 WorkView
import { computed } from 'vue'
import type { RagProviderId, WorkMode } from '../types'

const props = defineProps<{
  mode: WorkMode | null
  labels: Record<string, string>
}>()

const emit = defineEmits<{
  manage: []
}>()

const PROVIDER_LABELS: Record<RagProviderId, string> = {
  local: '本地库',
  cloud: '云端公共库',
  both: '双路合并'
}

const toolNames = computed(() => (props.mode?.tools ?? []).map((id) => props.labels[id] ?? id))
const providerText = computed(() =>
  props.mode ? PROVIDER_LABELS[props.mode.ragProvider] : '—'
)
const temperatureText = computed(() =>
  props.mode ? String(props.mode.temperature) : '—'
)
const topKText = computed(() => (props.mode ? String(props.mode.topK) : '—'))
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>当前模式</h4>
      <span class="panel-note">{{ mode ? (mode.builtin ? '内置' : '自定义') : '未加载' }}</span>
    </div>

    <div class="mode-card">
      <div class="mode-name">{{ mode?.name ?? '尚未选择模式' }}</div>
      <p class="mode-desc">{{ mode?.description ?? '模式列表加载后会显示说明。' }}</p>

      <div class="mode-kv">
        <span class="mode-key">温度</span>
        <span class="mode-value">{{ temperatureText }}</span>
        <span class="mode-key">检索条数</span>
        <span class="mode-value">{{ topKText }}</span>
        <span class="mode-key">检索来源</span>
        <span class="mode-value">{{ providerText }}</span>
      </div>

      <div class="mode-tools">
        <span class="mode-tools-title">可用工具</span>
        <div v-if="toolNames.length" class="mode-tool-list">
          <span v-for="name in toolNames" :key="name" class="mode-tool">{{ name }}</span>
        </div>
        <span v-else class="mode-tool-empty">纯对话 · 不调用工具</span>
      </div>
    </div>

    <button class="mode-manage" @click="emit('manage')">管理模式</button>
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

.mode-card {
  padding: 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
}

.mode-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.mode-desc {
  margin-top: 4px;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-3);
  word-break: break-word;
}

.mode-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 10px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}

.mode-key {
  font-size: 10.5px;
  color: var(--text-3);
}

.mode-value {
  overflow: hidden;
  font-size: 10.5px;
  color: var(--text-2);
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mode-tools {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 9px;
}

.mode-tools-title {
  font-size: 10.5px;
  color: var(--text-3);
}

.mode-tool-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mode-tool {
  padding: 1px 7px;
  font-size: 10px;
  line-height: 17px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 99px;
}

.mode-tool-empty {
  font-size: 10.5px;
  color: var(--text-3);
}

.mode-manage {
  margin-top: 10px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 6px;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.mode-manage:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--line-2);
}
</style>
