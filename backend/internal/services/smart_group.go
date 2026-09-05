package services

import (
	"sort"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// GroupByTag 按标签智能聚合相册。
//
// 规则：
//   - 一个相册可有多个标签 [tag1][tag2]，会出现在多个合集里
//   - 同一标签下相册数 >= MinTagAlbums（默认 2）时聚合为 SmartCollection
//   - 封面选择：图片数最多的相册的第一张图
func GroupByTag(albums []models.Album) []models.SmartCollection {
	const minTagAlbums = 2

	buckets := make(map[string][]models.Album)
	for _, a := range albums {
		seen := make(map[string]bool)
		for _, t := range a.Tags {
			if seen[t] {
				continue
			}
			seen[t] = true
			buckets[t] = append(buckets[t], a)
		}
	}

	if len(buckets) == 0 {
		return nil
	}

	var smart []models.SmartCollection
	for tag, list := range buckets {
		if len(list) < minTagAlbums {
			continue
		}
		sort.Slice(list, func(i, j int) bool {
			return list[i].ImageCount > list[j].ImageCount
		})
		smart = append(smart, models.SmartCollection{
			Type:       "smartCollection",
			Tag:        tag,
			Albums:     list,
			AlbumCount: len(list),
			CoverImage: list[0].CoverImage,
		})
	}

	sort.Slice(smart, func(i, j int) bool { return smart[i].Tag < smart[j].Tag })
	return smart
}
