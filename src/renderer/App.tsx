import React, { useEffect } from 'react'
import { useComicStore } from './store'
import Button from './components/ui/Button/Button'
import Input from './components/ui/Input/Input'

const App: React.FC = () => {
  const { loadData, isLoading, error, collections } = useComicStore()

  useEffect(() => {
    // 加载数据
    loadData()
  }, [])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-minimal-gray">
        <div className="text-center">
          <div className="loading-spinner w-12 h-12 border-4 border-minimal-blue border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-minimal-muted">正在加载...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-minimal-gray">
        <div className="text-center">
          <p className="text-minimal-red mb-4">加载失败: {error}</p>
          <Button onClick={() => loadData()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-minimal-gray">
      {/* 顶部标题栏 - 参考原型图 */}
      <div className="bg-white border-b border-minimal-border px-8 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-5">
          <div className="w-10 h-10 bg-minimal-blue rounded-lg flex items-center justify-center">
            <i className="fas fa-book-open text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-2xl font-light text-minimal-text">漫画阅读器</h1>
            <p className="text-sm text-minimal-muted font-light">Discover Amazing Comics</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" icon="fas fa-cog mr-2">
            设置
          </Button>
          <Button variant="primary" icon="fas fa-plus mr-2">
            导入
          </Button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-80px)]">
        {/* 左侧导航栏 - 参考原型图 */}
        <div className="w-64 bg-minimal-gray p-6 border-r border-minimal-border">
          <div className="space-y-1">
            <h2 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              Navigation
            </h2>
            <button className="w-full text-left px-4 py-3 bg-minimal-blue text-white rounded-md flex items-center">
              <i className="fas fa-th-large w-5 text-sm"></i>
              <span className="ml-3 text-sm font-medium">我的漫画</span>
            </button>
            <button className="w-full text-left px-4 py-3 hover:bg-white rounded-md flex items-center transition">
              <i className="fas fa-heart w-5 text-minimal-red"></i>
              <span className="ml-3 text-sm font-medium text-minimal-muted">收藏</span>
              <div className="ml-auto text-xs text-minimal-muted">0</div>
            </button>
            <button className="w-full text-left px-4 py-3 hover:bg-white rounded-md flex items-center transition">
              <i className="fas fa-clock w-5 text-minimal-blue"></i>
              <span className="ml-3 text-sm font-medium text-minimal-muted">历史</span>
            </button>
            <button className="w-full text-left px-4 py-3 hover:bg-white rounded-md flex items-center transition">
              <i className="fas fa-folder w-5 text-minimal-green"></i>
              <span className="ml-3 text-sm font-medium text-minimal-muted">分类</span>
            </button>
            <button className="w-full text-left px-4 py-3 hover:bg-white rounded-md flex items-center transition">
              <i className="fas fa-download w-5 text-minimal-muted"></i>
              <span className="ml-3 text-sm font-medium text-minimal-muted">导入记录</span>
            </button>
          </div>

          <div className="mt-8 space-y-1">
            <h2 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              Tags
            </h2>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 bg-minimal-blue/10 text-minimal-blue rounded-full text-xs font-medium">
                冒险
              </span>
              <span className="px-3 py-1.5 bg-minimal-green/10 text-minimal-green rounded-full text-xs font-medium">
                爱情
              </span>
              <span className="px-3 py-1.5 bg-minimal-yellow/10 text-minimal-yellow rounded-full text-xs font-medium">
                奇幻
              </span>
              <span className="px-3 py-1.5 bg-minimal-red/10 text-minimal-red rounded-full text-xs font-medium">
                科幻
              </span>
            </div>
          </div>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 p-8">
          {/* 搜索栏 */}
          <div className="mb-8 flex items-center space-x-3">
            <div className="flex-1 relative">
              <Input
                placeholder="搜索漫画标题、作者..."
                className="w-full"
              />
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-minimal-muted text-sm"></i>
            </div>
            <Button variant="secondary" icon="fas fa-filter mr-2 text-xs">
              筛选
            </Button>
            <Button variant="secondary" icon="fas fa-th-large mr-2 text-xs">
              网格
            </Button>
            <Button variant="secondary" icon="fas fa-list mr-2 text-xs">
              列表
            </Button>
          </div>

          {/* 漫画网格 - 展示加载的合集 */}
          <div className="grid grid-cols-6 gap-5">
            {collections.length === 0 ? (
              <div className="col-span-6 flex flex-col items-center justify-center py-20">
                <i className="fas fa-folder-open text-6xl text-minimal-muted/30 mb-4"></i>
                <p className="text-minimal-muted text-lg mb-2">还没有漫画</p>
                <p className="text-minimal-muted text-sm mb-4">
                  点击"导入"按钮开始添加你的第一本漫画
                </p>
                <Button variant="primary" icon="fas fa-plus mr-2">
                  导入漫画
                </Button>
              </div>
            ) : (
              collections.map((collection) => (
                <div
                  key={collection.id}
                  className="minimal-card rounded-lg overflow-hidden"
                >
                  <div className="aspect-[3/4] bg-minimal-gray flex items-center justify-center relative group">
                    <i className="fas fa-image text-5xl text-minimal-muted/30"></i>
                    <div className="absolute top-2 right-2 bg-white/90 px-2 py-1 rounded text-xs text-minimal-muted">
                      {collection.totalChapters}集
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium text-sm mb-1 text-minimal-text truncate">
                      {collection.name}
                    </h3>
                    <p className="text-xs text-minimal-muted mb-2 font-light">
                      {collection.author}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1">
                        <i className="fas fa-star text-xs text-minimal-yellow"></i>
                        <span className="text-xs text-minimal-muted">
                          {collection.rating}
                        </span>
                      </div>
                      <div className="flex space-x-2">
                        <button className="text-minimal-red hover:text-minimal-red/70 text-sm">
                          <i className="far fa-heart"></i>
                        </button>
                        <button className="text-minimal-blue hover:text-minimal-blue/70 text-sm">
                          <i className="fas fa-play"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
