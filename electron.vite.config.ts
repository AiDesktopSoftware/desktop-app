import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync } from 'node:fs'

/** 把 src/main/assets/ 复制到 out/main/assets/（托盘图标等） */
function copyMainAssetsPlugin() {
  return {
    name: 'copy-main-assets',
    closeBundle() {
      try {
        mkdirSync('out/main/assets', { recursive: true })
        copyFileSync('src/main/assets/tray.png', 'out/main/assets/tray.png')
      } catch {
        // 开发模式可能没有 assets，忽略
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyMainAssetsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
