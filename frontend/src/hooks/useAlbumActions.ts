import { useNavigate } from 'react-router-dom'
import { favoritesApi } from '../api/prefs'
import { fsApi, fsCapabilities } from '../api/fs'
import type { GridItem } from '../components/album/AlbumGrid'

interface Actions {
  open: () => void
  toggleFavorite: () => Promise<void>
  openInExplorer: () => Promise<void>
  copyPath: () => Promise<void>
}

// 提供相册右键菜单的动作实现。
// "属性" 弹窗需要 React state，由调用方持有，单独回调。
export function useAlbumActions(item: GridItem, onShowProperties?: (path: string) => void) {
  const navigate = useNavigate()

  // smart: 前缀与 to 的实际路径解码路径相同
  const decodedPath = decodeURIComponent(item.to.replace(/^\/albums\//, ''))

  const actions: Actions = {
    open: () => navigate(item.to),
    toggleFavorite: async () => {
      const list = await favoritesApi
        .list()
        .catch(() => ({ favorites: [] as string[] }))
      const exists = list.favorites.includes(decodedPath)
      if (exists) {
        await favoritesApi.remove(decodedPath)
      } else {
        await favoritesApi.add(decodedPath)
      }
    },
    openInExplorer: async () => {
      if (!fsCapabilities.allowOsOpen) throw new Error('allowOsOpen disabled')
      await fsApi.openInExplorer(decodedPath)
    },
    copyPath: async () => {
      await navigator.clipboard.writeText(decodedPath)
    },
  }

  return {
    ...actions,
    showProperties: () => onShowProperties?.(decodedPath),
  }
}