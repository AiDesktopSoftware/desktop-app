<script setup lang="ts">
// 执行轨迹面板：展示当前消息的工具调用，状态随主进程事件实时更新
import { computed } from 'vue'
import type { WorkToolCall } from '../types'

const props = defineProps<{
  tools: WorkToolCall[]
  labels: Record<string, string>
}>()

const doneCount = computed(() => props.tools.filter((tool) => tool.status === 'done').length)

function toolLabel(name: string): string {
  return props.labels[name] ?? name
}

function statusText(status: WorkToolCall['status']): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'done':
      return '完成'
    default:
      return '失败'
  }
}

/** 从参数里挑一个最有代表性的字段做摘要 */
function argSummary(args: Record<string, unknown>): string {
  const keys = ['query', 'url', 'path', 'dir', 'command']
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      const single = value.replace(/\s+/g, ' ').trim()
      return single.length > 40 ? `${single.slice(0, 40)}…` : single
    }
  }
  return ''
}
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>执行轨迹</h4>
      <span class="panel-note">{{ doneCount }} / {{ tools.length }}</span>
    </div>

    <ul v-if="tools.length" class="trace">
      <li v-for="tool in tools" :key="tool.id" :class="'is-' + tool.status">
        <span class="trace-dot" />
        <span class="trace-title">
          {{ toolLabel(tool.name) }}
          <template v-if="argSummary(tool.args)">
            · {{ argSummary(tool.args) }}
          </template>
        </span>
        <span class="trace-state">{{ statusText(tool.status) }}</span>
      </li>
    </ul>
    <div v-else class="panel-empty">
      <p>还没有工具调用</p>
      <span>Agent 执行联网搜索、读取文件或检索知识库时，调用过程会实时显示在这里。</span>
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

.panel-empty {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
}

.panel-empty p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}

.panel-empty span {
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
}

.trace {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px;
  list-style: none;
}

.trace li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-2);
}

.trace-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  background: transparent;
  border: 1px solid var(--text-3);
  border-radius: 99px;
}

.trace li.is-running .trace-dot {
  background: var(--accent);
  border-color: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
    box-shadow: 0 0 0 5px var(--accent-soft);
  }
}

.trace li.is-done .trace-dot {
  background: var(--accent);
  border-color: var(--accent);
}

.trace li.is-failed .trace-dot {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.trace-title {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trace-state {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
}
</style>
