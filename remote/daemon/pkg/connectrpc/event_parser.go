package connectrpc

import (
	"strings"
	"unicode"
)

type EventKind string

const (
	EventKindText             EventKind = "text"
	EventKindThinking         EventKind = "thinking"
	EventKindApprovalRequired EventKind = "approval_required"
	EventKindSearchStarted    EventKind = "search_started"
	EventKindSearchCompleted  EventKind = "search_completed"
	EventKindRunnerStarted    EventKind = "runner_started"
	EventKindRunnerStdout     EventKind = "runner_stdout"
	EventKindRunnerCompleted  EventKind = "runner_completed"
	EventKindToolStarted      EventKind = "tool_started"
	EventKindToolOutput       EventKind = "tool_output"
	EventKindToolCompleted    EventKind = "tool_completed"
	EventKindStatusUpdate     EventKind = "status_update"
)

type StreamEvent struct {
	Kind         EventKind `json:"kind"`
	Delta        string    `json:"delta,omitempty"`
	Status       string    `json:"status,omitempty"`
	CascadeID    string    `json:"cascadeId,omitempty"`
	TrajectoryID string    `json:"trajectoryId,omitempty"`
	StepIndex    uint32    `json:"stepIndex,omitempty"`
	CallID       string    `json:"callId,omitempty"`
	Tool           string    `json:"tool,omitempty"`
	Detail         string    `json:"detail,omitempty"`
	Command        string    `json:"command,omitempty"`
	Output         string    `json:"output,omitempty"`
	RunID          string    `json:"runId,omitempty"`
	Sequence       uint64    `json:"sequence,omitempty"`
	InteractionNum int       `json:"interactionNum,omitempty"`
}

// ParseFrameEvents analyse une frame protobuf gRPC-Web et extrait les événements lisibles.
func ParseFrameEvents(raw []byte, cascadeID string) []StreamEvent {
	var events []StreamEvent
	fields := DecodeFields(raw)

	// 1. Vérification pour les frames d'interaction directe (HandleCascadeUserInteraction: field 1 = cascadeID, field 2 = interaction {1: trajectoryId, 2: stepIndex, 5..23: payload})
	for _, f := range fields {
		if f.Num == 2 && f.WireType == 2 {
			subFields := DecodeFields(f.Bytes)
			var trajectoryID string
			var stepIndex uint32
			var isInteraction bool
			var detectedTool string
			var detail string

			var interactionNum int
			for _, sub := range subFields {
				if sub.WireType == 0 && sub.Num == 2 {
					stepIndex = uint32(sub.Varint)
				}
				if sub.WireType == 2 && sub.Num == 1 && len(sub.Bytes) == 36 {
					trajectoryID = string(sub.Bytes)
				}
				if sub.Num == InteractionRunCommand || sub.Num == InteractionOpenBrowserURL ||
					sub.Num == InteractionReadUrlContent || sub.Num == InteractionFilePermission ||
					sub.Num == InteractionPermission || sub.Num == InteractionAskQuestion ||
					sub.Num == InteractionApproval || sub.Num == InteractionMcp ||
					sub.Num == InteractionDeploy || sub.Num == InteractionRunExtensionCode ||
					sub.Num == InteractionDeleteDirectory || sub.Num == InteractionSendCommandInput ||
					sub.Num == InteractionInvokeSubagent || sub.Num == InteractionCloudSQL {
					isInteraction = true
					interactionNum = sub.Num
					if sub.Num == InteractionRunCommand {
						detectedTool = "run_command"
					} else if sub.Num == InteractionFilePermission {
						detectedTool = "file_permission"
					} else if sub.Num == InteractionReadUrlContent || sub.Num == InteractionOpenBrowserURL {
						detectedTool = "read_url_content"
					} else if sub.Num == InteractionPermission {
						detectedTool = "permission"
					} else if sub.Num == InteractionAskQuestion {
						detectedTool = "ask_question"
					} else if sub.Num == InteractionMcp {
						detectedTool = "mcp_tool"
					} else if sub.Num == InteractionDeploy {
						detectedTool = "deploy"
					} else if sub.Num == InteractionRunExtensionCode {
						detectedTool = "run_extension_code"
					} else if sub.Num == InteractionDeleteDirectory {
						detectedTool = "delete_directory"
					} else if sub.Num == InteractionSendCommandInput {
						detectedTool = "send_command_input"
					} else if sub.Num == InteractionInvokeSubagent {
						detectedTool = "invoke_subagent"
					} else if sub.Num == InteractionCloudSQL {
						detectedTool = "cloudsql"
					}
					if len(sub.Bytes) > 0 {
						detail = string(sub.Bytes)
					}
				}
			}
			if isInteraction && (trajectoryID != "" || stepIndex > 0) {
				return []StreamEvent{{
					Kind:           EventKindApprovalRequired,
					CascadeID:      cascadeID,
					TrajectoryID:   trajectoryID,
					StepIndex:      stepIndex,
					Tool:           detectedTool,
					Detail:         detail,
					InteractionNum: interactionNum,
				}}
			}
		}
	}

	for _, f := range fields {
		if f.WireType != 2 || len(f.Bytes) == 0 {
			continue
		}
		rawStr := string(f.Bytes)
		s := strings.TrimSpace(rawStr)
		if s == "" {
			continue
		}

		// 1. Détection des blocs d'approbation JSON directs :
		trimmed := strings.TrimSpace(s)
		isJSON := strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")
		isToolJSON := isJSON && (strings.Contains(trimmed, `"run_command"`) ||
			strings.Contains(trimmed, `"write_to_file"`) ||
			strings.Contains(trimmed, `"read_file"`) ||
			strings.Contains(trimmed, `"edit_file"`) ||
			strings.Contains(trimmed, `"list_files"`) ||
			strings.Contains(trimmed, `"search_files"`) ||
			strings.Contains(trimmed, `"read_url"`) ||
			strings.Contains(trimmed, `"read_url_content"`) ||
			strings.Contains(trimmed, `"open_browser_url"`) ||
			strings.Contains(trimmed, `"browse"`) ||
			strings.Contains(trimmed, `"search_web"`) ||
			strings.Contains(trimmed, `"fetch"`) ||
			strings.Contains(trimmed, `"permission"`) ||
			strings.Contains(trimmed, `"ask_question"`) ||
			strings.Contains(trimmed, `"ask_user"`) ||
			strings.Contains(trimmed, `"mcp"`) ||
			strings.Contains(trimmed, `"mcp_tool"`) ||
			strings.Contains(trimmed, `"call_mcp_tool"`) ||
			strings.Contains(trimmed, `"tool"`) ||
			strings.Contains(trimmed, `"command"`))

		if isToolJSON {
			events = append(events, StreamEvent{
				Kind:         EventKindApprovalRequired,
				CascadeID:    cascadeID,
				TrajectoryID: firstUUID(s),
				Tool:         extractToolName(s),
				Detail:       s,
			})
			continue
		}

		// 2. Détection des frames binaires protobuf imbriquées (champ 1 = sous-message avec trajectoryID + stepIndex + JSON blob) :
		subFields := DecodeFields(f.Bytes)
		var trajectoryID string
		var stepIndex uint32
		var isNestedApproval bool
		var nestedTool string
		var nestedDetail string

		for _, sub := range subFields {
			if sub.WireType == 0 && sub.Num == 2 {
				stepIndex = uint32(sub.Varint)
			}
			if sub.WireType == 2 && sub.Num == 1 && len(sub.Bytes) == 36 {
				trajectoryID = string(sub.Bytes)
			}
			if sub.WireType == 2 && len(sub.Bytes) > 0 && sub.Num >= 3 {
				st := strings.TrimSpace(string(sub.Bytes))
				if strings.HasPrefix(st, "{") && strings.HasSuffix(st, "}") &&
					(strings.Contains(st, `"run_command"`) || strings.Contains(st, `"write_to_file"`) ||
						strings.Contains(st, `"read_file"`) || strings.Contains(st, `"edit_file"`) ||
						strings.Contains(st, `"list_files"`) || strings.Contains(st, `"search_files"`) ||
						strings.Contains(st, `"read_url"`) || strings.Contains(st, `"read_url_content"`) ||
						strings.Contains(st, `"open_browser_url"`) || strings.Contains(st, `"browse"`) ||
						strings.Contains(st, `"search_web"`) || strings.Contains(st, `"fetch"`) ||
						strings.Contains(st, `"permission"`) ||
						strings.Contains(st, `"ask_question"`) || strings.Contains(st, `"ask_user"`) ||
						strings.Contains(st, `"mcp"`) || strings.Contains(st, `"call_mcp_tool"`) || strings.Contains(st, `"mcp_tool"`) ||
						strings.Contains(st, `"tool"`)) {
					isNestedApproval = true
					nestedTool = extractToolName(st)
					nestedDetail = st
				}
			}
		}

		if isNestedApproval {
			events = append(events, StreamEvent{
				Kind:         EventKindApprovalRequired,
				CascadeID:    cascadeID,
				TrajectoryID: trajectoryID,
				StepIndex:    stepIndex,
				Tool:         nestedTool,
				Detail:       nestedDetail,
			})
			continue
		}

		// 3. Sinon c'est du texte ou du thinking (en préservant les espaces des tokens)
		if IsPrintable(rawStr) && len(rawStr) > 0 {
			if strings.Contains(rawStr, "<thought>") || strings.Contains(rawStr, "Thinking...") {
				events = append(events, StreamEvent{
					Kind:      EventKindThinking,
					Delta:     rawStr,
					CascadeID: cascadeID,
				})
			} else {
				events = append(events, StreamEvent{
					Kind:      EventKindText,
					Delta:     rawStr,
					CascadeID: cascadeID,
				})
			}
		}
	}

	return events
}

func extractToolName(s string) string {
	if strings.Contains(s, "ask_question") || strings.Contains(s, "ask_user") {
		return "ask_question"
	}
	if strings.Contains(s, "mcp_tool") || strings.Contains(s, "call_mcp_tool") || strings.Contains(s, "mcp") {
		return "mcp_tool"
	}
	if strings.Contains(s, "delete_directory") {
		return "delete_directory"
	}
	if strings.Contains(s, "send_command_input") || strings.Contains(s, "send_input") {
		return "send_command_input"
	}
	if strings.Contains(s, "invoke_subagent") || strings.Contains(s, "subagent") {
		return "invoke_subagent"
	}
	if strings.Contains(s, "deploy_firebase") || strings.Contains(s, "check_deploy_status") || strings.Contains(s, "deploy") {
		return "deploy"
	}
	if strings.Contains(s, "cloudsql") || strings.Contains(s, "execute_sql") || strings.Contains(s, "update_schema") {
		return "cloudsql"
	}
	if strings.Contains(s, "run_command") {
		return "run_command"
	}
	if strings.Contains(s, "write_to_file") || strings.Contains(s, "replace_file_content") {
		return "write_to_file"
	}
	if strings.Contains(s, "read_url_content") || strings.Contains(s, "read_url") || strings.Contains(s, "open_browser_url") || strings.Contains(s, "browse") {
		return "read_url_content"
	}
	if strings.Contains(s, "file_permission") {
		return "file_permission"
	}
	if strings.Contains(s, "permission") {
		return "permission"
	}
	// Outils de lecture/recherche : le blob JSON contient la clé de l'outil
	// ("read_file": "path"). Sans clé connue → generic_tool (non auto-accepté).
	for _, k := range []string{"read_file", "edit_file", "list_files", "search_files", "grep", "glob", "fetch", "search_web"} {
		if strings.Contains(s, k) {
			return k
		}
	}
	return "generic_tool"
}

// IsPrintable vérifie qu'une chaîne ne contient que des caractères imprimables
// (ASCII + UTF-8 : accents, CJK, symboles) ou des retours à la ligne.
// Utilisé pour filtrer les octets binaires des flux protobuf.
func IsPrintable(s string) bool {
	for _, r := range s {
		if unicode.IsPrint(r) {
			continue
		}
		if r == '\n' || r == '\t' || r == '\r' {
			continue
		}
		return false
	}
	return true
}
