package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

// TestAllApprovals_FilePermission vérifie l'approbation d'accès fichier hors workspace.
func TestAllApprovals_FilePermission(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	gw.MarkApprovalPending("casc-file-1", connectrpc.StreamEvent{
		CallID:         "call-file-1",
		TrajectoryID:   "traj-file-1",
		StepIndex:      401,
		Tool:           "file_permission",
		Detail:         `{"filePath":"C:/Users/system/secret.key"}`,
		InteractionNum: connectrpc.InteractionFilePermission,
	})

	info := gw.pendingApprovalInfo("casc-file-1")
	if info == nil || info["command"] != "C:/Users/system/secret.key" {
		t.Fatalf("info incorrect: %v", info)
	}

	submitJSON := `{"type":"submit_approval","requestId":"req-file","cascadeId":"casc-file-1","callId":"call-file-1","trajectoryId":"traj-file-1","stepIndex":401,"decision":"allow","approvalType":"file_permission","filePath":"C:/Users/system/secret.key","scope":"session"}`
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(submitJSON)); err != nil {
		t.Fatalf("Erreur envoi: %v", err)
	}

	client.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("Erreur lecture: %v", err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(b, &msg); err != nil {
			continue
		}
		if msg["type"] == "approval_resolved" {
			data, _ := msg["data"].(map[string]interface{})
			if data["source"] != "remote" || data["approvalType"] != "file_permission" {
				t.Fatalf("approval_resolved inattendu: %+v", data)
			}
			break
		}
	}
	client.conn.SetReadDeadline(time.Time{})

	if fake.submitted != 1 {
		t.Fatalf("SubmitToolApproval non appelé")
	}
}

// TestAllApprovals_DesktopResolutionForAllTypes vérifie que la résolution Desktop
// ferme immédiatement n'importe quel type d'approbation sur le mobile.
func TestAllApprovals_DesktopResolutionForAllTypes(t *testing.T) {
	tools := []struct {
		name string
		num  int
	}{
		{"run_command", connectrpc.InteractionRunCommand},
		{"file_permission", connectrpc.InteractionFilePermission},
		{"read_url_content", connectrpc.InteractionReadUrlContent},
		{"mcp_tool", connectrpc.InteractionMcp},
		{"deploy", connectrpc.InteractionDeploy},
		{"send_command_input", connectrpc.InteractionSendCommandInput},
		{"invoke_subagent", connectrpc.InteractionInvokeSubagent},
		{"delete_directory", connectrpc.InteractionDeleteDirectory},
		{"browser_action", connectrpc.InteractionBrowserAction},
		{"cloudsql", connectrpc.InteractionCloudSQL},
	}

	for _, tc := range tools {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeApprovalRPC{}
			ts, gw := newTestServerWithGW(fake)
			defer ts.Close()

			client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
			defer client.conn.Close()

			cascID := "casc-res-" + tc.name
			gw.MarkApprovalPending(cascID, connectrpc.StreamEvent{
				CallID:         "call-res-" + tc.name,
				TrajectoryID:   "traj-res-1",
				StepIndex:      500,
				Tool:           tc.name,
				InteractionNum: tc.num,
			})

			if !gw.hasPendingApproval(cascID) {
				t.Fatalf("l'approbation %s doit être active", tc.name)
			}

			// Simulation de la résolution Desktop : WaitingForInput passe à false
			gw.reactiveSyncUpdates(map[string]connectrpc.ReactiveUpdate{
				cascID: {
					CascadeID:       cascID,
					WaitingForInput: false,
				},
			})

			if gw.hasPendingApproval(cascID) {
				t.Fatalf("l'approbation %s doit être nettoyée suite à la validation desktop", tc.name)
			}

			client.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			var seenResolved bool
			for !seenResolved {
				_, b, err := client.conn.ReadMessage()
				if err != nil {
					t.Fatalf("Erreur lecture: %v", err)
				}
				var msg map[string]interface{}
				if err := json.Unmarshal(b, &msg); err != nil {
					continue
				}
				if msg["type"] == "approval_resolved" {
					seenResolved = true
					data, _ := msg["data"].(map[string]interface{})
					if data["source"] != "desktop" {
						t.Fatalf("Attendu source='desktop', reçu %v", data["source"])
					}
				}
			}
			client.conn.SetReadDeadline(time.Time{})
		})
	}
}

// TestApprovalConflict_SecondSubmissionHandledCleanly vérifie l'arbitrage
// atomique : une deuxième soumission concurrente renvoie already_resolved
// avec conflict: true sans bloquer ni causer d'erreur fatale.
func TestApprovalConflict_SecondSubmissionHandledCleanly(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Déclarer une approbation
	gw.MarkApprovalPending("casc-conflict-1", connectrpc.StreamEvent{
		CallID:         "call-conf-1",
		TrajectoryID:   "traj-conf-1",
		StepIndex:      601,
		Tool:           "run_command",
		InteractionNum: connectrpc.InteractionRunCommand,
	})

	// 2. Première soumission mobile : réussit
	submit1 := `{"type":"submit_approval","requestId":"req-1","cascadeId":"casc-conflict-1","callId":"call-conf-1","trajectoryId":"traj-conf-1","stepIndex":601,"decision":"allow","approvalType":"run_command"}`
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(submit1)); err != nil {
		t.Fatalf("Erreur envoi submit1: %v", err)
	}

	// 3. Deuxième soumission concurrente : l'approbation locale a été retirée
	submit2 := `{"type":"submit_approval","requestId":"req-2","cascadeId":"casc-conflict-1","callId":"call-conf-1","trajectoryId":"traj-conf-1","stepIndex":601,"decision":"deny","approvalType":"run_command"}`
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(submit2)); err != nil {
		t.Fatalf("Erreur envoi submit2: %v", err)
	}

	// 4. Vérifier les réponses : l'une doit être "submitted", l'autre doit être "already_resolved" avec conflict: true
	client.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var seenSubmitted, seenConflict bool
	for !seenSubmitted || !seenConflict {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("Erreur lecture: %v", err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(b, &msg); err != nil {
			continue
		}
		if msg["type"] == "response" {
			data, _ := msg["data"].(map[string]interface{})
			if data["status"] == "submitted" {
				seenSubmitted = true
			} else if data["status"] == "already_resolved" && data["conflict"] == true {
				seenConflict = true
			}
		}
	}
	client.conn.SetReadDeadline(time.Time{})

	if !seenSubmitted || !seenConflict {
		t.Fatalf("Attendu 1 soumission acceptée et 1 conflit évité (already_resolved). Reçu submitted=%v conflict=%v", seenSubmitted, seenConflict)
	}
}
