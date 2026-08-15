// Package models 定义前后端共用的领域模型。
package models

import (
	"encoding/json"
	"time"
)

// 支持的图片扩展名（小写，含点）。
var ImageExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".bmp":  true,
	".webp": true,
	".tiff": true,
	".tif":  true,
}

// IsImageFile 判断文件名是否为支持的图片格式（不区分大小写）。
func IsImageFile(name string) bool {
	if len(name) < 5 {
		return false
	}
	ext := lowerExt(name)
	return ImageExts[ext]
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
// 历史命名：原 "相册" 概念；为了贴合"图像浏览器"产品定位，结构上也支持
// "folder" 概念（同一对象）。JSON 输出同时暴露新字段 `files`（推荐）与
// 旧字段 `imageFiles`（兼容）。
type Album struct {
	Type       string    `json:"type"`        // 始终为 "album"
	Path       string    `json:"path"`        // 绝对路径
	Name       string    `json:"name"`        // 文件夹名
	ImageFiles []string  `json:"-"`           // 见 MarshalJSON；同时输出 imageFiles + files
	CoverImage string    `json:"coverImage"`  // 封面（通常第一张）
	ImageCount int       `json:"imageCount"`  // 兼容旧字段，同时输出 fileCount
	Files      []string  `json:"-"`           // 见 MarshalJSON；为 0 时复用 ImageFiles
	FolderSize int64     `json:"folderSize"`  // 字节
	Author     string    `json:"author,omitempty"`
	ModTime    time.Time `json:"modTime"`
}

// MarshalJSON 同时输出 imageFiles（兼容）与 files（推荐）两个键。
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
		FileCount  int      `json:"fileCount"`
	}{
		alias:      alias(a),
		Files:      files,
		ImageFiles: a.ImageFiles,
		FileCount:  a.ImageCount,
	})
}

// Collection 仅含子相册（不含图片）的文件夹。
type Collection struct {
	Type       string      `json:"type"`        // 始终为 "collection"
	Path       string      `json:"path"`        // 绝对路径
	Name       string      `json:"name"`        // 文件夹名
	Albums     []Album     `json:"albums"`
	AlbumCount int         `json:"albumCount"`
}

// SmartCollection 基于方括号作者信息聚合的智能集合。
type SmartCollection struct {
	Type       string  `json:"type"`        // 始终为 "smartCollection"
	Author     string  `json:"author"`
	Albums     []Album `json:"albums"`
	AlbumCount int     `json:"albumCount"`
	CoverImage string  `json:"coverImage"`  // 图片数最多的相册封面
}

// ScanResult 单次扫描的完整结果。
type ScanResult struct {
	Root             string            `json:"root"`
	Albums           []Album           `json:"-"`          // 见 MarshalJSON；同时输出 albums + folders
	Collections      []Collection      `json:"collections"`
	SmartCollections []SmartCollection `json:"smartCollections"`
	AlbumCount       int               `json:"-"`          // 见 MarshalJSON；同时输出 albumCount + folderCount
	CollectionCount  int               `json:"collectionCount"`
	Duration         int64             `json:"duration"`  // 毫秒
	ScannedAt        time.Time         `json:"scannedAt"`
}

// MarshalJSON 同时输出 albums / folders 与 albumCount / folderCount 两组键。
func (s ScanResult) MarshalJSON() ([]byte, error) {
	type alias ScanResult
	return json.Marshal(struct {
		alias
		Albums     []Album `json:"albums"`
		Folders    []Album `json:"folders"`
		AlbumCount int     `json:"albumCount"`
		FolderCount int   `json:"folderCount"`
	}{
		alias:      alias(s),
		Albums:     s.Albums,
		Folders:    s.Albums,
		AlbumCount: s.AlbumCount,
		FolderCount: s.AlbumCount,
	})
}
