package gateway

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// scheduledTasksPath : chemin du fichier JSON de persistance des tâches
// planifiées. Variable pour testabilité (les tests pointent vers t.TempDir()).
var scheduledTasksPath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "scheduled_tasks.json"
	}
	return filepath.Join(home, ".gemini", "antigravity-remote", "scheduled_tasks.json")
}()

var sidecarsDirPath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".gemini", "config", "sidecars")
}()

var mainConfigFilePath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".gemini", "config", "config.json")
}()

type sidecarConfigJSON struct {
	Builtin     string   `json:"builtin"`
	Args        []string `json:"args"`
	DisplayName string   `json:"display_name"`
}

type mainConfigSidecarEntry struct {
	Enabled   bool   `json:"enabled"`
	ProjectID string `json:"projectId"`
}

type mainConfigFile struct {
	Sidecars map[string]mainConfigSidecarEntry `json:"sidecars"`
}

// syncSidecarsLocked importe les tâches planifiées définies dans les sidecars Antigravity IDE.
func (s *Server) syncSidecarsLocked() {
	if sidecarsDirPath == "" {
		return
	}
	configSidecars := make(map[string]bool)
	if mainConfigFilePath != "" {
		if data, err := os.ReadFile(mainConfigFilePath); err == nil {
			var cfg mainConfigFile
			if err := json.Unmarshal(data, &cfg); err == nil && cfg.Sidecars != nil {
				for k, v := range cfg.Sidecars {
					configSidecars[k] = v.Enabled
				}
			}
		}
	}

	entries, err := os.ReadDir(sidecarsDirPath)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		sidecarPath := filepath.Join(sidecarsDirPath, name, "sidecar.json")
		data, err := os.ReadFile(sidecarPath)
		if err != nil {
			continue
		}
		var sc sidecarConfigJSON
		if err := json.Unmarshal(data, &sc); err != nil {
			continue
		}
		if sc.Builtin != "schedule" || len(sc.Args) == 0 {
			continue
		}
		cronExpr := sc.Args[0]
		prompt := ""
		if len(sc.Args) > 3 {
			prompt = sc.Args[3]
		}
		if strings.TrimSpace(prompt) == "" {
			continue
		}
		displayName := sc.DisplayName
		if displayName == "" {
			displayName = name
		}
		isEnabled := true
		if en, ok := configSidecars[name]; ok {
			isEnabled = en
		}

		if existing, exists := s.scheduledTasks[name]; exists {
			existing.Name = displayName
			existing.Prompt = prompt
			existing.CronExpression = cronExpr
			existing.IsEnabled = isEnabled
			if isEnabled && existing.Status == "Paused" {
				existing.Status = "Running"
			} else if !isEnabled {
				existing.Status = "Paused"
			}
		} else {
			s.scheduledTasks[name] = &ScheduledTask{
				ID:             name,
				Name:           displayName,
				Prompt:         prompt,
				WorkspaceName:  "Workspace",
				CronExpression: cronExpr,
				IsDaemon:       true,
				IterationsRun:  0,
				IsEnabled:      isEnabled,
				Status:         map[bool]string{true: "Running", false: "Paused"}[isEnabled],
				NextRunAt:      nextRunAt(cronExpr),
				Events:         []ScheduledTaskEvent{},
			}
		}
	}
}

// sanitizeTaskID nettoie l'identifiant pour empêcher toute traversée de chemin.
func sanitizeTaskID(id string) string {
	clean := filepath.Base(filepath.Clean(id))
	clean = strings.ReplaceAll(clean, "..", "")
	clean = strings.Trim(clean, ". /\\")
	return clean
}

// writeSidecarSync synchronise une tâche planifiée vers les sidecars Antigravity IDE.
func writeSidecarSync(task *ScheduledTask) {
	if task == nil || task.ID == "" || sidecarsDirPath == "" || mainConfigFilePath == "" {
		return
	}
	safeID := sanitizeTaskID(task.ID)
	if safeID == "" {
		return
	}
	taskDir := filepath.Join(sidecarsDirPath, safeID)
	_ = os.MkdirAll(taskDir, 0755)
	sc := sidecarConfigJSON{
		Builtin: "schedule",
		Args: []string{
			task.CronExpression,
			"agentapi",
			"new-conversation",
			task.Prompt,
		},
		DisplayName: task.Name,
	}
	if sc.DisplayName == "" {
		sc.DisplayName = safeID
	}
	if scData, err := json.MarshalIndent(sc, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(taskDir, "sidecar.json"), scData, 0644)
	}

	data, err := os.ReadFile(mainConfigFilePath)
	if err == nil {
		var rawMap map[string]interface{}
		if err := json.Unmarshal(data, &rawMap); err == nil {
			sidecarsMap, ok := rawMap["sidecars"].(map[string]interface{})
			if !ok || sidecarsMap == nil {
				sidecarsMap = make(map[string]interface{})
				rawMap["sidecars"] = sidecarsMap
			}
			cur, ok := sidecarsMap[safeID].(map[string]interface{})
			if !ok || cur == nil {
				cur = make(map[string]interface{})
				sidecarsMap[safeID] = cur
			}
			cur["enabled"] = task.IsEnabled
			if outData, err := json.MarshalIndent(rawMap, "", "  "); err == nil {
				_ = os.WriteFile(mainConfigFilePath, outData, 0644)
			}
		}
	}
}

// removeSidecarSync supprime le sidecar Antigravity correspondant.
func removeSidecarSync(taskID string) {
	if taskID == "" || sidecarsDirPath == "" || mainConfigFilePath == "" {
		return
	}
	safeID := sanitizeTaskID(taskID)
	if safeID == "" {
		return
	}
	taskDir := filepath.Join(sidecarsDirPath, safeID)
	_ = os.RemoveAll(taskDir)

	data, err := os.ReadFile(mainConfigFilePath)
	if err == nil {
		var rawMap map[string]interface{}
		if err := json.Unmarshal(data, &rawMap); err == nil {
			if sidecarsMap, ok := rawMap["sidecars"].(map[string]interface{}); ok && sidecarsMap != nil {
				delete(sidecarsMap, safeID)
				if outData, err := json.MarshalIndent(rawMap, "", "  "); err == nil {
					_ = os.WriteFile(mainConfigFilePath, outData, 0644)
				}
			}
		}
	}
}

// SaveScheduledTasks écrit l'état courant des tâches planifiées sur disque.
// ponytail: écriture synchrone volontaire (mutation rare, pas en hot path) ;
// upgrade = écriture atomique + fsync si les tâches deviennent fréquentes.
func (s *Server) SaveScheduledTasks() error {
	s.mu.Lock()
	tasks := make([]ScheduledTask, 0, len(s.scheduledTasks))
	for _, t := range s.scheduledTasks {
		if t != nil {
			taskCopy := *t
			if len(t.Events) > 0 {
				taskCopy.Events = make([]ScheduledTaskEvent, len(t.Events))
				copy(taskCopy.Events, t.Events)
			}
			tasks = append(tasks, taskCopy)
			writeSidecarSync(t)
		}
	}
	s.mu.Unlock()

	data, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(scheduledTasksPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(scheduledTasksPath, data, 0600)
}

// LoadScheduledTasks relit les tâches planifiées depuis le disque au démarrage et synchronise les sidecars.
// Un fichier absent ou corrompu n'est pas fatal : on repart avec les sidecars ou une liste vide.
func (s *Server) LoadScheduledTasks() error {
	data, err := os.ReadFile(scheduledTasksPath)
	if err == nil {
		var tasks []*ScheduledTask
		if err := json.Unmarshal(data, &tasks); err == nil {
			s.mu.Lock()
			for _, t := range tasks {
				if t == nil || t.ID == "" {
					continue
				}
				if s.scheduledTasks[t.ID] == nil {
					s.scheduledTasks[t.ID] = t
				}
			}
			s.mu.Unlock()
		}
	}
	s.mu.Lock()
	s.syncSidecarsLocked()
	s.mu.Unlock()
	return nil
}
