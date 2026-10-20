import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  WorkApi,
  WorkCapability,
  WorkCapabilityId,
  WorkCapabilityRunResult,
  WorkChatStartPayload,
  WorkSession,
  WorkSettingsStatus
} from '../renderer/src/views/work/types'

// 渲染进程与主进程之间的安全通道，后续各模块的本地能力（读写文件、调用后端）都从这里暴露
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// 工作模式：流式模型调用与会话存储，Key 始终留在主进程
const workApi: WorkApi = {
  chatStart: (payload: WorkChatStartPayload) => ipcRenderer.invoke('work:chat:start', payload),
  chatAbort: async (requestId: string) => {
    await ipcRenderer.invoke('work:chat:abort', { requestId })
  },
  onChunk: (cb) => subscribe('work:chat:chunk', cb),
  onDone: (cb) => subscribe('work:chat:done', cb),
  onError: (cb) => subscribe('work:chat:error', cb),
  onTool: (cb) => subscribe('work:agent:tool', cb),
  onEvidence: (cb) => subscribe('work:agent:evidence', cb),
  settingsStatus: () =>
    ipcRenderer.invoke('work:settings:status') as Promise<WorkSettingsStatus>,
  loadSessions: () => ipcRenderer.invoke('work:store:load') as Promise<WorkSession[]>,
  saveSessions: async (sessions: WorkSession[]) => {
    await ipcRenderer.invoke('work:store:save', sessions)
  },
  listCapabilities: () =>
    ipcRenderer.invoke('work:cap:list') as Promise<WorkCapability[]>,
  runCapability: (id: WorkCapabilityId, args: Record<string, unknown>) =>
    ipcRenderer.invoke('work:cap:run', { id, args }) as Promise<WorkCapabilityRunResult>
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('workApi', workApi)
} else {
  ;(window as unknown as { api: typeof api }).api = api
  ;(window as unknown as { workApi: WorkApi }).workApi = workApi
}
