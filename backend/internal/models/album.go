// Package models 定义前后端共用的领域模型。
package models

import (
	"encoding/json"
	"time"
)

// 支持的图片扩展名（小写，含点）。
//
// 含 iPhone 照片常用的 HEIC/HEIF；缩略图与原图解码分别由
// `goheif` + `imaging` 处理，扫描阶段先做扩展名白名单。
var ImageExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".bmp":  true,
	".webp": true,
	".tiff": true,
	".tif":  true,
	".heic": true,
	".heif": true,
}

// IsImageFile 判断文件名是否为支持的图片格式（不区分大小写）。
func IsImageFile(name string) bool {
	if len(name) < 5 {
		return false
	}
	ext := lowerExt(name)
	return ImageExts[ext]
}

// VideoExts 支持的视频扩展名（小写，含点）。
//
// 选型：覆盖浏览器原生 `<video>` 元素能直接播放的常见容器。
// 视频的"封面"由前端在浏览器内通过 `<video>` + canvas 抽帧后回传
// 到 `/api/thumbs/cover`（实现见 handlers 包）；本服务不依赖 ffmpeg。
var VideoExts = map[string]bool{
	".mp4":  true,
	".m4v":  true,
	".webm": true,
	".mov":  true,
	".mkv":  true,
	".avi":  true, // 部分浏览器不支持 AVI 容器（含老式 XviD/DivX），但列入白名单方便后续扩展
}

// IsVideoFile 判断文件名是否为支持的视频格式（不区分大小写）。
func IsVideoFile(name string) bool {
	if len(name) < 5 {
		return false
	}
	ext := lowerExt(name)
	return VideoExts[ext]
}

func lowerExt(name string) string {
	for i := len(name) - 1; i >= 0 && i > len(name)-6; i-- {
		if name[i] == '.' {
			s := name[i:]
			b := []byte(s)
			for j := range b {
				if b[j] >= 'A' && b[j] <= 'Z' {
					b[j] += 32
				}
			}
			return string(b)
		}
	}
	return ""
}

// Album 含有图片的文件夹。
//
// 历史命名：原 "相册" 概念；为了贴合"本地画廊"产品定位，结构上也支持
// "folder" 概念（同一对象）。JSON 输出同时暴露新字段 `files`（推荐）与
// 旧字段 `imageFiles`（兼容）。
//
// 多根场景（mediaRoots 配置多个目录）下，扫描器会填充 SourceRoot（绝对路径）/
// SourceName（根的 basename，用于 badge 显示）；若不同根下出现同名相册，
// DisplayName 会加 "[SourceName] " 前缀避免歧义，否则与 Name 相同。
// 旧扫描缓存没有这几个字段时，handler 端兜底。
type Album struct {
	Type        string    `json:"type"`        // 始终为 "album"
	Path        string    `json:"path"`        // 绝对路径
	Name        string    `json:"name"`        // 文件夹名（原始名）
	DisplayName string    `json:"displayName,omitempty"` // 同名冲突时加来源前缀；否则等于 Name
	SourceRoot  string    `json:"sourceRoot,omitempty"`  // 所属媒体根（绝对路径）；多根扫描时填充
	SourceName  string    `json:"sourceName,omitempty"`  // 所属媒体根的 basename，用于 UI badge
	ImageFiles  []string  `json:"-"`           // 见 MarshalJSON/UnmarshalJSON；同时输出 imageFiles + files
	VideoFiles  []string  `json:"-"`           // 同上；输出 videoFiles
	CoverImage  string    `json:"coverImage"`  // 封面（图片时为原图绝对路径；视频时为视频绝对路径，缩略图由前端抽帧）
	ImageCount  int       `json:"imageCount"`  // 兼容旧字段，同时输出 fileCount
	VideoCount  int       `json:"videoCount,omitempty"`  // 视频数量（0 时省略）
	Files       []string  `json:"-"`           // 见 MarshalJSON/UnmarshalJSON；为 0 时复用 ImageFiles
	FolderSize  int64     `json:"folderSize"`  // 字节
	Tags        []string  `json:"tags,omitempty"`  // 标签（从方括号解析），可能多个
	Author      string    `json:"author,omitempty"` // 旧字段别名 = 第一个标签
	ModTime     time.Time `json:"modTime"`
	// CoverKind 标识封面来源："image" / "video" / ""（未指定时按是否有视频推断）。
	// 前端据此决定卡片样式（图卡 vs 视频▶卡）和点击进入的播放器类型。
	CoverKind string `json:"coverKind,omitempty"`
}

// MarshalJSON 同时输出 imageFiles（兼容）与 files（推荐）两个键。
//
// nil 切片序列化为 `[]`（默认 Go 行为是 `null`，前端直接 `.length` 会抛错）。
// VideoFiles 单独输出 videoFiles 键。
func (a Album) MarshalJSON() ([]byte, error) {
	type alias Album
	files := a.Files
	if len(files) == 0 {
		files = a.ImageFiles
	}
	return json.Marshal(struct {
		alias
		Files      []string `json:"files"`
		ImageFiles []string `json:"imageFiles"`
		VideoFiles []string `json:"videoFiles"`
		FileCount  int      `json:"fileCount"`
	}{
		alias:      alias(a),
		Files:      emptyStrings(files),
		ImageFiles: emptyStrings(a.ImageFiles),
		VideoFiles: emptyStrings(a.VideoFiles),
		FileCount:  a.ImageCount,
	})
}

// UnmarshalJSON 反序列化 album：
//   - 因 ImageFiles/Files 用了 `json:"-"`，需要自定义才能从 JSON 读回
//   - `imageFiles` 与 `files` 任一存在即写入；优先 files（新字段）
//   - 缓存文件被回填时可能只有 `imageFiles`（兼容旧版本）
//   - VideoFiles 字段缺失时为零值
func (a *Album) UnmarshalJSON(data []byte) error {
	type alias Album
	aux := struct {
		*alias
		Files      []string `json:"files"`
		ImageFiles []string `json:"imageFiles"`
		VideoFiles []string `json:"videoFiles"`
		FileCount  int      `json:"fileCount"`
	}{
		alias: (*alias)(a),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	switch {
	case len(aux.Files) > 0:
		a.Files = aux.Files
		a.ImageFiles = aux.ImageFiles // 即使为空也覆盖，避免残留旧值
	case len(aux.ImageFiles) > 0:
		a.ImageFiles = aux.ImageFiles
	}
	a.VideoFiles = aux.VideoFiles
	return nil
}

// emptyStrings 把 nil 切片转换为非 nil 空切片，避免 JSON 输出 `null`。
// 前端 TypeScript 类型期望 `string[]`，`null` 会被当作对象处理后抛错。
func emptyStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// Collection 仅含子相册（不含图片）的文件夹。
//
// Albums 与 Collections 同时存在：本层「散图」或直属于本层无嵌套的子相册
// 放在 Albums；下钻一层仍是「集合」语义的子集合（子文件夹里没有顶层图
// 只有更深子目录）放在 Collections。这样 UI 沿 Albums/Collections 两条
// 路径递归渲染时，可以完整保留「年 / 月 / 事件」这种多层目录结构。
type Collection struct {
	Type        string        `json:"type"`        // 始终为 "collection"
	Path        string        `json:"path"`        // 绝对路径
	Name        string        `json:"name"`        // 文件夹名
	DisplayName string        `json:"displayName,omitempty"`
	SourceRoot  string        `json:"sourceRoot,omitempty"`
	SourceName  string        `json:"sourceName,omitempty"`
	Albums      []Album       `json:"albums"`
	Collections []Collection  `json:"collections,omitempty"` // 嵌套子集合
	AlbumCount  int           `json:"albumCount"`            // 直属于本层的相册数（不含嵌套集合）
}

// MarshalJSON 确保 nil Albums 序列化为 `[]`；Collections 省略字段时
// 整段不输出，避免给前端返回大量空 `[]collections`。
func (c Collection) MarshalJSON() ([]byte, error) {
	type alias Collection
	albums := c.Albums
	if albums == nil {
		albums = []Album{}
	}
	// 嵌套 collections 为空时直接省略，前端按缺省处理即可
	hasNested := len(c.Collections) > 0
	return json.Marshal(struct {
		alias
		Albums      []Album       `json:"albums"`
		Collections []Collection  `json:"collections,omitempty"`
	}{
		alias:       alias(c),
		Albums:      albums,
		Collections: ternaryCollections(hasNested, c.Collections),
	})
}

func ternaryCollections(use bool, v []Collection) []Collection {
	if !use {
		return nil
	}
	return v
}

// SmartCollection 基于方括号标签聚合的智能集合。
//
// 历史命名：原本只把第一个方括号当"作者"；本地画廊产品语义下统称为
// "标签 / Tag"——一个文件夹可挂多个标签。
type SmartCollection struct {
	Type       string  `json:"type"`        // 始终为 "smartCollection"
	Tag        string  `json:"tag"`         // 标签（首个标签；当个智能合集的主键）
	Tags       []string `json:"tags,omitempty"`  // 同义时省略
	Author     string  `json:"author,omitempty"` // 旧字段别名 = Tag（兼容）
	Albums     []Album `json:"albums"`
	AlbumCount int     `json:"albumCount"`
	CoverImage string  `json:"coverImage"`  // 图片数最多的相册封面
}

// MarshalJSON 确保 nil Albums 序列化为 `[]`。
func (s SmartCollection) MarshalJSON() ([]byte, error) {
	type alias SmartCollection
	albums := s.Albums
	tags := s.Tags
	if albums == nil {
		albums = []Album{}
	}
	if tags == nil {
		tags = []string{}
	}
	return json.Marshal(struct {
		alias
		Albums []Album  `json:"albums"`
		Tags   []string `json:"tags"`
	}{alias: alias(s), Albums: albums, Tags: tags})
}

// ScanResult 单次扫描的完整结果。
//
// 多根场景下，Roots 列出所有参与扫描的根（按调用方传入顺序）；
// 旧字段 Root 取第一个根用于向后兼容。AlbumCount / CollectionCount 包含所有
// 根的合并统计。
type ScanResult struct {
	Root             string            `json:"root"`             // 第一个根（兼容字段）
	Roots            []string          `json:"roots,omitempty"`  // 所有根（多根时输出）
	Albums           []Album           `json:"albums"`
	Collections      []Collection      `json:"collections"`
	SmartCollections []SmartCollection `json:"smartCollections"`
	AlbumCount       int               `json:"albumCount"`
	CollectionCount  int               `json:"collectionCount"`
	Duration         int64             `json:"duration"` // 毫秒
	ScannedAt        time.Time         `json:"scannedAt"`
}
