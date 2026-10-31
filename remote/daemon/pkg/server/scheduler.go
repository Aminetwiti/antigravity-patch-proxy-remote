package server

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/session"
)

// ScheduledJob represents a scheduled agent task.
type ScheduledJob = domain.ScheduledJob

// JobStore defines the persistence interface for scheduled tasks.
type JobStore interface {
	SaveScheduledJob(ctx context.Context, job *domain.ScheduledJob) error
	GetScheduledJob(ctx context.Context, id string) (*domain.ScheduledJob, error)
	ListScheduledJobs(ctx context.Context) ([]domain.ScheduledJob, error)
	DeleteScheduledJob(ctx context.Context, id string) error
}

// Scheduler triggers periodic or cron-scheduled autonomous agent runs.
type Scheduler struct {
	mu            sync.RWMutex
	jobs          map[string]*ScheduledJob
	sessionSvc    *session.Service
	agentEng      *agent.Engine
	store         JobStore
	stopCh        chan struct{}
	running       bool
	lastRunMinute map[string]int64
}

func NewScheduler(sessionSvc *session.Service, agentEng *agent.Engine, stores ...JobStore) *Scheduler {
	var store JobStore
	if len(stores) > 0 {
		store = stores[0]
	}
	s := &Scheduler{
		jobs:          make(map[string]*ScheduledJob),
		sessionSvc:    sessionSvc,
		agentEng:      agentEng,
		store:         store,
		stopCh:        make(chan struct{}),
		lastRunMinute: make(map[string]int64),
	}
	if store != nil {
		if persistedJobs, err := store.ListScheduledJobs(context.Background()); err == nil {
			for i := range persistedJobs {
				j := persistedJobs[i]
				s.jobs[j.ID] = &j
			}
		}
	}
	return s
}

func (s *Scheduler) AddJob(job ScheduledJob) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if job.ID == "" {
		job.ID = fmt.Sprintf("job_%d", time.Now().UnixMilli())
	}
	if job.Name == "" {
		job.Name = "Scheduled Task"
	}
	if job.CronExpression == "" {
		job.CronExpression = "* * * * *"
	}
	if job.Prompt == "" {
		return fmt.Errorf("prompt is required")
	}
	now := time.Now()
	if job.CreatedAt.IsZero() {
		job.CreatedAt = now
	}
	job.UpdatedAt = now

	s.jobs[job.ID] = &job
	if s.store != nil {
		_ = s.store.SaveScheduledJob(context.Background(), &job)
	}
	return nil
}

func (s *Scheduler) RemoveJob(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[id]; !ok {
		return fmt.Errorf("job not found")
	}
	delete(s.jobs, id)
	delete(s.lastRunMinute, id)
	if s.store != nil {
		_ = s.store.DeleteScheduledJob(context.Background(), id)
	}
	return nil
}

func (s *Scheduler) ListJobs() []ScheduledJob {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]ScheduledJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		list = append(list, *j)
	}
	return list
}

func (s *Scheduler) Start(ctx context.Context) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	ticker := time.NewTicker(5 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.stopCh:
				return
			case now := <-ticker.C:
				s.tick(now)
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return
	}
	s.running = false
	close(s.stopCh)
}

func (s *Scheduler) tick(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	nowMinute := now.Unix() / 60

	for _, job := range s.jobs {
		if !job.IsEnabled {
			continue
		}
		if s.lastRunMinute[job.ID] == nowMinute {
			continue
		}
		if !cronMatches(job.CronExpression, now) {
			continue
		}

		s.lastRunMinute[job.ID] = nowMinute
		job.LastRunAt = now
		job.LastStatus = "RUNNING"
		job.UpdatedAt = now
		if s.store != nil {
			_ = s.store.SaveScheduledJob(context.Background(), job)
		}
		log.Printf("[Scheduler] Triggering autonomous job %s (%s)", job.ID, job.Name)

		go s.executeJob(job)
	}
}

func (s *Scheduler) executeJob(job *ScheduledJob) {
	if s.sessionSvc == nil || s.agentEng == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	sess, err := s.sessionSvc.CreateSession(ctx, "server", job.WorkspaceID, fmt.Sprintf("[Schedule: %s]", job.Name))
	if err != nil {
		log.Printf("[Scheduler] Failed to create session for job %s: %v", job.ID, err)
		s.updateJobStatus(job.ID, "FAILED")
		return
	}

	s.mu.Lock()
	job.SessionID = sess.ID
	if s.store != nil {
		_ = s.store.SaveScheduledJob(context.Background(), job)
	}
	s.mu.Unlock()

	if err := s.agentEng.StartTurn(ctx, sess.ID, job.Prompt); err != nil {
		log.Printf("[Scheduler] Failed to start turn for job %s: %v", job.ID, err)
		s.updateJobStatus(job.ID, "FAILED")
	} else {
		s.updateJobStatus(job.ID, "COMPLETED")
	}
}

func (s *Scheduler) updateJobStatus(id, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job, ok := s.jobs[id]; ok {
		job.LastStatus = status
		job.UpdatedAt = time.Now()
		if s.store != nil {
			_ = s.store.SaveScheduledJob(context.Background(), job)
		}
	}
}

// cronMatches tests 5-part cron syntax against current time.
func cronMatches(expr string, now time.Time) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	return cronField(fields[0], now.Minute(), 0, 59) &&
		cronField(fields[1], now.Hour(), 0, 23) &&
		cronField(fields[2], now.Day(), 1, 31) &&
		cronField(fields[3], int(now.Month()), 1, 12) &&
		cronField(fields[4], int(now.Weekday()), 0, 6)
}

func cronField(field string, v, min, max int) bool {
	field = strings.TrimSpace(field)
	if field == "" || field == "*" || field == "?" {
		return true
	}
	for _, part := range strings.Split(field, ",") {
		if cronPart(part, v, min, max) {
			return true
		}
	}
	return false
}

func cronPart(part string, v, min, max int) bool {
	step := 1
	if i := strings.Index(part, "/"); i >= 0 {
		s, err := strconv.Atoi(part[i+1:])
		if err != nil || s <= 0 {
			return false
		}
		step = s
		part = part[:i]
	}
	lo, hi := min, max
	if part != "*" {
		if i := strings.Index(part, "-"); i >= 0 {
			a, errA := strconv.Atoi(part[:i])
			b, errB := strconv.Atoi(part[i+1:])
			if errA != nil || errB != nil || a < min || b > max || a > b {
				return false
			}
			lo, hi = a, b
		} else {
			n, err := strconv.Atoi(part)
			if err != nil || n < min || n > max {
				return false
			}
			lo, hi = n, n
		}
	}
	if v < lo || v > hi {
		return false
	}
	return (v-lo)%step == 0
}
