import { contextBridge } from 'electron'

// 渲染进程与主进程之间的安全通道，后续各模块的本地能力（读写文件、调用后端）都从这里暴露
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(window as unknown as { api: typeof api }).api = api
}
