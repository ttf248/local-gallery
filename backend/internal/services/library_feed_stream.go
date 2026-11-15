package services

import (
	"sort"
	"strconv"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// 随机长流：瀑布流专页（/photo/random）的数据源。
//
// 首页那面「随手看看」是一次性的一批照片 —— 八本相册各十二张，看完就
// 没有了。瀑布流要的是一条能一直往下滑的流：这里把全库照片排成一条
// 确定的长流，按游标一页页往下取。
//
// 长流的形状：
//   - 相册按种子打乱（年份之间轮流取，不让一批照片全来自同一年）；
//   - 每本相册内部的照片也按种子打乱，连拍不会被连着摊出来；
//   - 一圈 = 全库每张照片各出现一次。圈数不够时绕下一圈，绕圈时相册内
//     的顺序重新打乱，因此照片会再出现，但不会按同一个次序再出现。

const (
	// mediaFeedStreamPerAlbum 是每一轮里每本相册贡献多少张照片。
	mediaFeedStreamPerAlbum = 12
	// mediaFeedStreamCycles 是长流最多绕全库几圈。
	//
	// 一圈就是全库每张照片各一次，十几千张的库滑很久也到不了一圈的
	// 头；小库才需要多绕几圈才不至于滑两下就到底。
	mediaFeedStreamCycles = 64
)

// mediaFeedStreamIndex 把全库照片排成一条确定的长流，并记住下标怎么
// 落到具体的一本相册、一张照片。
type mediaFeedStreamIndex struct {
	// albums 是长流里的相册顺序（按种子打散过）。
	albums []LibraryNodeSummary
	// counts 是每本相册的照片数。
	counts []int
	// rounds[r] 是第 r 轮里每本相册各贡献几张；roundStarts[r] 是这一轮
	// 在长流里的起始下标。
	rounds      [][]int
	roundStarts []int
	// total 是走完一圈的照片数。
	total int
}

// newMediaFeedStreamIndex 按相册顺序排出长流的轮次结构。
func newMediaFeedStreamIndex(order []LibraryNodeSummary, index *libraryPageIndex) *mediaFeedStreamIndex {
	stream := &mediaFeedStreamIndex{albums: order}
	stream.counts = make([]int, len(order))
	for position, album := range order {
		stream.counts[position] = len(index.media[album.ID])
	}
	for round := 0; ; round++ {
		contributions := make([]int, len(order))
		roundTotal := 0
		for position, count := range stream.counts {
			remaining := count - round*mediaFeedStreamPerAlbum
			if remaining <= 0 {
				continue
			}
			if remaining > mediaFeedStreamPerAlbum {
				remaining = mediaFeedStreamPerAlbum
			}
			contributions[position] = remaining
			roundTotal += remaining
		}
		if roundTotal == 0 {
			break
		}
		stream.roundStarts = append(stream.roundStarts, stream.total)
		stream.rounds = append(stream.rounds, contributions)
		stream.total += roundTotal
	}
	return stream
}

// locate 找出长流里第 index 张照片落在哪本相册的哪个位置。
//
// photoIndex 是相册内打乱之后的序号：相册内部也要打散，否则同一场活动
// 的连拍会连着摊在墙上，读起来像卡带。
func (s *mediaFeedStreamIndex) locate(index int) (albumPosition int, photoIndex int, ok bool) {
	if index < 0 || index >= s.total {
		return 0, 0, false
	}
	round := sort.Search(len(s.roundStarts), func(i int) bool {
		return s.roundStarts[i] > index
	}) - 1
	if round < 0 {
		return 0, 0, false
	}
	offset := index - s.roundStarts[round]
	for position, contribution := range s.rounds[round] {
		if offset < contribution {
			return position, round*mediaFeedStreamPerAlbum + offset, true
		}
		offset -= contribution
	}
	return 0, 0, false
}

// mediaFeedStreamPermutations 缓存相册内照片的顺序。
//
// 同一个相册在同一圈里必须给同一个顺序：长流是按游标一页页取的，
// 每页重新打乱的话，同一张照片会在相邻两页里换位置。
type mediaFeedStreamPermutations struct {
	seed     string
	revision uint64
	values   map[string][]LibraryMediaItem
}

func newMediaFeedStreamPermutations(seed string, revision uint64) *mediaFeedStreamPermutations {
	return &mediaFeedStreamPermutations{
		seed: seed, revision: revision, values: map[string][]LibraryMediaItem{},
	}
}

// permutation 返回相册内照片的顺序；圈数不同则顺序不同 —— 绕圈重来时
// 照片会再出现，但不会按同一个次序再出现。
func (p *mediaFeedStreamPermutations) permutation(
	cycle int,
	album LibraryNodeSummary,
	media []LibraryMediaItem,
) []LibraryMediaItem {
	key := strconv.Itoa(cycle) + "|" + album.ID
	if cached, exists := p.values[key]; exists {
		return cached
	}
	ordered := make([]LibraryMediaItem, len(media))
	copy(ordered, media)
	rnd := newFeedRandomizer(p.seed+"|"+key, p.revision)
	positions := make([]int, len(ordered))
	for i := range positions {
		positions[i] = i
	}
	rnd.shuffle(positions)
	shuffled := make([]LibraryMediaItem, len(ordered))
	for i, position := range positions {
		shuffled[i] = ordered[position]
	}
	p.values[key] = shuffled
	return shuffled
}

// pageMediaFeedStream 取随机长流的一页。
//
// 游标是长流里的照片下标：同一颗种子给出同一条长流，翻页与重进都接得
// 上。长流走完一圈会绕回开头再走一圈（圈内的相册内顺序重新打散），
// 因此小库也有得滑，不会滑两下就到底。
func pageMediaFeedStream(
	snapshot CatalogSnapshot,
	index *libraryPageIndex,
	q MediaFeedQuery,
	cursor string,
	limit int,
) (MediaFeedPage, error) {
	kind := models.NormalizeContentKind(string(q.Kind))
	scope := "media-feed:" + string(q.Kind) + ":stream:" + q.Seed
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return MediaFeedPage{}, err
	}
	order := orderFeedAlbums(index, kind, newFeedRandomizer(q.Seed, snapshot.Revision()))
	stream := newMediaFeedStreamIndex(order, index)
	if stream.total == 0 {
		return MediaFeedPage{
			LibraryPage: LibraryPage[FeedMediaItem]{
				Revision: snapshot.Revision(), Items: []FeedMediaItem{}, Total: 0,
			},
			Albums:  []FeedAlbumRef{},
			Sources: []FeedSource{},
		}, nil
	}
	// 长流的理论总长：绕圈计入。用户看到的是「一直往下滑」，而不是
	// 数到某个数就没了。
	total := stream.total * mediaFeedStreamCycles
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, total, limit)
	if err != nil {
		return MediaFeedPage{}, err
	}
	permutations := newMediaFeedStreamPermutations(q.Seed, snapshot.Revision())
	items := make([]FeedMediaItem, 0, end-start)
	counts := map[string]int{}
	for position := start; position < end; position++ {
		cycle := position / stream.total
		within := position % stream.total
		albumPosition, photoIndex, ok := stream.locate(within)
		if !ok {
			continue
		}
		album := stream.albums[albumPosition]
		ordered := permutations.permutation(cycle, album, index.media[album.ID])
		if photoIndex < 0 || photoIndex >= len(ordered) {
			continue
		}
		item := ordered[photoIndex]
		if item.sourcePath != "" {
			if version, versionErr := MediaVersion(item.sourcePath); versionErr == nil {
				item.Version = version
			}
		}
		items = append(items, FeedMediaItem{
			LibraryMediaItem: item, AlbumID: album.ID, AlbumName: album.DisplayName,
		})
		counts[album.ID]++
	}
	refs := make([]FeedAlbumRef, 0, len(counts))
	for _, album := range order {
		if count, exists := counts[album.ID]; exists {
			refs = append(refs, FeedAlbumRef{ID: album.ID, Name: album.DisplayName, Count: count})
		}
	}
	return MediaFeedPage{
		LibraryPage: LibraryPage[FeedMediaItem]{
			Revision: snapshot.Revision(), Items: items, Total: total, NextCursor: next,
		},
		Albums:  refs,
		Sources: []FeedSource{},
	}, nil
}
