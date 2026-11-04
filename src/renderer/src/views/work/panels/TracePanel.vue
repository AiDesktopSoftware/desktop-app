<script setup lang="ts">
// 执行轨迹面板：展示当前消息的 Agent todo 进度 + 工具调用
import { computed } from 'vue'
import type { WorkToolCall, WorkTodoItem } from '../types'

const props = defineProps<{
  tools: WorkToolCall[]
  todos: WorkTodoItem[]
  labels: Record<string, string>
}>()

const doneCount = computed(() => props.tools.filter((tool) => tool.status === 'done').length)
const todoDoneCount = computed(() => props.todos.filter((t) => t.done).length)

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
    <!-- Agent Todo 进度 -->
    <div v-if="todos.length" class="panel-block">
      <div class="panel-head">
        <h4>任务进度</h4>
        <span class="panel-note">{{ todoDoneCount }} / {{ todos.length }}</span>
      </div>
      <ul class="todos">
        <li v-for="(todo, idx) in todos" :key="idx" :class="{ 'is-done': todo.done }">
          <span class="todo-box" :class="todo.done ? 'checked' : ''">
            <span v-if="todo.done" class="todo-check">✓</span>
          </span>
          <span class="todo-text">{{ todo.text }}</span>
        </li>
      </ul>
    </div>

    <!-- 工具调用轨迹 -->
    <div v-if="tools.length" class="panel-block">
      <div class="panel-head">
        <h4>执行轨迹</h4>
        <span class="panel-note">{{ doneCount }} / {{ tools.length }}</span>
      </div>

      <ul class="trace">
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
    </div>

    <div v-if="!tools.length && !todos.length" class="panel-empty">
      <p>还没有执行记录</p>
      <span>Agent 在回答复杂问题时会自动拆解任务步骤（任务进度）并调用工具（执行轨迹），两者都会实时显示在这里。</span>
    </div>
  </div>
</template>

<style scoped>
.panel-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4px 2px 6px;
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

/* ---------- Todo 列表 ---------- */

.todos {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 2px 8px;
  margin: 0 0 8px;
  border-bottom: 1px solid var(--line-2);
  list-style: none;
}

.todos li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
}

.todo-box {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 1px solid var(--text-3);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.todo-box.checked {
  background: var(--accent);
  border-color: var(--accent);
}

.todo-check {
  font-size: 10px;
  color: #0b0f14;
  font-weight: 700;
}

.todo-text {
  flex: 1;
  word-break: break-word;
}

.todos li.is-done .todo-text {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-opacity: 0.5;
}

/* ---------- 工具调用轨迹 ---------- */

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
