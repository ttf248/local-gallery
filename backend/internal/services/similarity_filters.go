package services

// 本文件是相似照片分组给照片墙筛选用的两个查询入口：
// 「这张照片属于哪一组」与「这一组里有哪些照片」。
//
// 分组本身是派生数据，由后台分析算好；这里只做只读查询，
// 不重新实现相似度算法，也不改动任何原始媒体。

// SimilarityGroupRef 是分组在照片墙上的一枚轻量引用。
//
// 照片墙只需要知道「这张属于哪一组、这组有几张、代表是谁」，
// 不必把整组成员名单塞进每一页媒体里 —— 成员名单在展开时才去取。
type SimilarityGroupRef struct {
	// ID 是分组的稳定标识。
	ID string `json:"id"`
	// Kind 是分组类别：exact / near / burst。
	Kind string `json:"kind"`
	// Size 是组内照片总数。
	Size int `json:"size"`
	// Redundant 是除代表之外的张数。
	Redundant int `json:"redundant"`
	// Representative 是当前生效的代表照片。
	Representative string `json:"representative"`
	// RepresentativeIsManual 说明代表照片是用户指定的。
	RepresentativeIsManual bool `json:"representativeIsManual"`
}

// ResourceGroupRefs 返回「资源 → 它所属的组」的映射。
//
// 一张照片可能同时落在完全重复与连拍两组里。折叠时只能有一个主组，
// 优先级按语义排：完全重复最该折叠，近似重复次之；连拍的画面本就不同，
// 折叠它反而把不同的瞬间藏起来了。
func (s *SimilarityService) ResourceGroupRefs(resourceIDs []string) map[string]SimilarityGroupRef {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wanted := make(map[string]bool, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		if resourceID != "" {
			wanted[resourceID] = true
		}
	}
	result := make(map[string]SimilarityGroupRef)
	for _, group := range s.groups {
		if len(group.ResourceIDs) < 2 {
			continue
		}
		ref := SimilarityGroupRef{
			ID:                     group.ID,
			Kind:                   group.Kind,
			Size:                   len(group.ResourceIDs),
			Redundant:              group.Redundant,
			Representative:         group.Representative,
			RepresentativeIsManual: group.RepresentativeIsManual,
		}
		for _, resourceID := range group.ResourceIDs {
			if !wanted[resourceID] {
				continue
			}
			current, exists := result[resourceID]
			if !exists || similarityGroupPriority(group.Kind) > similarityGroupPriority(current.Kind) {
				result[resourceID] = ref
			}
		}
	}
	return result
}

// GroupsForResources 返回包含指定资源的所有分组。
//
// 展开一组时用它取回成员名单：照片墙上只挂着代表照片，
// 其余成员在用户点开时才读回来。
func (s *SimilarityService) GroupsForResources(resourceIDs []string) []SimilarityGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	wanted := make(map[string]bool, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		if resourceID != "" {
			wanted[resourceID] = true
		}
	}
	matched := make([]SimilarityGroup, 0, 4)
	for _, group := range s.groups {
		for _, resourceID := range group.ResourceIDs {
			if wanted[resourceID] {
				matched = append(matched, group)
				break
			}
		}
	}
	return matched
}

// similarityGroupPriority 给分组类别排序：完全重复 > 近似重复 > 连拍。
func similarityGroupPriority(kind string) int {
	switch SimilarityGroupKind(kind) {
	case SimilarityGroupKindExact:
		return 3
	case SimilarityGroupKindNear:
		return 2
	case SimilarityGroupKindBurst:
		return 1
	default:
		return 0
	}
}
