package models

import (
	"strings"
	"time"
	"unicode"
)

// HistoryEntry 单条最近访问记录。
type HistoryEntry struct {
	AlbumID    string    `json:"albumId"`
	Name       string    `json:"name"`
	ImageCount int       `json:"imageCount"`
	OpenedAt   time.Time `json:"openedAt"`
}

// ReadingProgress 单本相册的阅读进度。
type ReadingProgress struct {
	AlbumID string    `json:"albumId"` // 不透明相册 ID
	Index   int       `json:"index"`   // 当前页
	Total   int       `json:"total"`   // 总页数（冗余，便于显示）
	Scroll  int       `json:"scroll"`  // 滚动位置
	Updated time.Time `json:"updated"`
}

// Prefs 用户偏好（持久化在服务端 &lt;cacheDir&gt;/web_settings.json）。
//
// 字段语义对齐原桌面应用：
//   - Favorites：收藏的资源 ID 列表（相册 / 集合 / smart:<tag>）
//   - History：最近访问（LRU，上限 MaxRecent）
//   - ReadingProgress：阅读进度（按相册 ID）
//   - Theme：light / dark / system
//   - AutoSwitchAlbum：画廊末尾自动跳到下个相册
//   - ShowSwitchNotif：跨相册切换时显示通知
type Prefs struct {
	Favorites        []string          `json:"favorites"`
	History          []HistoryEntry    `json:"history"`
	ReadingProgress  []ReadingProgress `json:"readingProgress"`
	MaxRecent        int               `json:"maxRecent"`
	AutoSwitchAlbum  bool              `json:"autoSwitchAlbum"`
	ShowSwitchNotif  bool              `json:"showSwitchNotif"`
	Theme            string            `json:"theme"`
	SidebarCollapsed bool              `json:"sidebarCollapsed"`
}

// IsAlbumID 校验公共相册 ID 的稳定格式：a_ + 16 字节哈希的 base64url。
func IsAlbumID(value string) bool {
	return isOpaqueResourceID(value, "a_")
}

// IsFavoriteResourceID 校验收藏可接受的相册、集合或智能标签 ID。
func IsFavoriteResourceID(value string) bool {
	if IsAlbumID(value) || isOpaqueResourceID(value, "c_") {
		return true
	}
	if !strings.HasPrefix(value, "smart:") {
		return false
	}
	tag := strings.TrimPrefix(value, "smart:")
	if tag == "" || len(tag) > 256 || strings.ContainsAny(tag, `/\`) {
		return false
	}
	for _, r := range tag {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func isOpaqueResourceID(value, prefix string) bool {
	if len(value) != len(prefix)+22 || !strings.HasPrefix(value, prefix) {
		return false
	}
	for _, r := range value[len(prefix):] {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

// DefaultPrefs 返回默认偏好。
func DefaultPrefs() Prefs {
	return Prefs{
		Favorites:        []string{},
		History:          []HistoryEntry{},
		ReadingProgress:  []ReadingProgress{},
		MaxRecent:        10,
		AutoSwitchAlbum:  true,
		ShowSwitchNotif:  true,
		Theme:            "system",
		SidebarCollapsed: false,
	}
}
