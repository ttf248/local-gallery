package services

import (
	"context"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
)

func comicFixture(t *testing.T) (*ComicMetaService, string, string) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "douluodalu 斗罗大陆")
	work := models.Collection{SourceRoot: root, Name: filepath.Base(dir), Path: dir}
	for _, name := range []string{"0001 番外1", "0016 第1话 第一集", "0017 第2话 重逢"} {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(p, 0755); err != nil {
			t.Fatal(err)
		}
		a := models.Album{SourceRoot: root, Name: name, Path: p, ImageCount: 2}
		for _, n := range []string{"1.png", "2.png"} {
			file := filepath.Join(p, n)
			if err := os.WriteFile(file, []byte(n), 0600); err != nil {
				t.Fatal(err)
			}
			a.ImageFiles = append(a.ImageFiles, file)
		}
		a.CoverImage = a.ImageFiles[0]
		a.CoverKind = "image"
		work.Albums = append(work.Albums, a)
	}
	if err := os.WriteFile(filepath.Join(dir, "series.json"), []byte(`{"author":"作者","synopsis":"本地故事"}`), 0600); err != nil {
		t.Fatal(err)
	}
	_, v := middleware.PathSafetyMiddleware([]string{root})
	layout, err := EnsureCacheLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c := NewResourceCatalog()
	c.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindComic}}))
	s, err := OpenComicMetaService(ComicMetaServiceOptions{layout, c, v.Validate})
	if err != nil {
		t.Fatal(err)
	}
	c.Publish(&models.ScanResult{Collections: []models.Collection{work}}, []string{root})
	return s, c.ExternalID(dir, ResourceCollection), root
}
func TestComicMetaMergeAndRestart(t *testing.T) {
	s, id, _ := comicFixture(t)
	snap := s.Catalog.Acquire()
	d, ok := s.ResolveNodeMeta(snap, id)
	if !ok || d.CleanTitle != "斗罗大陆" || d.Author != "作者" || d.FullSynopsis != "本地故事" || d.MainCount != 2 || d.ExtraCount != 1 || d.FirstEpisodeLabel != "第 1 话 · 第一集" {
		t.Fatalf("%+v", d)
	}
	long := strings.Repeat("漫", 650)
	locked := true
	if _, err := s.SaveOverride(snap, id, ComicWorkOverridePatch{Synopsis: &long, Locked: &locked}); err != nil {
		t.Fatal(err)
	}
	s, err := OpenComicMetaService(s.ComicMetaServiceOptions)
	if err != nil {
		t.Fatal(err)
	}
	snap = s.Catalog.Acquire()
	d, _ = s.ResolveNodeMeta(snap, id)
	n, _ := snap.LibraryNode(id)
	if d.FullSynopsis != long || !d.Locked || len([]rune(n.Comic.Synopsis)) != 400 {
		t.Fatal("覆盖或列表截断丢失")
	}
	if _, err = s.RefreshWork(context.Background(), snap, id, true); err != ErrOnlineComicDisabled {
		t.Fatal(err)
	}
	d, err = s.ClearOverride(snap, id)
	if err != nil || d.FullSynopsis != "本地故事" {
		t.Fatal(d, err)
	}
}
func TestStateBackupComicOverrides(t *testing.T) {
	s, id, _ := comicFixture(t)
	title := "人工书名"
	_, err := s.SaveOverride(s.Catalog.Acquire(), id, ComicWorkOverridePatch{Title: &title})
	if err != nil {
		t.Fatal(err)
	}
	backup := s.BackupOverrides(s.Catalog.Acquire())
	s.ClearOverride(s.Catalog.Acquire(), id)
	snap := s.Catalog.Acquire()
	if err = s.CompareAndRestoreOverrides(backupDigest(backup), backup, snap); err == nil {
		t.Fatal("旧摘要被接受")
	}
	if err = s.CompareAndRestoreOverrides(backupDigest(s.BackupOverrides(snap)), backup, snap); err != nil {
		t.Fatal(err)
	}
	d, _ := s.ResolveNodeMeta(s.Catalog.Acquire(), id)
	if d.CleanTitle != title {
		t.Fatal(d)
	}
}

func TestComicMetaConcurrentEditsAndStaleRecognition(t *testing.T) {
	s, id, _ := comicFixture(t)
	snapshot := s.Catalog.Acquire()
	title, author, locked := "人工书名", "人工作者", true
	done := make(chan error, 2)
	for _, patch := range []ComicWorkOverridePatch{{Title: &title, Locked: &locked}, {Author: &author}} {
		go func() {
			_, err := s.SaveOverride(snapshot, id, patch)
			done <- err
		}()
	}
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	current := s.Catalog.Acquire()
	value := ComicWorkIntel{NodeID: id, Source: ComicMetaSourceOnline, Title: "过期匹配", UpdatedAt: time.Now().UTC(), ContentSig: current.state.comicSignatures[id]}
	if err := s.storeIntel([]ComicWorkIntel{value}); err != nil {
		t.Fatal(err)
	}
	d, _ := s.ResolveNodeMeta(s.Catalog.Acquire(), id)
	if !d.Locked || d.CleanTitle != title || d.Author != author || len(s.SnapshotForCatalog().Intel) != 0 {
		t.Fatalf("并发人工修改或锁定状态丢失：%+v", d)
	}
	if _, err := s.ClearOverride(current, id); err != nil {
		t.Fatal(err)
	}
	value.ContentSig = "old"
	if err := s.storeIntel([]ComicWorkIntel{value}); err != nil {
		t.Fatal(err)
	}
	if len(s.SnapshotForCatalog().Intel) != 0 {
		t.Fatal("旧扫描结果污染了当前快照")
	}
}

func TestComicMetaEditsLeaveMediaUnchanged(t *testing.T) {
	s, id, root := comicFixture(t)
	contents := func() map[string]string {
		t.Helper()
		out := map[string]string{}
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() {
				return err
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			out[path] = info.ModTime().String() + ":" + string(data)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := contents()
	snap := s.Catalog.Acquire()
	name := "手工书名"
	if _, err := s.SaveOverride(snap, id, ComicWorkOverridePatch{Title: &name}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RefreshWork(context.Background(), snap, id, false); err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(before, contents()) {
		t.Fatal("编辑或识别改变了媒体目录")
	}
}
