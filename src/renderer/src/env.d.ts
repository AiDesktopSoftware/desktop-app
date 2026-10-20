/// <reference types="vite/client" />

import type { WorkApi } from './views/work/types'

declare global {
  interface Window {
    workApi: WorkApi
  }
}

export {}
