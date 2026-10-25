/// <reference types="vite/client" />

import type { WorkApi } from './views/work/types'

// 预加载脚本暴露的通用窗口控制 API（App.vue 自绘标题栏按钮用）
interface WindowControlApi {
  platform: string
  versions: { electron: string; chrome: string }
  minimizeWindow: () => void
  toggleMaximize: () => void
  closeWindow: () => void
  onMaximizeState: (cb: (isMaximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    api: WindowControlApi
    workApi: WorkApi
  }
}

export {}
