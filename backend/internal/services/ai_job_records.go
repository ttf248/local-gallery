package services

// 本文件管可重建的分析结果：derived/metadata 里的单资源结果、它的版本键、
// 按模块或按资源的读取，以及资源离开图库后的作废。
//
// 结果与用户状态分开：这里的每一条都能从源文件重新算出来，
// 因此删除它们只需要重算，不需要备份。

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// ForgetResources 忘掉一批资源的分析结果。
//
// 资源从图库里消失后，它的分析结果已经没有对应的文件；留着会让派生
// 数据一直占着空间，也会让人以为这些照片还在库里。返回值是实际
// 忘掉的条数。
func (s *AIJobService) ForgetResources(resourceIDs []string) int {
	if len(resourceIDs) == 0 {
		return 0
	}
	targets := make(map[string]struct{}, len(resourceIDs))
	for _, id := range resourceIDs {
		if id == "" {
			continue
		}
		targets[id] = struct{}{}
	}
	if len(targets) == 0 {
		return 0
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return 0
	}
	removed := 0
	files := make(map[string]struct{})
	for key, record := range s.records {
		if _, exists := targets[record.ResourceID]; !exists {
			continue
		}
		if path, ok := s.recordFiles[key]; ok {
			files[path] = struct{}{}
		}
		delete(s.records, key)
		delete(s.recordFiles, key)
		removed++
	}
	if removed == 0 {
		s.mu.Unlock()
		return 0
	}
	s.recordsRevision++
	s.mu.Unlock()
	// 改写批次文件要读一遍整个文件再写回去，是磁盘操作：
	// 锁内做会让读任务的接口一起等。
	for path := range files {
		// 批次文件改写失败不影响本次运行：内存里的结果已经删掉，
		// 下次启动会重新读回旧记录，但图库本身的正确性不受影响。
		_ = rewriteAIBatchWithout(path, targets)
	}
	return removed
}

// rewriteAIBatchWithout 从批次文件里删掉指定资源的结果。
func rewriteAIBatchWithout(path string, removed map[string]struct{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var batch aiJobBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		return err
	}
	kept := make([]AIAnalysisRecord, 0, len(batch.Records))
	changed := false
	for _, record := range batch.Records {
		if _, exists := removed[record.ResourceID]; exists {
			changed = true
			continue
		}
		kept = append(kept, record)
	}
	if !changed {
		return nil
	}
	batch.Records = kept
	if len(batch.Records) == 0 {
		return os.Remove(path)
	}
	return writeAIJSONAtomic(path, batch)
}

// ClearModuleRecords removes a module's batch files and in-memory results.
func (s *AIJobService) ClearModuleRecords(moduleType string) error {
	if moduleType != AIJobTypeFace && moduleType != AIJobTypePortrait {
		return errors.New("only face analysis data can be cleared independently")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return errAIJobServiceClosed
	}
	if hasActiveAIJobType(s.jobs, moduleType) {
		s.mu.Unlock()
		return ErrAIJobActive
	}
	moduleDir := filepath.Join(s.metadataDir, moduleType)
	// 删目录是磁盘操作：人脸模块的批次文件可能有几千个，
	// 拿着任务状态锁删会让所有读任务的接口一起等。
	// 锁内只把内存里的结果摘掉，删目录放到锁外。
	for key, record := range s.records {
		if record.Type == moduleType {
			delete(s.records, key)
		}
	}
	s.recordsRevision++
	keptOrder := s.order[:0]
	for _, id := range s.order {
		if job := s.jobs[id]; job != nil && job.Type == moduleType {
			delete(s.jobs, id)
			continue
		}
		keptOrder = append(keptOrder, id)
	}
	s.order = keptOrder
	err := s.persistLocked()
	cleared := s.onRecordsCleared
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if removeErr := os.RemoveAll(moduleDir); removeErr != nil {
		return removeErr
	}
	if cleared != nil {
		cleared()
	}
	return nil
}

func hasActiveAIJobType(jobs map[string]*AIJob, moduleType string) bool {
	for _, job := range jobs {
		if job != nil && job.Type == moduleType && isAIJobActive(job.Status) {
			return true
		}
	}
	return false
}

// RecordsRevision 返回当前分析结果的版本号。
//
// 每次记录增删改都会递增它，派生数据据此判断自己的缓存是否过期。
func (s *AIJobService) RecordsRevision() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.recordsRevision
}

// Records 返回指定模块的结果副本，便于 handler 按当前资源快照过滤过期记录。
func (s *AIJobService) Records(moduleType string) []AIAnalysisRecord {
	s.mu.Lock()
	analyzer, installed := s.analyzers[moduleType]
	if !installed {
		s.mu.Unlock()
		return []AIAnalysisRecord{}
	}
	version := aiAnalyzerVersion(analyzer, s.settings.FaceModel)
	// 锁内只挑出记录，载荷复制放到锁外：OCR 与人脸的载荷可以很大，
	// 整表复制时拿着任务状态锁会让读任务的接口一起等。
	matched := make([]AIAnalysisRecord, 0)
	for _, record := range s.records {
		if record.Type == moduleType && record.ModuleVersion == version {
			matched = append(matched, record)
		}
	}
	s.mu.Unlock()

	result := make([]AIAnalysisRecord, 0, len(matched))
	for _, record := range matched {
		result = append(result, cloneRecord(record))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ResourceID != result[j].ResourceID {
			return result[i].ResourceID < result[j].ResourceID
		}
		return result[i].ModuleVersion < result[j].ModuleVersion
	})
	return result
}

// CaptureTimes returns the EXIF capture time of the supplied resources.
//
// It reads only that one field instead of copying whole analysis records:
// the smart album directory needs the newest capture time of every group,
// and a group's members run into tens of thousands of photos — copying
// each record's JSON payload just to read one timestamp is wasted work.
// Resources without a parsed capture time are simply absent from the map.
func (s *AIJobService) CaptureTimes(moduleType string, resourceIDs []string) map[string]time.Time {
	s.mu.Lock()
	analyzer, installed := s.analyzers[moduleType]
	if !installed {
		s.mu.Unlock()
		return map[string]time.Time{}
	}
	version := aiAnalyzerVersion(analyzer, s.settings.FaceModel)
	// 锁内只取载荷，解析放到锁外：一次要读整本相册的拍摄时间，
	// 拿着任务状态锁解 JSON 会让读任务的接口一起等。
	keys := make([]string, 0, len(resourceIDs))
	payloads := make([]json.RawMessage, 0, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		record, exists := s.records[aiRecordKeyForVersion(moduleType, version, resourceID)]
		if !exists || record.ModuleVersion != version || len(record.Data) == 0 {
			continue
		}
		keys = append(keys, resourceID)
		payloads = append(payloads, record.Data)
	}
	s.mu.Unlock()

	result := make(map[string]time.Time, len(keys))
	for index, payload := range payloads {
		var metadata struct {
			DateTimeOriginal string `json:"dateTimeOriginal,omitempty"`
		}
		if json.Unmarshal(payload, &metadata) != nil {
			continue
		}
		captured, ok := parseSmartCaptureTime(metadata.DateTimeOriginal)
		if !ok {
			continue
		}
		result[keys[index]] = captured
	}
	return result
}

// AllCaptureTimes returns the capture time of every resource the module has a
// current-version record for.
//
// The photo timeline orders the whole library by capture time, so it needs the
// complete set rather than one album's slice: asking per album turns a single
// pass over the library into thousands of queries. Resources without a parsed
// capture time are simply absent from the map.
func (s *AIJobService) AllCaptureTimes(moduleType string) map[string]time.Time {
	times, _ := s.AllCaptureTimesWithRevision(moduleType)
	return times
}

// AllCaptureTimesWithRevision returns a capture-time snapshot and the records
// revision observed while copying its payloads. A derived index must use these
// together so a concurrent record update cannot label old values with a newer
// cache epoch.
func (s *AIJobService) AllCaptureTimesWithRevision(moduleType string) (map[string]time.Time, uint64) {
	s.mu.Lock()
	revision := s.recordsRevision
	analyzer, installed := s.analyzers[moduleType]
	if !installed {
		s.mu.Unlock()
		return map[string]time.Time{}, revision
	}
	version := aiAnalyzerVersion(analyzer, s.settings.FaceModel)
	// 锁内只取载荷，解析放到锁外：整库拍摄时间有十万条量级，
	// 拿着任务状态锁解 JSON 会让读任务的接口一起等。
	type capturePayload struct {
		resourceID string
		data       json.RawMessage
	}
	payloads := make([]capturePayload, 0, len(s.records))
	for _, record := range s.records {
		if record.ModuleVersion != version || len(record.Data) == 0 {
			continue
		}
		payloads = append(payloads, capturePayload{resourceID: record.ResourceID, data: record.Data})
	}
	s.mu.Unlock()

	result := make(map[string]time.Time, len(payloads))
	for _, payload := range payloads {
		var metadata struct {
			DateTimeOriginal string `json:"dateTimeOriginal,omitempty"`
		}
		if json.Unmarshal(payload.data, &metadata) != nil {
			continue
		}
		captured, ok := parseSmartCaptureTime(metadata.DateTimeOriginal)
		if !ok {
			continue
		}
		result[payload.resourceID] = captured
	}
	return result, revision
}

// RecordsForResources returns current-version analysis records only for the
// supplied resource IDs. Album-scoped features use this instead of copying a
// library-wide analysis table into their own working set.
func (s *AIJobService) RecordsForResources(moduleType string, resourceIDs []string) map[string]AIAnalysisRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make(map[string]AIAnalysisRecord, len(resourceIDs))
	analyzer, installed := s.analyzers[moduleType]
	if !installed {
		return result
	}
	version := aiAnalyzerVersion(analyzer, s.settings.FaceModel)
	for _, resourceID := range resourceIDs {
		record, exists := s.records[aiRecordKeyForVersion(moduleType, version, resourceID)]
		if !exists || record.ModuleVersion != version {
			continue
		}
		result[resourceID] = cloneRecord(record)
	}
	return result
}

// RecordSummariesForResources returns freshness metadata for the requested
// files without copying their analysis payloads.
func (s *AIJobService) RecordSummariesForResources(moduleType string, resourceIDs []string) map[string]AIAnalysisRecordSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make(map[string]AIAnalysisRecordSummary, len(resourceIDs))
	analyzer, installed := s.analyzers[moduleType]
	if !installed {
		return result
	}
	version := aiAnalyzerVersion(analyzer, s.settings.FaceModel)
	for _, resourceID := range resourceIDs {
		record, exists := s.records[aiRecordKeyForVersion(moduleType, version, resourceID)]
		if !exists || record.ModuleVersion != version {
			continue
		}
		result[resourceID] = AIAnalysisRecordSummary{
			Type: record.Type, ResourceID: record.ResourceID, Size: record.Size,
			MTimeNs: record.MTimeNs, ModuleVersion: record.ModuleVersion, Status: record.Status,
		}
	}
	return result
}

// ModuleStatus returns the local installation state and current version of one
// analysis module without copying task history or all analysis records.
func (s *AIJobService) ModuleStatus(moduleType string) AIJobModule {
	s.mu.Lock()
	defer s.mu.Unlock()
	module := AIJobModule{Type: moduleType, Name: aiJobModuleName(moduleType)}
	if analyzer, exists := s.analyzers[moduleType]; exists {
		module.Installed, module.Reason = aiAnalyzerAvailabilityForModel(analyzer, s.settings.FaceModel)
		if module.Installed {
			module.Version = aiAnalyzerVersion(analyzer, s.settings.FaceModel)
		}
	}
	return module
}

// RecordsIncludingStaleVersions supplies persisted results to derived-index
// migrations while a module version is being recomputed.
func (s *AIJobService) RecordsIncludingStaleVersions(moduleType string) []AIAnalysisRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, installed := s.analyzers[moduleType]; !installed {
		return nil
	}
	result := make([]AIAnalysisRecord, 0)
	for _, record := range s.records {
		if record.Type == moduleType {
			result = append(result, cloneRecord(record))
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ResourceID != result[j].ResourceID {
			return result[i].ResourceID < result[j].ResourceID
		}
		return result[i].ModuleVersion < result[j].ModuleVersion
	})
	return result
}

// Record 返回一个资源在指定模块中的当前分析结果。
func (s *AIJobService) Record(moduleType, resourceID string) (AIAnalysisRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.analyzers[moduleType]; !exists {
		return AIAnalysisRecord{}, false
	}
	version := aiAnalyzerVersion(s.analyzers[moduleType], s.settings.FaceModel)
	record, exists := s.records[aiRecordKeyForVersion(moduleType, version, resourceID)]
	if !exists || record.ModuleVersion != version {
		return AIAnalysisRecord{}, false
	}
	return cloneRecord(record), true
}

// RecordIncludingStaleVersions returns one persisted result even when its
// analyzer version is no longer current, for fingerprint-validated migration reads.
func (s *AIJobService) RecordIncludingStaleVersions(moduleType, resourceID string) (AIAnalysisRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.analyzers[moduleType]; !exists {
		return AIAnalysisRecord{}, false
	}
	version := aiAnalyzerVersion(s.analyzers[moduleType], s.settings.FaceModel)
	record, exists := s.records[aiRecordKeyForVersion(moduleType, version, resourceID)]
	if !exists {
		return AIAnalysisRecord{}, false
	}
	return cloneRecord(record), true
}

func aiRecordKey(moduleType, resourceID string) string {
	return moduleType + "\x00" + resourceID
}

// cloneRecord 复制一条分析结果，让调用方拿到的载荷与内存里的互不影响。
//
// 人脸与 OCR 的载荷可以很大：浅拷贝会让调用方改到正在用的字节，
// 因此凡是把结果交出去的地方都走这一份复制。
func cloneRecord(record AIAnalysisRecord) AIAnalysisRecord {
	record.Data = append(json.RawMessage(nil), record.Data...)
	record.Fields = append([]string(nil), record.Fields...)
	return record
}

// cloneRecords 复制一批分析结果。
func cloneRecords(records []AIAnalysisRecord) []AIAnalysisRecord {
	if len(records) == 0 {
		return nil
	}
	cloned := make([]AIAnalysisRecord, len(records))
	for index, record := range records {
		cloned[index] = cloneRecord(record)
	}
	return cloned
}

func aiRecordKeyForVersion(moduleType, version, resourceID string) string {
	if moduleType == AIJobTypePortrait {
		return moduleType + "\x00" + version + "\x00" + resourceID
	}
	if moduleType != AIJobTypeFace {
		return aiRecordKey(moduleType, resourceID)
	}
	model := FaceModelQualityV2
	if version == FaceAnalyzerBuffaloMVersion {
		model = FaceModelBuffaloM
	}
	return moduleType + "\x00" + model + "\x00" + resourceID
}

func aiRecordKeyForRecord(record AIAnalysisRecord) string {
	return aiRecordKeyForVersion(record.Type, record.ModuleVersion, record.ResourceID)
}
