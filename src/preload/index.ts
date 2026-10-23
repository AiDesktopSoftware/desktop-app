import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CustomCapability,
  RagQuery,
  RagResult,
  WorkApi,
  WorkCapability,
  WorkCapabilityId,
  WorkCapabilityRunResult,
  WorkChatStartPayload,
  WorkCustomCapListResult,
  WorkCustomCapRemoveResult,
  WorkFlowDoneEvent,
  WorkFlowListResult,
  WorkFlowRemoveResult,
  WorkFlowRunResult,
  WorkFlowRunsResult,
  WorkFlowSaveResult,
  WorkFlowStepEvent,
  WorkKbImportResult,
  WorkKbListResult,
  WorkKbRemoveResult,
  WorkMode,
  WorkModeListResult,
  WorkModeRemoveResult,
  WorkModeResult,
  WorkPreferences,
  WorkPreferencesResult,
  WorkSession,
  WorkSettingsStatus,
  WorkflowDefinition
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
    ipcRenderer.invoke('work:cap:run', { id, args }) as Promise<WorkCapabilityRunResult>,
  searchRag: (query: RagQuery) =>
    ipcRenderer.invoke('work:rag:search', query) as Promise<RagResult>,
  kbList: () => ipcRenderer.invoke('work:kb:list') as Promise<WorkKbListResult>,
  kbImport: (paths?: string[]) =>
    ipcRenderer.invoke('work:kb:import', { paths }) as Promise<WorkKbImportResult>,
  kbRemove: (docId: string) =>
    ipcRenderer.invoke('work:kb:remove', { docId }) as Promise<WorkKbRemoveResult>,
  prefsGet: () =>
    ipcRenderer.invoke('work:prefs:get') as Promise<WorkPreferencesResult>,
  prefsSet: (patch: Partial<WorkPreferences>) =>
    ipcRenderer.invoke('work:prefs:set', { patch }) as Promise<WorkPreferencesResult>,
  modeList: () => ipcRenderer.invoke('work:mode:list') as Promise<WorkModeListResult>,
  modeSave: (mode: WorkMode) =>
    ipcRenderer.invoke('work:mode:save', { mode }) as Promise<WorkModeResult>,
  modeDuplicate: (id: string) =>
    ipcRenderer.invoke('work:mode:duplicate', { id }) as Promise<WorkModeResult>,
  modeRemove: (id: string) =>
    ipcRenderer.invoke('work:mode:remove', { id }) as Promise<WorkModeRemoveResult>,
  flowList: () => ipcRenderer.invoke('work:flow:list') as Promise<WorkFlowListResult>,
  flowSave: (workflow: WorkflowDefinition) =>
    ipcRenderer.invoke('work:flow:save', { workflow }) as Promise<WorkFlowSaveResult>,
  flowRemove: (id: string) =>
    ipcRenderer.invoke('work:flow:remove', { id }) as Promise<WorkFlowRemoveResult>,
  flowRun: (payload: { workflowId: string; variables: Record<string, string>; runId: string }) =>
    ipcRenderer.invoke('work:flow:run', payload) as Promise<WorkFlowRunResult>,
  flowAbort: async (runId: string) => {
    await ipcRenderer.invoke('work:flow:abort', { runId })
  },
  flowRuns: () => ipcRenderer.invoke('work:flow:runs') as Promise<WorkFlowRunsResult>,
  onFlowStep: (cb) => subscribe<WorkFlowStepEvent>('work:workflow:step', cb),
  onFlowDone: (cb) => subscribe<WorkFlowDoneEvent>('work:workflow:done', cb),
  // 工具审批（L1-1）
  onToolApprove: (cb) => {
    const handler = (_evt: Electron.IpcRendererEvent, payload: { requestId: string; toolName: string; args: Record<string, unknown>; reason: string }) => cb(payload)
    ipcRenderer.on('work:tool:approve', handler)
    return () => ipcRenderer.removeListener('work:tool:approve', handler)
  },
  toolApproveResult: (requestId: string, approved: boolean) =>
    ipcRenderer.invoke('work:tool:approve:result', { requestId, approved }),
  // 用户自定义 HTTP 能力管理
  customCapList: () =>
    ipcRenderer.invoke('work:cap:custom:list') as Promise<WorkCustomCapListResult>,
  customCapSave: (capability: CustomCapability) =>
    ipcRenderer.invoke('work:cap:custom:save', { capability }),
  customCapRemove: (id: string) =>
    ipcRenderer.invoke('work:cap:custom:remove', { id }) as Promise<WorkCustomCapRemoveResult>,
  // 文件导出（主进程弹保存对话框 + 写文件）
  workExport: (content: string, defaultName?: string) =>
    ipcRenderer.invoke('work:export', { content, defaultName }) as Promise<{ ok: boolean; path?: string; message?: string }>,
  // 托盘菜单命令（主进程通过 mainWindow.webContents.send 推送）
  onTrayCommand: (cb: (cmd: 'new-session' | 'open-prefs') => void) => {
    const onNew = () => cb('new-session')
    const onPrefs = () => cb('open-prefs')
    ipcRenderer.on('app:new-session', onNew)
    ipcRenderer.on('app:open-prefs', onPrefs)
    return () => {
      ipcRenderer.removeListener('app:new-session', onNew)
      ipcRenderer.removeListener('app:open-prefs', onPrefs)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('workApi', workApi)
} else {
  ;(window as unknown as { api: typeof api }).api = api
  ;(window as unknown as { workApi: WorkApi }).workApi = workApi
}
