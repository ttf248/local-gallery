import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbUrl } from '../../api/thumbs'
import { ImageIcon, FolderIcon, StarIcon } from '../common/Icon'

export type CardVariant = 'album' | 'collection' | 'smart'

export interface CardData {
  id: string
  variant: CardVariant
  title: string
  subtitle?: string
  count: number
  coverPath: string
  to: string
  isFavorite?: boolean
}

interface Props {
  data: CardData
}

// 卡片：缩略图懒加载（IntersectionObserver），未进入视口前不发起图片请求。
// 设计：3:4 比例封面；底部标题 / 副标题 / 计数；轻阴影 + 浮起效果。
export default function AlbumCard({ data }: Props) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '600px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  const Icon = data.variant === 'smart' ? StarIcon : data.variant === 'collection' ? FolderIcon : ImageIcon

  return (
    <div
      ref={ref}
      onClick={() => navigate(data.to)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(data.to)
        }
      }}
      className="group block bg-bg-elevated rounded-md overflow-hidden border border-border hover:border-border-strong lift cursor-pointer fade-up"
    >
      <div className="relative aspect-[3/4] bg-bg-subtle flex items-center justify-center overflow-hidden">
        {visible && data.coverPath ? (
          <>
            <img
              src={thumbUrl(data.coverPath)}
              alt={data.title}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center text-fg-subtle">
                <span className="text-xs">加载中…</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-fg-subtle gap-2">
            <Icon size={28} />
            <span className="text-xs">未找到封面</span>
          </div>
        )}
        {data.isFavorite && (
          <div className="absolute top-2 right-2 bg-bg-elevated/90 backdrop-blur rounded-full p-1.5 shadow-sm">
            <StarIcon size={12} className="text-warning" />
          </div>
        )}
      </div>
      <div className="p-3">
        <div
          className="font-medium text-[13px] truncate text-fg"
          title={data.title}
        >
          {data.title}
        </div>
        {data.subtitle && (
          <div className="text-xs text-fg-subtle truncate mt-0.5" title={data.subtitle}>
            {data.subtitle}
          </div>
        )}
        <div className="text-[11px] text-fg-muted mt-1.5 tabular-nums">
          {data.count} {data.variant === 'collection' ? '卷' : data.variant === 'smart' ? '卷' : '张'}
        </div>
      </div>
    </div>
  )
}
