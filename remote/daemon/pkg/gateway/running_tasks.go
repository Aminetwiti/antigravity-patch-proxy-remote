package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Running Background Tasks Manager
// ---------------------------------------------------------------------------

// RunningTaskInfo représente une tâche active en cours d'exécution
type RunningTaskInfo struct {
	ID        string             `json:"id"`
	Command   string             `json:"command"`
	CascadeID string             `json:"cascadeId,omitempty"`
	Status    string             `json:"status"` // "running", "completed", "failed", "killed"
	StartedAt time.Time          `json:"startedAt"`
	EndedAt   time.Time          `json:"endedAt,omitempty"`
	Output    string             `json:"output,omitempty"`
	cancel    context.CancelFunc `json:"-"`
}

type runningTaskManager struct {
	mu            sync.RWMutex
	tasks         map[string]*RunningTaskInfo
	finishedOrder []string // anneau FIFO pour limiter la mémoire
	maxFinished   int
	onBroadcast   func(OutgoingMessage)
}

func newRunningTaskManager() *runningTaskManager {
	return &runningTaskManager{
		tasks:       make(map[string]*RunningTaskInfo),
		maxFinished: 50,
	}
}

func (m *runningTaskManager) startTask(id, command, cascadeID string, cancel context.CancelFunc) (*RunningTaskInfo, bool) {
	if id == "" {
		id = fmt.Sprintf("task_%d", time.Now().UnixNano())
	}
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool
	var task *RunningTaskInfo

	m.mu.Lock()
	existing, ok := m.tasks[id]
	if ok && (existing.Status == "running" || existing.Status == "killed") {
		// Tâche déjà démarrée ou déjà tuée : ne pas écraser ni re-diffuser en boucle
		m.mu.Unlock()
		return existing, false
	}

	task = &RunningTaskInfo{
		ID:        id,
		Command:   command,
		CascadeID: cascadeID,
		Status:    "running",
		StartedAt: time.Now(),
		cancel:    cancel,
	}
	m.tasks[id] = task

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_started",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    task.Status,
				"startedAt": task.StartedAt.UnixMilli(),
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	// Diffusion hors-verrou pour éviter deadlocks et contentions de connexion
	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
	return task, true
}

func (m *runningTaskManager) appendOutput(id, delta string) {
	if delta == "" {
		return
	}
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		// Ne pas ajouter d'output sur une tâche inexistante ou terminée/tuée
		m.mu.Unlock()
		return
	}
	task.Output += delta
	if len(task.Output) > 100000 {
		task.Output = task.Output[len(task.Output)-100000:]
	}
	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_output",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"delta":     delta,
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
}

func (m *runningTaskManager) finishTask(id, status string) {
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		// Ne pas écraser une tâche tuée ("killed") par "completed"
		m.mu.Unlock()
		return
	}
	task.Status = status
	task.EndedAt = time.Now()
	task.cancel = nil

	// Rétention FIFO pour borner la mémoire
	m.finishedOrder = append(m.finishedOrder, id)
	if len(m.finishedOrder) > m.maxFinished {
		oldestID := m.finishedOrder[0]
		m.finishedOrder = m.finishedOrder[1:]
		if oldTask, exists := m.tasks[oldestID]; exists && oldTask.Status != "running" {
			delete(m.tasks, oldestID)
		}
	}

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_ended",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    task.Status,
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
}

func (m *runningTaskManager) syncTasksForCascade(cascadeID string, activeTasks map[string]string) {
	var endedTasks []RunningTaskInfo
	m.mu.Lock()
	// 1. Terminer les tâches de cette cascade qui ne sont plus dans activeTasks
	for id, task := range m.tasks {
		if task.CascadeID == cascadeID && task.Status == "running" {
			cleanID := normalizeTaskID(id)
			if _, isActive := activeTasks[cleanID]; !isActive {
				task.Status = "completed"
				task.EndedAt = time.Now()
				endedTasks = append(endedTasks, *task)
			}
		}
	}
	// 2. Démarrer / rafraîchir les tâches actives
	for cleanID, cmd := range activeTasks {
		if existing, exists := m.tasks[cleanID]; exists {
			if existing.Status != "running" {
				existing.Status = "running"
				existing.EndedAt = time.Time{}
			}
		} else {
			m.tasks[cleanID] = &RunningTaskInfo{
				ID:        cleanID,
				Command:   cmd,
				CascadeID: cascadeID,
				Status:    "running",
				StartedAt: time.Now(),
			}
		}
	}
	m.mu.Unlock()

	// Broadcast des fins de tâches détectées
	if m.onBroadcast != nil {
		for _, t := range endedTasks {
			m.onBroadcast(OutgoingMessage{
				Type: "task_ended",
				Data: map[string]interface{}{
					"id":        t.ID,
					"command":   t.Command,
					"cascadeId": t.CascadeID,
					"status":    "completed",
				},
			})
		}
	}
}

func (m *runningTaskManager) listTasks(onlyRunning bool) []RunningTaskInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]RunningTaskInfo, 0, len(m.tasks))
	for _, t := range m.tasks {
		if !onlyRunning || t.Status == "running" {
			res = append(res, *t)
		}
	}
	return res
}

// listTasksForCascade returns only tasks belonging to the given cascade/session.
func (m *runningTaskManager) listTasksForCascade(cascadeID string, onlyRunning bool) []RunningTaskInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]RunningTaskInfo, 0)
	for _, t := range m.tasks {
		if t.CascadeID != cascadeID {
			continue
		}
		if !onlyRunning || t.Status == "running" {
			res = append(res, *t)
		}
	}
	return res
}

func (m *runningTaskManager) killTask(id string) bool {
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool
	var cancel context.CancelFunc

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		m.mu.Unlock()
		return false
	}
	task.Status = "killed"
	task.EndedAt = time.Now()
	cancel = task.cancel
	task.cancel = nil

	m.finishedOrder = append(m.finishedOrder, id)
	if len(m.finishedOrder) > m.maxFinished {
		oldestID := m.finishedOrder[0]
		m.finishedOrder = m.finishedOrder[1:]
		if oldTask, exists := m.tasks[oldestID]; exists && oldTask.Status != "running" {
			delete(m.tasks, oldestID)
		}
	}

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_ended",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    "killed",
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	// Exécution du hook d'annulation réel hors-verrou
	if cancel != nil {
		cancel()
	}
	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
	return true
}

func normalizeTaskID(id string) string {
	id = strings.TrimSpace(id)
	id = strings.Trim(id, "\"'`\t\r\n")
	id = strings.ReplaceAll(id, "\\", "/")
	if idx := strings.LastIndex(id, "/"); idx >= 0 {
		id = id[idx+1:]
	}
	id = filepath.Base(filepath.Clean(id))
	if id == "." || id == "/" || id == ".." {
		return ""
	}
	return id
}

var (
	reTaskID  = regexp.MustCompile(`(?i)(?:task(?:\s+id)?:?\s*["'\\]*|sender=)(?:[a-zA-Z0-9_-]+/)?(task-[0-9a-zA-Z_-]+)`)
	reTaskCmd = regexp.MustCompile(`(?i)(?:Task Description|CommandLine):\s*([^\r\n]+)`)
)

func extractTaskIDFromText(text string) string {
	m := reTaskID.FindStringSubmatch(text)
	if len(m) > 1 {
		return normalizeTaskID(m[1])
	}
	return ""
}

func extractAllTaskIDsFromText(text string) []string {
	matches := reTaskID.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	res := make([]string, 0, len(matches))
	seen := make(map[string]bool)
	for _, m := range matches {
		if len(m) > 1 {
			tid := normalizeTaskID(m[1])
			if tid != "" && !seen[tid] {
				seen[tid] = true
				res = append(res, tid)
			}
		}
	}
	return res
}

func extractTaskCmdFromText(text string) string {
	m := reTaskCmd.FindStringSubmatch(text)
	if len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func findTaskLogPath(cascadeID, taskID string) string {
	if cascadeID == "" || taskID == "" {
		return ""
	}
	cleanCascadeID := filepath.Base(filepath.Clean(strings.ReplaceAll(cascadeID, "\\", "/")))
	if cleanCascadeID == "." || cleanCascadeID == "/" || cleanCascadeID == ".." {
		return ""
	}
	cleanTaskID := normalizeTaskID(taskID)
	if cleanTaskID == "" {
		return ""
	}
	if !strings.HasSuffix(cleanTaskID, ".log") {
		cleanTaskID += ".log"
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(home, ".gemini", "antigravity", "brain", cleanCascadeID, ".system_generated", "tasks", cleanTaskID),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cleanCascadeID, ".system_generated", "tasks", cleanTaskID),
		filepath.Join(home, ".gemini", "antigravity", "brain", cleanCascadeID, ".system_generated", "tasks", strings.TrimSuffix(cleanTaskID, ".log")),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cleanCascadeID, ".system_generated", "tasks", strings.TrimSuffix(cleanTaskID, ".log")),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (s *Server) getTaskLog(cascadeID, taskID string) (string, string, string) {
	cleanTaskID := normalizeTaskID(taskID)
	s.runningTasks.mu.RLock()
	t, ok := s.runningTasks.tasks[cleanTaskID]
	if !ok {
		// Recherche par commande exacte ou préfixe dans la cascade
		for _, candidate := range s.runningTasks.tasks {
			if candidate.CascadeID == cascadeID || cascadeID == "" {
				if candidate.ID == cleanTaskID ||
					strings.EqualFold(candidate.Command, taskID) ||
					strings.HasPrefix(candidate.Command, taskID) ||
					strings.HasPrefix(taskID, candidate.Command) {
					t = candidate
					ok = true
					break
				}
			}
		}
	}
	s.runningTasks.mu.RUnlock()

	cmd := ""
	status := "done"
	actualTaskID := cleanTaskID
	if ok {
		cmd = t.Command
		status = t.Status
		actualTaskID = t.ID
	}

	// 1. Recherche via le chemin de log standard avec actualTaskID et cleanTaskID
	logPath := findTaskLogPath(cascadeID, actualTaskID)
	if logPath == "" && actualTaskID != cleanTaskID {
		logPath = findTaskLogPath(cascadeID, cleanTaskID)
	}

	// 2. Si non trouvé et cascadeId présent, scanner le dossier .system_generated/tasks
	if logPath == "" && cascadeID != "" {
		home, err := os.UserHomeDir()
		if err == nil {
			tasksDirs := []string{
				filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".system_generated", "tasks"),
				filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "tasks"),
			}
			for _, dir := range tasksDirs {
				if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
					for _, entry := range entries {
						name := entry.Name()
						base := strings.TrimSuffix(name, ".log")
						if base == actualTaskID || base == cleanTaskID || strings.Contains(taskID, base) || (ok && base == t.ID) {
							logPath = filepath.Join(dir, name)
							break
						}
					}
					if logPath != "" {
						break
					}
				}
			}
		}
	}

	if logPath != "" {
		data, err := os.ReadFile(logPath)
		if err == nil && len(data) > 0 {
			return string(data), cmd, status
		}
	}

	if ok && t.Output != "" {
		return t.Output, cmd, status
	}

	return "", cmd, status
}

func (s *Server) scanRunningTasksFromTranscript(cascadeID string) {
	if cascadeID == "" {
		return
	}
	tPath := findTranscriptPath(cascadeID)
	if tPath == "" {
		return
	}
	f, err := os.Open(tPath)
	if err != nil {
		return
	}
	defer f.Close()

	activeTasks := make(map[string]string)
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Content string `json:"content"`
		}
		if json.Unmarshal(line, &entry) != nil {
			continue
		}
		content := entry.Content

		// Détection de démarrage
		if strings.Contains(content, "running as a background task") || strings.Contains(content, "Tool is running as a background task") {
			tIDs := extractAllTaskIDsFromText(content)
			tCmd := extractTaskCmdFromText(content)
			for _, tID := range tIDs {
				if tID != "" {
					if tCmd == "" {
						tCmd = tID
					}
					activeTasks[tID] = tCmd
				}
			}
		}

		// Détection de fin / annulation / résultat / timeout
		lowerContent := strings.ToLower(content)
		isFinished := strings.Contains(lowerContent, "finished with result") ||
			strings.Contains(lowerContent, "was canceled") ||
			strings.Contains(lowerContent, "was cancelled") ||
			strings.Contains(lowerContent, "exited with code") ||
			strings.Contains(lowerContent, "the command exited") ||
			strings.Contains(lowerContent, "status: done") ||
			strings.Contains(lowerContent, "status: error") ||
			strings.Contains(lowerContent, "status: killed") ||
			strings.Contains(lowerContent, "task finished") ||
			strings.Contains(lowerContent, "wait cancelled") ||
			strings.Contains(lowerContent, "wait canceled") ||
			strings.Contains(lowerContent, "tool execution was canceled")

		if isFinished || strings.Contains(content, "sender=") {
			tIDs := extractAllTaskIDsFromText(content)
			for _, tID := range tIDs {
				delete(activeTasks, tID)
			}
		}

		if strings.Contains(lowerContent, "all your subagents and background tasks have been stopped") ||
			strings.Contains(lowerContent, "stopped due to server restart") ||
			strings.Contains(lowerContent, "server restart") {
			activeTasks = make(map[string]string)
		}
	}

	// Vérification physique sur disque des logs des tâches restantes
	for tID := range activeTasks {
		logP := findTaskLogPath(cascadeID, tID)
		if logP != "" {
			if fi, err := os.Stat(logP); err == nil {
				// Si le fichier de log n'a pas été modifié depuis plus de 60s et n'est pas un daemon
				if time.Since(fi.ModTime()) > 60*time.Second {
					delete(activeTasks, tID)
					continue
				}
				if data, err := os.ReadFile(logP); err == nil {
					logStr := strings.ToLower(string(data))
					if strings.Contains(logStr, "exited with code") ||
						strings.Contains(logStr, "the command exited") ||
						strings.Contains(logStr, "task finished") ||
						strings.Contains(logStr, "finished with result") ||
						strings.Contains(logStr, "was canceled") ||
						strings.Contains(logStr, "was cancelled") ||
						strings.Contains(logStr, "status: done") {
						delete(activeTasks, tID)
					}
				}
			} else {
				// Le fichier de log n'existe pas ou n'est plus accessible
				delete(activeTasks, tID)
			}
		}
	}

	// Synchronisation avec l'état en mémoire
	s.runningTasks.syncTasksForCascade(cascadeID, activeTasks)
}
