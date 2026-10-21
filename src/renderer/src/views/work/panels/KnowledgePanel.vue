<script setup lang="ts">
// 本地知识库面板：展示资料列表与导入/删除结果，操作通过事件交给 WorkView
import type { KbDocument } from '../types'

const props = defineProps<{
  documents: KbDocument[]
  chunkCount: number
  importing: boolean
  notice: string
  error?: string
}>()

const emit = defineEmits<{
  import: []
  remove: [docId: string]
}>()

/** 列表里只显示文件名 */
function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : path
}
</script>

<template>
  <div class="panel-block">
    <div class="panel-head kb-head">
      <h4>本地知识库</h4>
      <span class="panel-note">{{ documents.length }} 篇 · {{ chunkCount }} 片段</span>
      <button class="kb-import" :disabled="importing" @click="emit('import')">
        {{ importing ? '导入中…' : '导入文件' }}
      </button>
    </div>

    <div v-if="error" class="panel-error">{{ error }}</div>
    <div v-if="notice" class="panel-notice">{{ notice }}</div>

    <ul v-if="documents.length" class="kb-list">
      <li v-for="doc in documents" :key="doc.id" class="kb-item">
        <div class="kb-line">
          <span class="kb-title" :title="doc.title">{{ doc.title }}</span>
          <button class="kb-del" title="删除该资料" @click="emit('remove', doc.id)">×</button>
        </div>
        <div class="kb-line kb-sub">
          <span class="kb-count">{{ doc.chunkCount }} 片段</span>
          <span class="kb-file" :title="doc.path">{{ fileName(doc.path) }}</span>
        </div>
      </li>
    </ul>
    <div v-else class="kb-empty">尚未导入资料，支持 txt / md / html / json / csv</div>
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

.kb-head {
  align-items: center;
}

.kb-head .panel-note {
  margin-left: auto;
  margin-right: 8px;
}

.kb-import {
  flex: 0 0 auto;
  padding: 3px 8px;
  font-size: 10.5px;
  color: var(--text-2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 6px;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.kb-import:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--line-2);
}

.kb-import:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-notice {
  margin-bottom: 7px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--text-2);
  background: var(--accent-soft);
  border: 1px solid rgba(61, 220, 151, 0.24);
  border-radius: var(--radius-sm);
  word-break: break-word;
}

.panel-error {
  margin-bottom: 7px;
  padding: 7px 9px;
  font-size: 10.5px;
  line-height: 1.65;
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.28);
  border-radius: var(--radius-sm);
}

.kb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
}

.kb-item {
  padding: 7px 9px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
  transition: border-color 0.16s ease;
}

.kb-item:hover {
  border-color: var(--line-2);
}

.kb-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.kb-sub {
  margin-top: 3px;
}

.kb-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kb-count {
  flex: 0 0 auto;
  font-size: 9.5px;
  color: var(--text-3);
}

.kb-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 9.5px;
  color: var(--text-3);
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.kb-del {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-3);
  border-radius: 4px;
  transition: color 0.14s ease, background 0.14s ease;
}

.kb-del:hover {
  color: #ff8b8b;
  background: rgba(255, 107, 107, 0.14);
}

.kb-empty {
  padding: 12px 10px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-3);
  text-align: center;
  background: rgba(255, 255, 255, 0.018);
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
}
</style>
