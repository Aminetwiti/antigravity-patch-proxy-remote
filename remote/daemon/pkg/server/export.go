package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/security/redaction"
)

type SessionExport struct {
	SessionID     string                 `json:"sessionId"`
	Title         string                 `json:"title"`
	WorkspaceID   string                 `json:"workspaceId"`
	State         string                 `json:"state"`
	CreatedAt     time.Time              `json:"createdAt"`
	DurationSec   int                    `json:"durationSec"`
	TotalEvents   int                    `json:"totalEvents"`
	ToolCounts    map[string]int         `json:"toolCounts"`
	Timeline      []TimelineItem         `json:"timeline"`
	FinalResponse string                 `json:"finalResponse,omitempty"`
}

type TimelineItem struct {
	Timestamp int64  `json:"timestamp"`
	Type      string `json:"type"`
	Summary   string `json:"summary"`
	Detail    string `json:"detail,omitempty"`
}

func BuildSessionExport(ctx context.Context, store eventstore.EventStore, sessionID string) (*SessionExport, error) {
	sess, err := store.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session not found: %w", err)
	}

	events, err := store.GetEventsSince(ctx, sessionID, 0, 10000)
	if err != nil {
		return nil, fmt.Errorf("failed reading session events: %w", err)
	}

	export := &SessionExport{
		SessionID:   sess.ID,
		Title:       redaction.Redact(sess.Title),
		WorkspaceID: sess.WorkspaceID,
		State:       string(sess.State),
		CreatedAt:   sess.CreatedAt,
		TotalEvents: len(events),
		ToolCounts:  make(map[string]int),
		Timeline:    make([]TimelineItem, 0, len(events)),
	}

	var lastTimestamp int64 = sess.CreatedAt.UnixMilli()

	for _, ev := range events {
		if ev.Timestamp > lastTimestamp {
			lastTimestamp = ev.Timestamp
		}

		switch ev.Type {
		case "user.message":
			var p struct{ Text string `json:"text"` }
			_ = json.Unmarshal(ev.Payload, &p)
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "User Prompt",
				Summary:   redaction.Redact(p.Text),
			})

		case "agent.thought":
			var p struct {
				Thought string `json:"thought"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			summary := redaction.Redact(p.Message)
			if summary == "" {
				summary = redaction.Redact(p.Thought)
			}
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Agent Thought",
				Summary:   summary,
				Detail:    redaction.Redact(p.Thought),
			})
			if p.Message != "" {
				export.FinalResponse = redaction.Redact(p.Message)
			}

		case "tool.call":
			var p struct {
				Name       string          `json:"name"`
				Parameters json.RawMessage `json:"parameters"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			export.ToolCounts[p.Name]++
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Tool Call: " + p.Name,
				Summary:   fmt.Sprintf("Invoked %s", p.Name),
				Detail:    redaction.Redact(string(p.Parameters)),
			})

		case "tool.result":
			var p struct {
				Output  string `json:"output"`
				Success bool   `json:"success"`
				Error   string `json:"error"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			status := "Success"
			if !p.Success {
				status = "Failed"
			}
			summary := fmt.Sprintf("Result: %s", status)
			if p.Error != "" {
				summary += " - " + redaction.Redact(p.Error)
			}
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Tool Result",
				Summary:   summary,
				Detail:    redaction.Redact(p.Output),
			})

		case "approval.requested":
			var p struct {
				ToolName string `json:"toolName"`
				Reason   string `json:"reason"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Approval Required",
				Summary:   fmt.Sprintf("Approval requested for %s: %s", p.ToolName, redaction.Redact(p.Reason)),
			})

		case "subagent.started":
			var p struct {
				Role string `json:"role"`
				Task string `json:"task"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Subagent Delegated",
				Summary:   fmt.Sprintf("[%s] %s", p.Role, redaction.Redact(p.Task)),
			})

		case "subagent.completed":
			var p struct {
				Role   string `json:"role"`
				Result string `json:"result"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Subagent Completed",
				Summary:   fmt.Sprintf("[%s] delegation finished", p.Role),
				Detail:    redaction.Redact(p.Result),
			})

		case "session.checkpoint_created":
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Checkpoint",
				Summary:   "Git workspace state captured",
			})

		case "session.rolled_back":
			export.Timeline = append(export.Timeline, TimelineItem{
				Timestamp: ev.Timestamp,
				Type:      "Rollback",
				Summary:   "Workspace rolled back to previous checkpoint",
			})
		}
	}

	export.DurationSec = int((lastTimestamp - sess.CreatedAt.UnixMilli()) / 1000)
	if export.DurationSec < 0 {
		export.DurationSec = 0
	}

	return export, nil
}

func FormatSessionMarkdown(export *SessionExport) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("# Session Post-Mortem: %s\n\n", export.Title))
	sb.WriteString(fmt.Sprintf("- **Session ID**: `%s`\n", export.SessionID))
	sb.WriteString(fmt.Sprintf("- **Workspace**: `%s`\n", export.WorkspaceID))
	sb.WriteString(fmt.Sprintf("- **Final State**: `%s`\n", export.State))
	sb.WriteString(fmt.Sprintf("- **Duration**: %d seconds\n", export.DurationSec))
	sb.WriteString(fmt.Sprintf("- **Total Events Logged**: %d\n\n", export.TotalEvents))

	sb.WriteString("## Tool Usage Summary\n\n")
	if len(export.ToolCounts) == 0 {
		sb.WriteString("No tools were invoked during this session.\n\n")
	} else {
		sb.WriteString("| Tool Name | Invocations |\n|---|---|\n")
		for tool, count := range export.ToolCounts {
			sb.WriteString(fmt.Sprintf("| `%s` | %d |\n", tool, count))
		}
		sb.WriteString("\n")
	}

	if export.FinalResponse != "" {
		sb.WriteString("## Final Assistant Outcome\n\n")
		sb.WriteString(export.FinalResponse)
		sb.WriteString("\n\n")
	}

	sb.WriteString("## Chronological Trajectory\n\n")
	for i, item := range export.Timeline {
		t := time.UnixMilli(item.Timestamp).UTC().Format("15:04:05")
		sb.WriteString(fmt.Sprintf("### %d. [%s] %s\n", i+1, t, item.Type))
		sb.WriteString(item.Summary + "\n")
		if item.Detail != "" && item.Detail != item.Summary {
			sb.WriteString("\n```\n" + strings.TrimSpace(item.Detail) + "\n```\n")
		}
		sb.WriteString("\n")
	}

	return sb.String()
}
