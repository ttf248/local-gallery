package services

import "sort"

// 相似照片人工决定跨重建的迁移。
//
// 分组随时可以重建，人工决定不行：用户挑了哪张当代表、哪些组已经看过、
// 哪些组不想再看到，这些必须跨重建保持。
//
// 分组标识取组内最小的资源标识，组内照片一增一减，标识就跟着变 ——
// 决定必须跟着照片走，不能跟着标识走。

// similarityDecision 是从旧组迁到新组的一份人工决定。
type similarityDecision struct {
	// reviewed 表示这一组已经看过。
	reviewed bool
	// ignored 表示这一组不想再看到。
	ignored bool
	// representative 是用户手动指定的代表照片。
	representative string
	// moved 表示这份决定是整份搬到新组上的。
	// 合组时不是：只有锚点所在的那一组说了算，其余旧组的决定归属
	// 说不清，保留在原处。
	moved bool
}

// similarityStateMigration 把上一轮的人工决定迁移到新一轮的分组上。
//
// 依据三样：分组类别、成员重叠、旧组锚点。
//   - 类别不同不算同一组：完全重复与近似重复是两回事。
//   - 成员重叠说明两组有共同的成员。
//   - 旧组锚点（组内最小的资源标识）是身份的最后依据：拆组时含有锚点的
//     那一组才是原来的那一组。
//
// 归属说不清时（拆组时锚点已经不在、合组且人工决定互相冲突）保留原始
// 人工数据不动：宁可让用户再看一遍，也不要把决定套到错的组上。
//
// 返回值是一份新的状态；入参不会被改动。
func similarityStateMigration(
	oldGroups []SimilarityGroup,
	state similarityState,
	newGroups []SimilarityGroup,
) similarityState {
	migrated := state.clone()
	if len(oldGroups) == 0 || len(newGroups) == 0 {
		return migrated
	}

	// 旧组 → 候选新组。只有同类、且有共同成员的才可能是同一组。
	candidates := similarityGroupCandidates(oldGroups, newGroups)
	// 旧组 → 承接它的新组。
	continuation := make(map[int]int, len(oldGroups))
	for oldIndex, group := range oldGroups {
		options := candidates[oldIndex]
		if len(options) == 0 {
			continue
		}
		if next, ok := similarityPickContinuation(group, options, newGroups); ok {
			continuation[oldIndex] = next
		}
	}
	// 新组 → 承接它的旧组。一个新组可能承接多个旧组（合组）。
	predecessors := make(map[int][]int)
	for oldIndex, newIndex := range continuation {
		predecessors[newIndex] = append(predecessors[newIndex], oldIndex)
	}

	for newIndex, olds := range predecessors {
		next := newGroups[newIndex]
		decision, moved := similarityMergeDecisions(oldGroups, olds, state, next)
		if !moved {
			// 归属说不清：原始人工数据留在原处，不套用到新组上。
			continue
		}
		if decision.reviewed {
			migrated.Reviewed[next.ID] = true
			delete(migrated.Ignored, next.ID)
		}
		if decision.ignored {
			migrated.Ignored[next.ID] = true
			delete(migrated.Reviewed, next.ID)
		}
		if decision.representative != "" {
			migrated.Representatives[next.ID] = decision.representative
		}
		if !decision.moved {
			// 合组：其余旧组的决定归属说不清，保留在原处。
			continue
		}
		// 决定整份迁到新组之后清掉旧键：留着的话，别的组可能撞上
		// 同一个标识，把这份决定套用过去。
		for _, oldIndex := range olds {
			old := oldGroups[oldIndex]
			if old.ID == next.ID {
				continue
			}
			delete(migrated.Reviewed, old.ID)
			delete(migrated.Ignored, old.ID)
			delete(migrated.Representatives, old.ID)
		}
	}
	return migrated
}

// similarityGroupCandidates 找出每个旧组可能延续成的新组。
//
// 用「资源 → 新组」的反查表，避免两组一组地两两比对。
func similarityGroupCandidates(oldGroups []SimilarityGroup, newGroups []SimilarityGroup) map[int][]int {
	byMember := make(map[string][]int)
	for index, group := range newGroups {
		for _, id := range group.ResourceIDs {
			byMember[id] = append(byMember[id], index)
		}
	}
	candidates := make(map[int][]int)
	for oldIndex, group := range oldGroups {
		seen := make(map[int]struct{})
		for _, id := range group.ResourceIDs {
			for _, newIndex := range byMember[id] {
				if newGroups[newIndex].Kind != group.Kind {
					// 类别不同不算同一组：完全重复与近似重复是两回事。
					continue
				}
				if _, exists := seen[newIndex]; exists {
					continue
				}
				seen[newIndex] = struct{}{}
				candidates[oldIndex] = append(candidates[oldIndex], newIndex)
			}
		}
		sort.Ints(candidates[oldIndex])
	}
	return candidates
}

// similarityPickContinuation 在候选新组里挑出承接旧组的那一个。
//
// 先看旧组锚点：拆组时含有锚点的那一组才是原来的那一组。锚点已经不在
// （那张照片被删了）就取重叠最多且唯一的那一个；两者都说不清时不迁移。
func similarityPickContinuation(old SimilarityGroup, options []int, newGroups []SimilarityGroup) (int, bool) {
	anchor := similarityGroupAnchor(old)
	for _, index := range options {
		if similarityGroupHasMember(newGroups[index], anchor) {
			return index, true
		}
	}
	best := -1
	bestOverlap := 0
	tied := false
	for _, index := range options {
		overlap := similarityGroupOverlap(old, newGroups[index])
		switch {
		case overlap > bestOverlap:
			best, bestOverlap, tied = index, overlap, false
		case overlap == bestOverlap:
			tied = true
		}
	}
	if best < 0 || tied {
		return 0, false
	}
	return best, true
}

// similarityMergeDecisions 把旧组的人工决定合成新组的一份。
//
// 一个旧组接一个新组：决定整份搬过去（照片还在，决定就该跟着走）。
//
// 多个旧组合成一个新组（合组）：以标识与新组一致的那一组为准 ——
// 它就是锚点所在的那一组，它的标识本来就是新组的标识，决定原样生效。
// 其余旧组的决定归属说不清（同一批照片一个看过、一个不想再看到），
// 保留在原处但不套用：宁可让用户再看一遍，也不要把决定套到错的组上。
//
// 返回值第二个为 false 表示归属说不清，整份决定都不套用。
func similarityMergeDecisions(
	oldGroups []SimilarityGroup,
	olds []int,
	state similarityState,
	next SimilarityGroup,
) (similarityDecision, bool) {
	decision := similarityDecision{}
	if len(olds) == 1 {
		old := oldGroups[olds[0]]
		decision.reviewed = state.Reviewed[old.ID]
		decision.ignored = state.Ignored[old.ID]
		decision.representative = state.Representatives[old.ID]
		decision.moved = true
	} else {
		primary := -1
		for _, oldIndex := range olds {
			if oldGroups[oldIndex].ID == next.ID {
				primary = oldIndex
				break
			}
		}
		if primary < 0 {
			// 没有旧组的标识与新组一致：合出来的组比旧组都大，
			// 决定只能整份搬过去 —— 但多份决定互相冲突时说不清。
			conflict := false
			for _, oldIndex := range olds {
				old := oldGroups[oldIndex]
				reviewed := state.Reviewed[old.ID]
				ignored := state.Ignored[old.ID]
				if conflict {
					if decision.reviewed != reviewed || decision.ignored != ignored {
						return similarityDecision{}, false
					}
					continue
				}
				decision.reviewed = reviewed
				decision.ignored = ignored
				if representative := state.Representatives[old.ID]; representative != "" {
					decision.representative = representative
				}
				conflict = true
			}
			decision.moved = true
		} else {
			// 锚点所在的那一组说了算。
			old := oldGroups[primary]
			decision.reviewed = state.Reviewed[old.ID]
			decision.ignored = state.Ignored[old.ID]
			decision.representative = state.Representatives[old.ID]
		}
	}
	// 代表照片必须还在新组里：不在就退回推荐代表。
	if decision.representative != "" && !similarityGroupHasMember(next, decision.representative) {
		decision.representative = ""
	}
	return decision, true
}

// similarityGroupAnchor 返回组内最小的资源标识：组的锚点。
func similarityGroupAnchor(group SimilarityGroup) string {
	anchor := ""
	for _, id := range group.ResourceIDs {
		if anchor == "" || id < anchor {
			anchor = id
		}
	}
	return anchor
}

// similarityGroupHasMember 判断组里有没有这个资源。
func similarityGroupHasMember(group SimilarityGroup, resourceID string) bool {
	if resourceID == "" {
		return false
	}
	for _, id := range group.ResourceIDs {
		if id == resourceID {
			return true
		}
	}
	return false
}

// similarityGroupOverlap 是两组共有的成员数量。
func similarityGroupOverlap(left, right SimilarityGroup) int {
	members := make(map[string]struct{}, len(left.ResourceIDs))
	for _, id := range left.ResourceIDs {
		members[id] = struct{}{}
	}
	overlap := 0
	for _, id := range right.ResourceIDs {
		if _, exists := members[id]; exists {
			overlap++
		}
	}
	return overlap
}

// clone 复制一份人工决定，迁移在副本上做。
func (s similarityState) clone() similarityState {
	copied := similarityState{
		Version:         s.Version,
		Reviewed:        make(map[string]bool, len(s.Reviewed)),
		Ignored:         make(map[string]bool, len(s.Ignored)),
		Representatives: make(map[string]string, len(s.Representatives)),
	}
	for id, value := range s.Reviewed {
		copied.Reviewed[id] = value
	}
	for id, value := range s.Ignored {
		copied.Ignored[id] = value
	}
	for id, value := range s.Representatives {
		copied.Representatives[id] = value
	}
	return copied
}
