package gateway

import (
	"fmt"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/ide"
	"github.com/gorilla/websocket"
)

// IsIDESupportedAction indique si une action concerne les services Antigravity IDE.
func (s *Server) IsIDESupportedAction(action string) bool {
	switch action {
	case "ide.list_workspaces", "ide.list_sessions", "ide.create_session", "ide.send_prompt", "ide.focus", "ide.status":
		return true
	default:
		return false
	}
}

// handleIDEMessage route et traite les requêtes WebSocket destinées à Antigravity IDE.
func (s *Server) handleIDEMessage(conn *websocket.Conn, msg IncomingMessage) {
	switch msg.Type {
	case "ide.list_workspaces":
		workspaces, err := ide.ListWorkspaces()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("erreur lecture workspaces IDE: %v", err),
			})
			return
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"workspaces": workspaces,
			},
		})

	case "ide.list_sessions":
		sessions, err := ide.ListSessions()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("erreur lecture sessions IDE: %v", err),
			})
			return
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"sessions": sessions,
			},
		})

	case "ide.status":
		instances, err := ide.DiscoverInstances()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("erreur découverte IDE: %v", err),
			})
			return
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"instances": instances,
				"active":    len(instances) > 0,
			},
		})

	case "ide.create_session":
		client, err := ide.NewAutoClient()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("aucune instance IDE active: %v", err),
			})
			return
		}

		wsPath := msg.WorkspacePath
		if wsPath == "" && msg.Data != nil {
			if p, ok := msg.Data["workspacePath"].(string); ok {
				wsPath = p
			}
		}

		model := msg.ModelUID
		if model == "" && msg.Data != nil {
			if m, ok := msg.Data["model"].(string); ok {
				model = m
			}
		}

		cascadeID, err := client.CreateSession(wsPath, model)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("échec création session IDE: %v", err),
			})
			return
		}

		// Focus automatique
		_ = client.SetFocus(cascadeID)

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": cascadeID,
				"status":    "created",
			},
		})

	case "ide.focus":
		cascadeID := msg.CascadeID
		if cascadeID == "" && msg.Data != nil {
			if c, ok := msg.Data["cascadeId"].(string); ok {
				cascadeID = c
			}
		}
		if cascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "cascadeId requis pour focus",
			})
			return
		}

		client, err := ide.NewAutoClient()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("erreur connexion IDE: %v", err),
			})
			return
		}

		if err := client.SetFocus(cascadeID); err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("échec focus IDE: %v", err),
			})
			return
		}

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": cascadeID,
				"focused":   true,
			},
		})

	case "ide.send_prompt":
		cascadeID := msg.CascadeID
		prompt := msg.Prompt
		if cascadeID == "" && msg.Data != nil {
			if c, ok := msg.Data["cascadeId"].(string); ok {
				cascadeID = c
			}
			if t, ok := msg.Data["prompt"].(string); ok && prompt == "" {
				prompt = t
			}
		}

		if cascadeID == "" || prompt == "" {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "cascadeId et prompt requis pour send_prompt",
			})
			return
		}

		client, err := ide.NewAutoClient()
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     fmt.Sprintf("connexion IDE impossible: %v", err),
			})
			return
		}

		// Acquitter le début de traitement
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"status": "streaming_started",
			},
		})

		// Diffuser le début du stream aux clients
		s.broadcast(OutgoingMessage{
			Type:      "stream_start",
			CascadeID: cascadeID,
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"userPrompt": prompt,
				"shellType":  "ide",
			},
		})

		// Streamer en tâche de fond
		go func() {
			errStream := client.SendMessageStream(cascadeID, prompt, func(ev connectrpc.StreamEvent) {
				deltaType := "stream_delta"
				var eventData map[string]interface{}
				if ev.Kind == connectrpc.EventKindThinking {
					eventData = map[string]interface{}{
						"thinkingDelta": ev.Delta,
						"stepIndex":     ev.StepIndex,
					}
				} else {
					eventData = map[string]interface{}{
						"delta":     ev.Delta,
						"stepIndex": ev.StepIndex,
					}
				}

				s.broadcast(OutgoingMessage{
					Type:      deltaType,
					CascadeID: cascadeID,
					RequestID: msg.RequestID,
					Data:      eventData,
				})
			})

			// Clôturer le stream
			s.broadcast(OutgoingMessage{
				Type:      "stream_end",
				CascadeID: cascadeID,
				RequestID: msg.RequestID,
				Data: map[string]interface{}{
					"status": map[bool]string{true: "done", false: "error"}[errStream == nil],
					"error":  map[bool]string{true: "", false: fmt.Sprintf("%v", errStream)}[errStream == nil],
				},
			})

			// Forcer le focus et rafraîchissement du Webview
			_ = client.SetFocus(cascadeID)
		}()
	}
}
