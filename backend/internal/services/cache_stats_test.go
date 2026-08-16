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
