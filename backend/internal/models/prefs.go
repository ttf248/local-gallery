package models

import "time"

// HistoryEntry 单条最近访问记录。
type HistoryEntry struct {
	Path       string    `json:"path"`
	Name       string    `json:"name"`
	ImageCount int       `json:"imageCount"`
	OpenedAt   time.Time `json:"openedAt"`
}

// ReadingProgress 单本相册的阅读进度。
type ReadingProgress struct {
	Path   string `json:"path"`   // 相册路径
	Index  int    `json:"index"`  // 当前页
	Total  int    `json:"total"`  // 总页数（冗余，便于显示）
	Scroll int    `json:"scroll"` // 滚动位置
	Updated time.Time `json:"updated"`
}

// Prefs 用户偏好（持久化在服务端 &lt;repoRoot&gt;/.cache/web_settings.json）。
//
// 字段语义对齐原桌面应用：
//   - Favorites：收藏的相册路径列表
//   - History：最近访问（LRU，上限 MaxRecent）
//   - ReadingProgress：阅读进度（按相册路径）
//   - Theme：light / dark / system
//   - AutoSwitchAlbum：查看器末尾自动跳到下个相册
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
