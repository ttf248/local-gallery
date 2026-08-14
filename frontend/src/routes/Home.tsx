import { useQuery, useMutation } from '@tanstack/react-query'
import { scanApi, ScanResult, ProgressEvent } from '../api/scan'
import { useEffect, useState } from 'react'
import { useScanSSE } from '../hooks/useScanSSE'
import AlbumGrid, { GridItem } from '../components/album/AlbumGrid'
import EmptyState from '../components/common/EmptyState'
import ScanProgress from '../components/album/ScanProgress'

function toGridItems(r: ScanResult | null | undefined): GridItem[] {
  if (!r) return []
  const items: GridItem[] = []
  for (const a of r.albums) {
    items.push({
      id: 'a:' + a.path,
      title: a.name,
      subtitle: a.author,
      count: a.imageCount,
      coverPath: a.coverImage,
      to: `/albums/${encodeURIComponent(a.path)}`,
    })
  }
  for (const c of r.collections) {
    items.push({
      id: 'c:' + c.path,
      title: c.name,
      subtitle: '集合',
      count: c.albumCount,
      coverPath: c.albums[0]?.coverImage ?? '',
      to: `/albums/${encodeURIComponent(c.path)}`,
    })
  }
  for (const s of r.smartCollections) {
    items.push({
      id: 's:' + s.author,
      title: s.author,
      subtitle: `${s.albumCount} 卷`,
      count: s.albumCount,
      coverPath: s.coverImage,
      to: `/albums/${encodeURIComponent('smart:' + s.author)}`,
    })
  }
  return items
}

export default function Home() {
  const [lastScanId, setLastScanId] = useState<string | null>(null)
  const sse = useScanSSE()
  const result = useQuery({
    queryKey: ['scan-result', lastScanId],
    queryFn: () => scanApi.result(lastScanId!).then((r) => r.result),
    enabled: !!lastScanId && sse.isComplete,
  })

  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      setLastScanId(r.scanId)
      sse.startWith(r.scanId)
    },
  })

  // 自动滚动到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const items = toGridItems(result.data)
  const progress: ProgressEvent | null = sse.progress

  return (
    <>
      <ScanProgress progress={progress} />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">漫画库</h1>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {sse.isRunning ? '扫描中…' : startScan.isPending ? '启动中…' : '开始扫描'}
          </button>
        </div>

        {result.isLoading && <div className="text-fg-muted">加载中…</div>}
        {result.data && items.length === 0 && (
          <EmptyState
            title="暂无漫画"
            description="点击右上角「开始扫描」加载漫画根目录。"
          />
        )}
        {result.data && items.length > 0 && <AlbumGrid items={items} />}
        {!result.data && !sse.isRunning && (
          <EmptyState
            title="欢迎使用漫画阅读器"
            description="漫画根目录已配置为服务端启动参数。点击「开始扫描」加载所有相册。"
            action={
              <button
                onClick={() => startScan.mutate()}
                disabled={startScan.isPending}
                className="px-4 py-2 rounded bg-accent text-white hover:bg-accent-hover"
              >
                开始扫描
              </button>
            }
          />
        )}
      </div>
    </>
  )
}
