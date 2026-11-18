package services

import "testing"

// similarityTestGroup 造一个分组：标识按正式规则算，成员一并列出。
func similarityTestGroup(kind string, ids ...string) SimilarityGroup {
	group := SimilarityGroup{
		Kind:        kind,
		ResourceIDs: ids,
	}
	group.ID = similarityGroupID(SimilarityGroupKind(kind), ids)
	for _, id := range ids {
		group.Members = append(group.Members, SimilarityMember{ResourceID: id})
	}
	return group
}

// TestSimilarityStateMigrationKeepsDecisionWhenAnchorSurvives 验证组内
// 多了照片时人工决定仍然对得上。
//
// 组的标识取组内最小的资源标识：锚点还在，标识就不变，决定原样生效。
func TestSimilarityStateMigrationKeepsDecisionWhenAnchorSurvives(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b")}
	next := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b", "f_c")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true
	state.Representatives[old[0].ID] = "f_b"

	migrated := similarityStateMigration(old, state, next)
	if !migrated.Reviewed[next[0].ID] {
		t.Fatal("锚点还在时已看过的决定应继续生效")
	}
	if migrated.Representatives[next[0].ID] != "f_b" {
		t.Fatalf("代表照片应保持 %q，实际 %q", "f_b", migrated.Representatives[next[0].ID])
	}
}

// TestSimilarityStateMigrationMovesDecisionWhenAnchorIsRemoved 验证锚点
// 那张照片被删掉之后，人工决定迁到新的组上。
//
// 标识跟着锚点走：锚点没了标识就变了。决定必须跟着照片走，
// 否则「已看过」「不想再看到」「手动代表」全部失效。
func TestSimilarityStateMigrationMovesDecisionWhenAnchorIsRemoved(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b")}
	next := []SimilarityGroup{similarityTestGroup("near", "f_b", "f_c")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true
	state.Representatives[old[0].ID] = "f_b"

	migrated := similarityStateMigration(old, state, next)
	if old[0].ID == next[0].ID {
		t.Fatal("测试前提不成立：锚点变了标识应该跟着变")
	}
	if !migrated.Reviewed[next[0].ID] {
		t.Fatal("已看过的决定应迁到新的组上")
	}
	if migrated.Representatives[next[0].ID] != "f_b" {
		t.Fatalf("代表照片应迁到新的组上，实际 %q", migrated.Representatives[next[0].ID])
	}
	if migrated.Reviewed[old[0].ID] {
		t.Fatal("迁走之后旧键应清掉，否则别的组会撞上同一份决定")
	}
}

// TestSimilarityStateMigrationKeepsIgnoredDecision 验证「不想再看到」
// 这类决定同样跟着照片走。
func TestSimilarityStateMigrationKeepsIgnoredDecision(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("exact", "f_a", "f_b")}
	next := []SimilarityGroup{similarityTestGroup("exact", "f_b", "f_c")}
	state := newSimilarityState()
	state.Ignored[old[0].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if !migrated.Ignored[next[0].ID] {
		t.Fatal("忽略的决定应迁到新的组上")
	}
	if migrated.Ignored[old[0].ID] {
		t.Fatal("迁走之后旧键应清掉")
	}
}

// TestSimilarityStateMigrationKeepsDecisionOnSplit 验证拆组时含有锚点的
// 那一组承接原来的决定，拆出来的新组不继承。
func TestSimilarityStateMigrationKeepsDecisionOnSplit(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b", "f_c")}
	next := []SimilarityGroup{
		similarityTestGroup("near", "f_a", "f_b"),
		similarityTestGroup("near", "f_c", "f_d"),
	}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if !migrated.Reviewed[next[0].ID] {
		t.Fatal("含锚点的那一组应承接原来的决定")
	}
	if migrated.Reviewed[next[1].ID] {
		t.Fatal("拆出来的新组不该继承旧组的决定")
	}
}

// TestSimilarityStateMigrationKeepsOriginalOnConflictingMerge 验证合组
// 且人工决定互相冲突时不擅自套用，原始数据留在原处。
//
// 合组以锚点所在的那一组为准：它的标识就是合出来的组的标识。
// 另一个旧组的决定归属说不清，保留在原处但不套用。
func TestSimilarityStateMigrationKeepsOriginalOnConflictingMerge(t *testing.T) {
	old := []SimilarityGroup{
		similarityTestGroup("near", "f_a", "f_b"),
		similarityTestGroup("near", "f_c", "f_d"),
	}
	next := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b", "f_c", "f_d")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true
	state.Ignored[old[1].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if old[0].ID != next[0].ID {
		t.Fatal("测试前提不成立：锚点所在的旧组标识应与新组一致")
	}
	if !migrated.Reviewed[next[0].ID] {
		t.Fatal("锚点所在的那一组说了算，已看过的应保留")
	}
	if !migrated.Ignored[old[1].ID] {
		t.Fatal("另一个旧组的忽略决定应保留在原处")
	}
}

// TestSimilarityStateMigrationAppliesAgreeingMerge 验证合组且人工决定
// 一致时决定迁到合出来的组上。
func TestSimilarityStateMigrationAppliesAgreeingMerge(t *testing.T) {
	old := []SimilarityGroup{
		similarityTestGroup("near", "f_a", "f_b"),
		similarityTestGroup("near", "f_c", "f_d"),
	}
	next := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b", "f_c", "f_d")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true
	state.Reviewed[old[1].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if !migrated.Reviewed[next[0].ID] {
		t.Fatal("决定一致时合出来的组应继承已看过")
	}
	if !migrated.Reviewed[old[1].ID] {
		t.Fatal("合组时另一个旧组的决定应保留在原处")
	}
}

// TestSimilarityStateMigrationDoesNotCrossKinds 验证类别不同的两组不会
// 互相迁移决定。
func TestSimilarityStateMigrationDoesNotCrossKinds(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("exact", "f_a", "f_b")}
	next := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if migrated.Reviewed[next[0].ID] {
		t.Fatal("类别不同不应迁移决定")
	}
	if !migrated.Reviewed[old[0].ID] {
		t.Fatal("原始决定应保留")
	}
}

// TestSimilarityStateMigrationDropsRepresentativeThatLeft 验证代表照片
// 不在新组里时不再算作手动指定。
func TestSimilarityStateMigrationDropsRepresentativeThatLeft(t *testing.T) {
	old := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b")}
	next := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_c")}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true
	state.Representatives[old[0].ID] = "f_b"

	migrated := similarityStateMigration(old, state, next)
	service := &SimilarityService{state: migrated, groups: next}
	service.applyStateLocked()
	if service.groups[0].RepresentativeIsManual {
		t.Fatal("代表照片已经不在组里，不该再算作手动指定")
	}
	if service.groups[0].Status != SimilarityStatusReviewed {
		t.Fatalf("已看过的状态应保持，实际 %q", service.groups[0].Status)
	}
}

// TestSimilarityStateMigrationKeepsOriginalWhenSplitIsAmbiguous 验证拆组
// 且说不清归属时保留原始人工数据。
func TestSimilarityStateMigrationKeepsOriginalWhenSplitIsAmbiguous(t *testing.T) {
	// 锚点 f_a 已经不在任何一组里，两组候选的重叠一样多。
	old := []SimilarityGroup{similarityTestGroup("near", "f_a", "f_b", "f_c")}
	next := []SimilarityGroup{
		similarityTestGroup("near", "f_b", "f_d"),
		similarityTestGroup("near", "f_c", "f_e"),
	}
	state := newSimilarityState()
	state.Reviewed[old[0].ID] = true

	migrated := similarityStateMigration(old, state, next)
	if migrated.Reviewed[next[0].ID] || migrated.Reviewed[next[1].ID] {
		t.Fatal("说不清归属时不该套用")
	}
	if !migrated.Reviewed[old[0].ID] {
		t.Fatal("原始决定应保留")
	}
}
