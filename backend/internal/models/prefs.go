package models

import "time"

// HistoryEntry 单条最近访问记录。
type HistoryEntry struct {
	Path       string    `json:"path"`
	Name       string    `json:"name"`
	ImageCount int       `json:"imageCount"`
	OpenedAt   time.Time `json:"openedAt"`
}

// Prefs 用户偏好（持久化在服务端 ~/.comic_reader/web_settings.json）。
//
// 字段语义对齐原桌面应用：
//   - Favorites：收藏的相册路径列表
//   - History：最近访问（LRU，上限 MaxRecent）
//   - Theme：light / dark / system
//   - AutoSwitchAlbum：查看器末尾自动跳到下个相册
//   - ShowSwitchNotif：跨相册切换时显示通知
type Prefs struct {
	Favorites        []string      `json:"favorites"`
	History          []HistoryEntry `json:"history"`
	MaxRecent        int           `json:"maxRecent"`
	AutoSwitchAlbum  bool          `json:"autoSwitchAlbum"`
	ShowSwitchNotif  bool          `json:"showSwitchNotif"`
	Theme            string        `json:"theme"`
	SidebarCollapsed bool          `json:"sidebarCollapsed"`
}

// DefaultPrefs 返回默认偏好。
func DefaultPrefs() Prefs {
	return Prefs{
		Favorites:        []string{},
		History:          []HistoryEntry{},
		MaxRecent:        10,
		AutoSwitchAlbum:  true,
		ShowSwitchNotif:  true,
		Theme:            "system",
		SidebarCollapsed: false,
	}
}
