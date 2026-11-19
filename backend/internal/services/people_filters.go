package services

// 本文件是人物分组给照片墙筛选用的两个查询入口：
// 「这张照片上有谁」与「这张照片是不是合照」。
//
// 两者都只读现有的人物索引，不另建一份长期索引，也不复制人脸特征。
// 照片墙按相册作用域调用它们，代价与相册里的照片数成正比。

// ResourcePersonIndex 返回「资源 → 它上面出现过的人物分组」。
//
// 人物索引里存的是脸，不是照片；照片墙要按人物筛照片，就得有一张反查表。
// 同一个人的多张脸只留一个 ID —— 筛选问的是「照片上有谁」，不是「有几张脸」。
func (s *PeopleService) ResourcePersonIndex() map[string][]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	grouped := make(map[string][]string)
	for _, face := range s.faces {
		personID := s.effectivePersonIDLocked(face)
		if personID == "" {
			continue
		}
		grouped[face.ResourceID] = append(grouped[face.ResourceID], personID)
	}
	for resourceID, ids := range grouped {
		grouped[resourceID] = uniqueSortedStrings(ids)
	}
	return grouped
}

// GroupPhotoResources 返回被判为合照的资源集合。
//
// 判定口径与人物列表一致：脸数超过门槛就是合照；脸数不足八张不是合照；
// 中间那一档看人脸相对画面长边的中位数。源图尺寸读不出来时只按脸数判断。
//
// 只有「八张到门槛之间」那一档需要查原图尺寸，其余档位不必付这个代价。
func (s *PeopleService) GroupPhotoResources(includeResource func(string) bool, faceCountThreshold int) map[string]bool {
	s.mu.RLock()
	faceCounts := make(map[string]int)
	boxes := make(map[string][][]float32)
	dimensionsLookup := s.sourceDimensions
	for _, face := range s.faces {
		if includeResource != nil && !includeResource(face.ResourceID) {
			continue
		}
		faceCounts[face.ResourceID]++
		if len(face.Box) >= 4 {
			boxes[face.ResourceID] = append(boxes[face.ResourceID], face.Box)
		}
	}
	s.mu.RUnlock()

	result := make(map[string]bool, len(faceCounts))
	for resourceID, count := range faceCounts {
		switch {
		case count > faceCountThreshold:
			result[resourceID] = true
		case count < PeopleGroupPhotoMinimumFaces:
			result[resourceID] = false
		default:
			result[resourceID] = groupPhotoByRelativeFaceSize(resourceID, boxes[resourceID], dimensionsLookup)
		}
	}
	return result
}

// groupPhotoByRelativeFaceSize 按人脸相对画面长边的中位数判定是不是合照。
//
// 尺寸读不出来时返回 false：宁可说它不是合照，也不要凭猜断一次。
func groupPhotoByRelativeFaceSize(resourceID string, boxes [][]float32, lookup func(string) MediaDimensions) bool {
	if lookup == nil || len(boxes) == 0 {
		return false
	}
	dimensions := lookup(resourceID)
	if !dimensions.Known() {
		return false
	}
	longSide := float64(max(dimensions.Width, dimensions.Height))
	if longSide <= 0 {
		return false
	}
	sizes := make([]float64, 0, len(boxes))
	for _, box := range boxes {
		sizes = append(sizes, float64(max(box[2], box[3]))/longSide)
	}
	return peopleP50(sizes) <= PeopleGroupPhotoRelativeFaceSizeThreshold
}
