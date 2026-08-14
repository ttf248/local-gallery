package services

import (
	"sort"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// GroupByAuthor 按作者智能聚合相册。
//
// 规则：
//   - 仅对有 [作者] 标记的相册分组
//   - 同一作者相册数 >= MinAuthorAlbums 时聚合为 SmartCollection
//   - 封面选择：图片数最多的相册的第一张图
//
// 与 Python 版语义一致，但阈值暴露为参数，便于测试。
func GroupByAuthor(albums []models.Album) []models.SmartCollection {
	const minAuthorAlbums = 2

	buckets := make(map[string][]models.Album)
	for _, a := range albums {
		if a.Author == "" {
			continue
		}
		buckets[a.Author] = append(buckets[a.Author], a)
	}

	if len(buckets) == 0 {
		return nil
	}

	var smart []models.SmartCollection
	for author, list := range buckets {
		if len(list) < minAuthorAlbums {
			continue
		}
		sort.Slice(list, func(i, j int) bool {
			return list[i].ImageCount > list[j].ImageCount
		})
		smart = append(smart, models.SmartCollection{
			Type:       "smartCollection",
			Author:     author,
			Albums:     list,
			AlbumCount: len(list),
			CoverImage: list[0].CoverImage,
		})
	}

	sort.Slice(smart, func(i, j int) bool { return smart[i].Author < smart[j].Author })
	return smart
}
