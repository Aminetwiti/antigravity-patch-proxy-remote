package gateway

import (
	"bufio"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AccountInfo représente les détails du compte Antigravity Desktop / Google AI.
type AccountInfo struct {
	Email           string                 `json:"email"`
	Plan            string                 `json:"plan"`
	PlanDisplayName string                 `json:"planDisplayName"`
	Telemetry       bool                   `json:"telemetryEnabled"`
	MarketingEmails bool                   `json:"marketingEmails"`
	Quotas          map[string]interface{} `json:"quotas,omitempty"`
}

// DiscoveredSkill représente un skill Antigravity (builtin ou custom).
type DiscoveredSkill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"path"`
	Category    string `json:"category"` // "builtin" | "custom"
	Enabled     bool   `json:"enabled"`
}

// DiscoveredRule représente une règle globale ou workspace.
type DiscoveredRule struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Scope   string `json:"scope"` // "global" | "workspace"
	Content string `json:"content"`
}

// BrowserStatus représente l'état du navigateur headless / CDP.
type BrowserStatus struct {
	Available        bool     `json:"available"`
	Mode             string   `json:"mode"`
	Paired           bool     `json:"paired"`
	AutoCapture      bool     `json:"autoCapture"`
	ScreenshotsCount int      `json:"screenshotsCount"`
	RecentCaptures   []string `json:"recentCaptures"`
}

var (
	accountMu               sync.RWMutex
	accountTelemetryEnabled = true
	accountMarketingEmails  = false
)

// accountPrefsFile est le fichier de persistance des préférences de compte.
// ponytail: fichier JSON simple réutilisant le pattern des projets — pas de
// schéma versionné; ajouter un version si le nombre de clés grandit.
const accountPrefsFile = ".gemini/config/prefs.json"

func accountPrefsPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, accountPrefsFile)
}

// loadAccountPrefs charge les préférences persistées au démarrage.
func loadAccountPrefs() {
	path := accountPrefsPath()
	if path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var prefs struct {
		Telemetry       bool `json:"telemetryEnabled"`
		MarketingEmails bool `json:"marketingEmails"`
	}
	if err := json.Unmarshal(data, &prefs); err != nil {
		return
	}
	accountMu.Lock()
	accountTelemetryEnabled = prefs.Telemetry
	accountMarketingEmails = prefs.MarketingEmails
	accountMu.Unlock()
}

// GetAccountInfo retourne les informations de compte avec quotas temps réel.
func (s *Server) GetAccountInfo() AccountInfo {
	accountMu.RLock()
	tel := accountTelemetryEnabled
	mkt := accountMarketingEmails
	accountMu.RUnlock()

	info := AccountInfo{
		Email:           "lesjardindelavie@gmail.com",
		Plan:            "Google AI Pro",
		PlanDisplayName: "Google AI Pro Plan",
		Telemetry:       tel,
		MarketingEmails: mkt,
	}

	if s.RPCClient != nil {
		if raw, err := s.RPCClient.RetrieveUserQuotaSummary(); err == nil && len(raw) > 0 {
			if qData, ok := s.buildQuotaData(raw); ok {
				info.Quotas = qData
			}
		}
	}

	return info
}

// SetAccountPreferences enregistre les préférences de télémétrie / marketing.
func SetAccountPreferences(telemetry, marketing bool) {
	accountMu.Lock()
	accountTelemetryEnabled = telemetry
	accountMarketingEmails = marketing
	accountMu.Unlock()

	// Persistance best-effort sur disque (BUG-SET-004).
	path := accountPrefsPath()
	if path == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	prefs := map[string]interface{}{
		"telemetryEnabled": telemetry,
		"marketingEmails":  marketing,
	}
	if b, err := json.MarshalIndent(prefs, "", "  "); err == nil {
		_ = os.WriteFile(path, b, 0644)
	}
}

// ListDiscoveredSkills recherche les skills dans ~/.gemini/antigravity/builtin/skills et ~/.gemini/config/skills.
func ListDiscoveredSkills() []DiscoveredSkill {
	home, err := os.UserHomeDir()
	if err != nil {
		return []DiscoveredSkill{}
	}

	skills := make([]DiscoveredSkill, 0)
	seen := make(map[string]bool)

	dirs := []struct {
		path     string
		category string
	}{
		{filepath.Join(home, ".gemini", "antigravity", "builtin", "skills"), "builtin"},
		{filepath.Join(home, ".gemini", "config", "skills"), "custom"},
	}

	for _, d := range dirs {
		entries, err := os.ReadDir(d.path)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			skillDir := filepath.Join(d.path, e.Name())
			skillFile := filepath.Join(skillDir, "SKILL.md")
			if _, err := os.Stat(skillFile); err == nil {
				name, desc := parseSkillMD(skillFile, e.Name())
				if !seen[name] {
					seen[name] = true
					skills = append(skills, DiscoveredSkill{
						Name:        name,
						Description: desc,
						Path:        skillFile,
						Category:    d.category,
						Enabled:     true,
					})
				}
			}
		}
	}

	return skills
}

// parseSkillMD extrait le frontmatter (name / description) de SKILL.md.
func parseSkillMD(path, fallbackName string) (string, string) {
	f, err := os.Open(path)
	if err != nil {
		return fallbackName, ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	inFrontmatter := false
	name := fallbackName
	desc := ""

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "---" {
			if !inFrontmatter {
				inFrontmatter = true
				continue
			} else {
				break
			}
		}
		if inFrontmatter {
			if strings.HasPrefix(line, "name:") {
				name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
				name = strings.Trim(name, `"'`)
			} else if strings.HasPrefix(line, "description:") {
				desc = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
				desc = strings.Trim(desc, `"'`)
			}
		}
	}

	return name, desc
}

// ListDiscoveredRules lit les règles globales dans ~/.gemini/antigravity/rules.
func ListDiscoveredRules() []DiscoveredRule {
	home, err := os.UserHomeDir()
	if err != nil {
		return []DiscoveredRule{}
	}

	rules := make([]DiscoveredRule, 0)
	rulesDir := filepath.Join(home, ".gemini", "antigravity", "rules")
	entries, err := os.ReadDir(rulesDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			p := filepath.Join(rulesDir, e.Name())
			data, err := os.ReadFile(p)
			if err == nil {
				rules = append(rules, DiscoveredRule{
					Name:    e.Name(),
					Path:    p,
					Scope:   "global",
					Content: string(data),
				})
			}
		}
	}

	return rules
}

// GetBrowserStatus retourne l'état du navigateur headless CDP.
func GetBrowserStatus() BrowserStatus {
	return BrowserStatus{
		Available:        true,
		Mode:             "headless_cdp",
		Paired:           false,
		AutoCapture:      true,
		ScreenshotsCount: 0,
		RecentCaptures:   []string{},
	}
}

// ProjectSettings représente les paramètres d'agent d'un projet Antigravity 2.0.
type ProjectSettings struct {
	ProjectID            string `json:"projectId"`
	ProjectName          string `json:"projectName"`
	SecurityPreset       string `json:"securityPreset"`       // "Default" | "Full machine" | "Turbo mode" | "Custom"
	ArtifactReviewPolicy string `json:"artifactReviewPolicy"`  // "Always Ask" | "Auto Approve" | "Never"
	FileAccessPolicy     string `json:"fileAccessPolicy"`     // "AGENT_SETTING_POLICY_ALLOW" | "AGENT_SETTING_POLICY_ASK"
	InternetPolicy       string `json:"internetPolicy"`       // "AGENT_SETTING_POLICY_ALLOW" | "AGENT_SETTING_POLICY_ASK"
	AutoExecutionPolicy  string `json:"autoExecutionPolicy"`  // "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER" | "CASCADE_COMMANDS_AUTO_EXECUTION_ASK"
	ArtifactReviewMode   string `json:"artifactReviewMode"`   // "ARTIFACT_REVIEW_MODE_TURBO" | "ARTIFACT_REVIEW_MODE_ALWAYS_ASK" | "ARTIFACT_REVIEW_MODE_NEVER"
	QueuedMessagesMode   string `json:"queuedMessagesMode"`   // "queue" | "immediate"
}

type projectConfigFile struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	ProjectResources map[string]interface{} `json:"projectResources,omitempty"`
	PermissionGrants map[string]interface{} `json:"permissionGrants,omitempty"`
	Settings         map[string]interface{} `json:"settings,omitempty"`
	UpdatedAt        string                 `json:"updatedAt,omitempty"`
}

var projectConfigMu sync.RWMutex

// GetProjectSettings récupère la configuration d'un projet depuis ~/.gemini/config/projects/<id>.json.
func GetProjectSettings(projectIDOrWorkspace string) ProjectSettings {
	projectConfigMu.RLock()
	defer projectConfigMu.RUnlock()

	filePath, projectID := resolveProjectConfigFile(projectIDOrWorkspace)
	defaultSettings := ProjectSettings{
		ProjectID:            projectID,
		ProjectName:          "Project",
		SecurityPreset:       "Default",
		ArtifactReviewPolicy: "Always Ask",
		FileAccessPolicy:     "AGENT_SETTING_POLICY_ASK",
		InternetPolicy:       "AGENT_SETTING_POLICY_ASK",
		AutoExecutionPolicy:  "CASCADE_COMMANDS_AUTO_EXECUTION_ASK",
		ArtifactReviewMode:   "ARTIFACT_REVIEW_MODE_ALWAYS_ASK",
		QueuedMessagesMode:   "queue",
	}

	if filePath == "" {
		return defaultSettings
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return defaultSettings
	}

	var conf projectConfigFile
	if err := json.Unmarshal(data, &conf); err != nil {
		return defaultSettings
	}

	res := defaultSettings
	if conf.ID != "" {
		res.ProjectID = conf.ID
	}
	if conf.Name != "" {
		res.ProjectName = conf.Name
	}

	if conf.Settings != nil {
		if fap, ok := conf.Settings["fileAccessPolicy"].(string); ok {
			res.FileAccessPolicy = fap
		}
		if ip, ok := conf.Settings["internetPolicy"].(string); ok {
			res.InternetPolicy = ip
		}
		if aep, ok := conf.Settings["autoExecutionPolicy"].(string); ok {
			res.AutoExecutionPolicy = aep
		}
		if arm, ok := conf.Settings["artifactReviewMode"].(string); ok {
			res.ArtifactReviewMode = arm
		}
	}

	// Résolution du Security Preset
	if res.AutoExecutionPolicy == "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER" || res.ArtifactReviewMode == "ARTIFACT_REVIEW_MODE_TURBO" {
		res.SecurityPreset = "Turbo mode"
	} else if res.FileAccessPolicy == "AGENT_SETTING_POLICY_ALLOW" {
		res.SecurityPreset = "Full machine"
	} else if res.FileAccessPolicy == "AGENT_SETTING_POLICY_ASK" || res.FileAccessPolicy == "" {
		res.SecurityPreset = "Default"
	} else {
		res.SecurityPreset = "Custom"
	}

	// Résolution de l'Artifact Review Policy
	if res.ArtifactReviewMode == "ARTIFACT_REVIEW_MODE_TURBO" || res.ArtifactReviewMode == "ARTIFACT_REVIEW_MODE_AUTO_APPROVE" {
		res.ArtifactReviewPolicy = "Auto Approve"
	} else if res.ArtifactReviewMode == "ARTIFACT_REVIEW_MODE_NEVER" {
		res.ArtifactReviewPolicy = "Never"
	} else {
		res.ArtifactReviewPolicy = "Always Ask"
	}

	return res
}

// UpdateProjectSettings persiste les réglages d'agent dans ~/.gemini/config/projects/<id>.json.
func UpdateProjectSettings(projectIDOrWorkspace string, settings ProjectSettings) (ProjectSettings, error) {
	projectConfigMu.Lock()
	defer projectConfigMu.Unlock()

	filePath, projectID := resolveProjectConfigFile(projectIDOrWorkspace)
	if filePath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return settings, err
		}
		projectsDir := filepath.Join(home, ".gemini", "config", "projects")
		_ = os.MkdirAll(projectsDir, 0755)
		if projectID == "" {
			projectID = "outside-of-project"
		}
		filePath = filepath.Join(projectsDir, projectID+".json")
	}

	var conf projectConfigFile
	if data, err := os.ReadFile(filePath); err == nil {
		_ = json.Unmarshal(data, &conf)
	}

	if conf.ID == "" {
		conf.ID = projectID
	}
	if conf.Settings == nil {
		conf.Settings = make(map[string]interface{})
	}

	// Application du Security Preset. Pour "Custom", on conserve les politiques
	// déjà persistées (édition avancée) au lieu de les écraser par des défauts.
	if settings.SecurityPreset == "Custom" {
		if v, ok := conf.Settings["fileAccessPolicy"].(string); ok && settings.FileAccessPolicy == "" {
			settings.FileAccessPolicy = v
		}
		if v, ok := conf.Settings["internetPolicy"].(string); ok && settings.InternetPolicy == "" {
			settings.InternetPolicy = v
		}
		if v, ok := conf.Settings["autoExecutionPolicy"].(string); ok && settings.AutoExecutionPolicy == "" {
			settings.AutoExecutionPolicy = v
		}
		if v, ok := conf.Settings["artifactReviewMode"].(string); ok && settings.ArtifactReviewMode == "" {
			settings.ArtifactReviewMode = v
		}
		// Déduit l'ArtifactReviewPolicy depuis le mode conservé pour que la
		// valeur retournée soit complète.
		if settings.ArtifactReviewPolicy == "" {
			switch settings.ArtifactReviewMode {
			case "ARTIFACT_REVIEW_MODE_TURBO", "ARTIFACT_REVIEW_MODE_AUTO_APPROVE":
				settings.ArtifactReviewPolicy = "Auto Approve"
			case "ARTIFACT_REVIEW_MODE_NEVER":
				settings.ArtifactReviewPolicy = "Never"
			default:
				settings.ArtifactReviewPolicy = "Always Ask"
			}
		}
	}
	switch settings.SecurityPreset {
	case "Turbo mode":
		settings.AutoExecutionPolicy = "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
		settings.ArtifactReviewMode = "ARTIFACT_REVIEW_MODE_TURBO"
		settings.FileAccessPolicy = "AGENT_SETTING_POLICY_ALLOW"
		settings.ArtifactReviewPolicy = "Auto Approve"
	case "Full machine":
		settings.AutoExecutionPolicy = "CASCADE_COMMANDS_AUTO_EXECUTION_ASK"
		settings.FileAccessPolicy = "AGENT_SETTING_POLICY_ALLOW"
		if settings.ArtifactReviewPolicy == "" {
			settings.ArtifactReviewPolicy = "Always Ask"
		}
	case "Default":
		settings.AutoExecutionPolicy = "CASCADE_COMMANDS_AUTO_EXECUTION_ASK"
		settings.FileAccessPolicy = "AGENT_SETTING_POLICY_ASK"
		if settings.ArtifactReviewPolicy == "" {
			settings.ArtifactReviewPolicy = "Always Ask"
		}
	}

	if settings.ArtifactReviewPolicy != "" {
		switch settings.ArtifactReviewPolicy {
		case "Auto Approve":
			settings.ArtifactReviewMode = "ARTIFACT_REVIEW_MODE_TURBO"
		case "Never":
			settings.ArtifactReviewMode = "ARTIFACT_REVIEW_MODE_NEVER"
		default:
			settings.ArtifactReviewMode = "ARTIFACT_REVIEW_MODE_ALWAYS_ASK"
		}
	}

	conf.Settings["fileAccessPolicy"] = settings.FileAccessPolicy
	conf.Settings["internetPolicy"] = settings.InternetPolicy
	conf.Settings["autoExecutionPolicy"] = settings.AutoExecutionPolicy
	conf.Settings["artifactReviewMode"] = settings.ArtifactReviewMode
	conf.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)

	updatedBytes, err := json.MarshalIndent(conf, "", "  ")
	if err != nil {
		return settings, err
	}

	if err := os.WriteFile(filePath, updatedBytes, 0644); err != nil {
		return settings, err
	}

	settings.ProjectID = conf.ID
	if conf.Name != "" {
		settings.ProjectName = conf.Name
	}
	return settings, nil
}

// resolveProjectConfigFile trouve le fichier de configuration de projet correspondant.
func resolveProjectConfigFile(projectIDOrWorkspace string) (string, string) {
	fallbackID := projectIDOrWorkspace
	if fallbackID == "" || strings.Contains(fallbackID, "/") || strings.Contains(fallbackID, "\\") {
		fallbackID = "outside-of-project"
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", fallbackID
	}
	projectsDir := filepath.Join(home, ".gemini", "config", "projects")
	if _, err := os.Stat(projectsDir); err != nil {
		return "", fallbackID
	}

	// 1. Recherche directe par ID de fichier
	if projectIDOrWorkspace != "" && !strings.Contains(projectIDOrWorkspace, "/") && !strings.Contains(projectIDOrWorkspace, "\\") {
		direct := filepath.Join(projectsDir, projectIDOrWorkspace+".json")
		if _, err := os.Stat(direct); err == nil {
			return direct, projectIDOrWorkspace
		}
	}

	// 2. Recherche par workspace URI / chemin
	cleanTarget := strings.TrimSpace(projectIDOrWorkspace)
	if cleanTarget != "" {
		cleanTarget = strings.ReplaceAll(cleanTarget, "\\", "/")
		cleanTarget = strings.TrimPrefix(cleanTarget, "file:///")
		if unescaped, err := url.QueryUnescape(cleanTarget); err == nil {
			cleanTarget = unescaped
		}
		cleanTarget = strings.ToLower(cleanTarget)

		entries, err := os.ReadDir(projectsDir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
					continue
				}
				p := filepath.Join(projectsDir, e.Name())
				data, err := os.ReadFile(p)
				if err != nil {
					continue
				}
				var conf projectConfigFile
				if err := json.Unmarshal(data, &conf); err == nil {
					if res, ok := conf.ProjectResources["resources"].([]interface{}); ok {
						for _, r := range res {
							if rMap, ok := r.(map[string]interface{}); ok {
								if gitFolder, ok := rMap["gitFolder"].(map[string]interface{}); ok {
									if fUri, ok := gitFolder["folderUri"].(string); ok {
										cleanUri := strings.ReplaceAll(fUri, "\\", "/")
										cleanUri = strings.TrimPrefix(cleanUri, "file:///")
										if unesc, err := url.QueryUnescape(cleanUri); err == nil {
											cleanUri = unesc
										}
										cleanUri = strings.ToLower(cleanUri)
										if strings.Contains(cleanTarget, cleanUri) || strings.Contains(cleanUri, cleanTarget) {
											return p, conf.ID
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

	// 3. Fallback : premier projet non-outside ou outside-of-project.json
	outsidePath := filepath.Join(projectsDir, "outside-of-project.json")
	if _, err := os.Stat(outsidePath); err == nil {
		return outsidePath, "outside-of-project"
	}

	entries, err := os.ReadDir(projectsDir)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
				id := strings.TrimSuffix(e.Name(), ".json")
				return filepath.Join(projectsDir, e.Name()), id
			}
		}
	}

	return "", fallbackID
}

