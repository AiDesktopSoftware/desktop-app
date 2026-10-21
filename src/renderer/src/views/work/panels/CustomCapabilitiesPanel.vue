<script setup lang="ts">
// 用户自定义 HTTP 能力面板：列表 + 新建/编辑表单
import { onMounted, ref } from 'vue'
import type { CustomCapability } from '../types'

const MAX_COUNT = 20

const capabilities = ref<CustomCapability[]>([])
const loading = ref(false)
const editing = ref<CustomCapability | null>(null)
const errorMsg = ref('')

// 表单草稿
type DraftParam = { key: string; type: 'string' | 'number' | 'boolean'; description: string }
const form = ref({
  name: '',
  description: '',
  method: 'GET' as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: '',
  headers: [{ key: '', value: '' }],
  bodyTemplate: '',
  bodyMime: 'application/json',
  params: [{ key: '', type: 'string' as DraftParam['type'], description: '' }] as DraftParam[],
  required: [] as string[],
  responsePath: ''
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const result = await window.workApi.customCapList()
    if (result.ok) {
      capabilities.value = result.capabilities
    } else {
      errorMsg.value = result.message ?? '加载失败'
    }
  } catch (err) {
    errorMsg.value = String(err)
  } finally {
    loading.value = false
  }
}

function startNew() {
  editing.value = null
  form.value = {
    name: '',
    description: '',
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '' }],
    bodyTemplate: '',
    bodyMime: 'application/json',
    params: [{ key: '', type: 'string', description: '' }],
    required: [],
    responsePath: ''
  }
}

function startEdit(item: CustomCapability) {
  editing.value = item
  form.value = {
    name: item.name,
    description: item.description,
    method: item.method,
    url: item.url,
    headers: Object.entries(item.headers ?? {}).length > 0
      ? Object.entries(item.headers ?? {}).map(([k, v]) => ({ key: k, value: v }))
      : [{ key: '', value: '' }],
    bodyTemplate: item.bodyTemplate ?? '',
    bodyMime: item.bodyMime ?? 'application/json',
    params: Object.entries(item.paramsSchema).map(([key, schema]) => ({
      key,
      type: schema.type,
      description: schema.description ?? ''
    })),
    required: [...(item.required ?? [])],
    responsePath: item.responsePath ?? ''
  }
}

function cancelEdit() {
  editing.value = null
}

async function saveForm() {
  errorMsg.value = ''
  // 基本校验
  if (!form.value.name.trim()) { errorMsg.value = '名称必填'; return }
  if (!form.value.description.trim()) { errorMsg.value = '描述必填（告诉 Agent 什么时候用它）'; return }
  if (!form.value.url.trim()) { errorMsg.value = 'URL 必填'; return }
  const validUrl = /^https?:\/\//i.test(form.value.url.trim())
  if (!validUrl) { errorMsg.value = 'URL 只允许 http:// 或 https://'; return }

  const validParams = form.value.params.filter((p) => p.key.trim())
  if (validParams.length === 0) { errorMsg.value = '至少声明一个参数'; return }

  // 组装 CustomCapability
  const headersObj: Record<string, string> = {}
  for (const h of form.value.headers) {
    if (h.key.trim()) headersObj[h.key.trim()] = h.value.trim()
  }
  const paramsSchema: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string }> = {}
  for (const p of validParams) {
    const entry: { type: 'string' | 'number' | 'boolean'; description?: string } = { type: p.type }
    if (p.description.trim()) entry.description = p.description.trim()
    paramsSchema[p.key.trim()] = entry
  }
  const reqList = form.value.required.filter((k) => validParams.some((p) => p.key.trim() === k))

  const draft: CustomCapability = {
    id: editing.value?.id ?? '',
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    method: form.value.method,
    url: form.value.url.trim(),
    headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    bodyTemplate: form.value.bodyTemplate.trim() || undefined,
    bodyMime: form.value.bodyMime.trim() || 'application/json',
    paramsSchema,
    required: reqList.length > 0 ? reqList : undefined,
    responsePath: form.value.responsePath.trim() || undefined,
    createdAt: editing.value?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  }

  try {
    const result = await window.workApi.customCapSave(draft)
    if (result.ok) {
      editing.value = null
      await load()
    } else {
      errorMsg.value = result.message ?? '保存失败'
    }
  } catch (err) {
    errorMsg.value = String(err)
  }
}

async function removeItem(item: CustomCapability) {
  errorMsg.value = ''
  if (!confirm(`确定删除自定义能力「${item.name}」？此操作不可恢复。`)) return
  try {
    const result = await window.workApi.customCapRemove(item.id)
    if (result.ok) {
      await load()
    } else {
      errorMsg.value = result.message ?? '删除失败'
    }
  } catch (err) {
    errorMsg.value = String(err)
  }
}

function addHeader() { form.value.headers.push({ key: '', value: '' }) }
function removeHeader(idx: number) { form.value.headers.splice(idx, 1) }
function addParam() { form.value.params.push({ key: '', type: 'string', description: '' }) }
function removeParam(idx: number) { form.value.params.splice(idx, 1) }
function toggleRequired(key: string) {
  const idx = form.value.required.indexOf(key)
  if (idx >= 0) form.value.required.splice(idx, 1)
  else form.value.required.push(key)
}

onMounted(load)
</script>

<template>
  <div class="panel-block">
    <div class="panel-head">
      <h4>自定义 HTTP 能力</h4>
      <button v-if="!editing && capabilities.length < MAX_COUNT" class="panel-btn" @click="startNew">+ 新建</button>
    </div>

    <p class="panel-hint">把任何 HTTP 接口注册为工具，Agent 能像调内置能力一样调用它。最多 {{ MAX_COUNT }} 个。</p>

    <p v-if="errorMsg" class="panel-error">{{ errorMsg }}</p>

    <!-- 列表视图 -->
    <template v-if="!editing">
      <div v-if="loading" class="panel-empty">加载中…</div>
      <div v-else-if="capabilities.length === 0" class="panel-empty">
        还没有自定义能力。点击右上角「+ 新建」开始。
      </div>
      <div v-else class="cap-list">
        <div v-for="item in capabilities" :key="item.id" class="cap-item">
          <div class="cap-item-top">
            <span class="cap-method" :class="'m-' + item.method.toLowerCase()">{{ item.method }}</span>
            <span class="cap-name">{{ item.name }}</span>
          </div>
          <div class="cap-url" :title="item.url">{{ item.url }}</div>
          <div class="cap-actions">
            <button class="cap-btn" @click="startEdit(item)">编辑</button>
            <button class="cap-btn danger" @click="removeItem(item)">删除</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 编辑表单 -->
    <template v-else>
      <div class="form-block">
        <div class="form-row">
          <label>名称</label>
          <input v-model="form.name" type="text" placeholder="例如：Dify 知识库检索" maxlength="30" />
        </div>
        <div class="form-row">
          <label>描述</label>
          <textarea v-model="form.description" placeholder="告诉 Agent 什么时候应该调用这个能力" rows="2" />
        </div>
        <div class="form-row two-col">
          <div>
            <label>方法</label>
            <select v-model="form.method">
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
              <option>DELETE</option>
            </select>
          </div>
          <div>
            <label>响应路径（可选）</label>
            <input v-model="form.responsePath" type="text" placeholder="例如 $.data.items[0].title" />
          </div>
        </div>
        <div class="form-row">
          <label>URL（支持 <code v-pre>{{参数名}}</code> 占位）</label>
          <input v-model="form.url" type="text" placeholder="https://api.example.com/v1/search?q={{query}}" />
        </div>

        <!-- 参数定义 -->
        <div class="form-section">
          <label>参数定义</label>
          <p class="form-hint">声明给这个能力传哪些参数，Agent 调用时会看到它们。</p>
          <div v-for="(param, idx) in form.params" :key="idx" class="param-row">
            <input v-model="param.key" type="text" placeholder="参数名" />
            <select v-model="param.type">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <input v-model="param.description" type="text" placeholder="参数说明（可选）" />
            <label class="req-check">
              <input
                type="checkbox"
                :checked="form.required.includes(param.key)"
                @change="param.key && toggleRequired(param.key)"
              />
              必填
            </label>
            <button class="cap-btn danger small" @click="removeParam(idx)">×</button>
          </div>
          <button class="cap-btn small" @click="addParam">+ 添加参数</button>
        </div>

        <!-- 请求头 -->
        <div class="form-section" v-if="form.method !== 'GET'">
          <label>请求头（可选）</label>
          <div v-for="(h, idx) in form.headers" :key="idx" class="kv-row">
            <input v-model="h.key" type="text" placeholder="Header Key" />
            <input v-model="h.value" type="text" placeholder="Value，支持 <code v-pre>{{参数名}}</code>" />
            <button class="cap-btn danger small" @click="removeHeader(idx)">×</button>
          </div>
          <button class="cap-btn small" @click="addHeader">+ 添加 Header</button>
        </div>

        <!-- 请求体 -->
        <div class="form-section" v-if="form.method !== 'GET' && form.method !== 'DELETE'">
          <label>请求体模板（可选）</label>
          <p class="form-hint">不填时自动把所有参数按 JSON 发送。模板里可以写 <code v-pre>{{参数名}}</code> 占位。</p>
          <textarea v-model="form.bodyTemplate" rows="3" placeholder='{"query": "{{query}}", "limit": 5}' />
          <div class="form-row single">
            <label>MIME</label>
            <input v-model="form.bodyMime" type="text" placeholder="application/json" />
          </div>
        </div>

        <div class="form-actions">
          <button class="panel-btn" @click="cancelEdit">取消</button>
          <button class="panel-btn primary" @click="saveForm">保存</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel-block { display: flex; flex-direction: column; }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 6px;
}

.panel-head h4 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-2);
}

.panel-hint {
  margin: 0 0 8px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.panel-error {
  margin: 0 0 8px;
  padding: 6px 8px;
  font-size: 10.5px;
  color: #c06a6a;
  background: rgba(192, 106, 106, 0.08);
  border: 1px solid rgba(192, 106, 106, 0.25);
  border-radius: 5px;
}

.panel-empty {
  padding: 20px 10px;
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  background: rgba(255, 255, 255, 0.025);
  border: 1px dashed var(--line);
  border-radius: 7px;
}

.panel-btn {
  padding: 4px 10px;
  font-size: 10.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 5px;
  cursor: pointer;
}
.panel-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--text); }
.panel-btn.primary {
  color: #0d1117;
  background: var(--lime);
  border-color: var(--lime);
}
.panel-btn.primary:hover { filter: brightness(1.08); }

/* 列表 */
.cap-list { display: flex; flex-direction: column; gap: 8px; }
.cap-item {
  padding: 9px 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--line);
  border-radius: 7px;
}
.cap-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.cap-method {
  padding: 1px 6px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}
.cap-method.m-get { color: #6fb07a; }
.cap-method.m-post { color: #8ab4f8; }
.cap-method.m-put { color: #d4a85c; }
.cap-method.m-patch { color: #c39bce; }
.cap-method.m-delete { color: #c06a6a; }
.cap-name { font-size: 12px; font-weight: 600; color: var(--text); }
.cap-url {
  margin-bottom: 6px;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cap-actions { display: flex; gap: 6px; }
.cap-btn {
  padding: 2px 8px;
  font-size: 10px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
}
.cap-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.08); }
.cap-btn.small { padding: 1px 6px; font-size: 10px; }
.cap-btn.danger { color: #c06a6a; }
.cap-btn.danger:hover { background: rgba(192, 106, 106, 0.1); }

/* 表单 */
.form-block { display: flex; flex-direction: column; gap: 10px; }
.form-row { display: flex; flex-direction: column; gap: 3px; }
.form-row label { font-size: 10px; color: var(--text-3); }
.form-row input[type="text"],
.form-row input[type="url"],
.form-row select,
.form-row textarea {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 5px;
  outline: none;
  box-sizing: border-box;
}
.form-row input:focus, .form-row textarea:focus, .form-row select:focus {
  border-color: var(--line-2);
}
.form-row textarea { resize: vertical; min-height: 48px; font-family: inherit; }
.form-row.two-col { flex-direction: row; gap: 8px; }
.form-row.two-col > div { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.form-row.single { flex-direction: row; align-items: center; gap: 6px; }
.form-row.single label { flex: 0 0 auto; }
.form-row.single input { flex: 1; }

.form-section {
  display: flex; flex-direction: column; gap: 5px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}
.form-section > label { font-size: 10.5px; color: var(--text-2); font-weight: 600; }
.form-hint { margin: 0; font-size: 10px; color: var(--text-3); }

.param-row, .kv-row {
  display: flex; gap: 5px; align-items: center;
}
.param-row input:first-child { flex: 1.2; }
.param-row select { flex: 0.7; padding: 5px 6px; font-size: 10px; }
.param-row input:nth-child(3) { flex: 1.5; }
.kv-row input { flex: 1; padding: 5px 7px; font-size: 10.5px; }

.req-check {
  display: flex; align-items: center; gap: 3px;
  font-size: 10px; color: var(--text-3); white-space: nowrap;
}

.form-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 6px; }
</style>
