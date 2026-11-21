package services

import (
	"errors"
	"testing"
)

// 相似照片整理的人工状态与撤销。
//
// 这一组用例盯住的是「撤销要严格回到操作前的状态」：
// 状态是三档（待处理 / 已处理 / 已忽略），而不是两个布尔。
// 用两个布尔表示状态时，「标记已处理」会把「已忽略」抹掉，
// 撤销时只翻一个布尔就回不去了 —— 用户点一次撤销，结果不是他点的
// 那一档。

// similarityGroupStatus 读某一组当前的人工状态。
func similarityGroupStatus(t *testing.T, similarity *SimilarityService, groupID string) string {
	t.Helper()
	page := similarity.Groups(SimilarityGroupFilter{})
	for _, group := range page.Groups {
		if group.ID == groupID {
			return group.Status
		}
	}
	t.Fatalf("分组 %s 不见了", groupID)
	return ""
}

// similarityFixtureGroup 造一个含完全重复组的相似照片服务。
func similarityFixtureGroup(t *testing.T) *SimilarityService {
	t.Helper()
	pattern := similarityTestJPEG(t, similarityTestPattern(320, 240, 0), 92)
	_, _, jobs, similarity := similarityServiceFixture(t, map[string][]byte{
		"a.jpg": pattern,
		"b.jpg": pattern,
	})
	runSimilarityAnalysis(t, jobs)
	if _, err := similarity.RebuildNow(); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	return similarity
}

// TestSimilarityUndoRestoresIgnoredAfterReview 验证：已忽略的组被标记为
// 已处理后，撤销要回到「已忽略」，不是回到「待处理」。
//
// 这一条是最初的缺陷：标记已处理顺手抹掉了「已忽略」，
// 撤销时只把「已处理」翻掉，于是那一组掉进「待处理」，
// 用户明明说「我不想再看它」，撤销之后却又回到了待办堆里。
func TestSimilarityUndoRestoresIgnoredAfterReview(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	if _, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored); err != nil {
		t.Fatalf("set ignored: %v", err)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("标记忽略之后的状态不对：%s", got)
	}

	// 用户又把它标记为已处理。
	result, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed)
	if err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	if result.Previous != SimilarityStatusIgnored {
		t.Fatalf("没有记下操作前的状态：%+v", result)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusReviewed {
		t.Fatalf("标记已处理之后的状态不对：%s", got)
	}

	// 撤销：回到操作前的「已忽略」。
	undo, err := similarity.SetStatusIfCurrent(
		group.ID,
		SimilarityStatusReviewed,
		result.Previous,
	)
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	if !undo.Changed {
		t.Fatalf("撤销没有生效：%+v", undo)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("撤销后没有回到已忽略，而是 %s", got)
	}
}

// TestSimilarityUndoRestoresReviewedAfterIgnore 验证：已处理的组被忽略后，
// 撤销要回到「已处理」，不是回到「待处理」。
func TestSimilarityUndoRestoresReviewedAfterIgnore(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	if _, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed); err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	result, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored)
	if err != nil {
		t.Fatalf("set ignored: %v", err)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("忽略之后的状态不对：%s", got)
	}

	// 撤销：回到操作前的「已处理」。
	undo, err := similarity.SetStatusIfCurrent(
		group.ID,
		SimilarityStatusIgnored,
		result.Previous,
	)
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	if !undo.Changed {
		t.Fatalf("撤销没有生效：%+v", undo)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusReviewed {
		t.Fatalf("撤销后没有回到已处理，而是 %s", got)
	}
}

// TestSimilarityUndoRejectsStaleDecision 验证：用户在这之后又改过这一组时，
// 过期撤销写不进去，也不盖掉更新的决定。
func TestSimilarityUndoRejectsStaleDecision(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	result, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed)
	if err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	// 用户随后又把它忽略了 —— 这是他现在的决定。
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored); err != nil {
		t.Fatalf("set ignored: %v", err)
	}

	// 撤销先前那次「标记已处理」：状态已经不是当时那一档了。
	if _, err := similarity.SetStatusIfCurrent(
		group.ID,
		SimilarityStatusReviewed,
		result.Previous,
	); !errors.Is(err, ErrSimilarityStatusConflict) {
		t.Fatalf("过期撤销没有被挡住：%v", err)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("过期撤销盖掉了更新的决定：%s", got)
	}
}

// TestSimilarityBatchChangedCountsOnlyRealChanges 验证：批量动作只把
// 真正变了的组算进 changed。
//
// 已经是「已处理」的组再标记一次，什么都没变 —— 把它算成一次变化，
// 界面上就会说「已把 N 组标记为已处理」，而实际上一组都没动。
func TestSimilarityBatchChangedCountsOnlyRealChanges(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	if _, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed); err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	result, err := similarity.ApplyBatch(SimilarityBatchReview, []string{group.ID})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	if result.Changed != 0 {
		t.Fatalf("重复标记已处理也算成了变化：changed=%d", result.Changed)
	}

	// 取消标记：这一次是真的变了。
	result, err = similarity.ApplyBatch(SimilarityBatchUnreview, []string{group.ID})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	if result.Changed != 1 {
		t.Fatalf("真的变了却没有算进去：changed=%d", result.Changed)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusPending {
		t.Fatalf("取消标记之后的状态不对：%s", got)
	}
}

// TestSimilarityBatchRecordsPreviousStatusPerGroup 验证：批量操作把每一组
// 操作前的状态都记下来，撤销才能按组恢复。
func TestSimilarityBatchRecordsPreviousStatusPerGroup(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	if _, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored); err != nil {
		t.Fatalf("set ignored: %v", err)
	}
	result, err := similarity.ApplyBatch(SimilarityBatchReview, []string{group.ID})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	if result.Changed != 1 {
		t.Fatalf("状态变了却没有算进去：changed=%d", result.Changed)
	}
	if result.Previous[group.ID] != SimilarityStatusIgnored {
		t.Fatalf("没有记下操作前的状态：%+v", result.Previous)
	}
	if result.Current[group.ID] != SimilarityStatusReviewed {
		t.Fatalf("没有记下操作后的状态：%+v", result.Current)
	}
}

// TestSimilarityBatchRestoreRestoresMixedStates 验证：混合状态的批量修改
// 撤销之后，每一组都回到自己原来的那一档。
//
// 「全部」视图里同时有待处理、已处理、已忽略的组。统一翻一个布尔
// 的话，已处理的会被推回待处理、已忽略的也会丢掉 —— 撤销之后
// 用户的选择全乱了。
func TestSimilarityBatchRestoreRestoresMixedStates(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	if _, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored); err != nil {
		t.Fatalf("set ignored: %v", err)
	}
	changed, err := similarity.ApplyBatch(SimilarityBatchReview, []string{group.ID})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	if changed.Changed != 1 {
		t.Fatalf("changed 不对：%+v", changed)
	}

	restored, err := similarity.ApplyBatchRestore([]SimilarityStatusChange{{
		GroupID: group.ID,
		From:    changed.Current[group.ID],
		To:      changed.Previous[group.ID],
	}})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Changed != 1 {
		t.Fatalf("恢复没有生效：%+v", restored)
	}
	if len(restored.Conflicts) != 0 {
		t.Fatalf("不该有冲突：%+v", restored.Conflicts)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("恢复后不是已忽略，而是 %s", got)
	}
}

// TestSimilarityBatchRestoreSkipsStaleGroups 验证：撤销时状态已经变了的组
// 不动，并如实报成冲突。
func TestSimilarityBatchRestoreSkipsStaleGroups(t *testing.T) {
	similarity := similarityFixtureGroup(t)
	group := findExactGroup(t, similarity)

	changed, err := similarity.ApplyBatch(SimilarityBatchReview, []string{group.ID})
	if err != nil {
		t.Fatalf("apply batch: %v", err)
	}
	// 用户在这之后又改了这一组。
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusIgnored); err != nil {
		t.Fatalf("set ignored: %v", err)
	}

	restored, err := similarity.ApplyBatchRestore([]SimilarityStatusChange{{
		GroupID: group.ID,
		From:    changed.Current[group.ID],
		To:      changed.Previous[group.ID],
	}})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Changed != 0 {
		t.Fatalf("过期的撤销不该写入：%+v", restored)
	}
	if len(restored.Conflicts) != 1 || restored.Conflicts[0] != group.ID {
		t.Fatalf("冲突没有如实报出来：%+v", restored.Conflicts)
	}
	if got := similarityGroupStatus(t, similarity, group.ID); got != SimilarityStatusIgnored {
		t.Fatalf("过期的撤销盖掉了更新的决定：%s", got)
	}
}

// TestSimilarityBatchRestoreReportsMissingGroups 验证：分组已经不存在
// （重建后换了 id）时，撤销如实报成冲突，而不是谎报恢复成功。
func TestSimilarityBatchRestoreReportsMissingGroups(t *testing.T) {
	similarity := similarityFixtureGroup(t)

	restored, err := similarity.ApplyBatchRestore([]SimilarityStatusChange{{
		GroupID: "g_不存在的分组",
		From:    SimilarityStatusReviewed,
		To:      SimilarityStatusPending,
	}})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Changed != 0 {
		t.Fatalf("不存在的分组不该算成恢复：%+v", restored)
	}
	if len(restored.Conflicts) != 1 {
		t.Fatalf("失效的分组没有报成冲突：%+v", restored.Conflicts)
	}
}
