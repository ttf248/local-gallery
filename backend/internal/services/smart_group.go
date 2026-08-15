package services

import (
	"sort"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// GroupByTag 按标签智能聚合相册。
//
// 规则：
//   - 一个相册可有多个标签 [tag1][tag2]，会出现在多个合集里
//   - 同一标签下相册数 >= MinTagAlbums（默认 2）时聚合为 SmartCollection
//   - 封面选择：图片数最多的相册的第一张图
//
// 兼容说明：
//   - 当 Album.Tags 为空但 Author 非空（老数据）时，仍按 Author 聚合
//   - 返回的 SmartCollection 同时带 Tag 与 Author 两字段（值相同），
//     保证旧客户端按 Author 读取还能工作
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
		// 兼容：Tags 为空时按 Author 聚合
		if a.Author != "" && !seen[a.Author] {
			buckets[a.Author] = append(buckets[a.Author], a)
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
			Author:     tag, // 兼容：老客户端按 Author 读
			Albums:     list,
			AlbumCount: len(list),
			CoverImage: list[0].CoverImage,
		})
	}

	sort.Slice(smart, func(i, j int) bool { return smart[i].Tag < smart[j].Tag })
	return smart
}

// GroupByAuthor 是 GroupByTag 的旧名字别名。
//
// 保留这个名称避免破坏老调用方。
func GroupByAuthor(albums []models.Album) []models.SmartCollection {
	return GroupByTag(albums)
}
