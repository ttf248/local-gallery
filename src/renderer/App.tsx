import React, { useEffect, useState } from 'react'
import { useComicStore } from './store'
import { fileScanner } from './services/file-scanner'
import TopBar from './components/layout/TopBar/TopBar'
import Sidebar from './components/layout/Sidebar/Sidebar'
import SearchBar from './components/MainInterface/SearchBar/SearchBar'
import ComicGrid from './components/MainInterface/ComicGrid/ComicGrid'
import ReaderInterface from './components/ReadingInterface/ReaderInterface'
import SearchInterface from './components/SearchInterface/SearchInterface'
import SettingsInterface from './components/SettingsInterface/SettingsInterface'
import { Collection } from '@shared/interfaces'

type CurrentView = 'main' | 'reader' | 'search' | 'settings'

const App: React.FC = () => {
  const {
    loadData,
    isLoading,
    error,
    collections,
    favorites,
    toggleFavorite,
    setSearchKeyword,
    getFilteredCollections,
  } = useComicStore()

  const [currentView, setCurrentView] = useState<CurrentView>('main')
  const [currentCollection, setCurrentCollection] = useState<Collection | null>(null)

  useEffect(() => {
    // 加载数据
    loadData()
  }, [])

  const handleImport = async () => {
    // 模拟导入漫画
    const mockScanResult = await fileScanner.scanDirectory('/mock/comics')
    console.log('扫描结果:', mockScanResult)
  }

  const handleCollectionClick = (collection: Collection) => {
    setCurrentCollection(collection)
    setCurrentView('reader')
  }

  const handleFavoriteClick = (id: string) => {
    toggleFavorite(id)
  }

  const handleSearch = (keyword: string) => {
    setSearchKeyword(keyword)
  }

  const handleNavigate = (key: string) => {
    if (key === 'search') {
      setCurrentView('search')
    } else if (key === 'myComics') {
      setCurrentView('main')
    }
  }

  const handleSettings = () => {
    setCurrentView('settings')
  }

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
          <button
            className="px-6 py-2.5 bg-minimal-blue text-white rounded-md hover:bg-minimal-blue/90 transition text-sm font-medium"
            onClick={() => loadData()}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  // 阅读界面
  if (currentView === 'reader' && currentCollection) {
    return (
      <ReaderInterface
        collection={currentCollection}
        chapter={{
          id: `${currentCollection.id}_chap_0`,
          collectionId: currentCollection.id,
          index: 0,
          title: '第1话',
          path: currentCollection.coverPath,
          pages: ['001.jpg', '002.jpg'],
          totalPages: 120,
          read: false,
        }}
        onClose={() => setCurrentView('main')}
        onNextPage={() => console.log('下一页')}
        onPrevPage={() => console.log('上一页')}
        onNextChapter={() => console.log('下一章')}
        onPrevChapter={() => console.log('上一章')}
      />
    )
  }

  // 设置界面
  if (currentView === 'settings') {
    return (
      <SettingsInterface onClose={() => setCurrentView('main')} />
    )
  }

  // 搜索界面
  if (currentView === 'search') {
    return (
      <div>
        <TopBar onSettingsClick={handleSettings} onImportClick={handleImport} />
        <SearchInterface
          collections={collections}
          onCollectionClick={handleCollectionClick}
          onFavoriteClick={handleFavoriteClick}
        />
      </div>
    )
  }

  // 主界面
  return (
    <div className="h-screen bg-minimal-gray">
      <TopBar onSettingsClick={handleSettings} onImportClick={handleImport} />
      <div className="flex h-[calc(100vh-80px)]">
        <Sidebar
          onNavigate={handleNavigate}
          favoriteCount={favorites.size}
        />
        <div className="flex-1 p-8">
          <SearchBar
            onSearch={handleSearch}
            onFilterClick={() => setCurrentView('search')}
          />
          <ComicGrid
            collections={getFilteredCollections()}
            favorites={favorites}
            onComicClick={handleCollectionClick}
            onFavoriteClick={handleFavoriteClick}
            onReadClick={(id) => handleCollectionClick(collections.find(c => c.id === id)!)}
          />
        </div>
      </div>
    </div>
  )
}

export default App
