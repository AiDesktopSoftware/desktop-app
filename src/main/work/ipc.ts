import { dialog, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { runAgent, resolveApproval } from './agent'
import { capabilityMetadata, getCapability } from './capabilities'
import {
  listCustomCapabilities,
  removeCustomCapability,
  saveCustomCapability,
  type CustomCapability
} from './capabilities/custom'
import { getConfig, getPreferences, isConfigured, maskApiKey, savePreferences } from './config'
import { importFiles, removeDocument } from './kb/ingest'
import { loadIndex } from './kb/store'
import { chatOnce, LlmError, streamChat, type LlmMessage } from './llm'
import {
  duplicateMode,
  getMode,
  listModes,
  removeMode,
  saveMode
} from './modes/store'
import { loadSessions, saveSessions } from './store'
import { executeTool } from './tools'
import { searchRag } from './rag/provider'
import type { RagQuery } from './rag/types'
import {
  listRuns,
  listWorkflows,
  removeWorkflow,
  runWorkflow,
  saveWorkflow
} from './workflow/engine'
import type {
  WorkFlowListResult,
  WorkKbImportResult,
  WorkKbListResult,
  WorkKbRemoveResult,
  WorkModeGetResult,
  WorkModeListResult,
  WorkModeRemoveResult,
  WorkModeResult,
  WorkPreferences,
  WorkPreferencesResult,
  WorkSettingsStatus
} from '../../renderer/src/views/work/types'

interface ChatStartPayload {
  requestId?: unknown
  messages?: unknown
  mode?: unknown
  modeId?: unknown
  model?: unknown
  temperature?: unknown
}

let registered = false
const controllers = new Map<string, AbortController>()
const flowControllers = new Map<string, AbortController>()

function normalizeMessages(input: unknown): LlmMessage[] {
  if (!Array.isArray(input)) return []
  const result: LlmMessage[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    const content = (item as { content?: unknown }).content
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string' || !content.trim()) continue
    result.push({ role, content })
  }
  return result
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 把异常压成一句可读中文原因，避免把整段堆栈回传给界面 */
function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail.slice(0, 160)
}

const KB_EXTENSIONS = ['txt', 'md', 'markdown', 'html', 'htm', 'json', 'csv', 'log']

/**
 * 注册工作模式相关 IPC，多次创建窗口时只注册一次。
 * 模型 Key 只在主进程使用，不会下发到渲染层。
 */
export function registerWorkIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('work:settings:status', (): WorkSettingsStatus => {
    const config = getConfig()
    return {
      configured: Boolean(config.apiKey && config.baseUrl),
      model: config.model,
      keyHint: maskApiKey(config.apiKey)
    }
  })

  ipcMain.handle('work:chat:start', async (event, payload: ChatStartPayload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
    if (!requestId) {
      return { ok: false, message: '请求缺少 requestId' }
    }
    if (!isConfigured()) {
      return { ok: false, message: '未配置 API Key，请在 config.local.json 中填写后重启应用。' }
    }
    const messages = normalizeMessages(payload.messages)
    if (messages.length === 0) {
      return { ok: false, message: '消息内容为空，无法发送。' }
    }

    const mode =
      payload.mode === 'plan' ? 'plan' : payload.mode === 'agent' ? 'agent' : 'chat'
    const modeId = typeof payload.modeId === 'string' && payload.modeId ? payload.modeId : undefined
    const model = typeof payload.model === 'string' && payload.model ? payload.model : undefined
    const temperature =
      typeof payload.temperature === 'number' && Number.isFinite(payload.temperature)
        ? payload.temperature
        : undefined
    const sender = event.sender

    // 同一 requestId 重复发起时，先中断旧请求
    controllers.get(requestId)?.abort()
    const controller = new AbortController()
    controllers.set(requestId, controller)

    try {
      if (mode === 'agent') {
        await runAgent({
          requestId,
          messages,
          modeId,
          model,
          temperature,
          signal: controller.signal,
          send: (channel, payloadBody) => safeSend(sender, channel, payloadBody)
        })
        return { ok: true }
      }

      if (mode === 'plan') {
        const text = await chatOnce({
          messages,
          model,
          temperature: temperature ?? 0.2,
          jsonObject: true,
          signal: controller.signal
        })
        safeSend(sender, 'work:chat:chunk', { requestId, delta: text })
      } else {
        await streamChat({
          messages,
          model,
          temperature,
          signal: controller.signal,
          onDelta: (delta) => safeSend(sender, 'work:chat:chunk', { requestId, delta })
        })
      }
      safeSend(sender, 'work:chat:done', { requestId })
      return { ok: true }
    } catch (error) {
      // 用户主动停止：保留已生成内容，按正常结束处理
      if (isAbortError(error) || controller.signal.aborted) {
        safeSend(sender, 'work:chat:done', { requestId })
        return { ok: false, message: '已停止生成' }
      }
      const message =
        error instanceof LlmError
          ? error.message
          : error instanceof Error
            ? error.message || '模型调用失败'
            : '模型调用失败'
      safeSend(sender, 'work:chat:error', { requestId, message })
      return { ok: false, message }
    } finally {
      if (controllers.get(requestId) === controller) {
        controllers.delete(requestId)
      }
    }
  })

  ipcMain.handle('work:chat:abort', (_event, payload: { requestId?: unknown }) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
    if (requestId) controllers.get(requestId)?.abort()
    return { ok: true }
  })

  ipcMain.handle('work:store:load', () => loadSessions())

  ipcMain.handle('work:store:save', async (_event, sessions: unknown) => {
    await saveSessions(sessions)
    return { ok: true }
  })

  // ---------------- 偏好设置 ----------------

  ipcMain.handle('work:prefs:get', (): WorkPreferencesResult => {
    try {
      return { ok: true, preferences: getPreferences() }
    } catch (error) {
      return { ok: false, message: `读取偏好设置失败：${errorDetail(error)}` }
    }
  })

  ipcMain.handle(
    'work:prefs:set',
    async (_event, payload: { patch?: unknown }): Promise<WorkPreferencesResult> => {
      try {
        const patch =
          payload?.patch && typeof payload.patch === 'object' && !Array.isArray(payload.patch)
            ? (payload.patch as Partial<WorkPreferences>)
            : {}
        const preferences = await savePreferences(patch)
        return { ok: true, preferences }
      } catch (error) {
        return { ok: false, message: `保存偏好设置失败：${errorDetail(error)}` }
      }
    }
  )

  // ---------------- 工作模式 ----------------

  ipcMain.handle('work:mode:list', async (): Promise<WorkModeListResult> => {
    try {
      return { ok: true, modes: await listModes() }
    } catch (error) {
      return { ok: false, modes: [], message: `读取模式失败：${errorDetail(error)}` }
    }
  })

  ipcMain.handle(
    'work:mode:get',
    async (_event, payload: { id?: unknown }): Promise<WorkModeGetResult> => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : undefined
        return { ok: true, mode: await getMode(id) }
      } catch (error) {
        return { ok: false, message: `读取模式失败：${errorDetail(error)}` }
      }
    }
  )

  ipcMain.handle(
    'work:mode:save',
    async (_event, payload: { mode?: unknown }): Promise<WorkModeResult> => {
      try {
        return { ok: true, mode: await saveMode(payload?.mode) }
      } catch (error) {
        return { ok: false, message: errorDetail(error) }
      }
    }
  )

  ipcMain.handle(
    'work:mode:duplicate',
    async (_event, payload: { id?: unknown }): Promise<WorkModeResult> => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : ''
        if (!id) return { ok: false, message: '缺少模式标识，无法复制' }
        return { ok: true, mode: await duplicateMode(id) }
      } catch (error) {
        return { ok: false, message: errorDetail(error) }
      }
    }
  )

  ipcMain.handle(
    'work:mode:remove',
    async (_event, payload: { id?: unknown }): Promise<WorkModeRemoveResult> => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : ''
        if (!id) return { ok: false, message: '缺少模式标识，无法删除' }
        await removeMode(id)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: errorDetail(error) }
      }
    }
  )

  // ---------------- 工作流编排 ----------------

  ipcMain.handle('work:flow:list', async (): Promise<WorkFlowListResult> => {
    try {
      return { ok: true, workflows: await listWorkflows() }
    } catch (error) {
      return { ok: false, workflows: [], message: `读取工作流失败：${errorDetail(error)}` }
    }
  })

  ipcMain.handle('work:flow:save', async (_event, payload: { workflow?: unknown }) => {
    try {
      return await saveWorkflow(payload?.workflow)
    } catch (error) {
      return { ok: false, message: `保存工作流失败：${errorDetail(error)}` }
    }
  })

  ipcMain.handle('work:flow:remove', async (_event, payload: { id?: unknown }) => {
    try {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      return await removeWorkflow(id)
    } catch (error) {
      return { ok: false, message: `删除工作流失败：${errorDetail(error)}` }
    }
  })

  // 异步启动后立即返回 runId，进度通过 work:workflow:step / work:workflow:done 推送
  ipcMain.handle(
    'work:flow:run',
    (
      event,
      payload: { workflowId?: unknown; variables?: unknown; runId?: unknown }
    ): { ok: boolean; runId?: string; message?: string } => {
      const workflowId = typeof payload?.workflowId === 'string' ? payload.workflowId : ''
      if (!workflowId) return { ok: false, message: '缺少工作流标识，无法运行' }

      const runId =
        typeof payload?.runId === 'string' && payload.runId ? payload.runId : randomUUID()
      const variables: Record<string, string> = {}
      if (
        payload?.variables &&
        typeof payload.variables === 'object' &&
        !Array.isArray(payload.variables)
      ) {
        for (const [key, value] of Object.entries(payload.variables as Record<string, unknown>)) {
          if (typeof value === 'string') variables[key] = value
        }
      }

      // 同一 runId 重复发起时先中断旧运行
      flowControllers.get(runId)?.abort()
      const controller = new AbortController()
      flowControllers.set(runId, controller)
      const sender = event.sender

      // 窗口销毁时中止运行，避免后台空转
      const onDestroyed = (): void => controller.abort()
      sender.once('destroyed', onDestroyed)

      void runWorkflow({
        workflowId,
        variables,
        runId,
        signal: controller.signal,
        send: (channel, body) => safeSend(sender, channel, body)
      })
        .catch((error) => {
          safeSend(sender, 'work:workflow:done', {
            runId,
            ok: false,
            result: '',
            message: `工作流运行失败：${errorDetail(error)}`
          })
        })
        .finally(() => {
          try {
            sender.removeListener('destroyed', onDestroyed)
          } catch {
            // 窗口已销毁时移除监听可能失败，忽略
          }
          if (flowControllers.get(runId) === controller) flowControllers.delete(runId)
        })

      return { ok: true, runId }
    }
  )

  ipcMain.handle('work:flow:abort', (_event, payload: { runId?: unknown }) => {
    const runId = typeof payload?.runId === 'string' ? payload.runId : ''
    if (runId) flowControllers.get(runId)?.abort()
    return { ok: true }
  })

  ipcMain.handle('work:flow:runs', async () => {
    try {
      return { ok: true, runs: await listRuns() }
    } catch (error) {
      return { ok: false, runs: [], message: `读取运行记录失败：${errorDetail(error)}` }
    }
  })

  // 能力元数据：只下发界面需要的字段，不包含执行函数与 JSON Schema
  ipcMain.handle('work:cap:list', () => capabilityMetadata())

  // 知识库检索：本地通道走真实索引，云端通道尚未接入
  ipcMain.handle('work:rag:search', (_event, payload: RagQuery) => searchRag(payload))

  // ---------------- 本地知识库 ----------------

  ipcMain.handle('work:kb:list', async (): Promise<WorkKbListResult> => {
    try {
      const index = await loadIndex()
      return { ok: true, documents: index.documents, chunkCount: index.chunks.length }
    } catch (error) {
      return {
        ok: false,
        documents: [],
        chunkCount: 0,
        message: `读取本地知识库失败：${errorDetail(error)}`
      }
    }
  })

  ipcMain.handle(
    'work:kb:import',
    async (_event, payload: { paths?: unknown }): Promise<WorkKbImportResult> => {
      try {
        let paths: string[] = []
        if (Array.isArray(payload?.paths)) {
          paths = payload.paths.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          )
        }

        // 未指定路径时弹系统文件选择框，支持多选
        if (paths.length === 0) {
          const picked = await dialog.showOpenDialog({
            title: '导入到知识库',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '文本资料', extensions: KB_EXTENSIONS }]
          })
          if (picked.canceled || picked.filePaths.length === 0) {
            return { ok: true, canceled: true, added: [], skipped: [] }
          }
          paths = picked.filePaths
        }

        const result = await importFiles(paths)
        return { ok: true, canceled: false, ...result }
      } catch (error) {
        return {
          ok: false,
          canceled: false,
          added: [],
          skipped: [],
          message: `导入失败：${errorDetail(error)}`
        }
      }
    }
  )

  ipcMain.handle(
    'work:kb:remove',
    async (_event, payload: { docId?: unknown }): Promise<WorkKbRemoveResult> => {
      try {
        const docId = typeof payload?.docId === 'string' ? payload.docId : ''
        if (!docId) return { ok: false, message: '缺少文档标识，无法删除' }
        const removed = await removeDocument(docId)
        return removed
          ? { ok: true }
          : { ok: false, message: '未找到该文档，可能已被删除' }
      } catch (error) {
        return { ok: false, message: `删除失败：${errorDetail(error)}` }
      }
    }
  )

  // 供界面单独检索本地库：复用统一检索入口，保证结构与 work:rag:search 一致
  ipcMain.handle('work:kb:search', async (_event, payload: { query?: unknown; topK?: unknown }) => {
    try {
      const query = typeof payload?.query === 'string' ? payload.query : ''
      const topK =
        typeof payload?.topK === 'number' && Number.isFinite(payload.topK)
          ? payload.topK
          : 5
      return await searchRag({ query, provider: 'local', topK })
    } catch (error) {
      return {
        ok: false,
        provider: 'local',
        chunks: [],
        message: `检索失败：${errorDetail(error)}`
      }
    }
  })

  /**
   * 界面直接执行能力，与 Agent 工具调用共用 executeTool。
   * 表单字段都是字符串，按注册表 schema 把数字字段转回 number。
   */
  ipcMain.handle(
    'work:cap:run',
    async (_event, payload: { id?: unknown; args?: unknown }) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      const capability = await getCapability(id)
      if (!capability) {
        return { ok: false, content: `未知能力：${id || '(空)'}` }
      }

      const rawArgs =
        payload?.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
          ? (payload.args as Record<string, unknown>)
          : {}
      const args: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rawArgs)) {
        const spec = capability.paramsSchema.properties[key]
        if (!spec) continue
        if (typeof value !== 'string') {
          args[key] = value
          continue
        }
        const trimmed = value.trim()
        if (!trimmed && !capability.paramsSchema.required?.includes(key)) continue
        if (spec.type === 'number') {
          const numeric = Number(trimmed)
          args[key] = Number.isFinite(numeric) ? numeric : trimmed
          continue
        }
        args[key] = value
      }

      return executeTool(capability.id, args)
    }
  )

  // ---------------- 用户自定义 HTTP 能力 ----------------

  ipcMain.handle('work:cap:custom:list', async () => {
    try {
      const list = await listCustomCapabilities()
      return { ok: true, capabilities: list }
    } catch (error) {
      return { ok: false, capabilities: [], message: `读取自定义能力失败：${errorDetail(error)}` }
    }
  })

  ipcMain.handle(
    'work:cap:custom:save',
    async (_event, payload: { capability?: unknown }) => {
      try {
        return await saveCustomCapability(payload?.capability)
      } catch (error) {
        return { ok: false, message: `保存自定义能力失败：${errorDetail(error)}` }
      }
    }
  )

  ipcMain.handle(
    'work:cap:custom:remove',
    async (_event, payload: { id?: unknown }) => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : ''
        if (!id) return { ok: false, message: '缺少自定义能力标识' }
        return await removeCustomCapability(id)
      } catch (error) {
        return { ok: false, message: `删除自定义能力失败：${errorDetail(error)}` }
      }
    }
  )

  // ---------------- 文件导出 ----------------

  ipcMain.handle(
    'work:export',
    async (_event, payload: { content?: unknown; defaultName?: unknown; filters?: unknown }) => {
      try {
        const content = typeof payload?.content === 'string' ? payload.content : ''
        const defaultName = typeof payload?.defaultName === 'string' ? payload.defaultName : 'export.md'
        const filters = Array.isArray(payload?.filters)
          ? (payload.filters as { name: string; extensions: string[] }[])
          : [
              { name: 'Markdown', extensions: ['md'] },
              { name: 'JSON', extensions: ['json'] },
              { name: '文本', extensions: ['txt'] }
            ]
        const result = await dialog.showSaveDialog({
          title: '导出会话',
          defaultPath: defaultName,
          filters
        })
        if (result.canceled || !result.filePath) {
          return { ok: false, message: '已取消' }
        }
        const { promises: fs } = await import('node:fs')
        await fs.writeFile(result.filePath, content, 'utf-8')
        return { ok: true, path: result.filePath }
      } catch (error) {
        return { ok: false, message: `导出失败：${errorDetail(error)}` }
      }
    }
  )

  // ---------------- 工具审批回传 ----------------

  ipcMain.handle(
    'work:tool:approve:result',
    async (_event, payload: { requestId?: unknown; approved?: unknown }) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
      const approved = Boolean(payload?.approved)
      if (!requestId) return { ok: false }
      resolveApproval(requestId, approved)
      return { ok: true }
    }
  )
}
