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

// Prefs 用户偏好（持久化在服务端 &lt;cacheDir&gt;/web_settings.json）。
//
// 字段语义对齐原桌面应用：
//   - Favorites：收藏的资源 ID 列表（相册 / 集合 / smart:<tag>）
//   - History：最近访问（LRU，上限 MaxRecent）
//   - Theme：light / dark / system
//   - AutoSwitchAlbum：画廊末尾自动跳到下个相册
//   - ShowSwitchNotif：跨相册切换时显示通知
//   - AppMode：上次使用的工作台（photo / comic）
//   - HiddenNavItems：侧栏里被收起的导航项
type Prefs struct {
	Favorites        []string       `json:"favorites"`
	History          []HistoryEntry `json:"history"`
	MaxRecent        int            `json:"maxRecent"`
	AutoSwitchAlbum  bool           `json:"autoSwitchAlbum"`
	ShowSwitchNotif  bool           `json:"showSwitchNotif"`
	Theme            string         `json:"theme"`
	SidebarCollapsed bool           `json:"sidebarCollapsed"`
	// AppMode 是上次使用的工作台。它决定进入应用根路径时落到照片侧还是
	// 漫画侧；当前在看哪一侧由前端路由决定，不从这里读。
	AppMode AppMode `json:"appMode"`
	// HiddenNavItems 是侧栏里被收起的导航项 key 列表。
	//
	// 侧栏入口可按需隐藏（设置页的「导航」分区逐项开关）。这里存的是
	// 生效的清单：前端算好每一项的最终可见性，再整份写回。服务端只把
	// key 当不透明字符串保存与透传，不解释它的含义。
	HiddenNavItems []string `json:"hiddenNavItems"`
}

// PrefsView 是 /api/prefs 对外暴露的偏好子集。
//
// 收藏与最近访问各有一套接口（/api/favorites、/api/history）：它们有独立的
// 写入路径与独立的缓存，跟着偏好一起返回只会让客户端多存一份同样的数据。
// 偏好文件本身仍然带着这两个字段（收藏与历史要和其它设置写在同一份文件里，
// 备份才是一个完整快照）。
type PrefsView struct {
	MaxRecent        int    `json:"maxRecent"`
	AutoSwitchAlbum  bool   `json:"autoSwitchAlbum"`
	ShowSwitchNotif  bool   `json:"showSwitchNotif"`
	Theme            string `json:"theme"`
	SidebarCollapsed bool   `json:"sidebarCollapsed"`
	// AppMode 是上次使用的工作台。它决定进入应用根路径时落到照片侧还是
	// 漫画侧；当前在看哪一侧由前端路由决定，不从这里读。
	AppMode AppMode `json:"appMode"`
	// HiddenNavItems 是侧栏里被收起的导航项 key 列表。
	//
	// 侧栏入口可按需隐藏（设置页的「导航」分区逐项开关）。这里存的是
	// 生效的清单：前端算好每一项的最终可见性，再整份写回。服务端只把
	// key 当不透明字符串保存与透传，不解释它的含义。
	HiddenNavItems []string `json:"hiddenNavItems"`
}

// View 取偏好里对外可见的那部分。
func (p Prefs) View() PrefsView {
	return PrefsView{
		MaxRecent:        p.MaxRecent,
		AutoSwitchAlbum:  p.AutoSwitchAlbum,
		ShowSwitchNotif:  p.ShowSwitchNotif,
		Theme:            p.Theme,
		SidebarCollapsed: p.SidebarCollapsed,
		AppMode:          p.AppMode,
		HiddenNavItems:   append([]string{}, p.HiddenNavItems...),
	}
}

// MaxHiddenNavItems 是隐藏导航项的上限。侧栏入口只有十来个，
// 超过这个数只可能是异常输入。
const MaxHiddenNavItems = 32

// DefaultHiddenNavItems 是默认收起的导航项。
//
// 照片侧的最近浏览、收藏照片与精选照片默认不出现在侧栏：它们都有更近
// 的入口（照片墙、首页专区），侧栏留给更少、更常用的入口。
//
// 这份清单与前端 utils/navEntries.ts 的 DEFAULT_HIDDEN_NAV_ITEMS 一一
// 对应，改一处就要改另一处。之所以两边各留一份：服务端存的是生效清单，
// 没有默认值就无法区分「用户没配过」与「用户把三项都放出来了」。
var DefaultHiddenNavItems = []string{
	"photo.recents",
	"photo.favorites",
	"photo.picks",
}

// IsValidNavItemKey 校验导航项 key 的格式：<侧>.<名字>。
//
// 形如 photo.recents、comic.unread。字符集收紧到小写字母、数字、点与
// 连字符：key 会原样写进偏好文件与备份文件，不给它开口子的余地。
func IsValidNavItemKey(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '.' || r == '-':
		default:
			return false
		}
	}
	return true
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
		MaxRecent:        10,
		AutoSwitchAlbum:  true,
		ShowSwitchNotif:  true,
		Theme:            "system",
		SidebarCollapsed: false,
		AppMode:          DefaultAppMode,
		HiddenNavItems:   append([]string{}, DefaultHiddenNavItems...),
	}
}
