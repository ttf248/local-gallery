import {
  Collection,
  Chapter,
  ScanResult,
  Directory,
} from '@shared/interfaces'
import { COLLECTION_DETECTION } from '@shared/constants'

/**
 * 文件扫描器 - 自动扫描漫画文件夹并识别合集
 * 参考 DEVELOPMENT_PLAN.md 阶段 7 设计
 */
class FileScanner {
  /**
   * 扫描目录
   */
  async scanDirectory(_rootPath: string): Promise<ScanResult> {
    const startTime = Date.now()

    try {
      // 遍历目录
      const _directories = await this.walkDirectories(_rootPath)

      // 识别合集
      const collections = this.detectCollections(_directories)

      // 生成章节
      const chapters = await this.generateChapters(collections)

      const scanTime = Date.now() - startTime

      return {
        collections,
        chapters,
        totalScanned: _directories.length,
        scanTime,
      }
    } catch (error) {
      throw new Error(`扫描失败: ${error}`)
    }
  }

  /**
   * 遍历目录
   */
  private async walkDirectories(_rootPath: string): Promise<Directory[]> {
    const _directories: Directory[] = []

    // 开发模式下使用模拟数据
    if (import.meta.env.DEV) {
      return this.getMockDirectories()
    }

    // 实际实现将通过 IPC 调用主进程
    return this.getMockDirectories()
  }

  /**
   * 检测合集
   */
  private detectCollections(_directories: Directory[]): Collection[] {
    const collections: Map<string, Directory[]> = new Map()

    // 按基础名称分组
    _directories.forEach(dir => {
      const baseName = this.extractBaseName(dir.name)
      if (!collections.has(baseName)) {
        collections.set(baseName, [])
      }
      collections.get(baseName)!.push(dir)
    })

    // 验证合集（至少2个文件夹）
    const validCollections: Collection[] = []
    collections.forEach((dirs, baseName) => {
      if (dirs.length >= COLLECTION_DETECTION.minChaptersForCollection) {
        // 按章节号排序
        dirs.sort((a, b) => {
          const aNum = this.getChapterNumber(a.name)
          const bNum = this.getChapterNumber(b.name)
          return aNum - bNum
        })

        // 创建合集
        const collection: Collection = {
          id: this.generateId(baseName),
          name: baseName,
          author: '未知作者',
          totalChapters: dirs.length,
          coverPath: dirs[0].path,
          tags: [],
          rating: 8.0,
          lastUpdated: new Date().toISOString(),
        }

        validCollections.push(collection)
      }
    })

    return validCollections
  }

  /**
   * 提取基础名称
   */
  private extractBaseName(dirName: string): string {
    for (const pattern of COLLECTION_DETECTION.namePatterns) {
      const match = dirName.match(pattern)
      if (match) {
        return match[1].trim()
      }
    }
    return dirName
  }

  /**
   * 提取章节号
   */
  private getChapterNumber(dirName: string): number {
    for (const pattern of COLLECTION_DETECTION.chapterPatterns) {
      const match = dirName.match(pattern)
      if (match) {
        return parseInt(match[1], 10)
      }
    }
    return 0
  }

  /**
   * 生成章节
   */
  private async generateChapters(collections: Collection[]): Promise<Chapter[]> {
    const chapters: Chapter[] = []

    collections.forEach(collection => {
      // 模拟章节生成
      for (let i = 0; i < collection.totalChapters; i++) {
        const chapter: Chapter = {
          id: `${collection.id}_chap_${i}`,
          collectionId: collection.id,
          index: i,
          title: `第${i + 1}话`,
          path: `${collection.coverPath}/chapter_${i}`,
          pages: this.generateMockPages(120),
          totalPages: 120,
          read: false,
        }
        chapters.push(chapter)
      }
    })

    return chapters
  }

  /**
   * 生成模拟页面
   */
  private generateMockPages(count: number): string[] {
    const pages: string[] = []
    for (let i = 1; i <= count; i++) {
      pages.push(`${i.toString().padStart(3, '0')}.jpg`)
    }
    return pages
  }

  /**
   * 生成 ID
   */
  private generateId(name: string): string {
    return `col_${name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`
  }

  /**
   * 获取模拟目录（开发用）
   */
  private getMockDirectories(): Directory[] {
    return [
      {
        path: '/mock/comics/进击的巨人/第1话',
        name: '第1话',
        isDirectory: true,
      },
      {
        path: '/mock/comics/进击的巨人/第2话',
        name: '第2话',
        isDirectory: true,
      },
      {
        path: '/mock/comics/进击的巨人/第3话',
        name: '第3话',
        isDirectory: true,
      },
      {
        path: '/mock/comics/鬼灭之刃/Vol.1',
        name: 'Vol.1',
        isDirectory: true,
      },
      {
        path: '/mock/comics/鬼灭之刃/Vol.2',
        name: 'Vol.2',
        isDirectory: true,
      },
      {
        path: '/mock/comics/海贼王/第1话',
        name: '第1话',
        isDirectory: true,
      },
    ]
  }
}

export const fileScanner = new FileScanner()
