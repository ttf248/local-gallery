import { useNavigate } from 'react-router-dom'
import { fsApi, fsCapabilities } from '../api/fs'
import type { CardData } from '../components/album/AlbumGrid'

interface Actions {
  open: () => void
  openInExplorer: () => Promise<void>
  copyPath: () => Promise<void>
}

// 提供相册右键菜单的动作实现。
// "属性" 弹窗需要 React state，由调用方持有，单独回调。
// 收藏切换由调用方通过 useFavorites().toggle 触发（避免再订阅 query）。
export function useAlbumActions(item: CardData, onShowProperties?: (path: string) => void) {
  const navigate = useNavigate()

  // 把 /albums/<encoded> 解码回相册路径；smart: 前缀照旧。
  const decodedPath = (() => {
    if (!item.to.startsWith('/albums/')) return item.to
    try {
      return decodeURIComponent(item.to.replace(/^\/albums\//, ''))
    } catch {
      return item.to
    }
  })()

  const actions: Actions = {
    open: () => navigate(item.to),
    openInExplorer: async () => {
      if (!fsCapabilities.allowOsOpen) throw new Error('allowOsOpen disabled')
      if (item.variant === 'smart') throw new Error('not a real path')
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
