package gateway

import (
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestSettingsCustomizations_DiscoveredSkillsAndRules(t *testing.T) {
	skills := ListDiscoveredSkills()
	if len(skills) == 0 {
		t.Logf("no skills found on test host (normal in CI)")
	} else {
		t.Logf("found %d skills", len(skills))
		for _, s := range skills {
			if s.Name == "" {
				t.Fatalf("skill without name")
			}
		}
	}

	rules := ListDiscoveredRules()
	t.Logf("found %d rules", len(rules))

	bStatus := GetBrowserStatus()
	if !bStatus.Available || bStatus.Mode == "" {
		t.Fatalf("invalid browser status: %+v", bStatus)
	}
}

func TestWebSocket_AccountSkillsRulesRPC(t *testing.T) {
	ts, _ := newTestServerWithGW(nil)
	defer ts.Close()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// 1. get_account_info
	reqAcc := map[string]string{
		"type":      "get_account_info",
		"requestId": "req-acc-1",
	}
	if err := conn.WriteJSON(reqAcc); err != nil {
		t.Fatalf("write: %v", err)
	}
	var respAcc struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&respAcc); err != nil {
		t.Fatalf("read account: %v", err)
	}
	if respAcc.Data["email"] == nil || respAcc.Data["plan"] == nil {
		t.Fatalf("missing email or plan in account info: %+v", respAcc.Data)
	}

	// 2. list_skills
	reqSkills := map[string]string{
		"type":      "list_skills",
		"requestId": "req-skills-1",
	}
	if err := conn.WriteJSON(reqSkills); err != nil {
		t.Fatalf("write skills: %v", err)
	}
	var respSkills struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&respSkills); err != nil {
		t.Fatalf("read skills: %v", err)
	}
	if respSkills.Data["skills"] == nil {
		t.Fatalf("expected skills list in response")
	}

	// 3. get_browser_status
	reqBrowser := map[string]string{
		"type":      "get_browser_status",
		"requestId": "req-browser-1",
	}
	if err := conn.WriteJSON(reqBrowser); err != nil {
		t.Fatalf("write browser: %v", err)
	}
	var respBrowser struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&respBrowser); err != nil {
		t.Fatalf("read browser: %v", err)
	}
	if respBrowser.Data["mode"] == nil {
		t.Fatalf("expected browser status data")
	}

	// 4. get_project_settings
	reqProj := map[string]string{
		"type":      "get_project_settings",
		"requestId": "req-proj-1",
	}
	if err := conn.WriteJSON(reqProj); err != nil {
		t.Fatalf("write proj: %v", err)
	}
	var respProj struct {
		Type      string          `json:"type"`
		RequestID string          `json:"requestId"`
		Data      ProjectSettings `json:"data"`
	}
	if err := conn.ReadJSON(&respProj); err != nil {
		t.Fatalf("read proj: %v", err)
	}
	if respProj.Data.SecurityPreset == "" {
		t.Fatalf("expected non-empty security preset")
	}

	// 5. update_project_settings
	reqUpdateProj := map[string]interface{}{
		"type":      "update_project_settings",
		"requestId": "req-proj-2",
		"data": map[string]interface{}{
			"securityPreset":       "Turbo mode",
			"artifactReviewPolicy": "Auto Approve",
		},
	}
	if err := conn.WriteJSON(reqUpdateProj); err != nil {
		t.Fatalf("write update proj: %v", err)
	}
	var respUpdateProj struct {
		Type      string          `json:"type"`
		RequestID string          `json:"requestId"`
		Data      ProjectSettings `json:"data"`
	}
	if err := conn.ReadJSON(&respUpdateProj); err != nil {
		t.Fatalf("read update proj: %v", err)
	}
	if respUpdateProj.Data.SecurityPreset != "Turbo mode" {
		t.Fatalf("expected Turbo mode, got: %s", respUpdateProj.Data.SecurityPreset)
	}
}

func TestProjectSettings_GetAndUpdate(t *testing.T) {
	s := GetProjectSettings("outside-of-project")
	if s.ProjectID == "" {
		t.Fatalf("expected project id")
	}

	updated, err := UpdateProjectSettings("outside-of-project", ProjectSettings{
		SecurityPreset:       "Full machine",
		ArtifactReviewPolicy: "Always Ask",
	})
	if err != nil {
		t.Fatalf("update error: %v", err)
	}
	if updated.SecurityPreset != "Full machine" {
		t.Fatalf("expected Full machine, got: %s", updated.SecurityPreset)
	}
}

// TestProjectSettings_CustomPresetPreservesPolicies vérifie que le preset
// "Custom" conserve les politiques déjà persistées au lieu de les écraser
// (BUG-SET-003).
func TestProjectSettings_CustomPresetPreservesPolicies(t *testing.T) {
	projectID := "custom-preset-test"

	// 1. Établit une base avec des politiques explicites via Full machine.
	if _, err := UpdateProjectSettings(projectID, ProjectSettings{
		SecurityPreset:       "Full machine",
		ArtifactReviewPolicy: "Always Ask",
	}); err != nil {
		t.Fatalf("seed error: %v", err)
	}

	// 2. Bascule sur Custom sans fournir de politiques → elles doivent être
	// conservées (pas remises aux défauts de "Default").
	updated, err := UpdateProjectSettings(projectID, ProjectSettings{
		SecurityPreset: "Custom",
	})
	if err != nil {
		t.Fatalf("update error: %v", err)
	}
	if updated.SecurityPreset != "Custom" {
		t.Fatalf("expected Custom, got: %s", updated.SecurityPreset)
	}
	if updated.FileAccessPolicy != "AGENT_SETTING_POLICY_ALLOW" {
		t.Fatalf("expected preserved ALLOW policy, got: %s", updated.FileAccessPolicy)
	}
	if updated.ArtifactReviewPolicy != "Always Ask" {
		t.Fatalf("expected preserved Always Ask, got: %s", updated.ArtifactReviewPolicy)
	}
}

// TestAccountPreferences_PersistRoundTrip vérifie que les préférences de
// compte survivent à un cycle set→load (BUG-SET-004).
func TestAccountPreferences_PersistRoundTrip(t *testing.T) {
	SetAccountPreferences(true, true)
	loadAccountPrefs()
	accountMu.RLock()
	tel := accountTelemetryEnabled
	mkt := accountMarketingEmails
	accountMu.RUnlock()
	if !tel || !mkt {
		t.Fatalf("expected persisted telemetry=true marketing=true, got %v/%v", tel, mkt)
	}

	SetAccountPreferences(false, false)
	loadAccountPrefs()
	accountMu.RLock()
	tel = accountTelemetryEnabled
	mkt = accountMarketingEmails
	accountMu.RUnlock()
	if tel || mkt {
		t.Fatalf("expected persisted telemetry=false marketing=false, got %v/%v", tel, mkt)
	}
}

