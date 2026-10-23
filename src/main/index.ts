import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { registerWorkIpc } from './work/ipc'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Electron App 自定义属性（标记是否正在退出，防止 close 事件触发 hide 而不是 quit）
const appState = app as unknown as { isQuiting?: boolean }

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭按钮 → 最小化到托盘（不退出进程）
  mainWindow.on('close', (event) => {
    if (!appState.isQuiting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // 外部链接交给系统浏览器打开，不在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite 服务，打包后加载本地构建产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  // 加载托盘图标
  const iconPath = join(__dirname, 'assets', 'tray.png')
  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('AI 研究助手')

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: '新建会话',
      click: () => {
        showMainWindow()
        mainWindow?.webContents.send('app:new-session')
      }
    },
    {
      label: '打开设置',
      click: () => {
        showMainWindow()
        mainWindow?.webContents.send('app:open-prefs')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        appState.isQuiting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)

  // 左键点击托盘图标 → 切换窗口显示状态
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        showMainWindow()
      }
    } else {
      createWindow()
    }
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
  // Windows 上如果窗口被最小化了，先恢复
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
}

app.whenReady().then(() => {
  registerWorkIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

// Windows：关闭主窗口后保留托盘，不退出
// macOS：关闭窗口后保留 dock 图标
// 所有平台：从托盘菜单点"退出"才真正退出
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    // macOS 保留 Dock 行为
  }
  // Windows/Linux：不自动 quit，托盘继续运行
})

// 让 window-all-closed 处理完后再真正退出
app.on('before-quit', () => {
  appState.isQuiting = true
})
