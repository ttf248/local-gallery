package services

import (
	"math"
	"sort"
	"time"
)

// 相似照片的三类分组算法。
//
// 三类结果各自独立：
//   - 完全重复：文件内容一致（SHA-256），可以跨文件夹；
//   - 近似重复：画面几乎一致（感知哈希 + 局部复核），只在文件夹内比较；
//   - 连拍同场景：短时间内的同一场景（EXIF 时间 + 文件顺序 + 语义相似度）。
//
// 「同一场景」不是「重复文件」：连拍组里的每一张都是不同的画面，
// 它们只是拍的是同一个瞬间，因此绝不按重复处理。

const (
	// similarityNearBands 是感知哈希的分带数。
	// 64 位分成 8 段各 8 位：汉明距离不超过 7 的两个哈希至少有一段完全相同
	// （鸽笼原理），所以 8 段索引一定能召回候选。
	similarityNearBands = 8
	// similarityNearBandBits 是每段的位数。
	similarityNearBandBits = 8
	// similarityNearStrongDistance 是整幅感知哈希的强匹配阈值。
	// 覆盖重新压缩、缩放与轻微调色。
	similarityNearStrongDistance = 6
	// similarityNearCropDistance 是中心裁切哈希的匹配阈值。
	// 覆盖轻微裁剪：裁过的照片其中心区域仍与原图的某个档位对应。
	similarityNearCropDistance = 8
	// similarityNearCropDistanceStrict 是在没有语义向量可用时收紧的裁切阈值。
	// 缺少第二道复核时，宁可少召回也不误报。
	similarityNearCropDistanceStrict = 6
	// similarityNearDifferenceDistance 是强匹配时对差分哈希的容忍上限。
	similarityNearDifferenceDistance = 12
	// similarityNearAspectTolerance 是长宽比允许的相对差异（对数空间）。
	similarityNearAspectTolerance = 0.2
	// similarityNearClipVeto 是语义相似度的否决线。
	// 画面哈希接近但语义差得远，说明不是同一张照片。
	similarityNearClipVeto = 0.72
	// similarityNearCandidateLimit 是一个文件夹内允许的候选对数量上限。
	// 超过上限说明这个文件夹大到需要更粗的策略，此时宁可少召回。
	similarityNearCandidateLimit = 400000
)

const (
	// similarityBurstWindow 是连拍的时间窗。
	similarityBurstWindow = 90 * time.Second
	// similarityBurstMaxSize 是单个连拍组的大小上限。
	similarityBurstMaxSize = 24
	// similarityBurstClipThreshold 是靠语义相似度判定同场景的阈值。
	similarityBurstClipThreshold = 0.92
	// similarityBurstHashThreshold 是靠感知哈希判定同场景的阈值。
	similarityBurstHashThreshold = 8
	// similarityBurstClipHashThreshold 是语义与哈希同时偏弱时的联合阈值。
	similarityBurstClipHashThreshold = 0.86
	// similarityBurstWeakHashThreshold 是缺少语义向量时哈希的收紧阈值。
	similarityBurstWeakHashThreshold = 5
	// similarityBurstWeakClipThreshold 是缺少语义向量时语义仍可用的收紧阈值。
	similarityBurstWeakClipThreshold = 0.95
)

// SimilarityCandidate 是一条参与分组的照片。
type SimilarityCandidate struct {
	// ResourceID 是资源标识。
	ResourceID string
	// Folder 是文件夹别名，只用于分组范围与展示。
	Folder string
	// Feature 是本地提取的特征。
	Feature SimilarityFeature
	// CapturedAt 是可信拍摄时间。
	CapturedAt time.Time
	// HasCapture 说明 CapturedAt 是否可信。
	HasCapture bool
	// TimeSource 说明时间来源："capture"（EXIF 拍摄时间）或 "file"（文件时间）。
	TimeSource string
	// Vector 是语义向量，HasVector 为假时不可用。
	Vector    []float32
	HasVector bool
}

// similarityUnionFind 是分组用的并查集。
type similarityUnionFind struct {
	parent []int
	rank   []int
}

func newSimilarityUnionFind(size int) *similarityUnionFind {
	find := &similarityUnionFind{parent: make([]int, size), rank: make([]int, size)}
	for index := range find.parent {
		find.parent[index] = index
	}
	return find
}

func (u *similarityUnionFind) Find(index int) int {
	for u.parent[index] != index {
		u.parent[index] = u.parent[u.parent[index]]
		index = u.parent[index]
	}
	return index
}

func (u *similarityUnionFind) Union(left, right int) {
	leftRoot, rightRoot := u.Find(left), u.Find(right)
	if leftRoot == rightRoot {
		return
	}
	switch {
	case u.rank[leftRoot] < u.rank[rightRoot]:
		u.parent[leftRoot] = rightRoot
	case u.rank[leftRoot] > u.rank[rightRoot]:
		u.parent[rightRoot] = leftRoot
	default:
		u.parent[rightRoot] = leftRoot
		u.rank[leftRoot]++
	}
}

// similarityComponents 把并查集拆成若干成员集合。
func similarityComponents(find *similarityUnionFind, size int) [][]int {
	groups := map[int][]int{}
	for index := 0; index < size; index++ {
		root := find.Find(index)
		groups[root] = append(groups[root], index)
	}
	components := make([][]int, 0, len(groups))
	for _, members := range groups {
		if len(members) > 1 {
			components = append(components, members)
		}
	}
	// 按最小成员下标排序，保证同样输入得到同样输出。
	sort.Slice(components, func(i, j int) bool {
		return components[i][0] < components[j][0]
	})
	return components
}

// SimilarityExactGroups 找出内容完全一致的照片组。
//
// 完全重复可以跨文件夹：同一张照片被保存到两个地方是最常见的重复来源。
func SimilarityExactGroups(candidates []SimilarityCandidate) [][]int {
	byDigest := map[string][]int{}
	for index, candidate := range candidates {
		if candidate.Feature.SHA256 == "" {
			continue
		}
		byDigest[candidate.Feature.SHA256] = append(byDigest[candidate.Feature.SHA256], index)
	}
	groups := make([][]int, 0, len(byDigest))
	for _, members := range byDigest {
		if len(members) > 1 {
			groups = append(groups, members)
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i][0] < groups[j][0] })
	return groups
}

// SimilarityNearGroups 找出画面近似一致的组。
//
// 近似重复只在文件夹内比较：跨目录的「相似」多半是同题材的不同照片，
// 放在一起只会制造噪音。
//
// 返回值第二项说明候选召回是否触到上限；触到时说明这个文件夹大到
// 只能做粗筛，界面上要如实说明，不能假装召回完整。
func SimilarityNearGroups(candidates []SimilarityCandidate) ([][]int, bool) {
	byFolder := map[string][]int{}
	for index, candidate := range candidates {
		byFolder[candidate.Folder] = append(byFolder[candidate.Folder], index)
	}
	folders := make([]string, 0, len(byFolder))
	for folder := range byFolder {
		folders = append(folders, folder)
	}
	sort.Strings(folders)

	groups := make([][]int, 0)
	limited := false
	for _, folder := range folders {
		members := byFolder[folder]
		folderGroups, folderLimited := similarityNearGroupsInFolder(candidates, members)
		groups = append(groups, folderGroups...)
		limited = limited || folderLimited
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i][0] < groups[j][0] })
	return groups, limited
}

// similarityNearGroupsInFolder 在一个文件夹内部做近似重复分组。
func similarityNearGroupsInFolder(candidates []SimilarityCandidate, members []int) ([][]int, bool) {
	if len(members) < 2 {
		return nil, false
	}
	// 分带索引：每个候选的每个哈希档位都登记到 8 段索引里。
	// 档位之间不区分，因此「原图哈希」与「裁切哈希」互相之间也能成为候选。
	buckets := map[similarityBandKey][]int{}
	for _, index := range members {
		for _, hash := range similarityHashVariants(candidates[index].Feature) {
			for band := 0; band < similarityNearBands; band++ {
				key := similarityBandKey{
					band:  uint8(band),
					value: uint8(hash >> uint((1-band)*similarityNearBandBits) & 0xff),
				}
				buckets[key] = append(buckets[key], index)
			}
		}
	}
	// 候选对用集合去重：同一对照片可能在多段索引里各出现一次。
	pairs := map[[2]int]struct{}{}
	limited := false
	keys := make([]similarityBandKey, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].band != keys[j].band {
			return keys[i].band < keys[j].band
		}
		return keys[i].value < keys[j].value
	})
	for _, key := range keys {
		bucket := buckets[key]
		for left := 0; left < len(bucket); left++ {
			for right := left + 1; right < len(bucket); right++ {
				first, second := bucket[left], bucket[right]
				if first > second {
					first, second = second, first
				}
				if _, exists := pairs[[2]int{first, second}]; exists {
					continue
				}
				if len(pairs) >= similarityNearCandidateLimit {
					limited = true
					break
				}
				pairs[[2]int{first, second}] = struct{}{}
			}
			if limited {
				break
			}
		}
		if limited {
			break
		}
	}

	find := newSimilarityUnionFind(len(candidates))
	for pair := range pairs {
		left, right := candidates[pair[0]], candidates[pair[1]]
		if !similarityNearMatch(left, right) {
			continue
		}
		find.Union(pair[0], pair[1])
	}
	components := similarityComponents(find, len(candidates))
	// 只保留同一文件夹内部的成员。
	result := make([][]int, 0, len(components))
	for _, component := range components {
		filtered := make([]int, 0, len(component))
		for _, index := range component {
			if candidates[index].Folder == candidates[component[0]].Folder {
				filtered = append(filtered, index)
			}
		}
		if len(filtered) > 1 {
			result = append(result, filtered)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i][0] < result[j][0] })
	return result, limited
}

// similarityBandKey 是分带索引的键。
type similarityBandKey struct {
	band  uint8
	value uint8
}

// similarityHashVariants 返回一张照片的全部哈希档位。
func similarityHashVariants(feature SimilarityFeature) []uint64 {
	variants := make([]uint64, 0, len(feature.Crops)+1)
	if feature.Crops == nil {
		return []uint64{feature.PHash}
	}
	variants = append(variants, feature.Crops...)
	return variants
}

// similarityNearMatch 判断两张照片是否算近似重复。
//
// 三步：先看长宽比（框得完全不同的两张图不算），再看整幅感知哈希，
// 最后看中心裁切档位。三者都不成立才算不是近似重复。
// 语义向量可用时，它是一道否决线：哈希接近但语义差得远就不是同一张。
func similarityNearMatch(left, right SimilarityCandidate) bool {
	if !similarityAspectCompatible(left.Feature, right.Feature) {
		return false
	}
	distance := similarityHashDistance(left.Feature.PHash, right.Feature.PHash)
	if distance <= similarityNearStrongDistance &&
		similarityHashDistance(left.Feature.DHash, right.Feature.DHash) <= similarityNearDifferenceDistance {
		return !similarityClipVeto(left, right)
	}
	cropDistance := similarityCropDistance(left.Feature, right.Feature)
	threshold := similarityNearCropDistance
	if !left.HasVector || !right.HasVector {
		threshold = similarityNearCropDistanceStrict
	}
	if cropDistance <= threshold {
		return !similarityClipVeto(left, right)
	}
	return false
}

// similarityAspectCompatible 判断两张照片的长宽比是否接近。
func similarityAspectCompatible(left, right SimilarityFeature) bool {
	leftRatio, rightRatio := similarityAspectRatio(left), similarityAspectRatio(right)
	if leftRatio <= 0 || rightRatio <= 0 {
		return true
	}
	difference := math.Abs(math.Log(leftRatio / rightRatio))
	return difference <= similarityNearAspectTolerance
}

// similarityAspectRatio 返回照片的长宽比。
func similarityAspectRatio(feature SimilarityFeature) float64 {
	if feature.Height <= 0 {
		return 0
	}
	return float64(feature.Width) / float64(feature.Height)
}

// similarityCropDistance 返回中心裁切档位之间的最小哈希距离。
func similarityCropDistance(left, right SimilarityFeature) int {
	leftVariants := similarityHashVariants(left)
	rightVariants := similarityHashVariants(right)
	best := similarityHashDistance(left.PHash, right.PHash)
	for _, leftHash := range leftVariants {
		for _, rightHash := range rightVariants {
			if distance := similarityHashDistance(leftHash, rightHash); distance < best {
				best = distance
			}
		}
	}
	return best
}

// similarityClipVeto 在语义向量可用时否决明显不同的两张图。
func similarityClipVeto(left, right SimilarityCandidate) bool {
	if !left.HasVector || !right.HasVector {
		return false
	}
	similarity := similarityVectorCosine(left.Vector, right.Vector)
	return similarity < similarityNearClipVeto
}

// SimilarityBurstGroups 找出连拍与同场景组。
//
// 判据是「时间挨得近」加「画面像同一场景」：
//   - 时间来自 EXIF 拍摄时间，没有拍摄时间时退回文件修改时间并标注出来；
//   - 画面判据优先用语义向量，其次用感知哈希。
//
// 与近似重复不同，这里允许同组里的照片长得不一样 —— 连拍本来如此。
func SimilarityBurstGroups(candidates []SimilarityCandidate) [][]int {
	byFolder := map[string][]int{}
	for index, candidate := range candidates {
		byFolder[candidate.Folder] = append(byFolder[candidate.Folder], index)
	}
	folders := make([]string, 0, len(byFolder))
	for folder := range byFolder {
		folders = append(folders, folder)
	}
	sort.Strings(folders)

	groups := make([][]int, 0)
	for _, folder := range folders {
		members := byFolder[folder]
		sort.Slice(members, func(left, right int) bool {
			leftTime, rightTime := candidates[members[left]].CapturedAt, candidates[members[right]].CapturedAt
			if !leftTime.Equal(rightTime) {
				return leftTime.Before(rightTime)
			}
			return candidates[members[left]].ResourceID < candidates[members[right]].ResourceID
		})
		find := newSimilarityUnionFind(len(candidates))
		for index := 0; index+1 < len(members); index++ {
			left, right := candidates[members[index]], candidates[members[index+1]]
			if !similarityBurstLinked(left, right) {
				continue
			}
			find.Union(members[index], members[index+1])
		}
		for _, component := range similarityComponents(find, len(candidates)) {
			if len(component) < 2 {
				continue
			}
			// 太大的组多半是延时或连拍簇，按时间切开。
			for _, chunk := range similaritySplitBurst(component) {
				groups = append(groups, chunk)
			}
		}
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i][0] < groups[j][0] })
	return groups
}

// similarityBurstLinked 判断时间上相邻的两张照片是不是同一场景。
func similarityBurstLinked(left, right SimilarityCandidate) bool {
	gap := right.CapturedAt.Sub(left.CapturedAt)
	if gap < 0 || gap > similarityBurstWindow {
		return false
	}
	// 文件时间只是退路，证据要求更严。
	strict := !left.HasCapture || !right.HasCapture
	hashDistance := similarityHashDistance(left.Feature.PHash, right.Feature.PHash)
	clip := 0.0
	if left.HasVector && right.HasVector {
		clip = similarityVectorCosine(left.Vector, right.Vector)
	}
	if strict {
		if clip >= similarityBurstWeakClipThreshold {
			return true
		}
		return hashDistance <= similarityBurstWeakHashThreshold
	}
	if clip >= similarityBurstClipThreshold {
		return true
	}
	if hashDistance <= similarityBurstHashThreshold {
		return true
	}
	return clip >= similarityBurstClipHashThreshold && hashDistance <= 14
}

// similaritySplitBurst 把过大的连拍组按上限切开。
func similaritySplitBurst(component []int) [][]int {
	if len(component) <= similarityBurstMaxSize {
		return [][]int{component}
	}
	chunks := make([][]int, 0, len(component)/similarityBurstMaxSize+1)
	for start := 0; start < len(component); start += similarityBurstMaxSize {
		end := min(start+similarityBurstMaxSize, len(component))
		chunks = append(chunks, component[start:end])
	}
	return chunks
}

// similarityVectorCosine 计算两个语义向量的余弦相似度。
func similarityVectorCosine(left, right []float32) float64 {
	if len(left) != len(right) || len(left) == 0 {
		return 0
	}
	var dot, leftNorm, rightNorm float64
	for index := range left {
		leftValue, rightValue := float64(left[index]), float64(right[index])
		dot += leftValue * rightValue
		leftNorm += leftValue * leftValue
		rightNorm += rightValue * rightValue
	}
	if leftNorm <= 0 || rightNorm <= 0 {
		return 0
	}
	return dot / (math.Sqrt(leftNorm) * math.Sqrt(rightNorm))
}
