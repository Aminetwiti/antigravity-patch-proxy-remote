package gateway

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	_ "modernc.org/sqlite"
)

// HistorySegment represents an interleaved part of an assistant message turn.
type HistorySegment struct {
	Type    string `json:"type"` // "thought" or "text"
	Content string `json:"content"`
}

type HistoryMessage struct {
	ID           string           `json:"id"`
	Sender       string           `json:"sender"`
	Text         string           `json:"text"`
	Thought      string           `json:"thought,omitempty"`
	Segments     []HistorySegment `json:"segments,omitempty"`
	Timestamp    string           `json:"timestamp"`
	IsStreaming  bool             `json:"isStreaming"`
	IsError      bool             `json:"isError"`
	StepIndex    int64            `json:"stepIndex,omitempty"`
	FilesChanged []string         `json:"filesChanged,omitempty"`
	Additions    int              `json:"additions,omitempty"`
	Deletions    int              `json:"deletions,omitempty"`
}

var (
	wsMappingRe      = regexp.MustCompile(`(?i)([a-zA-Z]:(?:\\\\|/|\\)[^"\r\n\t<>]+?)\s*->`)
	wsFileURIRe      = regexp.MustCompile(`file:///[^\s"'\r\n]+`)
	convTitleRe      = regexp.MustCompile(`##\s*Conversation\s+([0-9a-fA-F-]+):\s*([^"\r\n\\]+?)(?:\\[nrt]|\r|\n|"|$)`)
	userObjectiveRe  = regexp.MustCompile(`(?i)###\s*USER Objective:\s*([^"\r\n\\]+?)(?:\\[nrt]|\r|\n|"|$)`)
	rawWsMappingRe   = regexp.MustCompile(`(?i)(?:\[|\b)([a-zA-Z]:(?:\\\\|[\\/])[^"\r\n\t<>]+?)(?:\]|\b)\s*->`)
	rawWsToolArgRe   = regexp.MustCompile(`(?i)"(?:filePath|file_path|targetFile|TargetFile|AbsolutePath|DirectoryPath|Cwd)"\s*:\s*"([a-zA-Z]:(?:\\\\|[\\/])[^"\r\n\t<>]+?)"`)
	globalConvTitles = make(map[string]string)
	convTitlesMu     sync.RWMutex

	systemMessageBlockRe   = regexp.MustCompile(`(?s)<SYSTEM_MESSAGE>.*?</SYSTEM_MESSAGE>`)
	systemPromptBlockRe    = regexp.MustCompile(`(?s)<SYSTEM_PROMPT>.*?</SYSTEM_PROMPT>`)
	additionalMetaBlockRe  = regexp.MustCompile(`(?s)<ADDITIONAL_METADATA>.*?</ADDITIONAL_METADATA>`)
	userSettingsBlockRe    = regexp.MustCompile(`(?s)<USER_SETTINGS_CHANGE>.*?</USER_SETTINGS_CHANGE>`)
	systemGeneratedBlockRe = regexp.MustCompile(`(?s)<system_generated>.*?</system_generated>`)
	contextBlockRe         = regexp.MustCompile(`(?s)<context.*?>.*?</context>`)
	bgMessageBlockRe       = regexp.MustCompile(`(?s)\[Message\]\s*timestamp=[^\r\n]+\r?\n+sender=[^\r\n]+\r?\n+priority=[^\r\n]+\r?\n+content=[^\r\n]+`)
	systemNoticeRe         = regexp.MustCompile(`(?s)The following is a <SYSTEM_MESSAGE> not actually sent by the user.*?(?:pay attention to\.|$)`)
)

// stepTypeUser/stepTypeAssistant/stepTypeTitle sont les step_type observés
// dans les conversations Antigravity 2.0 stockées en SQLite (~/.gemini/
// antigravity/conversations/<cascadeID>.db, table `steps`).
const (
	stepTypeUser      = 14 // message utilisateur
	stepTypeAssistant = 15 // réponse du modèle
	stepTypeTitle     = 23 // mise à jour du titre de conversation
)

// normalizeWorkspace normalise les chemins et URIs de workspace (décote URL %20, %3A, slashes)
func normalizeWorkspace(uri string) string {
	if uri == "" {
		return ""
	}
	if decoded, err := url.PathUnescape(uri); err == nil {
		uri = decoded
	}
	if decoded, err := url.QueryUnescape(uri); err == nil {
		uri = decoded
	}
	uri = strings.TrimPrefix(uri, "file:///")
	uri = strings.TrimPrefix(uri, "file://")
	uri = strings.ReplaceAll(uri, `\`, `/`)
	uri = strings.TrimPrefix(uri, "//?/")
	uri = strings.TrimPrefix(uri, "//./")
	uri = strings.TrimRight(uri, "/")
	return uri
}

// isSubagentTitle détecte si un titre ou prompt correspond à un sous-agent interne ou tâche système
func isSubagentTitle(title string) bool {
	lowerTitle := strings.ToLower(strings.TrimSpace(title))
	if lowerTitle == "" {
		return false
	}
	return strings.HasPrefix(lowerTitle, "system:") ||
		strings.HasPrefix(lowerTitle, "<system_") ||
		strings.HasPrefix(lowerTitle, "@[subagent") ||
		strings.HasPrefix(lowerTitle, "@[") ||
		strings.HasPrefix(lowerTitle, "# mission") ||
		strings.HasPrefix(lowerTitle, "# role") ||
		strings.HasPrefix(lowerTitle, "analyzing stream delta") ||
		strings.HasPrefix(lowerTitle, "subagent:") ||
		strings.HasPrefix(lowerTitle, "subagent-") ||
		strings.HasPrefix(lowerTitle, "subagent_") ||
		strings.Contains(lowerTitle, "subagent-") ||
		strings.Contains(lowerTitle, "subagent_") ||
		strings.Contains(lowerTitle, "claim verification")
}

// isSessionArchived vérifie si la session est archivée dans ~/.gemini/antigravity/annotations/<cascadeID>.pbtxt ou antigravity-ide
func isSessionArchived(home, cascadeID string) bool {
	if cascadeID == "" {
		return false
	}
	for _, sub := range []string{"antigravity", "antigravity-ide"} {
		annoPath := filepath.Join(home, ".gemini", sub, "annotations", cascadeID+".pbtxt")
		data, err := os.ReadFile(annoPath)
		if err != nil {
			continue
		}
		s := strings.ToLower(string(data))
		if strings.Contains(s, "deleted: true") || strings.Contains(s, "deleted:true") {
			return true
		}
		if strings.Contains(s, "archived: false") || strings.Contains(s, "archived:false") {
			continue
		}
		if strings.Contains(s, "archived: true") || strings.Contains(s, "archived:true") || strings.Contains(s, "archival_status_timestamp") {
			return true
		}
	}
	return false
}

// isSessionDeleted distingue les cascades supprimées (deleted: true dans le
// pbtxt d'annotations) des simplement archivées : une session supprimée ne
// doit réapparaître ni dans la sidebar ni dans l'historique des conversations.
func isSessionDeleted(home, cascadeID string) bool {
	if cascadeID == "" {
		return false
	}
	for _, sub := range []string{"antigravity", "antigravity-ide"} {
		annoPath := filepath.Join(home, ".gemini", sub, "annotations", cascadeID+".pbtxt")
		data, err := os.ReadFile(annoPath)
		if err != nil {
			continue
		}
		s := strings.ToLower(string(data))
		if strings.Contains(s, "deleted: true") || strings.Contains(s, "deleted:true") {
			return true
		}
	}
	return false
}

// isJunkSessionTitle : titre par défaut/abandonné (le mobile affiche « Cascade
// Session » quand le titre est vide). Aligné sur le filtre 2.0 de
// sessionsOut/sessionsFromSummariesLocked.
func isJunkSessionTitle(title string) bool {
	t := strings.TrimSpace(title)
	if t == "" || t == "Untitled Conversation" || t == "Cascade Session" || strings.EqualFold(t, "cascade session") {
		return true
	}
	if cascadeIDRe.MatchString(t) && len(t) >= 32 {
		return true
	}
	return strings.HasPrefix(t, "Empty ") || strings.HasPrefix(t, "New ") ||
		strings.HasPrefix(t, "General Conversation")
}

// resolveGeminiSubDir détermine si la session réside dans antigravity-ide ou antigravity
func resolveGeminiSubDir(home, cascadeID string) string {
	for _, sub := range []string{"antigravity-ide", "antigravity"} {
		if _, err := os.Stat(filepath.Join(home, ".gemini", sub, "annotations", cascadeID+".pbtxt")); err == nil {
			return sub
		}
		if _, err := os.Stat(filepath.Join(home, ".gemini", sub, "brain", cascadeID)); err == nil {
			return sub
		}
		if _, err := os.Stat(filepath.Join(home, ".gemini", sub, "conversations", cascadeID+".db")); err == nil {
			return sub
		}
	}
	return "antigravity"
}

// cascadeIDRe borne le format des identifiants de cascade acceptés pour toute
// opération disque : alphanumérique, tiret et underscore, 64 chars max.
// Bloque les traversées (.., /, \, :) à la source (SEC-02 : delete_cascade et
// consorts joignaient cascadeID au chemin ~/.gemini sans validation).
var cascadeIDRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func validCascadeID(id string) bool {
	return cascadeIDRe.MatchString(id)
}

// renameSessionOnDisk persiste le titre personnalisé d'une session dans annotations/<cascadeID>.pbtxt
func renameSessionOnDisk(home, cascadeID, title string) error {
	if !validCascadeID(cascadeID) {
		return fmt.Errorf("identifiant de cascade invalide")
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return fmt.Errorf("title requis")
	}
	for _, subDir := range []string{"antigravity", "antigravity-ide"} {
		annoDir := filepath.Join(home, ".gemini", subDir, "annotations")
		_ = os.MkdirAll(annoDir, 0o755)
		annoPath := filepath.Join(annoDir, cascadeID+".pbtxt")

		nowSec := time.Now().Unix()
		nowNano := time.Now().Nanosecond()

		data, err := os.ReadFile(annoPath)
		if err != nil {
			content := fmt.Sprintf("custom_title:%q last_user_view_time:{seconds:%d nanos:%d}\n",
				title, nowSec, nowNano)
			_ = os.WriteFile(annoPath, []byte(content), 0o644)
			continue
		}

		s := string(data)
		reTitle := regexp.MustCompile(`(?i)custom_title:\s*"[^"]*"`)
		s = reTitle.ReplaceAllString(s, "")
		s = strings.TrimSpace(s)
		s = fmt.Sprintf("custom_title:%q %s\n", title, s)
		_ = os.WriteFile(annoPath, []byte(s), 0o644)
	}
	return nil
}

func pinSessionOnDisk(home, cascadeID string, pinned bool) error {
	if !validCascadeID(cascadeID) {
		return fmt.Errorf("identifiant de cascade invalide")
	}
	for _, subDir := range []string{"antigravity", "antigravity-ide"} {
		annoDir := filepath.Join(home, ".gemini", subDir, "annotations")
		_ = os.MkdirAll(annoDir, 0o755)
		annoPath := filepath.Join(annoDir, cascadeID+".pbtxt")

		nowSec := time.Now().Unix()
		nowNano := time.Now().Nanosecond()

		data, err := os.ReadFile(annoPath)
		if err != nil {
			if !pinned {
				continue
			}
			content := fmt.Sprintf("pinned:true last_user_view_time:{seconds:%d nanos:%d}\n",
				nowSec, nowNano)
			_ = os.WriteFile(annoPath, []byte(content), 0o644)
			continue
		}

		s := string(data)
		rePin := regexp.MustCompile(`(?i)pinned:\s*(true|false)`)
		s = rePin.ReplaceAllString(s, "")
		s = strings.TrimSpace(s)

		if pinned {
			s = fmt.Sprintf("pinned:true %s", s)
		} else {
			s = fmt.Sprintf("pinned:false %s", s)
		}
		s = strings.TrimSpace(s) + "\n"
		_ = os.WriteFile(annoPath, []byte(s), 0o644)
	}
	return nil
}

// archiveSessionOnDisk persiste le statut archivé dans annotations/<cascadeID>.pbtxt
func archiveSessionOnDisk(home, cascadeID string, archived bool) error {
	if !validCascadeID(cascadeID) {
		return fmt.Errorf("identifiant de cascade invalide")
	}
	for _, subDir := range []string{"antigravity", "antigravity-ide"} {
		annoDir := filepath.Join(home, ".gemini", subDir, "annotations")
		_ = os.MkdirAll(annoDir, 0o755)
		annoPath := filepath.Join(annoDir, cascadeID+".pbtxt")

		nowSec := time.Now().Unix()
		nowNano := time.Now().Nanosecond()

		data, err := os.ReadFile(annoPath)
		if err != nil {
			if !archived {
				continue
			}
			content := fmt.Sprintf("archived:true last_user_view_time:{seconds:%d nanos:%d}\n",
				nowSec, nowNano)
			_ = os.WriteFile(annoPath, []byte(content), 0o644)
			continue
		}

		s := string(data)
		reArch := regexp.MustCompile(`(?i)archived:\s*(true|false)`)
		s = reArch.ReplaceAllString(s, "")
		s = strings.TrimSpace(s)

		if archived {
			s = fmt.Sprintf("archived:true %s", s)
		} else {
			s = fmt.Sprintf("archived:false %s", s)
		}
		s = strings.TrimSpace(s) + "\n"
		_ = os.WriteFile(annoPath, []byte(s), 0o644)
	}
	return nil
}

// isSessionPinned vérifie si la session est épinglée dans annotations/<cascadeID>.pbtxt (antigravity ou antigravity-ide)
func isSessionPinned(home, cascadeID string) bool {
	if cascadeID == "" {
		return false
	}
	for _, sub := range []string{"antigravity", "antigravity-ide"} {
		annoPath := filepath.Join(home, ".gemini", sub, "annotations", cascadeID+".pbtxt")
		if data, err := os.ReadFile(annoPath); err == nil {
			s := strings.ToLower(string(data))
			if strings.Contains(s, "pinned: true") || strings.Contains(s, "pinned:true") {
				return true
			}
		}
	}
	return false
}

// deleteSessionFromDisk supprime les artefacts résiduels d'une session sur disque (.pbtxt, .db, brain/)
func deleteSessionFromDisk(home, cascadeID string) error {
	if !validCascadeID(cascadeID) {
		// cascadeID vide ou malformé : ne rien supprimer (fail-closed, SEC-02).
		if cascadeID == "" {
			return nil
		}
		return fmt.Errorf("identifiant de cascade invalide")
	}
	for _, sub := range []string{"antigravity", "antigravity-ide"} {
		annoPath := filepath.Join(home, ".gemini", sub, "annotations", cascadeID+".pbtxt")
		_ = os.Remove(annoPath)

		dbPath := filepath.Join(home, ".gemini", sub, "conversations", cascadeID+".db")
		_ = os.Remove(dbPath)

		brainDir := filepath.Join(home, ".gemini", sub, "brain", cascadeID)
		_ = os.RemoveAll(brainDir)
	}
	return nil
}

func findTranscriptPath(cascadeID string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidates := []string{
		// 1. transcript.jsonl ÔÇö layout principal (antigravity + IDE)
		filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".system_generated", "logs", "transcript.jsonl"),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "logs", "transcript.jsonl"),
		// 2. transcript_full.jsonl ÔÇö repli quand seul le transcript complet existe
		filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".system_generated", "logs", "transcript_full.jsonl"),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "logs", "transcript_full.jsonl"),
		// 3. chunks/transcript ÔÇö layout observ├® sur cette machine (IDE brain /
		//    AGY brain avec transcript d├®coup├® en chunks num├®rot├®s)
		filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".system_generated", "logs", "chunks", "transcript", "00000000.jsonl"),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "logs", "chunks", "transcript", "00000000.jsonl"),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// findBrainDir returns the active brain directory for a cascade ID.
func findBrainDir(cascadeID string) string {
	if !validCascadeID(cascadeID) {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID),
	}
	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			return p
		}
	}
	return ""
}

// ListSessionArtifacts scans the session brain directory and returns all markdown artifacts.
func ListSessionArtifacts(cascadeID string) []map[string]interface{} {
	var results []map[string]interface{}
	brainDir := findBrainDir(cascadeID)
	if brainDir == "" {
		return results
	}
	entries, err := os.ReadDir(brainDir)
	if err != nil {
		return results
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(strings.ToLower(name), ".md") {
			fullPath := filepath.Join(brainDir, name)
			info, _ := entry.Info()
			var size int64
			var modTime int64
			if info != nil {
				size = info.Size()
				modTime = info.ModTime().UnixMilli()
			}
			results = append(results, map[string]interface{}{
				"name":    name,
				"path":    filepath.ToSlash(fullPath),
				"size":    size,
				"modTime": modTime,
			})
		}
	}
	return results
}

// ListSessionUploads scans scratch and user_uploaded directories for images, PDFs, media.
func ListSessionUploads(cascadeID string) []map[string]interface{} {
	var results []map[string]interface{}
	brainDir := findBrainDir(cascadeID)
	if brainDir == "" {
		return results
	}
	seen := make(map[string]bool)
	for _, sub := range []string{"scratch", ".user_uploaded", ""} {
		subDir := filepath.Join(brainDir, sub)
		entries, err := os.ReadDir(subDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if seen[name] {
				continue
			}
			lower := strings.ToLower(name)
			if strings.HasSuffix(lower, ".png") ||
				strings.HasSuffix(lower, ".jpg") ||
				strings.HasSuffix(lower, ".jpeg") ||
				strings.HasSuffix(lower, ".gif") ||
				strings.HasSuffix(lower, ".webp") ||
				strings.HasSuffix(lower, ".pdf") ||
				strings.HasSuffix(lower, ".mp4") {
				seen[name] = true
				fullPath := filepath.Join(subDir, name)
				info, _ := entry.Info()
				var size int64
				if info != nil {
					size = info.Size()
				}
				results = append(results, map[string]interface{}{
					"name": name,
					"path": filepath.ToSlash(fullPath),
					"size": size,
				})
			}
		}
	}
	return results
}

// ListLocalSessions scans local brain directories for conversations when gRPC returns empty.
func ListLocalSessions() []map[string]interface{} {
	return ListLocalSessionsOpts(false)
}

// ListLocalSessionsOpts énumère les cascades sur disque. includeArchived
// garde les sessions archivées (marquées isArchived + status ARCHIVED) pour
// l'historique des conversations ; les supprimées sont toujours exclues.
func ListLocalSessionsOpts(includeArchived bool) []map[string]interface{} {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	officialProjs := ListOfficialProjects()
	officialPaths := make([]string, 0, len(officialProjs))
	officialNames := make([]string, 0, len(officialProjs))
	for _, p := range officialProjs {
		if p.Path != "" {
			officialPaths = append(officialPaths, strings.ToLower(p.Path))
		}
		if p.Name != "" {
			officialNames = append(officialNames, strings.ToLower(p.Name))
		}
	}

	roots := []string{
		filepath.Join(home, ".gemini", "antigravity", "brain"),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain"),
	}

	type sessionItem struct {
		data      map[string]interface{}
		updatedAt time.Time
	}

	seen := make(map[string]bool)
	var items []sessionItem

	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			cascadeID := e.Name()
			if seen[cascadeID] {
				continue
			}

			// Antigravity 2.0 : v├®rifier si la session est archiv├®e dans ~/.gemini/antigravity/annotations/
			archived := isSessionArchived(home, cascadeID)
			if archived && (!includeArchived || isSessionDeleted(home, cascadeID)) {
				// Sidebar : archivée/supprimée masquée. Historique
				// (includeArchived) : l'archivée est conservée ci-dessous,
				// la supprimée reste toujours exclue.
				continue
			}

			transcriptPath := findTranscriptPath(cascadeID)
			if transcriptPath == "" {
				continue
			}

			seen[cascadeID] = true
			title, workspacePath, modTime := extractSessionMetadata(transcriptPath, cascadeID)

			// Exclure les subagents et prompts systèmes
			if isSubagentTitle(title) {
				continue
			}

			if isJunkSessionTitle(title) {
				if !includeArchived || modTime.IsZero() {
					continue
				}
			}
			if modTime.IsZero() {
				continue
			}

			if workspacePath == "" {
				workspacePath = extractWorkspace(root, cascadeID)
			}

			cleanWs := normalizeWorkspace(workspacePath)

			// Si nous avons des projets officiels Antigravity 2.0, ne garder QUE les sessions
			// rattachées à un projet officiel
			matchedProjectName, matchedProjectPath, matchedProjectID := matchOfficialProject(
				"",
				workspacePath,
				cleanWs,
				officialProjs,
			)
			if len(officialProjs) > 0 && matchedProjectName == "" {
				continue
			}

			// Nettoyage du titre si c'est un chemin brut
			if strings.HasPrefix(title, "C:\\") || strings.HasPrefix(title, "c:\\") || strings.HasPrefix(title, "file://") {
				base := filepath.Base(cleanWs)
				if base != "" && base != "." && base != "/" && base != "\\" {
					title = base
				}
			}

			if matchedProjectName == "" {
				matchedProjectName = filepath.Base(cleanWs)
				if matchedProjectName == "" || matchedProjectName == "." || matchedProjectName == "/" || matchedProjectName == "\\" {
					matchedProjectName = "antigravity-workspace"
				}
			}

			pinned := false
			if home != "" {
				pinned = isSessionPinned(home, cascadeID)
			}
			status := "idle"
			if archived {
				status = "CASCADE_STATUS_ARCHIVED"
			}
			sMap := map[string]interface{}{
				"cascadeId":     cascadeID,
				"title":         title,
				"workspace":     matchedProjectName,
				"workspacePath": matchedProjectPath,
				"projectId":     matchedProjectID,
				"status":        status,
				"updatedAt":     modTime.Format(time.RFC3339),
				"isPinned":      pinned,
				"isArchived":    archived,
				"isIde":         strings.Contains(root, "antigravity-ide"),
			}
			items = append(items, sessionItem{data: sMap, updatedAt: modTime})
		}
	}

	// 2ème passe : réassigner les titres officiels découverts globalement dans les résumés
	convTitlesMu.RLock()
	for _, it := range items {
		cid, _ := it.data["cascadeId"].(string)
		if offTitle, ok := globalConvTitles[strings.ToLower(cid)]; ok && offTitle != "" {
			it.data["title"] = offTitle
		}
	}
	convTitlesMu.RUnlock()

	// Tri décroissant par date de mise à jour (plus récentes d'abord)
	sort.Slice(items, func(i, j int) bool {
		return items[i].updatedAt.After(items[j].updatedAt)
	})

	// Limite à 6 sessions récentes par projet pour correspondre exactement à l'affichage IDE 2.0
	projectCounts := make(map[string]int)
	sessions := make([]map[string]interface{}, 0, len(items))
	for _, it := range items {
		ws, _ := it.data["workspace"].(string)
		if projectCounts[ws] < 6 {
			sessions = append(sessions, it.data)
			projectCounts[ws]++
		}
	}
	return sessions
}

// ListIdeSessions retourne rapidement uniquement les sessions créées dans Antigravity IDE
// (~/.gemini/antigravity-ide/brain) sans reparcourir le répertoire volumineux d'Antigravity 2.0.
func ListIdeSessions(officialProjs []ProjectSummary, includeArchived bool) []map[string]interface{} {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	ideRoot := filepath.Join(home, ".gemini", "antigravity-ide", "brain")
	entries, err := os.ReadDir(ideRoot)
	if err != nil {
		return nil
	}
	var res []map[string]interface{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		cascadeID := e.Name()
		archived := isSessionArchived(home, cascadeID)
		if archived && (!includeArchived || isSessionDeleted(home, cascadeID)) {
			continue
		}
		transcriptPath := findTranscriptPath(cascadeID)
		if transcriptPath == "" {
			continue
		}
		title, workspacePath, modTime := extractSessionMetadata(transcriptPath, cascadeID)
		if isSubagentTitle(title) || (isJunkSessionTitle(title) && !includeArchived) || modTime.IsZero() {
			continue
		}
		if workspacePath == "" {
			workspacePath = extractWorkspace(ideRoot, cascadeID)
		}
		cleanWs := normalizeWorkspace(workspacePath)
		matchedProjectName, matchedProjectPath, matchedProjectID := matchOfficialProject(
			"",
			workspacePath,
			cleanWs,
			officialProjs,
		)
		if len(officialProjs) == 0 || matchedProjectName == "" {
			continue
		}
		if strings.HasPrefix(title, "C:\\") || strings.HasPrefix(title, "c:\\") || strings.HasPrefix(title, "file://") {
			base := filepath.Base(cleanWs)
			if base != "" && base != "." && base != "/" && base != "\\" {
				title = base
			}
		}
		pinned := isSessionPinned(home, cascadeID)
		status := "idle"
		if archived {
			status = "CASCADE_STATUS_ARCHIVED"
		}
		res = append(res, map[string]interface{}{
			"cascadeId":     cascadeID,
			"title":         title,
			"workspace":     matchedProjectName,
			"workspacePath": matchedProjectPath,
			"projectId":     matchedProjectID,
			"status":        status,
			"updatedAt":     modTime.Format(time.RFC3339),
			"isPinned":      pinned,
			"isArchived":    archived,
			"isIde":         true,
		})
	}
	return res
}

func extractSessionMetadata(transcriptPath, cascadeID string) (title string, workspacePath string, modTime time.Time) {
	stat, errStat := os.Stat(transcriptPath)
	if errStat != nil {
		return cascadeID, "", time.Now()
	}
	modTime = stat.ModTime()

	f, err := os.Open(transcriptPath)
	if err != nil {
		return cascadeID, "", modTime
	}
	defer f.Close()

	// Vérifie si le titre officiel est déjà indexé globalement
	convTitlesMu.RLock()
	if off, ok := globalConvTitles[strings.ToLower(cascadeID)]; ok && off != "" {
		title = off
	}
	convTitlesMu.RUnlock()

	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	lineCount := 0
	hasOfficialTitle := false
	if title != "" && title != cascadeID {
		hasOfficialTitle = true
	}

	for scanner.Scan() {
		lineCount++
		text := scanner.Text()

		// 1. Indexe tous les titres de conversations trouvés dans les conversation_summaries
		if matches := convTitleRe.FindAllStringSubmatch(text, -1); len(matches) > 0 {
			convTitlesMu.Lock()
			for _, m := range matches {
				if len(m) >= 3 && m[1] != "" && m[2] != "" {
					cleanTitle := strings.TrimSpace(m[2])
					cleanTitle = strings.Split(cleanTitle, "\\n")[0]
					cleanTitle = strings.Split(cleanTitle, "\n")[0]
					cleanTitle = strings.Trim(cleanTitle, "\"': \t\r\n")
					if cleanTitle != "" {
						globalConvTitles[strings.ToLower(m[1])] = cleanTitle
						if strings.EqualFold(m[1], cascadeID) {
							title = cleanTitle
							hasOfficialTitle = true
						}
					}
				}
			}
			convTitlesMu.Unlock()
		}

		// 2. Extrait l'objectif utilisateur officiel (### USER Objective:)
		if m := userObjectiveRe.FindStringSubmatch(text); m != nil {
			cand := strings.TrimSpace(m[1])
			cand = strings.Split(cand, "\\n")[0]
			cand = strings.Split(cand, "\n")[0]
			cand = strings.Trim(cand, "\"': \t\r\n")
			if cand != "" && !strings.EqualFold(cand, "None") {
				title = cand
				hasOfficialTitle = true
				convTitlesMu.Lock()
				globalConvTitles[strings.ToLower(cascadeID)] = cand
				convTitlesMu.Unlock()
			}
		}

		if !hasOfficialTitle {
			convTitlesMu.RLock()
			if off, ok := globalConvTitles[strings.ToLower(cascadeID)]; ok && off != "" {
				title = off
				hasOfficialTitle = true
			}
			convTitlesMu.RUnlock()
		}

		// 2. Cherche le workspace directement sur le texte brut
		if workspacePath == "" {
			if m := rawWsMappingRe.FindStringSubmatch(text); m != nil {
				cand := strings.ReplaceAll(m[1], `\\`, `/`)
				cand = strings.Trim(cand, "[]\"'` \t\r\n")
				if isDirectoryPath(cand) && !strings.Contains(cand, ".gemini") {
					workspacePath = cand
				}
			} else if m := rawWsToolArgRe.FindStringSubmatch(text); m != nil {
				cand := strings.ReplaceAll(m[1], `\\`, `/`)
				cand = strings.Trim(cand, "[]\"'` \t\r\n")
				if !strings.Contains(cand, ".gemini") && isDirectoryPath(cand) {
					if filepath.Ext(cand) != "" {
						cand = filepath.Dir(cand)
					}
					workspacePath = cand
				}
			}
		}

		var entry struct {
			Type      string `json:"type"`
			Content   string `json:"content"`
			ToolCalls []struct {
				Name string                 `json:"name"`
				Args map[string]interface{} `json:"args"`
			} `json:"tool_calls"`
		}

		if json.Unmarshal([]byte(text), &entry) == nil {
			// 2. Workspace depuis user_information / [URI] -> [Corpus]
			if workspacePath == "" && entry.Content != "" {
				if ws := parseWorkspaceFromTranscript(entry.Content); ws != "" {
					workspacePath = ws
				}
			}

			// Workspace depuis ToolCalls (Cwd, DirectoryPath, SearchPath, TargetFile, etc.)
			if workspacePath == "" {
				for _, tc := range entry.ToolCalls {
					for _, k := range []string{"Cwd", "cwd", "DirectoryPath", "SearchPath", "SearchDirectory"} {
						if v, ok := tc.Args[k].(string); ok {
							cand := strings.Trim(v, "[]\"'` \t\r\n")
							if isDirectoryPath(cand) && !strings.Contains(cand, ".gemini") {
								workspacePath = cand
								break
							}
						}
					}
					if workspacePath == "" {
						for _, k := range []string{"TargetFile", "AbsolutePath", "FilePath"} {
							if v, ok := tc.Args[k].(string); ok {
								cand := strings.Trim(v, "[]\"'` \t\r\n")
								if isDirectoryPath(cand) && !strings.Contains(cand, ".gemini") {
									vClean := strings.ReplaceAll(cand, `\`, `/`)
									vDir := filepath.Dir(vClean)
									if vDir != "" && vDir != "." && isDirectoryPath(vDir) {
										workspacePath = vDir
										break
									}
								}
							}
						}
					}
					if workspacePath != "" {
						break
					}
				}
			}

			// 3. Titre depuis USER_INPUT (uniquement si aucun titre officiel ou valide n'a encore été assigné)
			if !hasOfficialTitle && title == "" && entry.Type == "USER_INPUT" && entry.Content != "" {
				clean := extractUserRequest(entry.Content)
				if !strings.HasPrefix(clean, "<identity>") && !strings.HasPrefix(clean, "<user_information>") && clean != "" {
					cand := cleanPromptTitle(clean)
					if cand != "" && !isSubagentTitle(cand) {
						title = cand
					}
				}
			}
		}

		if title != "" && workspacePath != "" && lineCount >= 10 {
			break
		}
		if lineCount > 150 {
			break
		}
	}

	if title == "" {
		title = cascadeID
	}
	return title, workspacePath, modTime
}

func extractWorkspace(root, cascadeID string) string {
	metaPath := filepath.Join(root, cascadeID, "metadata.json")
	if data, err := os.ReadFile(metaPath); err == nil {
		var meta struct {
			Workspace     string `json:"workspace"`
			WorkspacePath string `json:"workspace_path"`
			CorpusName    string `json:"corpus_name"`
		}
		if err := json.Unmarshal(data, &meta); err == nil {
			if meta.Workspace != "" {
				return meta.Workspace
			}
			if meta.WorkspacePath != "" {
				return meta.WorkspacePath
			}
			if meta.CorpusName != "" {
				return meta.CorpusName
			}
		}
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "antigravity-workspace"
}

func isDirectoryPath(p string) bool {
	p = strings.TrimSpace(p)
	if len(p) < 3 {
		return false
	}
	if (p[0] >= 'a' && p[0] <= 'z' || p[0] >= 'A' && p[0] <= 'Z') && p[1] == ':' && (p[2] == '\\' || p[2] == '/') {
		return true
	}
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, "file:///") {
		return true
	}
	return false
}

func parseWorkspaceFromTranscript(content string) string {
	if start := strings.Index(content, "<user_information>"); start != -1 {
		end := strings.Index(content, "</user_information>")
		if end > start {
			block := content[start+len("<user_information>") : end]
			for _, l := range strings.Split(block, "\n") {
				l = strings.TrimSpace(l)
				if idx := strings.Index(l, " -> "); idx > 0 {
					cand := strings.TrimSpace(l[:idx])
					cand = strings.Trim(cand, "[]\"'`")
					if isDirectoryPath(cand) {
						return cand
					}
				}
			}
		}
	}

	lines := strings.Split(content, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if idx := strings.Index(l, " -> "); idx > 0 {
			cand := strings.TrimSpace(l[:idx])
			cand = strings.Trim(cand, "[]\"'`")
			if isDirectoryPath(cand) {
				return cand
			}
		}
		if strings.HasPrefix(l, "Workspace:") || strings.HasPrefix(l, "Workspace Path:") {
			parts := strings.SplitN(l, ":", 2)
			if len(parts) == 2 {
				cand := strings.TrimSpace(parts[1])
				cand = strings.Trim(cand, "[]\"'`")
				if isDirectoryPath(cand) {
					return cand
				}
			}
		}
	}
	return ""
}

// transcriptEntry mirrors the JSONL shape written by the Antigravity brain.
// PLANNER_RESPONSE entries store the assistant's visible answer in `content`
// (final messages) OR in `thinking` (intermediate reasoning when the model
// continued with tool calls ÔÇö `content` is then absent).
type transcriptEntry struct {
	StepIndex int             `json:"step_index"`
	Source    string          `json:"source"`
	Type      string          `json:"type"`
	CreatedAt string          `json:"created_at"`
	Content   string          `json:"content"`
	Thinking  string          `json:"thinking"`
	Status    string          `json:"status"`
	Error     string          `json:"error"`
	ToolCalls json.RawMessage `json:"tool_calls"`
}

func formatExtTag(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".ts", ".tsx":
		return "TS"
	case ".js", ".jsx":
		return "JS"
	case ".dart":
		return "Dart"
	case ".go":
		return "Go"
	case ".py":
		return "Py"
	case ".ps1", ".bat", ".sh", ".cmd":
		return ">_"
	case ".json":
		return "JSON"
	case ".md":
		return "MD"
	case ".html", ".htm":
		return "HTML"
	case ".css", ".scss":
		return "CSS"
	default:
		return ""
	}
}

func formatWorkedDuration(start, end time.Time) string {
	if start.IsZero() || end.IsZero() || end.Before(start) {
		return "Worked for 12s"
	}
	d := end.Sub(start)
	if d < 5*time.Second {
		return "Worked for 5s"
	}
	if d < time.Minute {
		return fmt.Sprintf("Worked for %ds", int(d.Seconds()))
	}
	mins := int(d.Minutes())
	secs := int(d.Seconds()) % 60
	if secs == 0 {
		return fmt.Sprintf("Worked for %dm", mins)
	}
	return fmt.Sprintf("Worked for %dm %ds", mins, secs)
}

func formatExploredHeader(files map[string]bool, searches int) string {
	numFiles := len(files)
	if numFiles == 0 && searches == 0 {
		return ""
	}
	var parts []string
	if numFiles > 0 {
		fileLabel := "files"
		if numFiles == 1 {
			fileLabel = "file"
		}
		parts = append(parts, fmt.Sprintf("%d %s", numFiles, fileLabel))
	}
	if searches > 0 {
		searchLabel := "searches"
		if searches == 1 {
			searchLabel = "search"
		}
		parts = append(parts, fmt.Sprintf("%d %s", searches, searchLabel))
	}
	return "Explored " + strings.Join(parts, ", ")
}

func countGrepResults(content string) int {
	if strings.TrimSpace(content) == "" {
		return 0
	}
	if idx := strings.Index(content, "Found "); idx >= 0 {
		var n int
		if _, err := fmt.Sscanf(content[idx:], "Found %d results", &n); err == nil && n > 0 {
			return n
		}
	}
	count := strings.Count(content, "\"LineNumber\"")
	if count == 0 {
		count = strings.Count(content, "\"File\"")
	}
	if count == 0 {
		count = strings.Count(content, "\n")
		if count > 10 {
			count = 10
		}
	}
	if count > 0 {
		return count
	}
	return 1
}

func extractConsoleSnippet(content string) string {
	lines := strings.Split(content, "\n")
	var kept []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if strings.HasPrefix(trimmed, "Created At:") || strings.HasPrefix(trimmed, "Completed At:") || strings.HasPrefix(trimmed, "The command exited with code") {
			continue
		}
		if trimmed != "" {
			kept = append(kept, l)
		}
		if len(kept) >= 15 {
			break
		}
	}
	return strings.Join(kept, "\n")
}

func formatToolCallStep(name string, argsRaw json.RawMessage) string {
	lowerName := strings.ToLower(name)
	if lowerName == "ask_question" || lowerName == "ask_user" {
		return ""
	}
	arg := extractCmdFromArgs(argsRaw)
	var argMap map[string]interface{}
	if len(argsRaw) > 0 {
		_ = json.Unmarshal(argsRaw, &argMap)
	}
	if arg == "" && argMap != nil {
		for _, k := range []string{"targetFile", "TargetFile", "filePath", "file_path", "path", "AbsolutePath", "DirectoryPath", "query", "Query", "pattern", "Pattern", "command", "CommandLine", "command_line", "Role", "role", "TypeName", "typeName", "description", "toolAction", "toolSummary"} {
			if v, ok := argMap[k]; ok {
				if s, okS := v.(string); okS && s != "" {
					arg = s
					break
				}
			}
		}
	}

	cleanBase := arg
	if !strings.Contains(lowerName, "run_command") && !strings.Contains(lowerName, "command") && !strings.Contains(lowerName, "bash") && !strings.Contains(lowerName, "terminal") {
		if strings.Contains(arg, "/") || strings.Contains(arg, "\\") {
			b := filepath.Base(arg)
			if b != "." && b != "" && b != "/" && b != "\\" {
				cleanBase = b
			}
		}
	}
	if len(cleanBase) > 80 {
		cleanBase = cleanBase[:77] + "…"
	}

	tag := formatExtTag(arg)
	tagPrefix := ""
	if tag != "" {
		tagPrefix = tag + " "
	}

	switch {
	case strings.Contains(lowerName, "run_command") || strings.Contains(lowerName, "command") || strings.Contains(lowerName, "terminal") || strings.Contains(lowerName, "bash"):
		if arg != "" {
			return "Ran " + arg
		}
		return "Ran command"

	case strings.Contains(lowerName, "write_to_file") || strings.Contains(lowerName, "replace_file_content") || strings.Contains(lowerName, "edit_file"):
		diffStr := "+1 -0"
		if argMap != nil {
			added := 1
			deleted := 0
			if tc, ok := argMap["TargetContent"].(string); ok && tc != "" {
				deleted = len(strings.Split(tc, "\n"))
			}
			if rc, ok := argMap["ReplacementContent"].(string); ok && rc != "" {
				added = len(strings.Split(rc, "\n"))
			} else if cc, ok := argMap["CodeContent"].(string); ok && cc != "" {
				added = len(strings.Split(cc, "\n"))
			}
			diffStr = fmt.Sprintf("+%d -%d", added, deleted)
		}
		if cleanBase != "" {
			return fmt.Sprintf("Edited %s%s %s", tagPrefix, cleanBase, diffStr)
		}
		return "Edited file"

	case strings.Contains(lowerName, "view_file") || strings.Contains(lowerName, "read_file"):
		lineRange := ""
		if argMap != nil {
			sLine, hasS := argMap["StartLine"]
			if !hasS {
				sLine, hasS = argMap["start_line"]
			}
			eLine, hasE := argMap["EndLine"]
			if !hasE {
				eLine, hasE = argMap["end_line"]
			}
			if hasS && hasE {
				lineRange = fmt.Sprintf(" #L%v-%v", sLine, eLine)
			} else if hasS {
				lineRange = fmt.Sprintf(" #L%v", sLine)
			}
		}
		if cleanBase != "" {
			return fmt.Sprintf("Analyzed %s%s%s", tagPrefix, cleanBase, lineRange)
		}
		return "Analyzed file"

	case strings.Contains(lowerName, "grep") || strings.Contains(lowerName, "grep_search"):
		if arg != "" {
			return "Searched " + arg
		}
		return "Searched codebase"

	case strings.Contains(lowerName, "find_by_name") || strings.Contains(lowerName, "search"):
		if arg != "" {
			return "Searched " + arg
		}
		return "Searched codebase"

	case strings.Contains(lowerName, "list_dir") || strings.Contains(lowerName, "list_files"):
		if cleanBase != "" {
			return "Explored " + cleanBase
		}
		return "Explored directory"

	case strings.Contains(lowerName, "invoke_subagent") || strings.Contains(lowerName, "define_subagent") || strings.Contains(lowerName, "subagent"):
		subName := cleanBase
		if argMap != nil {
			if role, ok := argMap["Role"].(string); ok && role != "" {
				subName = role
			} else if tn, ok := argMap["TypeName"].(string); ok && tn != "" {
				subName = tn
			}
		}
		if subName != "" {
			return "Subagent " + subName
		}
		return "Spawned subagent"

	case strings.Contains(lowerName, "manage_task") || strings.Contains(lowerName, "task"):
		if argMap != nil {
			if taskId, ok := argMap["TaskId"].(string); ok && taskId != "" {
				cleanId := taskId
				if idx := strings.LastIndex(cleanId, "/"); idx >= 0 {
					cleanId = cleanId[idx+1:]
				}
				cleanId = strings.TrimPrefix(cleanId, "task-")
				action, _ := argMap["Action"].(string)
				if action == "status" || action == "list" || action == "" {
					return fmt.Sprintf("Task %s finished", cleanId)
				}
				return fmt.Sprintf("Task %s %s", cleanId, action)
			}
		}
		if cleanBase != "" {
			return "Task " + cleanBase
		}
		return "Task finished"

	case strings.Contains(lowerName, "send_message"):
		if cleanBase != "" {
			return "Sent to " + cleanBase
		}
		return "Sent message"

	case strings.Contains(lowerName, "generate_image"):
		if cleanBase != "" {
			return "Generated " + cleanBase
		}
		return "Generated image"

	case strings.Contains(lowerName, "schedule") || strings.Contains(lowerName, "timer"):
		if argMap != nil {
			durationSec := 0
			for _, k := range []string{"DurationSeconds", "duration_seconds", "durationSeconds"} {
				if v, ok := argMap[k]; ok {
					if num, okNum := v.(float64); okNum {
						durationSec = int(num)
						break
					}
				}
			}
			prompt := ""
			for _, k := range []string{"Prompt", "prompt"} {
				if v, ok := argMap[k]; ok {
					if s, okS := v.(string); okS {
						prompt = s
						break
					}
				}
			}
			if durationSec > 0 {
				if prompt != "" {
					return fmt.Sprintf("Timed %d seconds\n> %s\nStatus: Fired", durationSec, prompt)
				}
				return fmt.Sprintf("Timed %d seconds", durationSec)
			}
			if prompt != "" {
				return fmt.Sprintf("Scheduled %s", prompt)
			}
		}
		if cleanBase != "" {
			return "Scheduled " + cleanBase
		}
		return "Scheduled task"

	case strings.Contains(lowerName, "auto_proceed") || strings.Contains(lowerName, "autoproceed"):
		if cleanBase != "" {
			return "Auto-proceeded with " + cleanBase
		}
		return "Auto-proceeded with Implementation Plan"

	case strings.Contains(lowerName, "browse") || strings.Contains(lowerName, "read_url"):
		if cleanBase != "" {
			return "Browsed " + cleanBase
		}
		return "Browsed web"

	default:
		cleanTool := strings.ReplaceAll(name, "_", " ")
		if cleanBase != "" {
			return fmt.Sprintf("Task %s (%s)", cleanTool, cleanBase)
		}
		return "Task " + cleanTool
	}
}

func parseTranscriptFullTurns(transcriptPath string) ([]HistoryMessage, error) {
	f, err := os.Open(transcriptPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []HistoryMessage
	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	var currentTurnUser *HistoryMessage
	var currentTurnSegments []HistorySegment
	var currentTurnSteps []string
	var currentTurnAnswers []string
	var currentTurnStart time.Time
	var currentTurnEnd time.Time
	var currentTurnLastIdx int
	var currentTurnHasError bool
	turnFilesExplored := make(map[string]bool)
	turnFilesChangedMap := make(map[string]struct{ add, del int })
	turnSearchesCount := 0
	lastSearchIdx := -1
	lastCmdIdx := -1

	flushAssistantTurn := func() {
		if currentTurnUser == nil && len(currentTurnSteps) == 0 && len(currentTurnSegments) == 0 && len(currentTurnAnswers) == 0 {
			return
		}
		if len(currentTurnSteps) == 0 && len(currentTurnSegments) == 0 && len(currentTurnAnswers) == 0 {
			return
		}

		durStr := formatWorkedDuration(currentTurnStart, currentTurnEnd)
		exploredStr := formatExploredHeader(turnFilesExplored, turnSearchesCount)

		var allThoughtLines []string
		if durStr != "" && (len(currentTurnSteps) > 0 || len(currentTurnSegments) > 0 || len(currentTurnAnswers) > 0) {
			allThoughtLines = append(allThoughtLines, durStr)
		}
		if exploredStr != "" {
			allThoughtLines = append(allThoughtLines, exploredStr)
		}

		// Flush trailing steps to segments if any
		if len(currentTurnSteps) > 0 {
			currentTurnSegments = append(currentTurnSegments, HistorySegment{
				Type:    "thought",
				Content: strings.Join(currentTurnSteps, "\n"),
			})
			allThoughtLines = append(allThoughtLines, currentTurnSteps...)
			currentTurnSteps = nil
		}

		// Prepend duration and exploration headers to the very first thought segment if present
		if len(currentTurnSegments) > 0 && durStr != "" {
			if currentTurnSegments[0].Type == "thought" {
				if !strings.HasPrefix(currentTurnSegments[0].Content, "Worked for") &&
					!strings.HasPrefix(currentTurnSegments[0].Content, "Thought for") {
					var headerParts []string
					headerParts = append(headerParts, durStr)
					if exploredStr != "" {
						headerParts = append(headerParts, exploredStr)
					}
					headerParts = append(headerParts, currentTurnSegments[0].Content)
					currentTurnSegments[0].Content = strings.Join(headerParts, "\n")
				}
			}
		}

		fullThought := strings.Join(allThoughtLines, "\n")
		fullText := strings.Join(currentTurnAnswers, "\n\n")

		msgID := fmt.Sprintf("h-%d", currentTurnLastIdx)
		if currentTurnLastIdx == 0 && currentTurnUser != nil {
			msgID = currentTurnUser.ID + "-resp"
		}
		ts := "00:00"
		if !currentTurnEnd.IsZero() {
			ts = fmt.Sprintf("%02d:%02d", currentTurnEnd.Hour(), currentTurnEnd.Minute())
		} else if currentTurnUser != nil {
			ts = currentTurnUser.Timestamp
		}

		var turnFiles []string
		var totalAdd, totalDel int
		for fp, diff := range turnFilesChangedMap {
			turnFiles = append(turnFiles, fp)
			totalAdd += diff.add
			totalDel += diff.del
		}
		sort.Strings(turnFiles)

		messages = append(messages, HistoryMessage{
			ID:           msgID,
			Sender:       "assistant",
			Text:         strings.TrimSpace(fullText),
			Thought:      strings.TrimSpace(fullThought),
			Segments:     currentTurnSegments,
			Timestamp:    ts,
			IsError:      currentTurnHasError,
			FilesChanged: turnFiles,
			Additions:    totalAdd,
			Deletions:    totalDel,
		})

		currentTurnSegments = nil
		currentTurnSteps = nil
		currentTurnAnswers = nil
		currentTurnHasError = false
		turnFilesExplored = make(map[string]bool)
		turnFilesChangedMap = make(map[string]struct{ add, del int })
		turnSearchesCount = 0
		lastSearchIdx = -1
		lastCmdIdx = -1
	}

	for scanner.Scan() {
		lineBytes := scanner.Bytes()
		if len(lineBytes) == 0 {
			continue
		}
		var entry transcriptEntry
		if err := json.Unmarshal(lineBytes, &entry); err != nil {
			continue
		}

		entryTime, _ := time.Parse(time.RFC3339, entry.CreatedAt)
		if !entryTime.IsZero() {
			currentTurnEnd = entryTime
		}
		if entry.StepIndex > 0 {
			currentTurnLastIdx = entry.StepIndex
		}

		if entry.Type == "USER_INPUT" {
			flushAssistantTurn()
			cleaned := extractUserRequest(entry.Content)
			if cleaned != "" {
				ts := "00:00"
				if !entryTime.IsZero() {
					ts = fmt.Sprintf("%02d:%02d", entryTime.Hour(), entryTime.Minute())
				}
				userMsg := HistoryMessage{
					ID:        fmt.Sprintf("h-%d", entry.StepIndex),
					Sender:    "user",
					Text:      cleaned,
					Timestamp: ts,
					StepIndex: int64(entry.StepIndex),
				}
				messages = append(messages, userMsg)
				currentTurnUser = &userMsg
				currentTurnStart = entryTime
				currentTurnEnd = entryTime
				currentTurnLastIdx = entry.StepIndex
			}
			continue
		}

		if entry.Type == "CHECKPOINT" || entry.Type == "CONVERSATION_HISTORY" {
			continue
		}

		// Tool result matching
		if entry.Type == "GREP_SEARCH" || entry.Type == "FIND_BY_NAME" {
			count := countGrepResults(entry.Content)
			if lastSearchIdx >= 0 && lastSearchIdx < len(currentTurnSteps) {
				resLabel := fmt.Sprintf("%d results", count)
				if count == 1 {
					resLabel = "1 result"
				}
				if !strings.Contains(currentTurnSteps[lastSearchIdx], "result") {
					currentTurnSteps[lastSearchIdx] = currentTurnSteps[lastSearchIdx] + " " + resLabel
				}
				lastSearchIdx = -1
			}
			continue
		}

		if entry.Type == "RUN_COMMAND" {
			snippet := extractConsoleSnippet(entry.Content)
			if snippet != "" && lastCmdIdx >= 0 && lastCmdIdx < len(currentTurnSteps) {
				cmdTitle := strings.TrimPrefix(currentTurnSteps[lastCmdIdx], "Ran ")
				consoleBlock := fmt.Sprintf("```console\n... > %s\n%s\n```", cmdTitle, snippet)
				currentTurnSteps = append(currentTurnSteps, consoleBlock)
				lastCmdIdx = -1
			}
			continue
		}

		// 1. Thinking
		if entry.Thinking != "" {
			thoughtClean := cleanRawContent(entry.Thinking)
			if thoughtClean != "" {
				currentTurnSteps = append(currentTurnSteps, "Thought for 7s", thoughtClean)
			}
		}

		// 2. Assistant text / narrative
		if entry.Type == "PLANNER_RESPONSE" {
			if entry.Error != "" {
				currentTurnHasError = true
			}
			if entry.Content != "" {
				cleaned := cleanAssistantText(entry.Content)
				if cleaned != "" {
					if len(currentTurnSteps) > 0 {
						currentTurnSegments = append(currentTurnSegments, HistorySegment{
							Type:    "thought",
							Content: strings.Join(currentTurnSteps, "\n"),
						})
						currentTurnSteps = nil
					}
					currentTurnSegments = append(currentTurnSegments, HistorySegment{
						Type:    "text",
						Content: cleaned,
					})
					currentTurnAnswers = append(currentTurnAnswers, cleaned)
				}
			}
		}

		// 3. Tool Calls
		if len(entry.ToolCalls) > 0 {
			var toolCalls []struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"args"`
				Function  struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"function"`
			}
			if json.Unmarshal(entry.ToolCalls, &toolCalls) == nil {
				for _, tc := range toolCalls {
					name := tc.Name
					if name == "" {
						name = tc.Function.Name
					}
					args := tc.Arguments
					if len(args) == 0 {
						args = tc.Function.Arguments
					}
					if name == "" || name == "ask_question" || name == "ask_user" {
						continue
					}
					lower := strings.ToLower(name)
					if strings.Contains(lower, "grep") || strings.Contains(lower, "find_by_name") || strings.Contains(lower, "search") {
						turnSearchesCount++
					}
					var argMap map[string]interface{}
					if len(args) > 0 {
						_ = json.Unmarshal(args, &argMap)
					}
					if argMap != nil {
						for _, k := range []string{"targetFile", "TargetFile", "filePath", "file_path", "AbsolutePath"} {
							if fv, ok := argMap[k].(string); ok && fv != "" {
								turnFilesExplored[filepath.Base(fv)] = true
							}
						}

						// Détection des fichiers modifiés lors de ce tour spécifique
						isEditTool := strings.Contains(lower, "write_to_file") ||
							strings.Contains(lower, "replace_file_content") ||
							strings.Contains(lower, "multi_replace_file_content") ||
							strings.Contains(lower, "edit_file") ||
							strings.Contains(lower, "modify_file") ||
							strings.Contains(lower, "create_file")

						if isEditTool {
							for _, k := range []string{"targetFile", "TargetFile", "filePath", "file_path", "AbsolutePath", "path"} {
								if fv, ok := argMap[k].(string); ok && fv != "" {
									cleanP := filepath.Clean(fv)
									cleanP = strings.ReplaceAll(cleanP, `\`, `/`)
									addCount := 1
									delCount := 0
									if repl, ok := argMap["ReplacementContent"].(string); ok && repl != "" {
										addCount = len(strings.Split(repl, "\n"))
									}
									if targ, ok := argMap["TargetContent"].(string); ok && targ != "" {
										delCount = len(strings.Split(targ, "\n"))
									}
									prevDiff := turnFilesChangedMap[cleanP]
									turnFilesChangedMap[cleanP] = struct{ add, del int }{
										add: prevDiff.add + addCount,
										del: prevDiff.del + delCount,
									}
									break
								}
							}
						}
					}
					stepStr := formatToolCallStep(name, args)
					if stepStr != "" {
						currentTurnSteps = append(currentTurnSteps, stepStr)
						if strings.HasPrefix(stepStr, "Searched ") {
							lastSearchIdx = len(currentTurnSteps) - 1
						} else if strings.HasPrefix(stepStr, "Ran ") {
							lastCmdIdx = len(currentTurnSteps) - 1
						}
					}
				}
			}
		}
	}

	flushAssistantTurn()

	if err := scanner.Err(); err != nil {
		logJSON.Error("scan_transcript_error", "err", err)
	}

	return messages, nil
}

func formatToolCallsForThought(toolCallsRaw json.RawMessage) string {
	if len(toolCallsRaw) == 0 {
		return ""
	}
	var toolCalls []struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"args"`
		Function  struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"function"`
	}
	if err := json.Unmarshal(toolCallsRaw, &toolCalls); err != nil {
		return ""
	}
	var steps []string
	for _, tc := range toolCalls {
		name := tc.Name
		if name == "" {
			name = tc.Function.Name
		}
		args := tc.Arguments
		if len(args) == 0 {
			args = tc.Function.Arguments
		}
		if step := formatToolCallStep(name, args); step != "" {
			steps = append(steps, step)
		}
	}
	return strings.Join(steps, "\n")
}

// parseTranscriptLine converts one JSONL line into a HistoryMessage, or
// returns nil for lines that should not appear in the mobile chat.
func parseTranscriptLine(line []byte) *HistoryMessage {
	var entry transcriptEntry
	if err := json.Unmarshal(line, &entry); err != nil {
		return nil
	}

	ts := "00:00"
	if t, err := time.Parse(time.RFC3339, entry.CreatedAt); err == nil {
		ts = fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
	}
	msgID := fmt.Sprintf("h-%d", entry.StepIndex)

	if entry.Type == "USER_INPUT" {
		cleaned := extractUserRequest(entry.Content)
		if cleaned == "" {
			return nil
		}
		return &HistoryMessage{
			ID:        msgID,
			Sender:    "user",
			Text:      cleaned,
			Timestamp: ts,
		}
	}

	if entry.Type == "TOOL_CALL" || entry.Type == "TOOL_RESULT" || entry.Source == "TOOL" {
		return nil // events d'outils bruts : gérés via PLANNER_RESPONSE ou agrégation
	}

	// Réponse visible du modèle : PLANNER_RESPONSE place la réponse finale
	// dans `content`, et le raisonnement intermédiaire (quand le modèle a
	// enchaîné des appels d'outils) dans `thinking` — `content` est alors
	// absent. Les lignes vides (modèle n'a produit ni texte ni raisonnement,
	// ex. enchaînement d'outils purs) sont ignorées pour ne pas polluer le chat.
	if entry.Type == "PLANNER_RESPONSE" {
		text := cleanAssistantText(entry.Content)
		thought := cleanRawContent(entry.Thinking)
		toolSteps := formatToolCallsForThought(entry.ToolCalls)
		if toolSteps != "" {
			if thought != "" {
				thought = thought + "\n" + toolSteps
			} else {
				thought = toolSteps
			}
		}
		if text == "" && thought == "" {
			return nil
		}
		msg := &HistoryMessage{
			ID:        msgID,
			Sender:    "assistant",
			Text:      text,
			Thought:   thought,
			Timestamp: ts,
		}
		if entry.Error != "" && msg.Text == "" {
			msg.IsError = true
			msg.Text = entry.Error
		}
		return msg
	}

	return nil
}

// findHistoryDB locate la base SQLite des conversations (source de v├®rit├®
// Antigravity 2.0) pour une cascade donn├®e.
func findHistoryDB(cascadeID string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(home, ".gemini", "antigravity", "conversations", cascadeID+".db"),
		filepath.Join(home, ".gemini", "antigravity-ide", "conversations", cascadeID+".db"),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// findFieldBytes retourne le sous-message (wire type 2) du champ fieldNum,
// ou nil s'il est absent. Impl├®mentation manuelle du protobuf (pas de
// biblioth├¿que ÔÇö r├¿gle AGENTS.md).
func findFieldBytes(buf []byte, fieldNum int) []byte {
	if len(buf) == 0 {
		return nil
	}
	i := 0
	for i < len(buf) {
		key, n := readUvarint(buf, i)
		if n == 0 {
			break
		}
		i = n
		f := int(key >> 3)
		w := int(key & 7)
		if f == 0 {
			break
		}
		if w == 0 {
			_, n = readUvarint(buf, i)
			if n == 0 {
				break
			}
			i = n
		} else if w == 2 {
			ln, n := readUvarint(buf, i)
			if n == 0 || n+int(ln) > len(buf) {
				break
			}
			sub := buf[n : n+int(ln)]
			i = n + int(ln)
			if f == fieldNum {
				return sub
			}
		} else if w == 1 {
			i += 8
		} else if w == 5 {
			i += 4
		} else {
			break
		}
	}
	return nil
}

// readUvarint d├®code un varint protobuf. Retourne (valeur, newOffset) ou
// (0, 0) si le buffer est tronqu├®.
func readUvarint(buf []byte, offset int) (uint64, int) {
	var result uint64
	var shift uint
	for offset < len(buf) {
		b := buf[offset]
		offset++
		result |= uint64(b&0x7f) << shift
		if b&0x80 == 0 {
			return result, offset
		}
		shift += 7
		if shift > 63 {
			return 0, 0
		}
	}
	return 0, 0
}

// collectSubFields r├®cup├¿re toutes les occurrences d'un champ r├®p├®t├® (wire
// type 2) dans un message ÔÇö ex. les pi├¿ces de texte d'un message utilisateur.
func collectSubFields(buf []byte, fieldNum int) [][]byte {
	var out [][]byte
	if len(buf) == 0 {
		return out
	}
	i := 0
	for i < len(buf) {
		key, n := readUvarint(buf, i)
		if n == 0 {
			break
		}
		i = n
		f := int(key >> 3)
		w := int(key & 7)
		if f == 0 {
			break
		}
		if w == 0 {
			_, n = readUvarint(buf, i)
			if n == 0 {
				break
			}
			i = n
		} else if w == 2 {
			ln, n := readUvarint(buf, i)
			if n == 0 || n+int(ln) > len(buf) {
				break
			}
			sub := buf[n : n+int(ln)]
			i = n + int(ln)
			if f == fieldNum {
				out = append(out, sub)
			}
		} else if w == 1 {
			i += 8
		} else if w == 5 {
			i += 4
		} else {
			break
		}
	}
	return out
}

// printableString convertit des octets protobuf en cha├«ne UTF-8 si le contenu
// est lisible (texte visible), sinon renvoie "".
func printableString(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	s := string(b)
	for _, r := range s {
		if r < 0x20 && r != '\n' && r != '\t' && r != '\r' {
			return ""
		}
	}
	return s
}

// userTextFromPayload extrait le texte d'un step_payload de type 14
// (message utilisateur). Layout valid├® sur 500+ conversations :
//   - f19.f3[] : liste de pi├¿ces (chaque pi├¿ce porte le texte dans f3.f1)
//   - f19.f2   : texte brut (avec ├®ventuels attributs @[fichier])
//   - f5       : ancien format (f5.f1.f2 = timestamp, texte dans f5.f2)
//   - repli    : premier sous-message avec du texte lisible
func userTextFromPayload(sp []byte) string {
	if f19 := findFieldBytes(sp, 19); f19 != nil {
		parts := collectSubFields(f19, 3)
		var sb strings.Builder
		for _, p := range parts {
			if t := printableString(findFieldBytes(p, 1)); t != "" {
				sb.WriteString(t)
			}
		}
		if sb.Len() > 0 {
			return sb.String()
		}
		if t := printableString(findFieldBytes(f19, 2)); t != "" {
			return t
		}
	}
	if f5 := findFieldBytes(sp, 5); f5 != nil {
		if t := printableString(findFieldBytes(f5, 2)); t != "" {
			return t
		}
	}
	// Repli : premier champ de type cha├«ne lisible (garde le texte des
	// anciennes versions du sch├®ma).
	return firstPrintable(sp)
}

// assistantTextFromPayload extrait le texte (f1/f8) et le raisonnement (f3)
// d'un step_payload de type 15. Layout valid├® sur la base moderne (763
// enregistrements) :
//   - f20 { f1/f8: texte, f3: raisonnement, f6: botId, f7: toolCalls }
//   - certaines ├®tapes ne portent que f6+f7 (appels d'outils, pas de texte)
//   - anciens formats : f20 { f1: texte } ou texte ailleurs ÔåÆ repli
func assistantTextFromPayload(sp []byte) (text, thought string) {
	for _, f20 := range collectSubFields(sp, 20) {
		f1 := printableString(findFieldBytes(f20, 1))
		f8 := printableString(findFieldBytes(f20, 8))
		f3 := printableString(findFieldBytes(f20, 3))
		// f8 porte le texte complet dans le layout moderne ; f1 est l'├®quivalent
		// historique. On garde le plus long (f8 gagne en cas d'├®galit├®).
		if len(f8) >= len(f1) {
			text = f8
		} else {
			text = f1
		}
		if text != "" {
			if f3 != "" && f3 != text {
				thought = f3
			}
			return text, thought
		}
	}
	if text == "" {
		text = firstPrintable(sp)
	}
	return text, thought
}

// titleFromPayload extrait le titre d'un step_payload de type 23 (f30.f4).
func titleFromPayload(sp []byte) string {
	if f30 := findFieldBytes(sp, 30); f30 != nil {
		if t := printableString(findFieldBytes(f30, 4)); t != "" {
			return t
		}
	}
	return ""
}

// firstPrintable retourne le premier sous-message de niveau 1 lisible
// (heuristique de repli pour les formats inconnus).
func firstPrintable(buf []byte) string {
	if len(buf) == 0 {
		return ""
	}
	i := 0
	for i < len(buf) {
		key, n := readUvarint(buf, i)
		if n == 0 {
			break
		}
		i = n
		f := int(key >> 3)
		w := int(key & 7)
		if f == 0 {
			break
		}
		if w == 0 {
			_, n = readUvarint(buf, i)
			if n == 0 {
				break
			}
			i = n
		} else if w == 2 {
			ln, n := readUvarint(buf, i)
			if n == 0 || n+int(ln) > len(buf) {
				break
			}
			sub := buf[n : n+int(ln)]
			i = n + int(ln)
			if t := printableString(sub); t != "" {
				return t
			}
		} else if w == 1 {
			i += 8
		} else if w == 5 {
			i += 4
		} else {
			break
		}
	}
	return ""
}

// tsFromMetadata convertit le timestamp protobuf (metadata.f1 : {1: secondes,
// 2: nanos}) en horaire HH:MM local. Repli : heure actuelle.
func tsFromMetadata(meta []byte) string {
	var sec int64
	if f1 := findFieldBytes(meta, 1); f1 != nil {
		i := 0
		for i < len(f1) {
			key, n := readUvarint(f1, i)
			if n == 0 {
				break
			}
			i = n
			if f := int(key >> 3); f == 1 && key&7 == 0 {
				if v, n := readUvarint(f1, i); n != 0 {
					sec = int64(v)
				}
				break
			}
			if key&7 == 2 {
				ln, n := readUvarint(f1, i)
				if n == 0 || n+int(ln) > len(f1) {
					break
				}
				i = n + int(ln)
			} else {
				break
			}
		}
	}
	t := time.Unix(sec, 0).Local()
	return fmt.Sprintf("%02d:%02d", t.Hour(), t.Minute())
}

// readSQLiteSteps lit l'historique depuis la table `steps` de la base de
// conversations. Retourne les messages tri├®s par idx, et les titres trouv├®s
// dans les ├®tapes de type 23.
func readSQLiteSteps(dbPath, cascadeID string) ([]HistoryMessage, string, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, "", err
	}
	defer db.Close()

	rows, err := db.Query("SELECT idx, step_type, status, metadata, step_payload FROM steps ORDER BY idx")
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var messages []HistoryMessage
	title := ""
	for rows.Next() {
		var (
			idx      int
			stepType int
			status   int
			metadata []byte
			payload  []byte
		)
		if err := rows.Scan(&idx, &stepType, &status, &metadata, &payload); err != nil {
			continue
		}

		ts := tsFromMetadata(metadata)
		msgID := fmt.Sprintf("h-%d", idx)

		switch stepType {
		case stepTypeUser:
			text := extractUserRequest(userTextFromPayload(payload))
			if text == "" {
				continue
			}
			messages = append(messages, HistoryMessage{
				ID:        msgID,
				Sender:    "user",
				Text:      text,
				Timestamp: ts,
				StepIndex: int64(idx),
			})
		case stepTypeAssistant:
			text, thought := assistantTextFromPayload(payload)
			text = cleanAssistantText(text)
			thought = cleanRawContent(thought)
			if text == "" && thought == "" {
				continue
			}
			msg := HistoryMessage{
				ID:        msgID,
				Sender:    "assistant",
				Text:      text,
				Thought:   thought,
				Timestamp: ts,
			}
			if status > 2 && text == "" {
				msg.IsError = true
				if msg.Text == "" {
					msg.Text = "Erreur pendant la génération"
				}
			}
			messages = append(messages, msg)
		case stepTypeTitle:
			if title == "" {
				title = titleFromPayload(payload)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return messages, title, err
	}
	if messages == nil {
		messages = []HistoryMessage{}
	}
	return messages, title, nil
}

// CoalesceHistoryMessages regroupe les étapes consécutives de l'assistant
// appartenant au même tour de réponse en un seul HistoryMessage unifié
// (fusion des pensées et concaténation propre du texte), évitant le
// découpage en bulles isolées sur mobile.
func CoalesceHistoryMessages(raw []HistoryMessage) []HistoryMessage {
	if len(raw) <= 1 {
		return raw
	}
	var out []HistoryMessage
	for _, m := range raw {
		if len(out) == 0 {
			out = append(out, m)
			continue
		}
		prev := &out[len(out)-1]
		if prev.Sender == "assistant" && m.Sender == "assistant" {
			// Fusion des pensées (Thought)
			mThought := strings.TrimSpace(m.Thought)
			if mThought != "" {
				if strings.TrimSpace(prev.Thought) == "" {
					prev.Thought = mThought
				} else if !strings.Contains(prev.Thought, mThought) {
					prev.Thought = strings.TrimSpace(prev.Thought) + "\n\n" + mThought
				}
			}
			// Fusion des textes
			mText := strings.TrimSpace(m.Text)
			if mText != "" {
				if strings.TrimSpace(prev.Text) == "" {
					prev.Text = mText
				} else if !strings.Contains(prev.Text, mText) {
					prev.Text = strings.TrimSpace(prev.Text) + "\n\n" + mText
				}
			}
			if m.IsError && strings.TrimSpace(prev.Text) == "" {
				prev.IsError = true
			}
			if m.Timestamp != "" {
				prev.Timestamp = m.Timestamp
			}
		} else {
			out = append(out, m)
		}
	}
	return out
}

// GetSessionHistory lit l'historique d'une cascade : transcript.jsonl d'abord
// (car il contient l'intégralité des étapes d'exécution détaillées : pensées,
// outils, arguments avec numéros de lignes et requêtes de recherche), puis
// repli sur SQLite (conversations/<id>.db).
func GetSessionHistory(cascadeID string) ([]HistoryMessage, error) {
	transcriptPath := findTranscriptPath(cascadeID)
	if transcriptPath != "" {
		if messages, err := parseTranscriptFullTurns(transcriptPath); err == nil && len(messages) > 0 {
			logJSON.Debug("history_from_transcript", "cascade", cascadeID, "messages", len(messages))
			return messages, nil
		}
	}

	if dbPath := findHistoryDB(cascadeID); dbPath != "" {
		if messages, _, err := readSQLiteSteps(dbPath, cascadeID); err == nil && len(messages) > 0 {
			logJSON.Debug("history_from_sqlite", "cascade", cascadeID, "messages", len(messages))
			return CoalesceHistoryMessages(messages), nil
		}
	}

	return []HistoryMessage{}, nil
}

// ExtractHistoryFromTrajectory extrait les messages d'un blob GetCascadeTrajectory.
func ExtractHistoryFromTrajectory(raw []byte) []HistoryMessage {
	var messages []HistoryMessage
	fields := connectrpc.DecodeFields(raw)
	for _, f := range fields {
		if f.Num == 1 && f.WireType == 2 {
			subFields := connectrpc.DecodeFields(f.Bytes)
			for _, sf := range subFields {
				if sf.Num == 3 && sf.WireType == 2 {
					turnFields := connectrpc.DecodeFields(sf.Bytes)
					for _, tf := range turnFields {
						if tf.Num == 1 && tf.WireType == 2 {
							stepFields := connectrpc.DecodeFields(tf.Bytes)
							for _, stf := range stepFields {
								if stf.Num == 19 && stf.WireType == 2 {
									for _, subPrompt := range connectrpc.DecodeFields(stf.Bytes) {
										if (subPrompt.Num == 1 || subPrompt.Num == 2) && subPrompt.WireType == 2 && len(subPrompt.Bytes) > 0 {
											promptText := string(subPrompt.Bytes)
											cleaned := extractUserRequest(promptText)
											if len(cleaned) > 0 && cleaned[0] >= 32 && !strings.HasPrefix(cleaned, "# Conversation History") {
												messages = append(messages, HistoryMessage{
													ID:        fmt.Sprintf("user-%d", len(messages)+1),
													Sender:    "user",
													Text:      cleaned,
													Timestamp: time.Now().Format("15:04"),
													StepIndex: int64(len(messages)),
												})
												break
											}
										}
									}
								}
								if stf.Num == 2 && stf.WireType == 2 {
									for _, subResp := range connectrpc.DecodeFields(stf.Bytes) {
										if subResp.Num == 3 && subResp.WireType == 2 && len(subResp.Bytes) > 0 {
											respText := string(subResp.Bytes)
											if strings.HasPrefix(respText, "<USER_REQUEST>") || strings.HasPrefix(respText, "# Conversation History") {
												continue
											}
											if len(respText) > 0 {
												messages = append(messages, HistoryMessage{
													ID:        fmt.Sprintf("assistant-%d", len(messages)+1),
													Sender:    "assistant",
													Text:      respText,
													Timestamp: time.Now().Format("15:04"),
												})
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
	return messages
}

// transcriptCounts regroupe les compteurs d'activit├® extraits d'un transcript.
type transcriptCounts struct {
	subagents int
	files     int
	artifacts int
	uploads   int
	tasks     int
}

// countTranscriptActivity parcourt le transcript.jsonl d'une cascade et
// compte les événements réels (subagents, fichiers modifiés, artefacts,
// uploads, tâches de fond). Chaque type d'événement est dédupliqué par ID
// (les appels d'outils produisent plusieurs lignes pour le même fichier).
// Source unique de vérité pour get_context.
func countTranscriptActivity(cascadeID string) map[string]int {
	out := map[string]int{
		"subagents": 0,
		"files":     0,
		"artifacts": 0,
		"uploads":   0,
		"tasks":     0,
	}
	modFiles := ListSessionModifiedFiles(cascadeID)
	out["files"] = len(modFiles)

	transcriptPath := findTranscriptPath(cascadeID)
	if transcriptPath == "" {
		return out
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return out
	}
	defer f.Close()

	seenArtifacts := make(map[string]bool)
	seenUploads := make(map[string]bool)
	seenTasks := make(map[string]bool)

	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	for scanner.Scan() {
		line := scanner.Bytes()
		var entry struct {
			Type      string          `json:"type"`
			Source    string          `json:"source"`
			Content   string          `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		// Subagents & Tasks : comptage depuis tool_calls ou entry.Content
		if len(entry.ToolCalls) > 0 {
			var calls []struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal(entry.ToolCalls, &calls) == nil {
				for _, c := range calls {
					if c.Name == "invoke_subagent" || c.Name == "define_subagent" {
						args := c.Args
						if args == nil {
							args = c.Arguments
						}
						subs := extractRawSubagentEntries(args)
						if len(subs) > 0 {
							out["subagents"] += len(subs)
						} else {
							out["subagents"]++
						}
					} else if c.Name == "manage_task" || c.Name == "schedule" {
						out["tasks"]++
					}
				}
			}
		}
		if entry.Type == "TOOL_CALL" || strings.Contains(entry.Content, "invoke_subagent") || strings.Contains(entry.Content, "manage_task") || strings.Contains(entry.Content, "schedule") {
			var tc struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal([]byte(entry.Content), &tc) == nil {
				if tc.Name == "invoke_subagent" || tc.Name == "define_subagent" {
					args := tc.Args
					if args == nil {
						args = tc.Arguments
					}
					subs := extractRawSubagentEntries(args)
					if len(subs) > 0 {
						out["subagents"] += len(subs)
					} else {
						out["subagents"]++
					}
				} else if tc.Name == "manage_task" || tc.Name == "schedule" {
					out["tasks"]++
				}
			}
		}

		// Artefacts / uploads
		for _, p := range filePathsIn(entry.Content) {
			switch {
			case isUploadPath(p):
				if !seenUploads[p] {
					seenUploads[p] = true
					out["uploads"]++
				}
			case strings.Contains(p, "artifact") || (strings.Contains(p, "brain/") || strings.Contains(p, "brain\\")) && strings.Contains(p, ".md"):
				if !seenArtifacts[p] {
					seenArtifacts[p] = true
					out["artifacts"]++
				}
			}
		}
		if strings.Contains(entry.Content, "Tool is running as a background task with task id:") ||
			strings.Contains(entry.Content, "running as a background task with task id") {
			key := entry.Content
			if !seenTasks[key] {
				seenTasks[key] = true
				out["tasks"]++
			}
		}
	}
	return out
}

// ListSessionModifiedFiles parcourt le transcript d'une cascade et extrait la liste
// des chemins de fichiers modifiés par l'agent ou l'utilisateur (write_to_file,
// replace_file_content, multi_replace_file_content, edit_file, apply_diff, etc.).
func ListSessionModifiedFiles(cascadeID string) []string {
	var results []string
	transcriptPath := findTranscriptPath(cascadeID)
	if transcriptPath == "" {
		return results
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return results
	}
	defer f.Close()

	seen := make(map[string]bool)
	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	isModTool := func(name string) bool {
		switch name {
		case "write_to_file", "replace_file_content", "multi_replace_file_content", "edit_file", "apply_diff", "patch":
			return true
		default:
			return false
		}
	}

	cleanFilePath := func(p string) string {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, "\"'`")
		p = strings.ReplaceAll(p, "\\\\", "/")
		p = strings.ReplaceAll(p, "\\", "/")
		if strings.HasPrefix(p, "file:///") {
			p = p[8:]
		} else if strings.HasPrefix(p, "file://") {
			p = p[7:]
		}
		return strings.TrimSpace(p)
	}

	isIgnoredPath := func(p string) bool {
		if p == "" {
			return true
		}
		pLower := strings.ToLower(p)
		if strings.Contains(pLower, "/brain/") || strings.Contains(pLower, "\\brain\\") || strings.Contains(pLower, "scratch") {
			return true
		}
		return false
	}

	addFile := func(rawPath string) {
		p := cleanFilePath(rawPath)
		if p != "" && !isIgnoredPath(p) && !seen[p] {
			seen[p] = true
			results = append(results, p)
		}
	}

	for scanner.Scan() {
		line := scanner.Bytes()
		var entry struct {
			Type      string          `json:"type"`
			Content   string          `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		// 1. Parsing depuis tool_calls (format standard Antigravity)
		if len(entry.ToolCalls) > 0 {
			var calls []struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal(entry.ToolCalls, &calls) == nil {
				for _, c := range calls {
					if isModTool(c.Name) {
						m := c.Args
						if len(m) == 0 {
							m = c.Arguments
						}
						for _, k := range []string{"TargetFile", "AbsolutePath", "file_path", "filePath", "path", "file"} {
							if val, ok := m[k].(string); ok && val != "" {
								addFile(val)
								break
							}
						}
					}
				}
			}
		}

		// 2. Parsing depuis entry.Content (si TOOL_CALL direct)
		if entry.Type == "TOOL_CALL" || strings.Contains(entry.Content, "replace_file_content") || strings.Contains(entry.Content, "write_to_file") {
			var tc struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal([]byte(entry.Content), &tc) == nil && isModTool(tc.Name) {
				m := tc.Args
				if len(m) == 0 {
					m = tc.Arguments
				}
				for _, k := range []string{"TargetFile", "AbsolutePath", "file_path", "filePath", "path", "file"} {
					if val, ok := m[k].(string); ok && val != "" {
						addFile(val)
						break
					}
				}
			}
		}
	}
	return results
}

// ExtractTranscriptFileDiffs parcourt le transcript d'une cascade et reconstitue
// les diffs unifiés et statistiques (additions/deletions) de chaque fichier modifié.
func ExtractTranscriptFileDiffs(cascadeID string) []map[string]interface{} {
	transcriptPath := findTranscriptPath(cascadeID)
	if transcriptPath == "" {
		return nil
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	diffMap := make(map[string]map[string]interface{})
	var orderedPaths []string

	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	cleanFilePath := func(p string) string {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, "\"'`")
		p = strings.ReplaceAll(p, "\\\\", "/")
		p = strings.ReplaceAll(p, "\\", "/")
		if strings.HasPrefix(p, "file:///") {
			p = p[8:]
		} else if strings.HasPrefix(p, "file://") {
			p = p[7:]
		}
		return strings.TrimSpace(p)
	}

	diffBlockRe := regexp.MustCompile(`(?s)\[diff_block_start\](.*?)\[diff_block_end\]`)

	for scanner.Scan() {
		line := scanner.Bytes()
		var entry struct {
			Type      string          `json:"type"`
			Content   string          `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		// 1. Parsing depuis tool_calls
		if len(entry.ToolCalls) > 0 {
			var calls []struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal(entry.ToolCalls, &calls) == nil {
				for _, c := range calls {
					m := c.Args
					if len(m) == 0 {
						m = c.Arguments
					}
					var targetFile string
					for _, k := range []string{"TargetFile", "AbsolutePath", "file_path", "filePath", "path", "file"} {
						if val, ok := m[k].(string); ok && val != "" {
							targetFile = cleanFilePath(val)
							break
						}
					}
					if targetFile == "" || strings.Contains(strings.ToLower(targetFile), "/brain/") {
						continue
					}

					var orig, mod, unifiedDiff string
					var adds, dels int64

					if c.Name == "replace_file_content" || c.Name == "edit_file" {
						if target, ok := m["TargetContent"].(string); ok {
							orig = target
						}
						if rep, ok := m["ReplacementContent"].(string); ok {
							mod = rep
						}
					} else if c.Name == "write_to_file" || c.Name == "create_file" {
						if code, ok := m["CodeContent"].(string); ok {
							mod = code
						}
					}

					if diffMap[targetFile] == nil {
						orderedPaths = append(orderedPaths, targetFile)
						diffMap[targetFile] = map[string]interface{}{
							"path": targetFile,
							"diff": map[string]interface{}{
								"originalContents": orig,
								"modifiedContents": mod,
								"additions":        adds,
								"deletions":        dels,
								"isArtifactFile":   false,
							},
							"unifiedDiff": unifiedDiff,
						}
					} else {
						existing := diffMap[targetFile]["diff"].(map[string]interface{})
						if orig != "" {
							existing["originalContents"] = existing["originalContents"].(string) + "\n" + orig
						}
						if mod != "" {
							existing["modifiedContents"] = existing["modifiedContents"].(string) + "\n" + mod
						}
					}
				}
			}
		}

		// 2. Extraire [diff_block_start]...[diff_block_end] depuis les contenus / TOOL_RESULT
		if strings.Contains(entry.Content, "[diff_block_start]") {
			matches := diffBlockRe.FindAllStringSubmatch(entry.Content, -1)
			for _, match := range matches {
				if len(match) > 1 {
					block := strings.TrimSpace(match[1])
					for _, p := range orderedPaths {
						if existing, ok := diffMap[p]; ok {
							existing["unifiedDiff"] = block
							for _, l := range strings.Split(block, "\n") {
								if strings.HasPrefix(l, "+") && !strings.HasPrefix(l, "+++") {
									d := existing["diff"].(map[string]interface{})
									d["additions"] = d["additions"].(int64) + 1
								} else if strings.HasPrefix(l, "-") && !strings.HasPrefix(l, "---") {
									d := existing["diff"].(map[string]interface{})
									d["deletions"] = d["deletions"].(int64) + 1
								}
							}
						}
					}
				}
			}
		}
	}

	var results []map[string]interface{}
	for _, p := range orderedPaths {
		if d, ok := diffMap[p]; ok {
			results = append(results, d)
		}
	}
	return results
}

// extractRawSubagentEntries extrait les objets sous-agents depuis les arguments (map ou string JSON).
func extractRawSubagentEntries(argsRaw map[string]interface{}) []map[string]interface{} {
	if argsRaw == nil {
		return nil
	}
	var rawSubs interface{}
	for _, k := range []string{"Subagents", "subagents", "subagent", "Subagent"} {
		if val, exists := argsRaw[k]; exists && val != nil {
			rawSubs = val
			break
		}
	}
	if rawSubs == nil {
		return nil
	}
	// Cas 1 : Tranche déjà désérialisée
	if list, ok := rawSubs.([]interface{}); ok {
		var out []map[string]interface{}
		for _, item := range list {
			if m, ok := item.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
		return out
	}
	// Cas 2 : Chaîne encodée en JSON
	if s, ok := rawSubs.(string); ok && len(strings.TrimSpace(s)) > 0 {
		var list []map[string]interface{}
		if json.Unmarshal([]byte(s), &list) == nil && len(list) > 0 {
			return list
		}
		var single map[string]interface{}
		if json.Unmarshal([]byte(s), &single) == nil && len(single) > 0 {
			return []map[string]interface{}{single}
		}
	}
	return nil
}

// SubagentSummary représente un sous-agent découvert dans l'arbre d'exécution (DAG).
type SubagentSummary struct {
	ID              string `json:"id"`
	ParentID        string `json:"parentId"`
	TypeName        string `json:"typeName"`
	Role            string `json:"role"`
	Prompt          string `json:"prompt"`
	State           string `json:"state"` // running, idle, completed, errored
	CreatedAt       int64  `json:"createdAt"`
	DurationSeconds int64  `json:"durationSeconds,omitempty"`
	WorkedFor       string `json:"workedFor,omitempty"`
	LastMessage     string `json:"lastMessage,omitempty"`
}

// ExtractSubagents parcourt le transcript d'une cascade et extrait la liste
// ordonnée des sous-agents invoqués (DAG / arborescence).
func ExtractSubagents(cascadeID string) []SubagentSummary {
	var results []SubagentSummary
	transcriptPath := findTranscriptPath(cascadeID)
	if transcriptPath == "" {
		return results
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return results
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	seen := make(map[string]int) // id -> index in results

	for scanner.Scan() {
		line := scanner.Bytes()
		var entry struct {
			Type      string          `json:"type"`
			Source    string          `json:"source"`
			Content   string          `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
			StepIndex int64           `json:"step_index"`
			Timestamp int64           `json:"timestamp"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		// Détection dans tool_calls JSON array (support args et arguments)
		if len(entry.ToolCalls) > 0 {
			var calls []struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal(entry.ToolCalls, &calls) == nil {
				for _, c := range calls {
					if c.Name == "invoke_subagent" || c.Name == "define_subagent" {
						args := c.Args
						if args == nil {
							args = c.Arguments
						}
						subList := extractRawSubagentEntries(args)
						for _, smap := range subList {
							typeName, _ := smap["TypeName"].(string)
							if typeName == "" {
								typeName, _ = smap["typeName"].(string)
							}
							role, _ := smap["Role"].(string)
							if role == "" {
								role, _ = smap["role"].(string)
							}
							if role == "" {
								role = typeName
							}
							if role == "" {
								role = "Subagent"
							}
							prompt, _ := smap["Prompt"].(string)
							if prompt == "" {
								prompt, _ = smap["prompt"].(string)
							}
							subID, _ := smap["ConversationId"].(string)
							if subID == "" {
								subID, _ = smap["conversationId"].(string)
							}
							if subID == "" {
								subID, _ = smap["id"].(string)
							}
							if subID == "" {
								subID = fmt.Sprintf("subagent-%s-%d", typeName, len(results)+1)
							}
							if idx, exists := seen[subID]; exists {
								results[idx].State = "running"
							} else {
								seen[subID] = len(results)
								results = append(results, SubagentSummary{
									ID:              subID,
									ParentID:        cascadeID,
									TypeName:        typeName,
									Role:            role,
									Prompt:          prompt,
									State:           "completed",
									CreatedAt:       entry.Timestamp,
									DurationSeconds: 14,
									WorkedFor:       "14s",
								})
							}
						}
					}
				}
			}
		}

		// Détection dans Content texte si stringifié
		if strings.Contains(entry.Content, "invoke_subagent") || strings.Contains(entry.Content, "manage_subagents") {
			var tc struct {
				Name      string                 `json:"name"`
				Args      map[string]interface{} `json:"args"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			if json.Unmarshal([]byte(entry.Content), &tc) == nil && (tc.Name == "invoke_subagent" || tc.Name == "define_subagent") {
				args := tc.Args
				if args == nil {
					args = tc.Arguments
				}
				subList := extractRawSubagentEntries(args)
				for _, smap := range subList {
					typeName, _ := smap["TypeName"].(string)
					if typeName == "" {
						typeName, _ = smap["typeName"].(string)
					}
					role, _ := smap["Role"].(string)
					if role == "" {
						role, _ = smap["role"].(string)
					}
					if role == "" {
						role = typeName
					}
					if role == "" {
						role = "Subagent"
					}
					prompt, _ := smap["Prompt"].(string)
					if prompt == "" {
						prompt, _ = smap["prompt"].(string)
					}
					subID, _ := smap["ConversationId"].(string)
					if subID == "" {
						subID, _ = smap["conversationId"].(string)
					}
					if subID == "" {
						subID, _ = smap["id"].(string)
					}
					if subID == "" {
						subID = fmt.Sprintf("subagent-%s-%d", typeName, len(results)+1)
					}
					if _, exists := seen[subID]; !exists {
						seen[subID] = len(results)
						results = append(results, SubagentSummary{
							ID:              subID,
							ParentID:        cascadeID,
							TypeName:        typeName,
							Role:            role,
							Prompt:          prompt,
							State:           "completed",
							CreatedAt:       entry.Timestamp,
							DurationSeconds: 14,
							WorkedFor:       "14s",
						})
					}
				}
			}
		}
	}
	return results
}

// filePathsIn extrait les chemins absolus (Windows, POSIX et file:///) d'un
// texte — ils identifient fichiers, artefacts et uploads dans les transcripts.
func filePathsIn(s string) []string {
	var out []string
	// Regex POSIX (/c:/…, /home/…, /Users/…) et Windows (C:\…, C:/…, c:\…).
	re := regexp.MustCompile(`(?:file:///)?(?:[A-Za-z]:[/\\]|/)(?:[^"'\s\t\r\n\(\)<>]+)`)
	for _, m := range re.FindAllString(s, -1) {
		clean := strings.TrimRight(m, "\"',.;:)")
		clean = strings.ReplaceAll(clean, "\\\\", "\\")
		if len(clean) > 8 { // ignore les fragments trop courts
			out = append(out, clean)
		}
	}
	return out
}

// isUploadPath d├®tecte un fichier t├®l├®vers├® par le mobile dans scratch/.
func isUploadPath(p string) bool {
	return strings.Contains(p, "scratch") && strings.Contains(p, "upload_")
}

func cleanRawContent(s string) string {
	if s == "" {
		return ""
	}
	s = systemMessageBlockRe.ReplaceAllString(s, "")
	s = systemPromptBlockRe.ReplaceAllString(s, "")
	s = additionalMetaBlockRe.ReplaceAllString(s, "")
	s = userSettingsBlockRe.ReplaceAllString(s, "")
	s = systemGeneratedBlockRe.ReplaceAllString(s, "")
	s = contextBlockRe.ReplaceAllString(s, "")
	s = bgMessageBlockRe.ReplaceAllString(s, "")
	s = systemNoticeRe.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

func cleanAssistantText(s string) string {
	s = cleanRawContent(s)
	if s == "" {
		return ""
	}
	trimmed := strings.TrimSpace(s)
	if strings.HasPrefix(trimmed, "<SYSTEM_MESSAGE>") ||
		strings.HasPrefix(trimmed, "<system_message>") ||
		strings.HasPrefix(trimmed, "[Message] timestamp=") {
		return ""
	}
	return trimmed
}

var (
	artifactMediaRe = regexp.MustCompile(`(?i)\[ARTIFACT:\s*([^\]]+)\]\s*\r?\n\s*Path:\s*([^\r\n]+)`)
	userUploadedRe  = regexp.MustCompile(`(?i)(?:file:///|[a-zA-Z]:[\\/]|/)[^\r\n\t\"'<>]+\.(?:png|jpg|jpeg|gif|webp|svg|pdf|mp4|webm)`)
)

func extractMediaArtifacts(content string) []string {
	var images []string
	seen := make(map[string]bool)

	// 1. [ARTIFACT: media_xxx]\nPath: file:///...
	matches := artifactMediaRe.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		if len(m) >= 3 {
			name := strings.ToLower(strings.TrimSpace(m[1]))
			p := strings.TrimSpace(m[2])
			lowerP := strings.ToLower(p)
			isMedia := strings.HasPrefix(name, "media_") ||
				strings.HasPrefix(name, "upload_") ||
				strings.HasPrefix(name, "img_") ||
				strings.HasSuffix(lowerP, ".png") ||
				strings.HasSuffix(lowerP, ".jpg") ||
				strings.HasSuffix(lowerP, ".jpeg") ||
				strings.HasSuffix(lowerP, ".gif") ||
				strings.HasSuffix(lowerP, ".webp") ||
				strings.HasSuffix(lowerP, ".svg") ||
				strings.HasSuffix(lowerP, ".pdf") ||
				strings.HasSuffix(lowerP, ".mp4") ||
				strings.HasSuffix(lowerP, ".webm")

			if isMedia && !seen[p] {
				seen[p] = true
				images = append(images, p)
			}
		}
	}

	// 2. Direct paths in .user_uploaded, user_uploaded, scratch, media_ or tempmediaStorage
	for _, match := range userUploadedRe.FindAllString(content, -1) {
		p := strings.TrimSpace(match)
		lower := strings.ToLower(p)
		if (strings.Contains(lower, ".user_uploaded") ||
			strings.Contains(lower, "user_uploaded") ||
			strings.Contains(lower, "media_") ||
			strings.Contains(lower, "tempmediastorage") ||
			strings.Contains(lower, "scratch/upload_") ||
			strings.Contains(lower, "scratch\\upload_")) && !seen[p] {
			seen[p] = true
			images = append(images, p)
		}
	}

	return images
}

func extractUserRequest(content string) string {
	startTag := "<USER_REQUEST>"
	endTag := "</USER_REQUEST>"

	var userReq string
	startIdx := strings.Index(content, startTag)
	if startIdx >= 0 {
		endIdx := strings.Index(content, endTag)
		if endIdx > startIdx {
			userReq = cleanRawContent(content[startIdx+len(startTag) : endIdx])
		}
	}

	if userReq == "" && startIdx < 0 {
		trimmed := strings.TrimSpace(content)
		if !strings.HasPrefix(trimmed, "<SYSTEM_MESSAGE>") &&
			!strings.HasPrefix(trimmed, "<system_message>") &&
			!strings.HasPrefix(trimmed, "<identity>") &&
			!strings.HasPrefix(trimmed, "<user_information>") &&
			!strings.HasPrefix(trimmed, "<skills>") &&
			!strings.HasPrefix(trimmed, "<subagents>") &&
			!strings.HasPrefix(trimmed, "<messaging>") &&
			!strings.HasPrefix(trimmed, "<artifacts>") &&
			!strings.HasPrefix(trimmed, "<slash_commands>") &&
			!strings.HasPrefix(trimmed, "<planning_mode>") &&
			!strings.HasPrefix(trimmed, "<guidelines>") &&
			!strings.HasPrefix(trimmed, "<communication_style>") &&
			!strings.HasPrefix(trimmed, "<conversation_transcript>") &&
			!strings.HasPrefix(trimmed, "[Message] timestamp=") {
			userReq = cleanRawContent(trimmed)
		}
	}

	// Extraire les pièces jointes / images uploadées (ex. depuis Antigravity Desktop ou Mobile)
	mediaArtifacts := extractMediaArtifacts(content)

	// Nettoyer les balises [ARTIFACT: ...] brutes qui étaient dans le prompt utilisateur
	userReq = artifactMediaRe.ReplaceAllString(userReq, "")
	userReq = regexp.MustCompile(`(?i)(?:Path|Last Edited):\s*[^\r\n]+`).ReplaceAllString(userReq, "")
	userReq = strings.TrimSpace(userReq)

	if len(mediaArtifacts) > 0 {
		for _, imgPath := range mediaArtifacts {
			cleanP := imgPath
			if !strings.HasPrefix(cleanP, "file://") && (strings.HasPrefix(cleanP, "/") || (len(cleanP) >= 2 && cleanP[1] == ':')) {
				cleanP = "file:///" + filepath.ToSlash(cleanP)
			}
			imgTag := fmt.Sprintf("![Image](%s)", cleanP)
			if !strings.Contains(userReq, imgTag) {
				if userReq == "" {
					userReq = imgTag
				} else {
					userReq = userReq + "\n\n" + imgTag
				}
			}
		}
	}

	return strings.TrimSpace(userReq)
}

// extractModelFromContent extrait le nom du modèle s'il a été changé dans les métadonnées <USER_SETTINGS_CHANGE>
func extractModelFromContent(content string) string {
	if idx := strings.Index(content, "<USER_SETTINGS_CHANGE>"); idx != -1 {
		sub := content[idx:]
		if mIdx := strings.Index(sub, "`Model Selection` from "); mIdx != -1 {
			target := sub[mIdx+len("`Model Selection` from "):]
			if toIdx := strings.Index(target, " to "); toIdx != -1 {
				afterTo := target[toIdx+len(" to "):]
				if endIdx := strings.Index(afterTo, "."); endIdx != -1 {
					return strings.TrimSpace(afterTo[:endIdx])
				}
				if endIdx := strings.Index(afterTo, "\n"); endIdx != -1 {
					return strings.TrimSpace(afterTo[:endIdx])
				}
			}
		}
	}
	return ""
}

func cleanPromptTitle(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	imgMdRe := regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`)
	s = imgMdRe.ReplaceAllString(s, "[Image]")
	// Remplacer les longs chemins absolus Windows par leur dossier de base
	pathRe := regexp.MustCompile(`[a-zA-Z]:\\[^ \t\r\n]+`)
	s = pathRe.ReplaceAllStringFunc(s, func(p string) string {
		base := filepath.Base(p)
		if base != "" && base != "." && base != "/" && base != "\\" {
			return base
		}
		return p
	})
	if len(s) > 60 {
		return s[:60] + "..."
	}
	return s
}

// ProjectSummary represents an official Antigravity 2.0 project from ~/.gemini/config/projects/
type ProjectSummary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	FolderURI string    `json:"folderUri"`
	Path      string    `json:"path"`
	UpdatedAt time.Time `json:"updatedAt"`
}

var (
	projectsCacheMu  sync.RWMutex
	cachedProjects   []ProjectSummary
	projectsCachedAt time.Time
	projectsCacheTTL = 5 * time.Second
)

// InvalidateProjectsCache force le rechargement immédiat du registre de projets.
func InvalidateProjectsCache() {
	projectsCacheMu.Lock()
	cachedProjects = nil
	projectsCacheMu.Unlock()
}

// ListOfficialProjects reads registered projects from ~/.gemini/config/projects/
func ListOfficialProjects() []ProjectSummary {
	projectsCacheMu.RLock()
	if cachedProjects != nil && time.Since(projectsCachedAt) < projectsCacheTTL {
		res := make([]ProjectSummary, len(cachedProjects))
		copy(res, cachedProjects)
		projectsCacheMu.RUnlock()
		return res
	}
	projectsCacheMu.RUnlock()

	projectsCacheMu.Lock()
	defer projectsCacheMu.Unlock()
	if cachedProjects != nil && time.Since(projectsCachedAt) < projectsCacheTTL {
		res := make([]ProjectSummary, len(cachedProjects))
		copy(res, cachedProjects)
		return res
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	projectsDir := filepath.Join(home, ".gemini", "config", "projects")
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}

	var list []ProjectSummary
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") || e.Name() == "outside-of-project.json" {
			continue
		}
		filePath := filepath.Join(projectsDir, e.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var parsed struct {
			ID               string `json:"id"`
			Name             string `json:"name"`
			UpdatedAt        string `json:"updatedAt"`
			ProjectResources struct {
				Resources []struct {
					GitFolder struct {
						FolderURI string `json:"folderUri"`
					} `json:"gitFolder"`
				} `json:"resources"`
			} `json:"projectResources"`
		}
		if err := json.Unmarshal(data, &parsed); err != nil {
			continue
		}

		folderURI := ""
		if len(parsed.ProjectResources.Resources) > 0 {
			folderURI = parsed.ProjectResources.Resources[0].GitFolder.FolderURI
		}

		// Convert folderUri (file:///c%3A/...) to normalized path
		path := normalizeWorkspace(folderURI)
		if path == "" && parsed.Name != "" && (strings.Contains(parsed.Name, `\`) || strings.Contains(parsed.Name, "/")) {
			path = normalizeWorkspace(parsed.Name)
		}

		var updatedTime time.Time
		if parsed.UpdatedAt != "" {
			updatedTime, _ = time.Parse(time.RFC3339, parsed.UpdatedAt)
		}

		name := parsed.Name
		if name == "" && path != "" {
			name = filepath.Base(path)
		}
		if name == "" {
			name = parsed.ID
		}

		list = append(list, ProjectSummary{
			ID:        parsed.ID,
			Name:      name,
			FolderURI: folderURI,
			Path:      path,
			UpdatedAt: updatedTime,
		})
	}

	// Tri par date de mise à jour décroissante
	sort.Slice(list, func(i, j int) bool {
		return list[i].UpdatedAt.After(list[j].UpdatedAt)
	})

	cachedProjects = list
	projectsCachedAt = time.Now()

	res := make([]ProjectSummary, len(list))
	copy(res, list)
	return res
}

// projectIDFromRegistry résout le projectID d'un workspace à partir du
// registre local ~/.gemini/config/projects/*.json, sans aucun appel LS
// (O(1), utilisé par create_cascade quand le cache sessions est froid).
func projectIDFromRegistry(uri string) string {
	if uri == "" {
		return ""
	}
	normUri := strings.ToLower(normalizeWorkspace(uri))
	for _, p := range ListOfficialProjects() {
		pNormPath := strings.ToLower(normalizeWorkspace(p.Path))
		pNormUri := strings.ToLower(normalizeWorkspace(p.FolderURI))
		if strings.EqualFold(p.FolderURI, uri) ||
			(pNormUri != "" && pNormUri == normUri) ||
			(pNormPath != "" && pNormPath == normUri) ||
			strings.EqualFold(p.Name, uri) {
			return p.ID
		}
	}
	return ""
}

// matchOfficialProject associe de manière déterministe et hiérarchique une session à un projet officiel.
// Priorités : 1) ID exact, 2) Chemin exact, 3) Sous-dossier le plus spécifique, 4) Nom exact.
func matchOfficialProject(projID, wsPath, wsName string, projects []ProjectSummary) (matchedName, matchedPath, matchedID string) {
	if len(projects) == 0 {
		return wsName, wsPath, projID
	}

	// 1. Priorité 1 : ID exact
	if projID != "" {
		for _, p := range projects {
			if p.ID == projID {
				return p.Name, p.Path, p.ID
			}
		}
	}

	normWs := strings.ToLower(normalizeWorkspace(wsPath))
	if normWs != "" {
		// 2. Priorité 2 : Chemin ou URI exact
		for _, p := range projects {
			pNormPath := strings.ToLower(normalizeWorkspace(p.Path))
			pNormUri := strings.ToLower(normalizeWorkspace(p.FolderURI))
			if (pNormPath != "" && pNormPath == normWs) || (pNormUri != "" && pNormUri == normWs) {
				return p.Name, p.Path, p.ID
			}
		}

		// 3. Priorité 3 : Sous-dossier le plus spécifique (parent le plus long)
		var bestParent *ProjectSummary
		longestLen := -1
		for i, p := range projects {
			pNormPath := strings.ToLower(normalizeWorkspace(p.Path))
			if pNormPath != "" {
				prefixSlash := pNormPath + "/"
				prefixBack := pNormPath + "\\"
				if strings.HasPrefix(normWs, prefixSlash) || strings.HasPrefix(normWs, prefixBack) {
					if len(pNormPath) > longestLen {
						longestLen = len(pNormPath)
						bestParent = &projects[i]
					}
				}
			}
		}
		if bestParent != nil {
			return bestParent.Name, bestParent.Path, bestParent.ID
		}
	}

	// 4. Priorité 4 : Nom de dossier ou de projet exact
	if wsName != "" {
		for _, p := range projects {
			if strings.EqualFold(p.Name, wsName) {
				return p.Name, p.Path, p.ID
			}
		}
	}
	if normWs != "" {
		base := strings.ToLower(filepath.Base(normWs))
		for _, p := range projects {
			if strings.EqualFold(p.Name, base) {
				return p.Name, p.Path, p.ID
			}
		}
	}

	return wsName, wsPath, projID
}

// GetUniqueWorkspaces returns the list of unique workspace names discovered on the machine.
func GetUniqueWorkspaces() []string {
	projs := ListOfficialProjects()
	if len(projs) > 0 {
		var names []string
		for _, p := range projs {
			names = append(names, p.Name)
			if len(names) >= 8 {
				break
			}
		}
		return names
	}

	sessions := ListLocalSessions()
	seen := make(map[string]bool)
	var list []string
	for _, s := range sessions {
		if ws, ok := s["workspace"].(string); ok && ws != "" && !seen[ws] {
			seen[ws] = true
			list = append(list, ws)
			if len(list) >= 8 {
				break
			}
		}
	}
	return list
}

// listWorkspaces construit le sélecteur de workspace (G4) : le registre
// officiel ~/.gemini/config/projects uniquement pour rester synchronisé avec Antigravity.
// Si aucun projet officiel n'est configuré, fallback sur un scan borné du home.
func listWorkspaces() []map[string]interface{} {
	seen := make(map[string]bool)
	var out []map[string]interface{}
	add := func(name, path, source string) {
		norm := filepath.ToSlash(strings.TrimRight(path, "/\\"))
		lowerKey := strings.ToLower(norm)
		if name == "" || norm == "" || seen[lowerKey] {
			return
		}
		seen[lowerKey] = true
		rel := ""
		if home, err := os.UserHomeDir(); err == nil {
			if r, err := filepath.Rel(home, norm); err == nil && !strings.HasPrefix(r, "..") {
				rel = filepath.ToSlash(r)
			}
		}
		out = append(out, map[string]interface{}{
			"name":         name,
			"path":         norm,
			"relativePath": rel,
			"source":       source,
		})
	}

	for _, p := range ListOfficialProjects() {
		add(p.Name, p.Path, "registry")
	}

	// Uniquement en fallback si aucun projet officiel n'est configuré
	if len(out) == 0 {
		if home, err := os.UserHomeDir(); err == nil {
			if entries, err := os.ReadDir(home); err == nil {
				skip := map[string]bool{
					"AppData": true, "Library": true, "Applications": true,
					"Desktop": true, "Documents": true, "Downloads": true,
					"Pictures": true, "Music": true, "Videos": true, "Public": true,
					".git": true, ".gemini": true, "node_modules": true,
				}
				for _, e := range entries {
					if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || skip[e.Name()] {
						continue
					}
					add(e.Name(), filepath.Join(home, e.Name()), "home")
				}
			}
		}
	}
	return out
}

// GetMostRecentSession retourne la session la plus récemment mise à jour sur le PC.
func GetMostRecentSession() (map[string]interface{}, error) {
	sessions := ListLocalSessions()
	if len(sessions) == 0 {
		return nil, fmt.Errorf("aucune session active trouvée")
	}
	return sessions[0], nil
}
