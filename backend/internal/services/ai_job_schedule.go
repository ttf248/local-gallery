package services

// 本文件管每日计划：按本机时钟判断是否到点，依次等待扫描完成、
// 把就绪模块的增量任务排进现有队列、最后刷新智能相册。
//
// 计划状态写在 state/ai_jobs.json；同一天只执行一次。

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"
)

// SetDailyTaskHandlers attaches the non-analysis work that brackets scheduled
// analysis. The scanner and smart album service are created after AIJobService.
func (s *AIJobService) SetDailyTaskHandlers(scan, smartAlbums func(context.Context) error) {
	s.mu.Lock()
	s.dailyScan = scan
	s.dailySmartAlbums = smartAlbums
	s.mu.Unlock()
}

// ConfigureDaily 更新持久化的本地每日调度设置。
func (s *AIJobService) ConfigureDaily(
	enabled bool,
	dailyTime string,
	dailyModules []string,
	peopleEnabled bool,
	dailyScan bool,
	dailySmartAlbums bool,
) (AIJobSettings, error) {
	if _, err := time.Parse("15:04", dailyTime); err != nil {
		return AIJobSettings{}, errors.New("daily time must use HH:MM")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJobSettings{}, errors.New("AI job service is shutting down")
	}
	if !peopleEnabled && hasActiveAIJobType(s.jobs, AIJobTypeFace) {
		return AIJobSettings{}, ErrAIJobActive
	}
	if !peopleEnabled {
		dailyModules = withoutModule(dailyModules, AIJobTypeFace)
	}
	modules, err := s.normalizeDailyModulesLocked(dailyModules, enabled && !dailyScan && !dailySmartAlbums)
	if err != nil {
		return AIJobSettings{}, err
	}
	if enabled && !dailyScan && !dailySmartAlbums && len(modules) == 0 {
		return AIJobSettings{}, errors.New("at least one scheduled task is required")
	}
	previous := s.copySettingsLocked()
	s.settings.DailyEnabled = enabled
	s.settings.DailyTime = dailyTime
	s.settings.DailyModules = modules
	s.settings.DailyScan = dailyScan
	s.settings.DailySmartAlbums = dailySmartAlbums
	s.settings.PeopleEnabled = peopleEnabled
	if err := s.persistLocked(); err != nil {
		s.settings = previous
		return AIJobSettings{}, err
	}
	return s.copySettingsLocked(), nil
}

func withoutModule(modules []string, excluded string) []string {
	result := make([]string, 0, len(modules))
	for _, module := range modules {
		if module != excluded {
			result = append(result, module)
		}
	}
	return result
}

func (s *AIJobService) normalizeDailyModulesLocked(modules []string, enabled bool) ([]string, error) {
	if len(modules) == 0 {
		if enabled {
			return nil, errors.New("at least one installed analysis module is required")
		}
		return []string{}, nil
	}
	selected := make(map[string]struct{}, len(modules))
	for _, moduleType := range modules {
		if !validAIJobType(moduleType) {
			return nil, fmt.Errorf("unknown analysis module %q", moduleType)
		}
		analyzer, installed := s.analyzers[moduleType]
		if !installed || !aiAnalyzerAvailable(analyzer) {
			return nil, fmt.Errorf("analysis module %q is not installed", moduleType)
		}
		selected[moduleType] = struct{}{}
	}
	ordered := make([]string, 0, len(selected))
	for _, moduleType := range []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypeSimilarity} {
		if _, exists := selected[moduleType]; exists {
			ordered = append(ordered, moduleType)
		}
	}
	return ordered, nil
}

func (s *AIJobService) setDailyRun(stage, status, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.settings.LastScheduledStage = stage
	s.settings.LastScheduledStatus = status
	s.settings.LastScheduledError = message
	if status != "running" {
		s.dailyPlanActive = false
	}
	_ = s.persistLocked()
}

func (s *AIJobService) copySettingsLocked() AIJobSettings {
	settings := s.settings
	settings.DailyModules = append([]string{}, s.settings.DailyModules...)
	return settings
}

func (s *AIJobService) scheduleTick(now time.Time) {
	s.mu.Lock()
	ctx := s.scheduleContext
	s.mu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	s.scheduleTickWithContext(ctx, now)
}

func (s *AIJobService) scheduleTickWithContext(ctx context.Context, now time.Time) {
	s.mu.Lock()
	if s.closed || s.dailyPlanActive || s.hasPendingJobsLocked() || !dailyScheduleDue(s.settings, now) {
		s.mu.Unlock()
		return
	}
	settings := s.copySettingsLocked()
	analyzers := make(map[string]AIAnalyzer, len(settings.DailyModules))
	for _, moduleType := range settings.DailyModules {
		analyzers[moduleType] = s.analyzers[moduleType]
	}
	s.dailyPlanActive = true
	s.mu.Unlock()

	readyModules := make([]string, 0, len(settings.DailyModules))
	skippedModules := make([]string, 0)
	for _, moduleType := range settings.DailyModules {
		if err := ctx.Err(); err != nil {
			s.mu.Lock()
			s.dailyPlanActive = false
			s.mu.Unlock()
			return
		}
		analyzer := analyzers[moduleType]
		if analyzer == nil {
			skippedModules = append(skippedModules, moduleType)
			continue
		}
		if readiness, ok := analyzer.(AIAnalyzerReadiness); ok {
			readyCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			err := readiness.Ready(readyCtx)
			cancel()
			if err != nil {
				skippedModules = append(skippedModules, moduleType)
				continue
			}
		}
		readyModules = append(readyModules, moduleType)
	}

	s.mu.Lock()
	if s.closed || !s.dailyPlanActive || s.hasPendingJobsLocked() || !dailyScheduleDue(s.settings, now) || !sameDailyPlan(s.settings, settings) {
		s.dailyPlanActive = false
		s.mu.Unlock()
		return
	}
	today := now.In(time.Local).Format("2006-01-02")
	previousDate := s.settings.LastScheduledDate
	previousStatus := s.settings.LastScheduledStatus
	previousStage := s.settings.LastScheduledStage
	previousError := s.settings.LastScheduledError
	s.settings.LastScheduledDate = today
	s.settings.LastScheduledStatus = "running"
	s.settings.LastScheduledStage = "starting"
	s.settings.LastScheduledError = ""
	if err := s.persistLocked(); err != nil {
		s.settings.LastScheduledDate = previousDate
		s.settings.LastScheduledStatus = previousStatus
		s.settings.LastScheduledStage = previousStage
		s.settings.LastScheduledError = previousError
		s.dailyPlanActive = false
		s.mu.Unlock()
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()

	go s.runScheduledPlan(ctx, settings, readyModules, skippedModules)
}

func sameDailyPlan(left, right AIJobSettings) bool {
	return left.DailyEnabled == right.DailyEnabled &&
		left.DailyTime == right.DailyTime &&
		left.PeopleEnabled == right.PeopleEnabled &&
		left.FaceModel == right.FaceModel &&
		left.DailyScan == right.DailyScan &&
		left.DailySmartAlbums == right.DailySmartAlbums &&
		slices.Equal(left.DailyModules, right.DailyModules)
}

func (s *AIJobService) runScheduledPlan(ctx context.Context, settings AIJobSettings, modules, skippedModules []string) {
	defer s.wg.Done()
	analysisErrorCode := ""
	if settings.DailyScan {
		s.setDailyRun("scan", "running", "")
		s.mu.Lock()
		scan := s.dailyScan
		s.mu.Unlock()
		if scan == nil {
			s.setDailyRun("scan", "failed", "scan_task_unavailable")
			return
		}
		if err := scan(ctx); err != nil {
			if errors.Is(err, ErrDailyPlanNoMediaRoots) {
				s.setDailyRun("completed", "completed", "")
				return
			}
			status := "failed"
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				status = "interrupted"
			}
			s.setDailyRun("scan", status, "scan_failed")
			return
		}
	}
	if len(modules) > 0 && !s.catalog.Acquire().Ready() {
		s.setDailyRun("analysis", "failed", "library_not_ready")
		return
	}

	if len(modules) > 0 {
		s.setDailyRun("analysis", "running", "")
		ids, err := s.enqueueScheduledModules(modules)
		if err != nil {
			s.setDailyRun("analysis", "failed", "analysis_start_failed")
			return
		}
		if err := s.waitForScheduledModules(ctx, ids); err != nil {
			if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				s.setDailyRun("analysis", "interrupted", "analysis_interrupted")
				return
			}
			analysisErrorCode = "analysis_failed"
		}
	}
	if analysisErrorCode == "" && len(skippedModules) > 0 {
		analysisErrorCode = "analysis_module_unavailable"
	}

	if settings.DailySmartAlbums {
		s.setDailyRun("smart_albums", "running", "")
		s.mu.Lock()
		refresh := s.dailySmartAlbums
		s.mu.Unlock()
		if refresh == nil {
			s.setDailyRun("smart_albums", "failed", "smart_albums_unavailable")
			return
		}
		if err := refresh(ctx); err != nil {
			if errors.Is(err, ErrDailyPlanNoMediaRoots) {
				s.setDailyRun("completed", "completed", "")
				return
			}
			status := "failed"
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				status = "interrupted"
			}
			s.setDailyRun("smart_albums", status, "smart_albums_failed")
			return
		}
	}
	if analysisErrorCode != "" {
		s.setDailyRun("analysis", "failed", analysisErrorCode)
		return
	}
	s.setDailyRun("completed", "completed", "")
}

func (s *AIJobService) enqueueScheduledModules(modules []string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("AI job service is shutting down")
	}
	if s.hasPendingJobsLocked() {
		return nil, ErrAIJobActive
	}
	previousOrderLength := len(s.order)
	previousQueue := append([]string(nil), s.queue...)
	created := make([]string, 0, len(modules))
	for _, moduleType := range modules {
		if moduleType == AIJobTypeFace && !s.settings.PeopleEnabled {
			continue
		}
		if _, installed := s.analyzers[moduleType]; !installed {
			continue
		}
		job := s.newJobLocked(moduleType, AIJobModeIncremental)
		job.Scheduled = true
		s.jobs[job.ID] = &job
		s.order = append(s.order, job.ID)
		created = append(created, job.ID)
	}
	if len(created) == 0 {
		return nil, nil
	}
	if len(created) > 1 {
		s.queue = append(s.queue, created[1:]...)
	}
	s.activeID = created[0]
	if err := s.persistLocked(); err != nil {
		for _, id := range created {
			delete(s.jobs, id)
		}
		s.order = s.order[:previousOrderLength]
		s.queue = previousQueue
		s.activeID = ""
		return nil, err
	}
	s.launchLocked(created[0])
	return created, nil
}

func (s *AIJobService) waitForScheduledModules(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	var terminalError error
	for {
		allDone := true
		for _, id := range ids {
			job, exists := s.Get(id)
			if !exists {
				if terminalError == nil {
					terminalError = errors.New("scheduled analysis job disappeared")
				}
				continue
			}
			switch job.Status {
			case AIJobStatusCompleted:
			case AIJobStatusFailed, AIJobStatusCancelled:
				if terminalError == nil {
					terminalError = errors.New("scheduled analysis job did not complete")
				}
			default:
				allDone = false
			}
		}
		if allDone {
			return terminalError
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func dailyScheduleDue(settings AIJobSettings, now time.Time) bool {
	if !settings.DailyEnabled {
		return false
	}
	now = now.In(time.Local)
	today := now.Format("2006-01-02")
	if settings.LastScheduledDate == today {
		return settings.LastScheduledStatus == "interrupted"
	}
	scheduledToday, err := time.ParseInLocation("2006-01-02 15:04", today+" "+settings.DailyTime, time.Local)
	if err != nil {
		return false
	}
	missedPreviousDay := false
	if settings.LastScheduledDate != "" {
		lastDate, parseErr := time.ParseInLocation("2006-01-02", settings.LastScheduledDate, time.Local)
		if parseErr == nil {
			yesterday := time.Date(now.Year(), now.Month(), now.Day()-1, 0, 0, 0, 0, time.Local)
			missedPreviousDay = lastDate.Before(yesterday)
		}
	}
	return !now.Before(scheduledToday) || missedPreviousDay
}
