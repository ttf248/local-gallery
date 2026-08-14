import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { thumbUrl } from '../api/thumbs'
import { historyApi } from '../api/prefs'
import EmptyState from '../components/common/EmptyState'

// 相册视图：图片网格。
// 当前实现：从 URL 解码 path，加载第一张图片作为目录扫描依据。
// T11 简化版：直接以"列出目录图片"模式呈现。
// 真实数据需要后端返回相册内的图片列表（已在 T4 的 ScanResult.albums[].imageFiles 中）。
export default function Album() {
  const params = useParams()
  const navigate = useNavigate()
  const albumPath = decodeURIComponent(params['*'] ?? '')

  // 解析 smart: 前缀
  const isSmart = albumPath.startsWith('smart:')
  const realPath = isSmart ? albumPath.slice(6) : albumPath
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // 触发最近访问
    historyApi.add({
      path: albumPath,
      name: albumPath.split(/[/\\]/).pop() ?? albumPath,
      imageCount: 0,
    }).catch(() => {})
    // T11 简化：扫描结果通过 useQuery 缓存，Album 路径 → images 暂时以占位方式呈现
    // 真实实现会在 T15 接入 scan-result 的缓存
    setImages([])
    setLoading(false)
  }, [albumPath])

  if (loading) return <div className="p-6 text-fg-muted">加载中…</div>
  if (!albumPath) return <EmptyState title="无效路径" />

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-2">
        {isSmart ? `作者: ${realPath}` : albumPath.split(/[/\\]/).pop()}
      </h1>
      <p className="text-sm text-fg-muted mb-4">{albumPath}</p>

      {images.length === 0 ? (
        <EmptyState
          title="该视图尚未完整实现"
          description="完整图片列表 + 查看器集成将在 T15 阶段通过 scan-result 缓存完成。"
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {images.map((img, i) => (
            <button
              key={img}
              onClick={() => {
                const qs = new URLSearchParams({
                  images: encodeURIComponent(JSON.stringify(images)),
                  index: String(i),
                  name: albumPath,
                })
                navigate(`/viewer/${encodeURIComponent(albumPath)}?${qs}`)
              }}
              className="aspect-[3/4] bg-bg-subtle rounded overflow-hidden border border-border hover:border-accent"
            >
              <img src={thumbUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
