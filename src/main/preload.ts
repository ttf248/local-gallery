const { contextBridge, ipcRenderer } = require('electron')

// 暴露受保护的方法，允许渲染进程使用 ipcRenderer，同时不暴露整个对象
contextBridge.exposeInMainWorld('api', {
  // 数据文件操作
  readDataFile: (filePath: string) =>
    ipcRenderer.invoke('read-data-file', filePath),
  writeDataFile: (filePath: string, data: any) =>
    ipcRenderer.invoke('write-data-file', filePath, data),

  // 路径操作
  getPath: (name: string) =>
    ipcRenderer.invoke('get-app-path', name),
})
