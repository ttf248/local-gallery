import { ApiResponse } from '@shared/interfaces'

declare global {
  interface Window {
    api: {
      readDataFile: (filePath: string) => Promise<ApiResponse<any>>
      writeDataFile: (filePath: string, data: any) => Promise<ApiResponse<void>>
      getPath: (name: string) => Promise<ApiResponse<string>>
    }
  }
}

export {}
