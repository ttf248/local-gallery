import { useEffect, useState } from 'react'
import { imageInfoApi, type ImageInfo } from '../api/imageInfo'

// 共享的图片元数据 fetch：ImageInfoPanel（查看器右侧）和
// PropertiesDialog（album/grid 右键菜单）原本各自 useState + useEffect
// 拉同一份数据。统一到这里避免重复实现 + 重复请求。
//
// 行为：
//   - absPath 变化时重新拉
//   - 拉取过程中 loading=true
//   - 失败时 err=<message>
//   - absPath 为空时 info/err/loading 全部清空
export function useImageInfo(absPath: string | null | undefined) {
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!absPath) {
      setInfo(null)
      setErr(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    let cancelled = false
    imageInfoApi
      .get(absPath)
      .then((d) => {
        if (!cancelled) setInfo(d)
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message ?? '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [absPath])

  return { info, err, loading }
}
