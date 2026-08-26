package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCacheStatsService_Usage_Missing(t *testing.T) {
	svc := NewCacheStatsService(100 * time.Millisecond)
	u, _, err := svc.Usage(filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatalf("missing dir should not error, got: %v", err)
	}
	if u.Available {
		t.Error("Available should be false for missing dir")
	}
	if u.TotalBytes != 0 || u.FileCount != 0 {
		t.Errorf("missing dir should be empty, got %+v", u)
	}
}

func TestCacheStatsService_Usage_Basic(t *testing.T) {
	dir := t.TempDir()
	files := map[string]int{
		"a.txt": 100,
		"b.txt": 200,
		"c.txt": 300,
	}
	for n, sz := range files {
		if err := os.WriteFile(filepath.Join(dir, n), make([]byte, sz), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// 子目录里的文件也应计入
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "d.txt"), make([]byte, 50), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := NewCacheStatsService(100 * time.Millisecond)
	u, _, err := svc.Usage(dir)
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if !u.Available {
		t.Error("Available should be true")
	}
	if u.FileCount != 4 {
		t.Errorf("FileCount: got %d want 4", u.FileCount)
	}
	if u.TotalBytes != 650 {
		t.Errorf("TotalBytes: got %d want 650", u.TotalBytes)
	}
}

func TestCacheStatsService_TTL(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := NewCacheStatsService(200 * time.Millisecond)
	u1, exp1, err := svc.Usage(dir)
	if err != nil {
		t.Fatal(err)
	}
	if exp1 == nil {
		t.Fatal("expiresAt should not be nil after first call")
	}
	// 立即再调,应该命中缓存
	u2, exp2, _ := svc.Usage(dir)
	if u2.ScannedAt != u1.ScannedAt {
		t.Errorf("TTL hit: ScannedAt changed: %v vs %v", u1.ScannedAt, u2.ScannedAt)
	}
	if exp2 == nil || !exp2.Equal(*exp1) {
		t.Errorf("expiresAt should be stable within TTL, got %v vs %v", exp1, exp2)
	}
	// 等过期
	time.Sleep(250 * time.Millisecond)
	u3, _, _ := svc.Usage(dir)
	if u3.ScannedAt.Equal(u1.ScannedAt) {
		t.Error("after TTL, ScannedAt should refresh")
	}
}

func TestCacheStatsService_Invalidate(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	svc := NewCacheStatsService(10 * time.Second)
	u1, _, _ := svc.Usage(dir)
	svc.Invalidate()
	// 强制不同时间戳(避免毫秒级碰撞,虽然极小概率)
	time.Sleep(2 * time.Millisecond)
	u2, _, _ := svc.Usage(dir)
	if u2.ScannedAt.Equal(u1.ScannedAt) {
		t.Errorf("after Invalidate, ScannedAt should refresh: u1=%v u2=%v", u1.ScannedAt, u2.ScannedAt)
	}
}

func TestCacheStatsService_PathChange(t *testing.T) {
	// 切换到不同路径时应重算(即使在 TTL 内)
	d1 := t.TempDir()
	d2 := t.TempDir()
	os.WriteFile(filepath.Join(d1, "a.txt"), []byte("12345"), 0o644)
	os.WriteFile(filepath.Join(d2, "a.txt"), []byte("1234567890"), 0o644)
	svc := NewCacheStatsService(10 * time.Second)
	u1, _, _ := svc.Usage(d1)
	u2, _, _ := svc.Usage(d2)
	if u1.Path == u2.Path {
		t.Error("different paths should produce different snapshots")
	}
	if u1.TotalBytes == u2.TotalBytes {
		t.Error("different file sizes should produce different totals")
	}
}

// 子目录细分:thumbs(顶层 jpg)+ video-faststart / video-transcode(子目录)三类独立统计。
// 验证:
//  1. thumbs:cacheDir 顶层 .jpg,Available=true,bytes/count 与实际相符
//  2. 子目录不存在 → Available=false,bytes/count=0
//  3. 子目录存在 → Available=true,bytes/count 与目录内实际相符
//  4. 顶层 TotalBytes 包含 thumbs + 两个子目录 + 顶层元数据(主 + 三 sub 各自独立)
func TestCacheStatsService_SubDir(t *testing.T) {
	dir := t.TempDir()
	// 模拟三种缓存各有不同字节数 + 顶层放一个非 jpg 元数据
	mkFile := func(rel string, sz int) {
		full := filepath.Join(dir, rel)
		os.MkdirAll(filepath.Dir(full), 0o755)
		os.WriteFile(full, make([]byte, sz), 0o644)
	}
	// thumbs:实际写在 cacheDir 顶层(<md5>.jpg 命名),不放在 thumbs/ 子目录
	mkFile("abc.jpg", 1000)
	mkFile("def.jpg", 2000)
	mkFile("video-faststart/xyz.mp4", 5000)
	mkFile("video-transcode/pqr.mp4", 8000)
	mkFile("prefs.json", 100) // 顶层 json 元数据,不该被 thumbs 算进去

	svc := NewCacheStatsService(time.Second)
	u, _, err := svc.Usage(dir)
	if err != nil {
		t.Fatal(err)
	}
	// 顶层 5 文件 16.1 KB
	if u.FileCount != 5 {
		t.Errorf("FileCount: got %d want 5", u.FileCount)
	}
	if u.TotalBytes != 16100 {
		t.Errorf("TotalBytes: got %d want 16100", u.TotalBytes)
	}

	// Thumbs:2 文件 3KB
	if !u.Thumbs.Available {
		t.Error("Thumbs.Available should be true")
	}
	if u.Thumbs.FileCount != 2 || u.Thumbs.Bytes != 3000 {
		t.Errorf("Thumbs: got %+v want 2 files / 3000 bytes", u.Thumbs)
	}

	// VideoFaststart:1 文件 5KB
	if !u.VideoFaststart.Available {
		t.Error("VideoFaststart.Available should be true")
	}
	if u.VideoFaststart.FileCount != 1 || u.VideoFaststart.Bytes != 5000 {
		t.Errorf("VideoFaststart: got %+v want 1 file / 5000 bytes", u.VideoFaststart)
	}

	// VideoTranscode:1 文件 8KB
	if !u.VideoTranscode.Available {
		t.Error("VideoTranscode.Available should be true")
	}
	if u.VideoTranscode.FileCount != 1 || u.VideoTranscode.Bytes != 8000 {
		t.Errorf("VideoTranscode: got %+v want 1 file / 8000 bytes", u.VideoTranscode)
	}
}

// 顶层空:faststart/transcode 走子目录扫描 → Available=false;
// thumbs 改走 cacheDir 顶层 jpg 扫描(目录在)→ Available=true 但文件数 0。
// —— 详见 scanThumbsTopLevel 注释。
func TestCacheStatsService_SubDirMissing(t *testing.T) {
	dir := t.TempDir()
	// 顶层空 — 整个 dir 存在但无子目录
	svc := NewCacheStatsService(time.Second)
	u, _, err := svc.Usage(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Thumbs:cacheDir 顶层扫描,目录存在 → Available=true,文件数 0
	if !u.Thumbs.Available {
		t.Errorf("Thumbs.Available should be true when cacheDir exists, got false")
	}
	if u.Thumbs.FileCount != 0 || u.Thumbs.Bytes != 0 {
		t.Errorf("Thumbs should be empty in fresh dir, got %+v", u.Thumbs)
	}
	// Faststart / Transcode:子目录不存在 → Available=false
	for name, sub := range map[string]SubUsage{
		"VideoFaststart": u.VideoFaststart,
		"VideoTranscode": u.VideoTranscode,
	} {
		if sub.Available {
			t.Errorf("%s.Available should be false when subdir missing", name)
		}
		if sub.Bytes != 0 || sub.FileCount != 0 {
			t.Errorf("%s should be empty when subdir missing, got %+v", name, sub)
		}
	}
}

// 回归测试:thumbs 统计 cacheDir 顶层的 .jpg/.jpeg 文件,
// 跳过子目录(由 faststart/transcode 各自扫)和顶层元数据(.json 等)。
// 这是修 scanSubDir("thumbs") 永远返回空 bug 的核心场景。
func TestCacheStatsService_ThumbsTopLevel(t *testing.T) {
	dir := t.TempDir()
	// 三个 jpg,一个 jpeg,一个 png(应被忽略),一个 .json 元数据(应被忽略)
	if err := os.WriteFile(filepath.Join(dir, "aa01.jpg"), make([]byte, 100), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bb02.jpg"), make([]byte, 200), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cc03.JPEG"), make([]byte, 300), 0o644); err != nil { // 大写扩展名也要认
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "thumb.png"), make([]byte, 999), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scan_cache.json"), make([]byte, 50), 0o644); err != nil {
		t.Fatal(err)
	}
	// 子目录里的 jpg(应被忽略,不是顶层;faststart 子目录是合法子目录)
	if err := os.MkdirAll(filepath.Join(dir, "video-faststart"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "video-faststart", "nested.jpg"), make([]byte, 888), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := NewCacheStatsService(100 * time.Millisecond)
	u, _, err := svc.Usage(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !u.Thumbs.Available {
		t.Error("Thumbs.Available should be true")
	}
	if u.Thumbs.FileCount != 3 {
		t.Errorf("Thumbs.FileCount: got %d want 3 (3 .jpg/.jpeg at top level)", u.Thumbs.FileCount)
	}
	if u.Thumbs.Bytes != 600 {
		t.Errorf("Thumbs.Bytes: got %d want 600 (100+200+300)", u.Thumbs.Bytes)
	}
	// 关键不变量:thumbs 不应误数子目录里的 jpg(nested.jpg 在
	// video-faststart/ 下,只有 scanSubDir 才会数;scanThumbsTopLevel
	// 只看顶层 ReadDir)。faststart 子目录里这个 nested.jpg 不会进 thumbs。
	// 如果未来有人把 scanThumbsTopLevel 改成递归,这条断言会抓住。
	if u.Thumbs.FileCount != 3 {
		t.Errorf("nested.jpg leaked into thumbs.FileCount: %+v", u.Thumbs)
	}
}
