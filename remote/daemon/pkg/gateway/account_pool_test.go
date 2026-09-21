package gateway

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestAccountPool_EnvJSONParsing(t *testing.T) {
	testJSON := `[
		{"email": "test1@example.com", "refresh_token": "rt1"},
		{"email": "test2@example.com", "refresh_token": "rt2"}
	]`

	os.Setenv("AG_ACCOUNTS_JSON", testJSON)
	defer os.Unsetenv("AG_ACCOUNTS_JSON")

	pool := NewAccountPool()
	accounts := pool.ListAccounts()
	if len(accounts) != 2 {
		t.Fatalf("expected 2 accounts, got %d", len(accounts))
	}
	if accounts[0].Email != "test1@example.com" || !accounts[0].IsActive {
		t.Errorf("expected test1@example.com to be active, got %+v", accounts[0])
	}
	if accounts[1].Email != "test2@example.com" || accounts[1].IsActive {
		t.Errorf("expected test2@example.com to be standby, got %+v", accounts[1])
	}

	// Test switch
	switched, err := pool.SwitchAccount("test2@example.com")
	if err != nil {
		t.Fatalf("unexpected switch error: %v", err)
	}
	if switched.Email != "test2@example.com" || switched.Status != "active" {
		t.Errorf("unexpected switched account: %+v", switched)
	}

	active := pool.GetActiveAccount()
	if active.Email != "test2@example.com" {
		t.Errorf("expected active email test2@example.com, got %s", active.Email)
	}

	// Test auto rotate
	rotated, err := pool.RotateNext("quota_exhausted")
	if err != nil {
		t.Fatalf("unexpected rotate error: %v", err)
	}
	if rotated.Email != "test1@example.com" {
		t.Errorf("expected rotated email test1@example.com, got %s", rotated.Email)
	}
}

func TestAccountPool_EnvFileParsing(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "accounts.json")
	content := `[
		{"email": "file1@domain.com", "refresh_token": "tok1"},
		{"email": "file2@domain.com", "refresh_token": "tok2"}
	]`
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	os.Setenv("AG_ACCOUNTS_FILE", filePath)
	os.Setenv("AG_ACTIVE_ACCOUNT", "file2@domain.com")
	defer func() {
		os.Unsetenv("AG_ACCOUNTS_FILE")
		os.Unsetenv("AG_ACTIVE_ACCOUNT")
	}()

	pool := NewAccountPool()
	active := pool.GetActiveAccount()
	if active.Email != "file2@domain.com" {
		t.Errorf("expected active account file2@domain.com from AG_ACTIVE_ACCOUNT, got %s", active.Email)
	}
}

func TestAccountPool_Concurrency(t *testing.T) {
	pool := &AccountPool{
		accounts: []*AccountEntry{
			{Email: "acc1@test.com", Status: "active"},
			{Email: "acc2@test.com", Status: "standby"},
			{Email: "acc3@test.com", Status: "standby"},
		},
		activeIndex: 0,
		autoRotate:  true,
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func(id int) {
			defer wg.Done()
			_ = pool.GetActiveAccount()
			_ = pool.ListAccounts()
		}(i)
		go func(id int) {
			defer wg.Done()
			if id%2 == 0 {
				_, _ = pool.RotateNext("quota_exhausted")
			} else {
				_, _ = pool.SwitchAccount("acc2@test.com")
			}
		}(i)
	}
	wg.Wait()
}

func TestWebSocket_AccountSwitchRPC(t *testing.T) {
	testJSON := `[
		{"email": "alpha@pool.com", "refresh_token": "rtA"},
		{"email": "beta@pool.com", "refresh_token": "rtB"}
	]`
	os.Setenv("AG_ACCOUNTS_JSON", testJSON)
	defer os.Unsetenv("AG_ACCOUNTS_JSON")

	// Re-init global pool with test env
	globalPool = NewAccountPool()

	ts, _ := newTestServerWithGW(nil)
	defer ts.Close()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// 1. Check get_account_info returns accounts list
	req := map[string]string{
		"type":      "get_account_info",
		"requestId": "req-acc-info",
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("write: %v", err)
	}

	var resp struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read: %v", err)
	}

	if resp.Data["email"] == nil || resp.Data["email"] != "alpha@pool.com" {
		t.Errorf("expected active email alpha@pool.com, got %v", resp.Data["email"])
	}
	accountsRaw, ok := resp.Data["accounts"].([]interface{})
	if !ok || len(accountsRaw) != 2 {
		t.Fatalf("expected 2 accounts in accounts list, got %v", resp.Data["accounts"])
	}

	// 2. Switch account to beta@pool.com
	switchReq := map[string]interface{}{
		"type":      "switch_account",
		"requestId": "req-switch",
		"data": map[string]string{
			"email": "beta@pool.com",
		},
	}
	if err := conn.WriteJSON(switchReq); err != nil {
		t.Fatalf("write switch: %v", err)
	}

	var switchResp struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&switchResp); err != nil {
		t.Fatalf("read switch resp: %v", err)
	}
	if switchResp.Data["ok"] != true || switchResp.Data["email"] != "beta@pool.com" {
		t.Errorf("unexpected switch response: %+v", switchResp.Data)
	}

	// 2b. Check broadcast event account_switched
	var broadcastMsg struct {
		Type string                 `json:"type"`
		Data map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&broadcastMsg); err != nil {
		t.Fatalf("read broadcast: %v", err)
	}
	if broadcastMsg.Type != "account_switched" || broadcastMsg.Data["email"] != "beta@pool.com" {
		t.Errorf("expected account_switched broadcast, got %+v", broadcastMsg)
	}

	// 3. Set auto-rotate
	rotateToggleReq := map[string]interface{}{
		"type":      "set_auto_rotate",
		"requestId": "req-auto-rotate",
		"data": map[string]bool{
			"enabled": false,
		},
	}
	if err := conn.WriteJSON(rotateToggleReq); err != nil {
		t.Fatalf("write auto rotate: %v", err)
	}
	var rotateResp struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&rotateResp); err != nil {
		t.Fatalf("read rotate resp: %v", err)
	}
	if rotateResp.Data["autoRotateEnabled"] != false {
		t.Errorf("expected autoRotateEnabled false, got %+v", rotateResp.Data)
	}
}

func TestAccountPool_SelectBestAccountForModel(t *testing.T) {
	pool := &AccountPool{
		accounts: []*AccountEntry{
			{
				Email:  "acc1@test.com",
				Status: "standby",
				Quotas: []ModelQuotaInfo{
					{Name: "claude-sonnet-4-6", Percentage: 10},
					{Name: "gemini-2.5-pro", Percentage: 100},
				},
			},
			{
				Email:  "acc2@test.com",
				Status: "standby",
				Quotas: []ModelQuotaInfo{
					{Name: "claude-sonnet-4-6", Percentage: 95},
					{Name: "gemini-2.5-pro", Percentage: 30},
				},
			},
		},
		activeIndex: 0,
		autoRotate:  true,
	}

	// acc1 is active, has 10% on Claude (< 20%) -> should switch to acc2 which has 95%
	best, err := pool.SelectBestAccountForModel("claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("unexpected select error: %v", err)
	}
	if best.Email != "acc2@test.com" {
		t.Errorf("expected acc2@test.com for Claude, got %s", best.Email)
	}

	// acc2 is active, has 30% on Gemini (> 20%) -> should retain acc2
	best2, err := pool.SelectBestAccountForModel("gemini-2.5-pro")
	if err != nil {
		t.Fatalf("unexpected select error: %v", err)
	}
	if best2.Email != "acc2@test.com" {
		t.Errorf("expected acc2@test.com retained for Gemini, got %s", best2.Email)
	}
}

func TestAccountPool_WatchdogAutoReset(t *testing.T) {
	pastTime := time.Now().Add(-10 * time.Minute).Format(time.RFC3339)
	futureTime := time.Now().Add(10 * time.Minute).Format(time.RFC3339)

	recoveredCalled := false
	pool := &AccountPool{
		accounts: []*AccountEntry{
			{
				Email:  "exhausted_ready@test.com",
				Status: "exhausted",
				Quotas: []ModelQuotaInfo{
					{Name: "gemini-2.5-pro", Percentage: 0, ResetTime: pastTime},
				},
			},
			{
				Email:  "exhausted_waiting@test.com",
				Status: "exhausted",
				Quotas: []ModelQuotaInfo{
					{Name: "gemini-2.5-pro", Percentage: 0, ResetTime: futureTime},
				},
			},
		},
		activeIndex: 0,
	}
	pool.SetOnAccountRecovered(func(acc AccountEntry) {
		if acc.Email == "exhausted_ready@test.com" {
			recoveredCalled = true
		}
	})

	recovered := pool.CheckAndResetExhaustedAccounts()
	if len(recovered) != 1 {
		t.Fatalf("expected 1 recovered account, got %d", len(recovered))
	}
	if recovered[0].Email != "exhausted_ready@test.com" {
		t.Errorf("expected exhausted_ready@test.com, got %s", recovered[0].Email)
	}
	if !recoveredCalled {
		t.Errorf("expected OnAccountRecovered callback to be called")
	}

	// Verify state in pool
	for _, acc := range pool.accounts {
		if acc.Email == "exhausted_ready@test.com" {
			if acc.Status != "active" { // activeIndex was 0
				t.Errorf("expected status active, got %s", acc.Status)
			}
			if acc.Quotas[0].Percentage != 100 {
				t.Errorf("expected percentage 100, got %d", acc.Quotas[0].Percentage)
			}
		}
		if acc.Email == "exhausted_waiting@test.com" {
			if acc.Status != "exhausted" {
				t.Errorf("expected status exhausted, got %s", acc.Status)
			}
			if acc.Quotas[0].Percentage != 0 {
				t.Errorf("expected percentage 0, got %d", acc.Quotas[0].Percentage)
			}
		}
	}
}

func TestWebSocket_AccountSelectBestRPC(t *testing.T) {
	testJSON := `[
		{"email": "claude_low@pool.com", "refresh_token": "rt1", "quotas": [{"name": "claude-sonnet-4-6", "percentage": 5}]},
		{"email": "claude_high@pool.com", "refresh_token": "rt2", "quotas": [{"name": "claude-sonnet-4-6", "percentage": 90}]}
	]`
	os.Setenv("AG_ACCOUNTS_JSON", testJSON)
	defer os.Unsetenv("AG_ACCOUNTS_JSON")

	globalPool = NewAccountPool()

	ts, _ := newTestServerWithGW(nil)
	defer ts.Close()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Select best account for claude
	req := map[string]interface{}{
		"type":      "select_best_account",
		"requestId": "req-best-claude",
		"data": map[string]string{
			"model": "claude",
		},
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("write select_best: %v", err)
	}

	var resp struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read: %v", err)
	}
	if resp.Data["ok"] != true || resp.Data["email"] != "claude_high@pool.com" {
		t.Errorf("expected claude_high@pool.com to be selected, got %+v", resp.Data)
	}
}

