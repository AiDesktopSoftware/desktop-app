import { ipcMain, type WebContents } from 'electron'
import { runAgent } from './agent'
import { capabilityMetadata, getCapability } from './capabilities'
import { getConfig, isConfigured, maskApiKey } from './config'
import { chatOnce, LlmError, streamChat, type LlmMessage } from './llm'
import { loadSessions, saveSessions } from './store'
import { executeTool } from './tools'
import { searchRag } from './rag/provider'
import type { RagQuery } from './rag/types'
import type { WorkSettingsStatus } from '../../renderer/src/views/work/types'

interface ChatStartPayload {
  requestId?: unknown
  messages?: unknown
  mode?: unknown
  model?: unknown
  temperature?: unknown
}

let registered = false
const controllers = new Map<string, AbortController>()

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

  // 能力元数据：只下发界面需要的字段，不包含执行函数与 JSON Schema
  ipcMain.handle('work:cap:list', () => capabilityMetadata())

  // 知识库检索：P0 只跑通统一契约，真实通道由 provider 内部决定是否可用
  ipcMain.handle('work:rag:search', (_event, payload: RagQuery) => searchRag(payload))

  /**
   * 界面直接执行能力，与 Agent 工具调用共用 executeTool。
   * 表单字段都是字符串，按注册表 schema 把数字字段转回 number。
   */
  ipcMain.handle(
    'work:cap:run',
    async (_event, payload: { id?: unknown; args?: unknown }) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      const capability = getCapability(id)
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
}
