import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { thumbUrl } from '../../api/thumbs'

interface Props {
  title: string
  subtitle?: string
  count: number
  coverPath: string
  to: string
}

// 卡片：缩略图懒加载（IntersectionObserver），未进入视口前不发起图片请求。
export default function AlbumCard({ title, subtitle, count, coverPath, to }: Props) {
  const [visible, setVisible] = useState(false)
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

  return (
    <div
      ref={ref}
      onClick={() => navigate(to)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(to)
      }}
      className="block bg-bg-elevated rounded-lg overflow-hidden border border-border hover:border-accent transition-colors cursor-pointer"
    >
      <div className="aspect-[3/4] bg-bg-subtle flex items-center justify-center overflow-hidden">
        {visible ? (
          <img
            src={thumbUrl(coverPath)}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-fg-subtle text-sm">加载中…</span>
        )}
      </div>
      <div className="p-2">
        <div className="font-medium truncate" title={title}>
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-fg-subtle truncate">{subtitle}</div>
        )}
        <div className="text-xs text-fg-muted mt-1">{count} 张</div>
      </div>
    </div>
  )
}
