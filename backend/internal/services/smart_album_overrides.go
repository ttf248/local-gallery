package services

// 本文件管用户对分组的改名与隐藏，以及分组换号时把这些修改迁移过去。
//
// 迁移分两步：先写下新键，等缓存落盘后再删旧键 —— 顺序反过来的话，
// 进程在两次写之间退出时用户改过的名字就没有出处了。

import (
	"context"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func (s *SmartAlbumService) applyOverrides(albumID, dimension string, groups []SmartAlbumGroup) []SmartAlbumGroup {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	result := make([]SmartAlbumGroup, len(groups))
	for index, group := range groups {
		group.Members = nil
		group.OverrideConflict = group.OverrideConflict && hasSmartAlbumOverrideSource(s.state.Overrides, albumID, dimension, group.overrideSources)
		if group.OverrideConflict {
			result[index] = group
			continue
		}
		if override, exists := s.state.Overrides[smartOverrideKey(albumID, dimension, group.ID)]; exists {
			group.Hidden = override.Hidden
			if override.Name != "" {
				group.Name = override.Name
				group.CustomName = true
			}
		}
		result[index] = group
	}
	return result
}

func hasSmartAlbumOverrideSource(
	overrides map[string]SmartAlbumOverride,
	albumID, dimension string,
	sources []string,
) bool {
	for _, source := range sources {
		if _, exists := overrides[smartOverrideKey(albumID, dimension, source)]; exists {
			return true
		}
	}
	return false
}

// smartAlbumOverrideMigration 记着一次迁移里要删掉的旧键。
//
// 迁移分两步走：先把新键写进状态，等缓存落盘之后再删旧键。
// 顺序反过来的话，进程在两次写之间退出时旧键已经被删掉、缓存里却还是
// 旧分组 —— 用户改过的名字就此没有出处。
type smartAlbumOverrideMigration struct {
	removed []string
}

func (s *SmartAlbumService) migrateSmartAlbumOverrides(
	albumID, dimension string,
	previous []smartAlbumCachedGroup,
	groups []SmartAlbumGroup,
) ([]SmartAlbumGroup, *smartAlbumOverrideMigration, error) {
	if len(previous) == 0 || len(groups) == 0 {
		return groups, nil, nil
	}
	type oldOverride struct {
		id      string
		value   SmartAlbumOverride
		members map[string]struct{}
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	originalOverrides := make(map[string]SmartAlbumOverride, len(s.state.Overrides))
	for key, value := range s.state.Overrides {
		originalOverrides[key] = value
	}

	oldByID := make(map[string]oldOverride)
	for _, group := range previous {
		members := make(map[string]struct{}, len(group.Members))
		for _, id := range group.Members {
			members[id] = struct{}{}
		}
		sourceIDs := append([]string{group.ID}, group.OverrideSources...)
		for _, id := range sourceIDs {
			if override, exists := s.state.Overrides[smartOverrideKey(albumID, dimension, id)]; exists {
				oldByID[id] = oldOverride{id: id, value: override, members: members}
			}
		}
	}
	if len(oldByID) == 0 {
		return groups, nil, nil
	}
	oldIDs := make([]string, 0, len(oldByID))
	for id := range oldByID {
		oldIDs = append(oldIDs, id)
	}
	sort.Strings(oldIDs)
	matches := make(map[int][]oldOverride)
	for _, id := range oldIDs {
		old := oldByID[id]
		bestIndex, bestOverlap, bestRatio := -1, 0, -1.0
		for index, group := range groups {
			newMembers := make(map[string]struct{}, len(group.Members))
			for _, member := range group.Members {
				newMembers[member] = struct{}{}
			}
			overlap := smartRecommendationIntersection(old.members, newMembers)
			if id != group.ID {
				minimum := max(3, int(math.Ceil(float64(min(len(old.members), len(newMembers)))*0.35)))
				if overlap < minimum || float64(overlap)/float64(max(1, len(old.members))) < 0.5 ||
					float64(overlap)/float64(max(1, len(newMembers))) < 0.25 {
					continue
				}
			}
			ratio := float64(overlap) / float64(max(1, len(old.members)))
			if overlap > bestOverlap || overlap == bestOverlap && ratio > bestRatio ||
				overlap == bestOverlap && ratio == bestRatio && bestIndex >= 0 && group.ID < groups[bestIndex].ID {
				bestIndex, bestOverlap, bestRatio = index, overlap, ratio
			}
		}
		if bestIndex >= 0 {
			matches[bestIndex] = append(matches[bestIndex], old)
		}
	}
	changed := false
	removed := make([]string, 0, len(oldByID))
	for index, oldMatches := range matches {
		group := &groups[index]
		newKey := smartOverrideKey(albumID, dimension, group.ID)
		existing, hasExisting := s.state.Overrides[newKey]
		values := make([]SmartAlbumOverride, 0, len(oldMatches)+1)
		if hasExisting {
			values = append(values, existing)
		}
		for _, old := range oldMatches {
			if old.id != group.ID {
				values = append(values, old.value)
			}
		}
		if len(values) == 0 {
			continue
		}
		same := true
		for _, value := range values[1:] {
			if value != values[0] {
				same = false
				break
			}
		}
		if !same {
			group.OverrideConflict = true
			for _, old := range oldMatches {
				if old.id != group.ID {
					group.overrideSources = append(group.overrideSources, old.id)
				}
			}
			continue
		}
		if len(values) > 0 {
			s.state.Overrides[newKey] = values[0]
		}
		for _, old := range oldMatches {
			if old.id != group.ID {
				// 旧键先留着：它要等缓存落盘之后才删。
				removed = append(removed, smartOverrideKey(albumID, dimension, old.id))
			}
		}
		changed = true
	}
	if changed {
		if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
			s.state.Overrides = originalOverrides
			return nil, nil, fmt.Errorf("persist migrated smart album overrides: %w", err)
		}
	}
	return groups, &smartAlbumOverrideMigration{removed: removed}, nil
}

// commitSmartAlbumOverrideMigration 在缓存落盘之后删掉旧键。
//
// 删失败只会留下多余的旧键：它们对应的分组已经不存在，界面上看不到，
// 下一次迁移还会再试一次。丢掉用户的改名才是不可接受的。
func (s *SmartAlbumService) commitSmartAlbumOverrideMigration(migration *smartAlbumOverrideMigration) error {
	if migration == nil || len(migration.removed) == 0 {
		return nil
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	for _, key := range migration.removed {
		delete(s.state.Overrides, key)
	}
	if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
		return fmt.Errorf("remove migrated smart album overrides: %w", err)
	}
	return nil
}

func (s *SmartAlbumService) UpdateOverride(ctx context.Context, albumID, dimension, groupID string, name *string, hidden *bool) (SmartAlbumSummary, error) {
	if name == nil && hidden == nil {
		return SmartAlbumSummary{}, ErrSmartAlbumOverride
	}
	if name != nil {
		*name = strings.TrimSpace(*name)
		if len([]rune(*name)) > 60 || strings.IndexFunc(*name, unicode.IsControl) >= 0 {
			return SmartAlbumSummary{}, ErrSmartAlbumOverride
		}
	}
	summary, err := s.Groups(ctx, albumID, dimension, false)
	if err != nil {
		return SmartAlbumSummary{}, err
	}
	var targetGroup SmartAlbumGroup
	for _, group := range summary.Groups {
		if group.ID == groupID {
			targetGroup = group
			break
		}
	}
	if targetGroup.ID == "" {
		return SmartAlbumSummary{}, ErrSmartAlbumNotFound
	}
	key := smartOverrideKey(albumID, dimension, groupID)
	s.stateMu.Lock()
	previous := s.state.Overrides[key]
	removed := make(map[string]SmartAlbumOverride)
	for _, source := range targetGroup.overrideSources {
		sourceKey := smartOverrideKey(albumID, dimension, source)
		if value, exists := s.state.Overrides[sourceKey]; exists {
			removed[sourceKey] = value
			delete(s.state.Overrides, sourceKey)
		}
	}
	next := previous
	if name != nil {
		next.Name = *name
	}
	if hidden != nil {
		next.Hidden = *hidden
	}
	if next.Name == "" && !next.Hidden {
		delete(s.state.Overrides, key)
	} else {
		s.state.Overrides[key] = next
	}
	if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
		if previous.Name == "" && !previous.Hidden {
			delete(s.state.Overrides, key)
		} else {
			s.state.Overrides[key] = previous
		}
		for sourceKey, value := range removed {
			s.state.Overrides[sourceKey] = value
		}
		s.stateMu.Unlock()
		return SmartAlbumSummary{}, fmt.Errorf("persist smart album override: %w", err)
	}
	s.stateMu.Unlock()
	s.directoryRevision.Add(1)
	return s.Groups(ctx, albumID, dimension, false)
}

func smartOverrideKey(albumID, dimension, groupID string) string {
	return albumID + "/" + dimension + "/" + groupID
}

func (s *SmartAlbumService) Corrections() SmartAlbumCorrections {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	corrections := SmartAlbumCorrections{
		Version: s.state.Version, Overrides: make(map[string]SmartAlbumOverride, len(s.state.Overrides)),
	}
	for key, value := range s.state.Overrides {
		corrections.Overrides[key] = value
	}
	return corrections
}

func (s *SmartAlbumService) ReplaceCorrections(corrections SmartAlbumCorrections) error {
	if !validSmartAlbumCorrections(corrections) {
		return ErrSmartAlbumOverride
	}
	next := smartAlbumState{
		Version: smartAlbumStateVersion, Overrides: make(map[string]SmartAlbumOverride, len(corrections.Overrides)),
	}
	for key, value := range corrections.Overrides {
		next.Overrides[key] = value
	}
	s.stateMu.Lock()
	previous := s.state
	s.state = next
	if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
		s.state = previous
		s.stateMu.Unlock()
		return err
	}
	s.stateMu.Unlock()
	s.directoryRevision.Add(1)
	return nil
}

func validSmartAlbumCorrections(corrections SmartAlbumCorrections) bool {
	if corrections.Version != smartAlbumStateVersion || len(corrections.Overrides) > 100000 {
		return false
	}
	for key, override := range corrections.Overrides {
		parts := strings.Split(key, "/")
		if len(parts) != 3 || !models.IsAlbumID(parts[0]) || !validSmartAlbumDimension(parts[1]) ||
			!validSmartGroupID(parts[2]) || override.Name == "" && !override.Hidden ||
			override.Name != strings.TrimSpace(override.Name) || len([]rune(override.Name)) > 60 ||
			strings.IndexFunc(override.Name, unicode.IsControl) >= 0 {
			return false
		}
	}
	return true
}

func validSmartGroupID(groupID string) bool {
	if len(groupID) != 23 || !strings.HasPrefix(groupID, "sg_") {
		return false
	}
	_, err := hex.DecodeString(groupID[3:])
	return err == nil
}
