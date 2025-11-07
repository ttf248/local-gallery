import {
  ComicData,
  Collection,
  Chapter,
  ReadingProgress,
  HistoryEntry,
  FavoriteEntry,
  ApiResponse
} from '@shared/interfaces'
import { ERROR_CODES } from '@shared/constants'

/**
 * 数据管理器 - 负责 JSON 文件的读写操作
 * 参考 DEVELOPMENT_PLAN.md 阶段 2 设计
 */
class DataManager {
  private data: ComicData
  private filePath: string
  private isLoaded: boolean = false

  constructor() {
    this.filePath = this.getDataFilePath()
    this.data = this.getDefaultData()
  }

  /**
   * 获取数据文件路径
   */
  private getDataFilePath(): string {
    // 在开发环境中使用模拟路径
    if (process.env.NODE_ENV === 'development') {
      return './data.json'
    }

    // 生产环境使用用户数据目录
    const userData = window.api?.getPath?.('userData') || process.cwd()
    return `${userData}/data.json`
  }

  /**
   * 获取默认数据结构
   */
  private getDefaultData(): ComicData {
    return {
      collections: [],
      chapters: [],
      readingProgress: [],
      history: [],
      favorites: [],
    }
  }

  /**
   * 加载数据
   */
  async loadData(): Promise<ApiResponse<ComicData>> {
    try {
      // 在渲染进程中，通过 IPC 调用主进程
      if (window.api?.readDataFile) {
        const result = await window.api.readDataFile(this.filePath)

        if (result.success) {
          this.data = result.data
          this.isLoaded = true
          return {
            success: true,
            data: this.data,
            message: '数据加载成功'
          }
        } else {
          // 文件不存在，使用默认数据
          this.data = this.getDefaultData()
          this.isLoaded = true
          return {
            success: true,
            data: this.data,
            message: '使用默认数据'
          }
        }
      }

      // 开发模式下的模拟实现
      this.data = this.getDefaultData()
      this.isLoaded = true
      return {
        success: true,
        data: this.data,
        message: '数据加载成功 (开发模式)'
      }
    } catch (error) {
      console.error('数据加载失败:', error)
      return {
        success: false,
        error: ERROR_CODES.LOAD_FAILED,
        message: '数据加载失败'
      }
    }
  }

  /**
   * 保存数据
   */
  async saveData(): Promise<ApiResponse<void>> {
    try {
      if (!this.isLoaded) {
        throw new Error('数据尚未加载')
      }

      // 在渲染进程中，通过 IPC 调用主进程
      if (window.api?.writeDataFile) {
        const result = await window.api.writeDataFile(this.filePath, this.data)

        if (result.success) {
          return {
            success: true,
            message: '数据保存成功'
          }
        } else {
          throw new Error(result.error || '保存失败')
        }
      }

      // 开发模式下的模拟实现
      console.log('保存数据 (开发模式):', this.data)
      return {
        success: true,
        message: '数据保存成功 (开发模式)'
      }
    } catch (error) {
      console.error('数据保存失败:', error)
      return {
        success: false,
        error: ERROR_CODES.SAVE_FAILED,
        message: '数据保存失败'
      }
    }
  }

  /**
   * 获取所有合集
   */
  getCollections(): Collection[] {
    return this.data.collections
  }

  /**
   * 根据 ID 获取合集
   */
  getCollectionById(id: string): Collection | undefined {
    return this.data.collections.find(c => c.id === id)
  }

  /**
   * 获取合集的所有章节
   */
  getChaptersByCollectionId(collectionId: string): Chapter[] {
    return this.data.chapters
      .filter(c => c.collectionId === collectionId)
      .sort((a, b) => a.index - b.index)
  }

  /**
   * 根据 ID 获取章节
   */
  getChapterById(id: string): Chapter | undefined {
    return this.data.chapters.find(c => c.id === id)
  }

  /**
   * 保存阅读进度
   */
  async saveProgress(
    collectionId: string,
    chapterIndex: number,
    currentPage: number
  ): Promise<ApiResponse<void>> {
    try {
      const existing = this.data.readingProgress.find(
        p => p.collectionId === collectionId
      )

      const progress: ReadingProgress = {
        collectionId,
        chapterIndex,
        currentPage,
        lastReadAt: new Date().toISOString(),
      }

      if (existing) {
        Object.assign(existing, progress)
      } else {
        this.data.readingProgress.push(progress)
      }

      // 保存到历史记录
      const historyEntry: HistoryEntry = {
        collectionId,
        timestamp: new Date().toISOString(),
      }
      this.data.history.push(historyEntry)

      // 保持历史记录只保留最近 100 条
      if (this.data.history.length > 100) {
        this.data.history = this.data.history.slice(-100)
      }

      await this.saveData()
      return {
        success: true,
        message: '阅读进度已保存'
      }
    } catch (error) {
      console.error('保存阅读进度失败:', error)
      return {
        success: false,
        error: ERROR_CODES.SAVE_FAILED,
        message: '保存阅读进度失败'
      }
    }
  }

  /**
   * 获取阅读进度
   */
  getProgress(collectionId: string): ReadingProgress | undefined {
    return this.data.readingProgress.find(p => p.collectionId === collectionId)
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(collectionId: string): Promise<ApiResponse<boolean>> {
    try {
      const existingIndex = this.data.favorites.findIndex(
        f => f.collectionId === collectionId
      )

      let isFavorited: boolean

      if (existingIndex >= 0) {
        // 已收藏，取消收藏
        this.data.favorites.splice(existingIndex, 1)
        isFavorited = false
      } else {
        // 未收藏，添加收藏
        this.data.favorites.push({
          collectionId,
          addedAt: new Date().toISOString(),
        })
        isFavorited = true
      }

      await this.saveData()
      return {
        success: true,
        data: isFavorited,
        message: isFavorited ? '已添加到收藏' : '已取消收藏'
      }
    } catch (error) {
      console.error('切换收藏状态失败:', error)
      return {
        success: false,
        error: ERROR_CODES.SAVE_FAILED,
        message: '操作失败'
      }
    }
  }

  /**
   * 检查是否已收藏
   */
  isFavorite(collectionId: string): boolean {
    return this.data.favorites.some(f => f.collectionId === collectionId)
  }

  /**
   * 获取所有收藏
   */
  getFavorites(): FavoriteEntry[] {
    return this.data.favorites
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number): HistoryEntry[] {
    const history = [...this.data.history]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return limit ? history.slice(0, limit) : history
  }

  /**
   * 添加合集
   */
  async addCollection(collection: Collection, chapters: Chapter[]): Promise<ApiResponse<void>> {
    try {
      // 检查合集是否已存在
      const existing = this.data.collections.find(c => c.id === collection.id)
      if (existing) {
        return {
          success: false,
          error: 'COLLECTION_EXISTS',
          message: '合集已存在'
        }
      }

      // 添加合集和章节
      this.data.collections.push(collection)
      this.data.chapters.push(...chapters)

      await this.saveData()
      return {
        success: true,
        message: '合集添加成功'
      }
    } catch (error) {
      console.error('添加合集失败:', error)
      return {
        success: false,
        error: ERROR_CODES.SAVE_FAILED,
        message: '添加合集失败'
      }
    }
  }

  /**
   * 删除合集
   */
  async removeCollection(collectionId: string): Promise<ApiResponse<void>> {
    try {
      // 删除合集
      this.data.collections = this.data.collections.filter(
        c => c.id !== collectionId
      )

      // 删除相关章节
      this.data.chapters = this.data.chapters.filter(
        c => c.collectionId !== collectionId
      )

      // 删除相关进度
      this.data.readingProgress = this.data.readingProgress.filter(
        p => p.collectionId !== collectionId
      )

      // 删除相关收藏
      this.data.favorites = this.data.favorites.filter(
        f => f.collectionId !== collectionId
      )

      // 删除相关历史
      this.data.history = this.data.history.filter(
        h => h.collectionId !== collectionId
      )

      await this.saveData()
      return {
        success: true,
        message: '合集删除成功'
      }
    } catch (error) {
      console.error('删除合集失败:', error)
      return {
        success: false,
        error: ERROR_CODES.SAVE_FAILED,
        message: '删除合集失败'
      }
    }
  }

  /**
   * 搜索合集
   */
  searchCollections(keyword: string): Collection[] {
    if (!keyword.trim()) {
      return this.data.collections
    }

    const lowerKeyword = keyword.toLowerCase()
    return this.data.collections.filter(
      c =>
        c.name.toLowerCase().includes(lowerKeyword) ||
        c.author.toLowerCase().includes(lowerKeyword) ||
        c.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
    )
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const totalCollections = this.data.collections.length
    const totalChapters = this.data.chapters.length
    const totalPages = this.data.chapters.reduce((sum, c) => sum + c.totalPages, 0)
    const favoriteCount = this.data.favorites.length
    const historyCount = this.data.history.length

    return {
      totalCollections,
      totalChapters,
      totalPages,
      favoriteCount,
      historyCount,
    }
  }
}

// 导出单例实例
export const dataManager = new DataManager()
