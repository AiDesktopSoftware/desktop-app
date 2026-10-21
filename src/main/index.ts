import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d11',
    autoHideMenuBar: true,
    title: 'AI 多源信息采集与研究助手',
    // 隐藏原生标题栏，窗口按钮以深色浮层形式叠加在自绘标题栏上
    // hover 效果对齐 Trae：最小化/最大化浅灰背景，关闭按钮红色填充
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#10131a',
      symbolColor: '#98a1b0',
      hoverColor: 'rgba(255, 255, 255, 0.08)',
      hoverSymbolColor: '#ffffff',
      closeColor: '#10131a',
      closeSymbolColor: '#98a1b0',
      closeHoverColor: '#e81123',
      closeHoverSymbolColor: '#ffffff',
      height: 40
    } as Electron.TitleBarOverlay,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // 外部链接交给系统浏览器打开，不在应用内新开窗口
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 服务，打包后加载本地构建产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
