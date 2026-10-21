<script setup lang="ts">
// 产物面板：从最近工作流运行中提取 report 节点输出，提供预览 + Markdown 导出
import { computed } from 'vue'
import type { WorkflowRun } from '../types'

const props = defineProps<{
  runs: WorkflowRun[]
}>()

interface ArtifactItem {
  runId: string
  workflowName: string
  createdAt: number
  title: string
  content: string
}

/** 从最近运行里找出 report 节点产出的产物 */
const artifacts = computed<ArtifactItem[]>(() => {
  const result: ArtifactItem[] = []
  for (const run of props.runs) {
    if (run.status !== 'done' && run.status !== 'failed') continue
    for (const step of run.steps) {
      if (step.status !== 'done' || !step.output) continue
      // 只收集长度 > 50 的实质性输出（过滤空跑）
      if (step.output.trim().length < 50) continue
      // 用 step.label 作为标题
      result.push({
        runId: run.id,
        workflowName: run.name,
        createdAt: run.endedAt ?? run.createdAt,
        title: step.label || '报告',
        content: step.output
      })
    }
  }
  // 按时间倒序
  result.sort((a, b) => b.createdAt - a.createdAt)
  return result
})

async function exportArtifact(item: ArtifactItem): Promise<void> {
  const safeName = item.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || '报告'
  const md = `# ${item.title}\n\n> 来源：${item.workflowName}，生成于 ${new Date(item.createdAt).toLocaleString()}\n\n${item.content}`
  try {
    const api = (window as unknown as { workApi: { workExport: (c: string, n?: string) => Promise<{ ok: boolean; path?: string; message?: string }> } }).workApi
    const res = await api.workExport(md, `${safeName}.md`)
    if (res.ok && res.path) {
      alert(`已导出到：${res.path}`)
    } else if (res.message && res.message !== '已取消') {
      alert(res.message)
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : '导出失败')
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>产物</h4>
      <span class="panel-note">{{ artifacts.length }} 项</span>
    </div>

    <div v-if="artifacts.length === 0" class="panel-empty">
      <p>暂未生成产物</p>
      <span>运行含「生成报告」节点的工作流后，结果会自动出现在这里。</span>
    </div>

    <div v-else class="artifact-list">
      <div v-for="item in artifacts" :key="item.runId + item.title" class="artifact-item">
        <div class="artifact-top">
          <span class="artifact-title">{{ item.title }}</span>
          <span class="artifact-time">{{ formatTime(item.createdAt) }}</span>
        </div>
        <div class="artifact-src">来源：{{ item.workflowName }}</div>
        <div class="artifact-preview">{{ item.content.slice(0, 180) }}{{ item.content.length > 180 ? '…' : '' }}</div>
        <button class="artifact-export" @click="exportArtifact(item)">导出 Markdown</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-block { display: flex; flex-direction: column; }

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 8px;
}
.panel-head h4 {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: 0.03em; color: var(--text-2);
}
.panel-note { font-size: 10.5px; color: var(--text-3); }

.panel-empty {
  display: flex; flex-direction: column; gap: 5px;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.022);
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
}
.panel-empty p { font-size: 12px; color: var(--text-2); }
.panel-empty span { font-size: 10.5px; color: var(--text-3); line-height: 1.7; }

.artifact-list { display: flex; flex-direction: column; gap: 8px; }
.artifact-item {
  display: flex; flex-direction: column; gap: 5px;
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line); border-radius: 6px;
}
.artifact-top { display: flex; align-items: baseline; gap: 6px; }
.artifact-title { font-size: 12px; font-weight: 600; color: var(--text); }
.artifact-time { font-size: 10px; color: var(--text-3); }
.artifact-src { font-size: 10px; color: var(--text-3); }
.artifact-preview {
  font-size: 10.5px; color: var(--text-2); line-height: 1.6;
  white-space: pre-wrap; word-break: break-all;
  max-height: 64px; overflow: hidden;
}
.artifact-export {
  align-self: flex-end;
  padding: 3px 10px; font-size: 10px; color: var(--text-2);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line); border-radius: 4px;
  cursor: pointer;
}
.artifact-export:hover { color: var(--text); border-color: var(--line-2); background: rgba(255, 255, 255, 0.07); }
</style>
