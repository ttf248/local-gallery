package services

import "sync"

// UnreadLibraryIndex 缓存当前目录和活动版本组合下的未读相册下标。它只保留
// 轻量下标而不复制相册摘要：同一版本的后续游标页仅校验游标、按下标取值并切片，
// 不再重复扫描全库。
type UnreadLibraryIndex struct {
	mu sync.RWMutex

	ready            bool
	catalogRevision  uint64
	activityRevision uint64
	albumIndexes     []int
}

func NewUnreadLibraryIndex() *UnreadLibraryIndex {
	return &UnreadLibraryIndex{}
}

// Page 返回未读相册的一页。目录 revision 保持既有分页游标契约；活动 revision
// 只用作内部缓存键，因此响应字段和 URL 参数无需变化。
func (i *UnreadLibraryIndex) Page(snapshot CatalogSnapshot, startedImageAlbumIDs map[string]struct{}, activityRevision uint64, cursor string, limit int) (LibraryPage[LibraryNodeSummary], error) {
	const scope = "library-unread"
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	indexes, err := i.albumIndexesFor(snapshot, startedImageAlbumIDs, activityRevision)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(indexes), limit)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	albums := snapshot.state.library.albums
	items := make([]LibraryNodeSummary, end-start)
	for itemIndex, albumIndex := range indexes[start:end] {
		items[itemIndex] = cloneNodeSummary(albums[albumIndex])
	}
	return LibraryPage[LibraryNodeSummary]{
		Revision: snapshot.Revision(), Items: items, Total: len(indexes), NextCursor: next,
	}, nil
}

func (i *UnreadLibraryIndex) albumIndexesFor(snapshot CatalogSnapshot, startedImageAlbumIDs map[string]struct{}, activityRevision uint64) ([]int, error) {
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return nil, ErrLibraryNotReady
	}
	catalogRevision := snapshot.Revision()
	i.mu.RLock()
	if i.ready && i.catalogRevision == catalogRevision && i.activityRevision == activityRevision {
		indexes := i.albumIndexes
		i.mu.RUnlock()
		return indexes, nil
	}
	i.mu.RUnlock()

	i.mu.Lock()
	defer i.mu.Unlock()
	if i.ready && i.catalogRevision == catalogRevision && i.activityRevision == activityRevision {
		return i.albumIndexes, nil
	}
	albums := snapshot.state.library.albums
	indexes := make([]int, 0, len(albums))
	for albumIndex, album := range albums {
		if _, started := startedImageAlbumIDs[album.ID]; started && album.ImageCount > 0 {
			continue
		}
		indexes = append(indexes, albumIndex)
	}
	i.ready = true
	i.catalogRevision = catalogRevision
	i.activityRevision = activityRevision
	i.albumIndexes = indexes
	return i.albumIndexes, nil
}
