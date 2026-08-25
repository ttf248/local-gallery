// Vite 注入的全局常量（见 vite.config.ts 的 define）
declare const __APP_VERSION__: string

interface DirectoryPickerHandle {
  name: string
}

interface Window {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite'
  }) => Promise<DirectoryPickerHandle>
}
