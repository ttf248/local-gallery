import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'

// 保持对窗口对象的全局引用，如果不这么做的话，当 JavaScript 对象被
// 垃圾回收的时候，window 将会被自动关闭
let mainWindow: BrowserWindow | null = null

const isDev = process.env.NODE_ENV === 'development'

function createWindow(): void {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false, // 先不显示，等加载完成后再显示
    webPreferences: {
      nodeIntegration: false, // 为了安全，禁用 Node.js 集成
      contextIsolation: true, // 启用上下文隔离
      preload: path.join(__dirname, 'preload.js'), // 预加载脚本
    },
    titleBarStyle: 'default',
    autoHideMenuBar: !isDev, // 开发环境下显示菜单栏
  })

  // 加载应用
  if (isDev) {
    // 开发环境：加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:5173')
    // 打开开发者工具
    mainWindow.webContents.openDevTools()
  } else {
    // 生产环境：加载构建后的文件
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 当 window 被关闭，这个事件会被触发
  mainWindow.on('closed', () => {
    // 解除对 window 对象的引用，如果你的应用支持多窗口的话，
    // 通常会把多个 window 对象存储在一个数组里面，与此同时，你应该删除相应的元素
    mainWindow = null
  })

  // 当页面加载完成时显示窗口
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })
}

// Electron 会在初始化后并准备创建浏览器窗口的时候，调用这个函数
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    // 在 macOS 上，当单击 dock 图标并且没有其他窗口打开时
    // 通常在应用程序中重新创建窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 当全部窗口关闭时退出
app.on('window-all-closed', () => {
  // 在 macOS 上，应用程序及其菜单栏通常保持活跃状态
  // 直到用户使用 Cmd + Q 显式退出
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 在这个文件中，你可以包含应用程序的所有主进程代码
// 也可以将它们分别打包然后再import进来

// IPC 事件处理
ipcMain.handle('read-data-file', async (_event, filePath: string) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return {
      success: true,
      data: JSON.parse(data),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '读取文件失败',
    }
  }
})

ipcMain.handle('write-data-file', async (_event, filePath: string, data: any) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '写入文件失败',
    }
  }
})

ipcMain.handle('get-app-path', async (_event, name: string) => {
  try {
    const appPath = app.getPath(name as any)
    return {
      success: true,
      path: appPath,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取路径失败',
    }
  }
})
