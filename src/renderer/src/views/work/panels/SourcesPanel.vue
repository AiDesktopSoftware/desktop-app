<script setup lang="ts">
// 检索来源面板：只展示当前会话汇总的证据，不修改会话
import { computed } from 'vue'
import type { WorkEvidenceItem } from '../types'

const props = defineProps<{
  items: WorkEvidenceItem[]
}>()

const count = computed(() => props.items.length)

/** 联网来源显示域名，去掉 www 前缀 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 本地资料只显示文件名，路径放到 title */
function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : path
}
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>检索来源</h4>
      <span class="panel-note">{{ count }} 条</span>
    </div>

    <ul v-if="items.length" class="evidence">
      <li v-for="item in items" :key="item.url || item.path">
        <a v-if="item.url" :href="item.url" target="_blank" rel="noreferrer" :title="item.url">
          <span class="ev-title">{{ item.title }}</span>
          <span class="ev-host">{{ hostOf(item.url) }}</span>
        </a>
        <div v-else class="ev-static" :title="item.path">
          <span class="ev-title">{{ item.title }}</span>
          <span class="ev-local">{{ item.path ? fileName(item.path) : '本地资料' }}</span>
        </div>
      </li>
    </ul>
    <div v-else class="panel-empty">
      <p>来源会标注在回答中</p>
      <span>Agent 联网搜索、读取网页或检索本地知识库后，来源会自动汇总到这里。</span>
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

.evidence {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 0 2px;
  list-style: none;
}

.evidence a,
.evidence .ev-static {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.evidence a:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--line-2);
}

.ev-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-2);
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ev-host {
  font-size: 10px;
  color: var(--accent);
}

.ev-local {
  overflow: hidden;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
