package services

// 相似照片整理的人工决定。
//
// 分组结果可以随时重建，人工决定不行：用户挑了哪张当代表、
// 哪些组已经看过、哪些组不想再看到，这些决定必须跨重建保持。
// 因此它们单独存放在 state/ 下，与派生分组分开。

// similarityStateVersion 是 state/similarity.json 的格式版本。
const similarityStateVersion = 1

// similarityState 是相似照片整理的人工决定。
type similarityState struct {
	// Version 是格式版本。
	Version int `json:"version"`
	// Reviewed 记下已经看过并确认过的分组。
	Reviewed map[string]bool `json:"reviewed"`
	// Ignored 记下用户不想再看到的分组。
	Ignored map[string]bool `json:"ignored"`
	// Representatives 记下用户手动指定的代表照片。
	Representatives map[string]string `json:"representatives"`
}

// newSimilarityState 返回一份空决定。
func newSimilarityState() similarityState {
	return similarityState{
		Version:         similarityStateVersion,
		Reviewed:        map[string]bool{},
		Ignored:         map[string]bool{},
		Representatives: map[string]string{},
	}
}

// normalize 补齐缺失的字段，并把无效条目丢掉。
//
// 按段解析而不是整份反序列化：某一段的格式变了，
// 不该把用户在其他段里已经做过的决定一起清掉。
func (s *similarityState) normalize() {
	if s.Reviewed == nil {
		s.Reviewed = map[string]bool{}
	}
	if s.Ignored == nil {
		s.Ignored = map[string]bool{}
	}
	if s.Representatives == nil {
		s.Representatives = map[string]string{}
	}
	for id, reviewed := range s.Reviewed {
		if id == "" || !reviewed {
			delete(s.Reviewed, id)
		}
	}
	for id, ignored := range s.Ignored {
		if id == "" || !ignored {
			delete(s.Ignored, id)
		}
	}
	for id, resourceID := range s.Representatives {
		if id == "" || resourceID == "" {
			delete(s.Representatives, id)
		}
	}
}
