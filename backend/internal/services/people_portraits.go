package services

import (
	"context"
	"encoding/json"
	"math"
	"sort"
)

const AIJobTypePortrait = "portrait"

type PortraitAnalyzer struct {
	*FaceAnalyzer
	People *PeopleService
}

func (*PortraitAnalyzer) Type() string { return AIJobTypePortrait }
func (a *PortraitAnalyzer) VersionForModel(model string) (string, bool) {
	v, ok := a.FaceAnalyzer.VersionForModel(model)
	return "portrait-v1/" + v, ok
}
func (a *PortraitAnalyzer) Version() string { v, _ := a.VersionForModel(DefaultFaceModel); return v }
func (a *PortraitAnalyzer) RecordCurrent(r AIAnalysisRecord) bool {
	if r.Type != AIJobTypePortrait || r.Status != "verified" {
		return false
	}
	s := a.People
	s.mu.RLock()
	defer s.mu.RUnlock()
	keys := s.facesByResource[r.ResourceID]
	for _, k := range keys {
		if e, ok := s.portraits[k]; !ok || e.Hash != s.faces[k].recordHash {
			return false
		}
	}
	return len(keys) > 0
}

type portraitEvidence struct {
	Eyes    []float32 `json:"eyes,omitempty"`
	Hash    string    `json:"hash"`
	Box     []float32 `json:"box,omitempty"`
	Quality float32   `json:"quality,omitempty"`
}

// 优先核对常见人物所在的照片，每个资源只解码一次。
func (a *PortraitAnalyzer) targets(all []aiJobTarget) []aiJobTarget {
	s := a.People
	s.mu.RLock()
	defer s.mu.RUnlock()
	counts := map[string]int{}
	for _, f := range s.faces {
		counts[s.effectivePersonIDLocked(f)]++
	}
	priorities := map[string]int{}
	for _, f := range s.faces {
		priorities[f.ResourceID] = max(priorities[f.ResourceID], counts[s.effectivePersonIDLocked(f)])
	}
	out := all[:0]
	for _, t := range all {
		if priorities[t.resourceID] > 0 {
			out = append(out, t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return priorities[out[i].resourceID] > priorities[out[j].resourceID] })
	for i := range out {
		out[i].position = i
	}
	return out
}

func (a *PortraitAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	outputs, err := a.FaceAnalyzer.AnalyzeBatch(ctx, inputs)
	if err != nil {
		return nil, err
	}
	for i, out := range outputs {
		if out.Status == "failed" {
			continue
		}
		var detected struct{ Faces []detectedPortrait }
		if err := json.Unmarshal(out.Data, &detected); err != nil {
			return nil, err
		}
		input := inputs[i]
		s := a.People
		evidence := map[string]portraitEvidence{}
		s.mu.RLock()
		for _, key := range s.facesByResource[input.ResourceID] {
			f := s.faces[key]
			if f.Size != input.Size || f.MTimeNs != input.MTimeNs {
				continue
			}
			evidence[key] = verifyPortrait(f, detected.Faces)

		}
		s.mu.RUnlock()
		data, err := json.Marshal(evidence)
		if err != nil {
			return nil, err
		}
		outputs[i] = AIAnalysisOutput{Status: "verified", Data: data}
	}
	return outputs, nil
}

type detectedPortrait struct {
	Box, Embedding, EyeCenter []float32
	PortraitQuality           float32
}

func verifyPortrait(f PersonFace, detections []detectedPortrait) portraitEvidence {
	best, second := float32(0), float32(0)
	winner := -1
	for j, d := range detections {
		if len(d.Box) != 4 || len(d.Embedding) != len(f.embedding) {
			continue
		}
		similarity := smartVectorDot(f.embedding, d.Embedding)
		// 位置接近时用于同脸消歧；强特征匹配也能找回旧坐标错位的人脸。
		near := math.Hypot(float64((d.Box[0]+d.Box[2]/2)-(f.Box[0]+f.Box[2]/2)), float64((d.Box[1]+d.Box[3]/2)-(f.Box[1]+f.Box[3]/2))) < float64(max(f.Box[2], f.Box[3]))/2
		if similarity < 0.72 || (!near && similarity < 0.85) {
			continue
		}
		if near {
			similarity += 0.05
		}
		if similarity > best {
			second = best
			best = similarity
			winner = j
		} else if similarity > second {
			second = similarity
		}
	}
	e := portraitEvidence{Hash: f.recordHash}
	if winner >= 0 && best-second > 0.05 {
		d := detections[winner]
		e.Box = d.Box
		e.Eyes = d.EyeCenter
		e.Quality = d.PortraitQuality
	}
	return e
}

func (s *PeopleService) ApplyPortraits(records []AIAnalysisRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.portraits == nil {
		s.portraits = map[string]portraitEvidence{}
	}
	for _, r := range records {
		if r.Type != AIJobTypePortrait || r.ModuleVersion != "portrait-v1/"+s.faceModelVersion || r.Status != "verified" {
			continue
		}
		var entries map[string]portraitEvidence
		if json.Unmarshal(r.Data, &entries) == nil {
			for k, v := range entries {
				s.portraits[k] = v
			}
		}
	}
}
func (s *PeopleService) portraitFaceLocked(f PersonFace) PersonFace {
	if e, ok := s.portraits[f.Key]; ok && e.Hash == f.recordHash {
		f.Box = e.Box
		f.portraitEyes = e.Eyes
		f.portraitQuality = &e.Quality
	}
	return f
}
func (s *PeopleService) considerPortrait(g *PersonGroup, f PersonFace) {
	if g.firstResource == "" || f.ResourceID < g.firstResource {
		g.firstResource = f.ResourceID
	}
	f = s.portraitFaceLocked(f)
	if len(f.Box) != 4 {
		return
	}
	if chosen := s.manual.PortraitFaces[g.ID]; chosen != "" && chosen == f.Key {
		g.coverScore = -1
		g.considerCover(f)
		g.coverScore = math.Inf(1)
	} else {
		g.considerCover(f)
	}
}
func (s *PeopleService) SetPortrait(id, key string) error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if key != "" {
		f, ok := s.faces[key]
		if !ok || s.effectivePersonIDLocked(f) != id || len(s.portraitFaceLocked(f).Box) != 4 {
			return ErrInvalidPerson
		}
	}
	if s.manual.PortraitFaces == nil {
		s.manual.PortraitFaces = map[string]string{}
	}
	old := s.manual.PortraitFaces[id]
	if key == "" {
		delete(s.manual.PortraitFaces, id)
	} else {
		s.manual.PortraitFaces[id] = key
	}
	if err := s.persistManualLocked(); err != nil {
		s.manual.PortraitFaces[id] = old
		return err
	}
	return nil
}
func (s *PeopleService) PortraitSource(id, resource string, index int) (PersonFace, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, ok := s.faces[PersonFaceKey(resource, index)]
	if !ok || s.effectivePersonIDLocked(f) != id {
		return PersonFace{}, false
	}
	f = s.portraitFaceLocked(f)
	return f, len(f.Box) == 4
}
