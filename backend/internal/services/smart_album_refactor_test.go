package services

import (
	"path/filepath"
	"testing"
)

// TestSmartAlbumOverrideMigrationKeepsOldKeyUntilCacheIsPersisted 守住
// 改名迁移的落盘顺序。
//
// 迁移分两步：先写下新键，等缓存落盘之后再删旧键。
// 顺序反过来的话，进程在两次写之间退出时旧键已经被删掉、缓存里却还是
// 旧分组 —— 用户改过的名字就此没有出处，只能重新改一遍。
func TestSmartAlbumOverrideMigrationKeepsOldKeyUntilCacheIsPersisted(t *testing.T) {
	service := &SmartAlbumService{
		statePath: filepath.Join(t.TempDir(), "smart-albums.json"),
		state: smartAlbumState{
			Version:   smartAlbumStateVersion,
			Overrides: map[string]SmartAlbumOverride{},
		},
	}
	albumID := "a_test"
	dimension := SmartAlbumDimensionRecommended
	oldID := "sg_11111111111111111111"
	newID := "sg_22222222222222222222"
	members := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	oldKey := smartOverrideKey(albumID, dimension, oldID)
	newKey := smartOverrideKey(albumID, dimension, newID)
	service.state.Overrides[oldKey] = SmartAlbumOverride{Name: "家人出游"}

	groups, migration, err := service.migrateSmartAlbumOverrides(albumID, dimension,
		[]smartAlbumCachedGroup{{ID: oldID, Members: members}},
		[]SmartAlbumGroup{{ID: newID, Dimension: dimension, Members: members}},
	)
	if err != nil {
		t.Fatalf("migrateSmartAlbumOverrides() error = %v", err)
	}
	if len(groups) != 1 || groups[0].OverrideConflict {
		t.Fatalf("migration result = %+v", groups)
	}
	if _, exists := service.state.Overrides[newKey]; !exists {
		t.Fatal("the migrated override was not written")
	}
	if _, exists := service.state.Overrides[oldKey]; !exists {
		t.Fatal("the old override key was removed before the cache was persisted")
	}
	// 缓存写失败时不提交删除：旧键仍然指向旧分组，改名还在。
	if err := service.commitSmartAlbumOverrideMigration(migration); err != nil {
		t.Fatalf("commitSmartAlbumOverrideMigration() error = %v", err)
	}
	if _, exists := service.state.Overrides[oldKey]; exists {
		t.Fatal("the old override key was not removed after the cache was persisted")
	}
	if service.state.Overrides[newKey].Name != "家人出游" {
		t.Fatalf("the migrated override lost its value: %+v", service.state.Overrides[newKey])
	}
}

// TestSmartAlbumCoverageCountsMissingOnce 守住覆盖率只有一套算法。
//
// 完整记录、摘要与向量索引三种结果结构判「成功还是失败」的方式不同，
// 缺失数的算法却是同一套：分开写就会出现两处口径不一致。
func TestSmartAlbumCoverageCountsMissingOnce(t *testing.T) {
	module := AIJobModule{Type: AIJobTypeOCR, Installed: true}
	records := map[string]AIAnalysisRecord{
		"a": {Status: "parsed"},
		"b": {Status: "failed"},
	}
	summaries := map[string]AIAnalysisRecordSummary{
		"a": {Status: "parsed"},
		"b": {Status: "failed"},
	}
	fromRecords := coverageForRecords(4, 2, records, module)
	fromSummaries := coverageForSummaries(4, 2, summaries, module)
	if fromRecords != fromSummaries {
		t.Fatalf("coverage differs between records and summaries: %+v vs %+v", fromRecords, fromSummaries)
	}
	if fromRecords.Analyzed != 1 || fromRecords.Failed != 1 || fromRecords.Missing != 2 {
		t.Fatalf("coverage = %+v, want analyzed 1, failed 1, missing 2", fromRecords)
	}
}
