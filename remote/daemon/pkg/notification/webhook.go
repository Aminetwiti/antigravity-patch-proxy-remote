package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/security"
)

// WebhookDispatcher dispatches real-time domain events to external webhooks (Slack, Discord, Generic HTTP POST).
// Runs asynchronously with a worker channel to prevent blocking event emission or SQLite transactions.
type WebhookDispatcher struct {
	webhookURLs []string
	client      *http.Client
	allowLocal  bool
	eventQueue  chan domain.Event
	done        chan struct{}
	wg          sync.WaitGroup
	mu          sync.RWMutex
	enabled     bool
}

// NewWebhookDispatcher creates a background webhook dispatcher with SSRF protection.
// webhookURLs can be comma-separated or single URLs.
func NewWebhookDispatcher(rawURLs string) *WebhookDispatcher {
	var urls []string
	for _, u := range strings.Split(rawURLs, ",") {
		u = strings.TrimSpace(u)
		if u != "" {
			urls = append(urls, u)
		}
	}

	d := &WebhookDispatcher{
		webhookURLs: urls,
		client:      security.NewSSRFProtectedClient(10 * time.Second),
		allowLocal:  false,
		eventQueue:  make(chan domain.Event, 200),
		done:        make(chan struct{}),
		enabled:     len(urls) > 0,
	}

	if d.enabled {
		d.wg.Add(1)
		go d.worker()
	}

	return d
}

// SetClientForTesting allows setting a custom HTTP client and disabling SSRF checks for tests.
func (d *WebhookDispatcher) SetClientForTesting(client *http.Client, allowLocal bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.client = client
	d.allowLocal = allowLocal
}

// AddWebhookURL dynamically adds a destination webhook URL.
func (d *WebhookDispatcher) AddWebhookURL(url string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	url = strings.TrimSpace(url)
	if url == "" {
		return
	}
	d.webhookURLs = append(d.webhookURLs, url)
	if !d.enabled {
		d.enabled = true
		d.wg.Add(1)
		go d.worker()
	}
}

// OnDomainEvent receives a domain event and queues it if relevant for alerting.
func (d *WebhookDispatcher) OnDomainEvent(evt domain.Event) {
	d.mu.RLock()
	enabled := d.enabled
	d.mu.RUnlock()

	if !enabled {
		return
	}

	// Filter only high-value notification events to avoid spamming webhooks
	switch evt.Type {
	case "approval.requested", "approval.timeout", "session.state_changed", "schedule.executed", "subagent.completed", "subagent.failed":
		select {
		case d.eventQueue <- evt:
		default:
			// Queue full; discard rather than block
		}
	}
}

func (d *WebhookDispatcher) worker() {
	defer d.wg.Done()

	for {
		select {
		case <-d.done:
			return
		case evt := <-d.eventQueue:
			d.sendEvent(evt)
		}
	}
}

func (d *WebhookDispatcher) sendEvent(evt domain.Event) {
	d.mu.RLock()
	urls := make([]string, len(d.webhookURLs))
	copy(urls, d.webhookURLs)
	d.mu.RUnlock()

	for _, rawURL := range urls {
		if !d.allowLocal {
			if err := security.ValidateURL(rawURL); err != nil {
				continue
			}
		}

		payloadBytes, contentType := formatPayload(rawURL, evt)
		if len(payloadBytes) == 0 {
			continue
		}

		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, rawURL, bytes.NewReader(payloadBytes))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "ag-agentd-webhook/1.0")

		resp, err := d.client.Do(req)
		if err != nil {
			continue
		}
		_ = resp.Body.Close()
	}
}

func formatPayload(targetURL string, evt domain.Event) ([]byte, string) {
	lower := strings.ToLower(targetURL)
	isDiscord := strings.Contains(lower, "discord.com/api/webhooks") || strings.Contains(lower, "/api/webhooks")
	isSlack := strings.Contains(lower, "hooks.slack.com") || strings.Contains(lower, "slack.com")

	title, description, color := buildAlertSummary(evt)
	if title == "" {
		return nil, ""
	}

	if isDiscord {
		// Discord Webhook format
		discordPayload := map[string]interface{}{
			"embeds": []map[string]interface{}{
				{
					"title":       title,
					"description": description,
					"color":       color,
					"timestamp":   time.Now().UTC().Format(time.RFC3339),
					"footer": map[string]string{
						"text": fmt.Sprintf("Session: %s", evt.SessionID),
					},
				},
			},
		}
		b, _ := json.Marshal(discordPayload)
		return b, "application/json"
	}

	if isSlack {
		// Slack Webhook format
		slackPayload := map[string]interface{}{
			"text": fmt.Sprintf("*%s*\n%s\n_Session: `%s`_", title, description, evt.SessionID),
		}
		b, _ := json.Marshal(slackPayload)
		return b, "application/json"
	}

	// Generic Webhook format
	genericPayload := map[string]interface{}{
		"event":       evt.Type,
		"sessionId":   evt.SessionID,
		"timestamp":   evt.Timestamp,
		"title":       title,
		"description": description,
		"rawPayload":  json.RawMessage(evt.Payload),
	}
	b, _ := json.Marshal(genericPayload)
	return b, "application/json"
}

func buildAlertSummary(evt domain.Event) (title, description string, color int) {
	switch evt.Type {
	case "approval.requested":
		var p struct {
			ToolName   string          `json:"toolName"`
			Parameters json.RawMessage `json:"parameters"`
			Reason     string          `json:"reason"`
			ApprovalID string          `json:"id"`
		}
		_ = json.Unmarshal(evt.Payload, &p)
		title = "⚠️ Human Approval Required"
		description = fmt.Sprintf("Agent requested tool execution: **`%s`**\nReason: %s\nApproval ID: `%s`", p.ToolName, p.Reason, p.ApprovalID)
		color = 0xf59e0b // Amber

	case "approval.timeout":
		title = "⌛ Approval Timed Out"
		description = "Approval request timed out without user intervention. Execution denied."
		color = 0xef4444 // Red

	case "session.state_changed":
		var p struct {
			State  string `json:"state"`
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(evt.Payload, &p)
		switch p.State {
		case "COMPLETED":
			title = "✅ Agent Session Completed"
			description = fmt.Sprintf("Session finished successfully.\n%s", p.Reason)
			color = 0x10b981 // Green
		case "FAILED":
			title = "❌ Agent Session Failed"
			description = fmt.Sprintf("Session encountered an error.\n%s", p.Reason)
			color = 0xef4444 // Red
		default:
			return "", "", 0 // Skip non-terminal state transitions to prevent noise
		}

	case "schedule.executed":
		var p struct {
			JobID string `json:"jobId"`
			Name  string `json:"name"`
		}
		_ = json.Unmarshal(evt.Payload, &p)
		title = "⏰ Scheduled Job Executed"
		description = fmt.Sprintf("Automated background job **`%s`** (`%s`) triggered.", p.Name, p.JobID)
		color = 0x3b82f6 // Blue

	case "subagent.completed":
		var p struct {
			Role   string `json:"role"`
			Task   string `json:"task"`
			Result string `json:"result"`
		}
		_ = json.Unmarshal(evt.Payload, &p)
		title = "👥 Subagent Delegation Completed"
		description = fmt.Sprintf("Subagent (**%s**) finished task: %s", p.Role, p.Task)
		color = 0x8b5cf6 // Purple

	default:
		return "", "", 0
	}

	return title, description, color
}

// Close stops the worker cleanly.
func (d *WebhookDispatcher) Close() {
	d.mu.Lock()
	if !d.enabled {
		d.mu.Unlock()
		return
	}
	d.enabled = false
	d.mu.Unlock()

	close(d.done)
	d.wg.Wait()
}
