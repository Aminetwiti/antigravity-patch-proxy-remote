package ide

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// GetIdeDataDir retourne le dossier de données racine d'Antigravity IDE (~/.gemini/antigravity-ide).
func GetIdeDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".gemini", "antigravity-ide")
}

// ListSessions parcourt les sessions sur disque et dans les bases de données.
func ListSessions() ([]SessionSummary, error) {
	dataDir := GetIdeDataDir()
	brainDir := filepath.Join(dataDir, "brain")
	convDir := filepath.Join(dataDir, "conversations")

	entries, err := os.ReadDir(brainDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SessionSummary{}, nil
		}
		return nil, err
	}

	var summaries []SessionSummary

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		cascadeID := entry.Name()
		sessionDir := filepath.Join(brainDir, cascadeID)
		transcriptPath := filepath.Join(sessionDir, ".system_generated", "logs", "transcript.jsonl")
		dbPath := filepath.Join(convDir, cascadeID+".db")

		info, errStat := entry.Info()
		lastMod := time.Now()
		if errStat == nil {
			lastMod = info.ModTime()
		}

		hasTranscript := false
		if tInfo, errT := os.Stat(transcriptPath); errT == nil {
			hasTranscript = true
			if tInfo.ModTime().After(lastMod) {
				lastMod = tInfo.ModTime()
			}
		}

		hasDB := false
		if _, errDB := os.Stat(dbPath); errDB == nil {
			hasDB = true
		}

		title, stepCount, activeModel, wsPath := extractSessionMetadata(dbPath, transcriptPath)

		if title == "" {
			title = fmt.Sprintf("Session %s", cascadeID[:8])
		}

		summaries = append(summaries, SessionSummary{
			CascadeID:     cascadeID,
			Title:         title,
			WorkspacePath: wsPath,
			LastModified:  lastMod,
			StepCount:     stepCount,
			ActiveModel:   activeModel,
			HasDatabase:   hasDB,
			HasTranscript: hasTranscript,
		})
	}

	// Tri par date décroissante
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].LastModified.After(summaries[j].LastModified)
	})

	return summaries, nil
}

// extractSessionMetadata tente de lire les métadonnées depuis SQLite ou transcript.jsonl.
func extractSessionMetadata(dbPath, transcriptPath string) (title string, stepCount int, activeModel string, wsPath string) {
	// 1. Essai via SQLite
	if _, err := os.Stat(dbPath); err == nil {
		db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
		if err == nil {
			defer db.Close()

			// Lire le nombre d'étapes
			_ = db.QueryRow("SELECT count(*) FROM steps").Scan(&stepCount)

			// Lire les métadonnées
			var dbTitle, dbModel, dbWs sql.NullString
			errMeta := db.QueryRow("SELECT title, active_model_uid, workspace_root FROM trajectory_meta LIMIT 1").Scan(&dbTitle, &dbModel, &dbWs)
			if errMeta == nil {
				if dbTitle.Valid && dbTitle.String != "" {
					title = dbTitle.String
				}
				if dbModel.Valid {
					activeModel = dbModel.String
				}
				if dbWs.Valid {
					wsPath = DecodeURI(dbWs.String)
				}
			}
		}
	}

	// 2. Fallback / enrichissement via transcript.jsonl
	if transcriptPath != "" {
		if f, err := os.Open(transcriptPath); err == nil {
			defer f.Close()
			scanner := bufio.NewScanner(f)
			count := 0
			for scanner.Scan() {
				count++
				line := scanner.Text()
				if title == "" && strings.Contains(line, `"USER_INPUT"`) {
					var raw map[string]interface{}
					if errJSON := json.Unmarshal([]byte(line), &raw); errJSON == nil {
						if c, ok := raw["content"].(string); ok {
							// Extraire le texte du prompt
							c = cleanPromptContent(c)
							if len(c) > 60 {
								c = c[:57] + "..."
							}
							if c != "" {
								title = c
							}
						}
					}
				}
			}
			if stepCount == 0 {
				stepCount = count
			}
		}
	}

	return title, stepCount, activeModel, wsPath
}

// cleanPromptContent nettoie les balises d'enveloppe XML du prompt.
func cleanPromptContent(raw string) string {
	raw = strings.ReplaceAll(raw, "\r", "")
	startTag := "<USER_REQUEST>"
	endTag := "</USER_REQUEST>"
	sIdx := strings.Index(raw, startTag)
	if sIdx != -1 {
		eIdx := strings.Index(raw, endTag)
		if eIdx != -1 && eIdx > sIdx {
			return strings.TrimSpace(raw[sIdx+len(startTag) : eIdx])
		}
	}
	return strings.TrimSpace(raw)
}

// ReadSessionSteps charge toutes les étapes d'une session depuis son transcript.jsonl.
func ReadSessionSteps(cascadeID string) ([]Step, error) {
	dataDir := GetIdeDataDir()
	transcriptPath := filepath.Join(dataDir, "brain", cascadeID, ".system_generated", "logs", "transcript.jsonl")

	f, err := os.Open(transcriptPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var steps []Step
	scanner := bufio.NewScanner(f)
	// Buffer large pour les gros messages JSON
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		var raw struct {
			StepIndex int    `json:"step_index"`
			Source    string `json:"source"`
			Type      string `json:"type"`
			Status    string `json:"status"`
			Content   string `json:"content"`
			CreatedAt string `json:"created_at"`
		}
		if errJSON := json.Unmarshal([]byte(line), &raw); errJSON == nil {
			var createdAt time.Time
			if raw.CreatedAt != "" {
				createdAt, _ = time.Parse(time.RFC3339, raw.CreatedAt)
			}
			steps = append(steps, Step{
				Index:     raw.StepIndex,
				Source:    raw.Source,
				Type:      raw.Type,
				Status:    raw.Status,
				Content:   cleanPromptContent(raw.Content),
				CreatedAt: createdAt,
			})
		}
	}

	return steps, scanner.Err()
}
