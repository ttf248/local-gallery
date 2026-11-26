package services

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/disintegration/imaging"
)

func portraitVersion(f PersonFace) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("portrait3/%s/%s/%d/%d/%v/%v", f.Key, f.recordHash, f.Size, f.MTimeNs, f.Box, f.portraitEyes)))
	return fmt.Sprintf("%x", digest[:12])
}
func portraitURL(id string, f PersonFace) string {
	return fmt.Sprintf("/api/thumbs/%s/portrait/%s/%d?v=%s", f.ResourceID, id, f.FaceIndex, portraitVersion(f))
}

type PortraitOption struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

func (s *PeopleService) PortraitOptions(id string) []PortraitOption {
	s.mu.RLock()
	defer s.mu.RUnlock()
	type ranked struct {
		option PortraitOption
		score  float64
	}
	choices := []ranked{}
	for _, f := range s.faces {
		if s.effectivePersonIDLocked(f) != id || s.sourceIsPhoto != nil && !s.sourceIsPhoto(f.ResourceID) {
			continue
		}
		f = s.portraitFaceLocked(f)
		if len(f.Box) != 4 {
			continue
		}
		var g PersonGroup
		g.considerCover(f)
		choices = append(choices, ranked{PortraitOption{f.Key, portraitURL(id, f)}, g.coverScore})
	}
	sort.Slice(choices, func(i, j int) bool {
		if choices[i].score == choices[j].score {
			return choices[i].option.Key < choices[j].option.Key
		}
		return choices[i].score > choices[j].score
	})
	out := make([]PortraitOption, len(choices))
	for i, c := range choices {
		out[i] = c.option
	}
	return out
}

// 人脸框使用转正后的源图像素。只在头像首次请求时解码，复用缩略图的并发、磁盘与内存缓存。
func (s *ThumbnailService) Portrait(path string, f PersonFace, size int) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != f.Size || info.ModTime().UnixNano() != f.MTimeNs {
		return nil, ErrSourceMissing
	}
	key := fmt.Sprintf("%s-%d", portraitVersion(f), size)
	// 同一张合照的不同人脸也必须使用独立缓存。
	s.mu.RLock()
	cache := s.memCache
	dir := s.cacheDir
	s.mu.RUnlock()
	if b, ok := cache.Get(key); ok {
		return b, nil
	}
	file := filepath.Join(dir, key+JPEGExt)
	result, err, _ := s.flight.Do(key, func() (interface{}, error) {
		if b, err := os.ReadFile(file); err == nil {
			return b, nil
		}
		img, err := s.decodeForRender(path, 4096)
		if err != nil {
			return nil, err
		}
		w, h := img.Bounds().Dx(), img.Bounds().Dy()
		originalW, originalH, known := decodeImageDimensions(path)
		if known && (originalW > originalH) != (w > h) {
			originalW, originalH = originalH, originalW
		}
		scale := 1.0
		if known {
			scale = float64(w) / float64(originalW)
		}
		x, y, fw, fh := float64(f.Box[0])*scale, float64(f.Box[1])*scale, float64(f.Box[2])*scale, float64(f.Box[3])*scale
		if x+fw/2 < 0 || x+fw/2 >= float64(w) || y+fh/2 < 0 || y+fh/2 >= float64(h) {
			return nil, ErrSourceMissing
		}
		span := min(w, h, max(1, int(math.Ceil(max(fw, fh)*1.48))))
		centerX, centerY := x+fw/2, y+fh*0.43
		if len(f.portraitEyes) == 2 {
			centerX = float64(f.portraitEyes[0]) * scale
			centerY = float64(f.portraitEyes[1])*scale + float64(span)*0.10
		}
		left := max(0, min(w-span, int(centerX)-span/2))
		top := max(0, min(h-span, int(centerY)-span/2))
		crop := imaging.Crop(img, image.Rect(left, top, left+span, top+span))
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, imaging.Resize(crop, size, size, imaging.Lanczos), &jpeg.Options{Quality: 90}); err != nil {
			return nil, err
		}
		b := buf.Bytes()
		if err := writeScanCacheAtomic(file, b); err != nil {
			return nil, err
		}
		return b, nil
	})
	if err != nil {
		return nil, err
	}
	data := result.([]byte)
	cache.Add(key, data)
	return data, nil
}
