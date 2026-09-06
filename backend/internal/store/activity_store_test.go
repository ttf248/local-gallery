package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func testFileID(n int) string {
	return "f_" + testIDDigits(n)
}

func testIDDigits(n int) string {
	const width = 22
	value := []byte("0000000000000000000000")
	for i := width - 1; n > 0 && i >= 0; i-- {
		value[i] = byte('0' + n%10)
		n /= 10
	}
	return string(value)
}

func newTestActivityStore(t *testing.T) (*ActivityStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "activity.json")
	return NewActivityStore(path, ""), path
}

func imageActivity(album int, page, count int) models.Activity {
	return models.Activity{
		AlbumID:   testAlbumID(album),
		MediaKind: models.MediaKindImage,
		PageIndex: page,
		PageCount: count,
		Updated:   time.Date(2026, 1, 1, 0, 0, album, 0, time.UTC),
	}
}

func TestActivityStorePersistsIndependentImageAndVideoActivities(t *testing.T) {
	store, path := newTestActivityStore(t)
	image := imageActivity(1, 3, 10)
	video := models.Activity{
		AlbumID:    testAlbumID(1),
		MediaKind:  models.MediaKindVideo,
		ItemID:     testFileID(1),
		PositionMS: 20_000,
		DurationMS: 100_000,
		Updated:    time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
	}
	if err := store.SetBatch([]models.Activity{image, video}); err != nil {
		t.Fatal(err)
	}

	reopened := NewActivityStore(path, "")
	got, err := reopened.Query([]models.ActivityIdentity{image.Identity(), video.Identity()})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].PageIndex != 3 || got[1].PositionMS != 20_000 {
		t.Fatalf("unexpected persisted activities: %+v", got)
	}
	if got[0].Status != models.ActivityInProgress || got[1].Status != models.ActivityInProgress {
		t.Fatalf("status was not derived: %+v", got)
	}
}

func TestActivityStoreBatchRejectsAllWhenOneItemIsInvalid(t *testing.T) {
	store, _ := newTestActivityStore(t)
	valid := imageActivity(1, 1, 4)
	invalid := imageActivity(2, 4, 4)
	if err := store.SetBatch([]models.Activity{valid, invalid}); err == nil {
		t.Fatal("invalid batch was accepted")
	}
	if _, exists, err := store.Get(valid.Identity()); err != nil || exists {
		t.Fatalf("invalid batch partially committed: exists=%v err=%v", exists, err)
	}
}

func TestActivityStoreDoesNotOverwriteNewerActivity(t *testing.T) {
	store, _ := newTestActivityStore(t)
	newer := imageActivity(1, 7, 10)
	newer.Updated = time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	older := imageActivity(1, 2, 10)
	older.Updated = newer.Updated.Add(-time.Second)
	if err := store.Set(newer); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(older); err != nil {
		t.Fatal(err)
	}
	got, exists, err := store.Get(newer.Identity())
	if err != nil || !exists || got.PageIndex != newer.PageIndex {
		t.Fatalf("older activity overwrote newer value: activity=%+v exists=%v err=%v", got, exists, err)
	}
}

func TestActivityStoreStartedImageAlbumIDsExcludesVideoOnlyRecords(t *testing.T) {
	store, _ := newTestActivityStore(t)
	image := imageActivity(1, 1, 3)
	video := models.Activity{
		AlbumID:    testAlbumID(2),
		MediaKind:  models.MediaKindVideo,
		ItemID:     testFileID(2),
		PositionMS: 10_000,
		DurationMS: 20_000,
	}
	if err := store.SetBatch([]models.Activity{image, video}); err != nil {
		t.Fatal(err)
	}
	ids, err := store.StartedImageAlbumIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 {
		t.Fatalf("image IDs=%v", ids)
	}
	if _, ok := ids[image.AlbumID]; !ok {
		t.Fatalf("missing image album ID %q", image.AlbumID)
	}
}

func TestActivityStoreImageActivitiesExcludesVideoRecords(t *testing.T) {
	store, _ := newTestActivityStore(t)
	image := imageActivity(1, 1, 3)
	video := models.Activity{
		AlbumID:    testAlbumID(2),
		MediaKind:  models.MediaKindVideo,
		ItemID:     testFileID(2),
		PositionMS: 10_000,
		DurationMS: 20_000,
	}
	if err := store.SetBatch([]models.Activity{image, video}); err != nil {
		t.Fatal(err)
	}
	activities, err := store.ImageActivities()
	if err != nil {
		t.Fatal(err)
	}
	if len(activities) != 1 || activities[0].AlbumID != image.AlbumID || activities[0].MediaKind != models.MediaKindImage {
		t.Fatalf("image activities=%+v", activities)
	}
}

func TestActivityStoreDeleteAndClearAreIdempotent(t *testing.T) {
	store, _ := newTestActivityStore(t)
	first := imageActivity(1, 1, 3)
	second := imageActivity(2, 2, 3)
	if err := store.SetBatch([]models.Activity{first, second}); err != nil {
		t.Fatal(err)
	}
	removed, err := store.Delete(first.Identity())
	if err != nil || !removed {
		t.Fatalf("delete failed: removed=%v err=%v", removed, err)
	}
	removed, err = store.Delete(first.Identity())
	if err != nil || removed {
		t.Fatalf("second delete must be idempotent: removed=%v err=%v", removed, err)
	}
	count, err := store.Clear()
	if err != nil || count != 1 {
		t.Fatalf("clear failed: count=%d err=%v", count, err)
	}
	count, err = store.Clear()
	if err != nil || count != 0 {
		t.Fatalf("second clear must be idempotent: count=%d err=%v", count, err)
	}
}

func TestActivityStoreMigratesOpaqueLegacyProgressOnce(t *testing.T) {
	dir := t.TempDir()
	activityPath := filepath.Join(dir, "activity.json")
	prefsPath := filepath.Join(dir, "web_settings.json")
	legacy := map[string]any{
		"readingProgress": []map[string]any{
			{"albumId": testAlbumID(1), "index": 12, "total": 10, "updated": "2026-01-01T00:00:00Z"},
			{"path": `C:\\secret`, "index": 1, "total": 2},
		},
	}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(prefsPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	store := NewActivityStore(activityPath, prefsPath)
	identity := models.ActivityIdentity{AlbumID: testAlbumID(1), MediaKind: models.MediaKindImage}
	activity, exists, err := store.Get(identity)
	if err != nil || !exists {
		t.Fatalf("legacy activity was not migrated: exists=%v err=%v", exists, err)
	}
	if activity.PageIndex != 9 || activity.Status != models.ActivityCompleted {
		t.Fatalf("legacy overflow was not clamped: %+v", activity)
	}
	if _, err := os.Stat(activityPath); err != nil {
		t.Fatalf("migration was not persisted: %v", err)
	}

	// 新文件是唯一真相源；修改旧偏好不得让已删除记录复活。
	if _, err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	reopened := NewActivityStore(activityPath, prefsPath)
	if _, exists, err := reopened.Get(identity); err != nil || exists {
		t.Fatalf("legacy data revived after migration: exists=%v err=%v", exists, err)
	}
}

func TestActivityStoreEagerLoadProtectsMigrationFromLaterPrefsRewrite(t *testing.T) {
	dir := t.TempDir()
	activityPath := filepath.Join(dir, "activity.json")
	prefsPath := filepath.Join(dir, "web_settings.json")
	legacy := []byte(`{"theme":"dark","readingProgress":[{"albumId":"a_0000000000000000000001","index":2,"total":5,"updated":"2026-01-01T00:00:00Z"}]}`)
	if err := os.WriteFile(prefsPath, legacy, 0o644); err != nil {
		t.Fatal(err)
	}

	activities := NewActivityStore(activityPath, prefsPath)
	if err := activities.Load(); err != nil {
		t.Fatal(err)
	}
	// PrefsStore 的新模型不再保留 readingProgress；模拟它在启动后改写偏好。
	if err := os.WriteFile(prefsPath, []byte(`{"theme":"light"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	reopened := NewActivityStore(activityPath, prefsPath)
	activity, exists, err := reopened.Get(models.ActivityIdentity{
		AlbumID: testAlbumID(1), MediaKind: models.MediaKindImage,
	})
	if err != nil || !exists || activity.PageIndex != 2 || activity.PageCount != 5 {
		t.Fatalf("eager migration was not durable: activity=%+v exists=%v err=%v", activity, exists, err)
	}
}

func TestActivityStoreRecoversFromCorruptFileWithoutExposingIt(t *testing.T) {
	store, path := newTestActivityStore(t)
	if err := os.WriteFile(path, []byte(`{"version":`), 0o644); err != nil {
		t.Fatal(err)
	}
	activities, err := store.Query([]models.ActivityIdentity{{
		AlbumID: testAlbumID(1), MediaKind: models.MediaKindImage,
	}})
	if err != nil || len(activities) != 0 {
		t.Fatalf("corrupt file did not recover: %+v err=%v", activities, err)
	}
	matches, _ := filepath.Glob(path + ".corrupt.*")
	if len(matches) != 1 {
		t.Fatalf("corrupt file backup missing: %v", matches)
	}
}

func TestActivityStoreKeepsUnsupportedFutureVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "activity.json")
	future := []byte(`{"version":2,"activities":[]}`)
	if err := os.WriteFile(path, future, 0o644); err != nil {
		t.Fatal(err)
	}
	store := NewActivityStore(path, "")
	if err := store.Load(); err == nil {
		t.Fatal("future activity version was accepted")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(future) {
		t.Fatalf("future activity file was modified: %s", got)
	}
	matches, _ := filepath.Glob(path + ".corrupt.*")
	if len(matches) != 0 {
		t.Fatalf("future activity file was treated as corrupt: %v", matches)
	}
}
