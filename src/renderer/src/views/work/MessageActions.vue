<script setup lang="ts">
// 消息操作行：复制 / 分支 / 修改（仅用户消息）/ 删除 / 重试（仅助手消息）/ 存为工作流（助手消息有工具轨迹时）
// 按钮默认隐藏，由父级 .msg 的 hover / focus-within 控制显示
import { onBeforeUnmount, ref } from 'vue'

defineProps<{
  role: 'user' | 'assistant'
  /** 生成中禁用除复制外的操作 */
  disabled?: boolean
  /** 正在重新生成，仅助手消息使用 */
  retrying?: boolean
  /** 助手消息是否有工具调用轨迹（可冻结石工作流） */
  hasTools?: boolean
}>()

const emit = defineEmits<{
  copy: []
  branch: []
  edit: []
  delete: []
  retry: []
  saveAsFlow: []
}>()

// 复制成功提示只在本组件内短暂展示，1.2 秒后自动还原
const copied = ref(false)
let copyTimer: number | undefined

function onCopy(): void {
  emit('copy')
  copied.value = true
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
    copyTimer = undefined
  }, 1200)
}

onBeforeUnmount(() => {
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
})
</script>

<template>
  <div class="msg-actions">
    <button
      class="act-btn"
      :class="{ 'is-copied': copied }"
      :title="copied ? '已复制' : '复制内容'"
      @click="onCopy"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h7" />
      </svg>
      <span v-if="copied" class="act-text">已复制</span>
    </button>

    <button
      class="act-btn"
      :disabled="disabled"
      :title="disabled ? '生成中不可分支' : '以这条消息创建分支'"
      @click="emit('branch')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="5" r="2.2" />
        <circle cx="6" cy="19" r="2.2" />
        <circle cx="18" cy="7" r="2.2" />
        <path d="M6 7.2v9.6" />
        <path d="M18 9.2c0 5.2-5.6 4.4-9.6 6.2" />
      </svg>
    </button>

    <button
      v-if="role === 'user'"
      class="act-btn"
      :disabled="disabled"
      :title="disabled ? '生成中不可修改' : '修改后重新生成'"
      @click="emit('edit')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
        <path d="M14.5 7.5l2 2" />
      </svg>
    </button>

    <button
      class="act-btn is-danger"
      :disabled="disabled"
      :title="disabled ? '生成中不可删除' : '删除这条消息'"
      @click="emit('delete')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h16" />
        <path d="M9 7V5h6v2" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>

    <button
      v-if="role === 'assistant'"
      class="act-btn"
      :disabled="disabled || retrying"
      :title="retrying ? '正在重新生成' : '重新生成'"
      @click="emit('retry')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </svg>
      <span v-if="retrying" class="act-text">重试中</span>
    </button>

    <button
      v-if="role === 'assistant' && hasTools"
      class="act-btn"
      :disabled="disabled"
      title="把这次 Agent 调用轨迹冻结为可复用的工作流"
      @click="emit('saveAsFlow')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <path d="M14 4v6h6" />
        <path d="M8 14h8" />
        <path d="M12 11v6" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 24px;
  min-width: 24px;
  padding: 0 4px;
  color: var(--text-3);
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
}

.act-btn:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.act-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.act-btn svg {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
}

.act-btn.is-danger:hover:not(:disabled) {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.12);
}

.act-btn.is-copied,
.act-btn.is-copied:hover {
  color: var(--accent);
}

.act-text {
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}
</style>
