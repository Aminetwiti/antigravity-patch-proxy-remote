package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

// TestMcpApproval_MobileApprove vérifie le scénario 1 :
// L'IDE ou le stream demande l'approbation d'un outil MCP (ex: coolify/get_application)
// Le mobile reçoit approval_pending, soumet la décision d'approbation (submit_approval).
// Le daemon appelle SubmitToolApproval sur le Language Server et diffuse approval_resolved (source=remote).
func TestMcpApproval_MobileApprove(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Déclaration de l'approbation en attente pour l'outil MCP
	mcpDetail := `{"ServerName":"coolify","ToolName":"get_application","Arguments":{"uuid":"1qyidg5c2izhxy6njh4ua7wm"}}`
	gw.MarkApprovalPending("casc-mcp-1", connectrpc.StreamEvent{
		CallID:         "call-mcp-1",
		TrajectoryID:   "traj-mcp-1",
		StepIndex:      368,
		Tool:           "mcp_tool",
		Detail:         mcpDetail,
		InteractionNum: connectrpc.InteractionMcp,
	})

	// Vérification des infos d'approbation en attente
	info := gw.pendingApprovalInfo("casc-mcp-1")
	if info == nil {
		t.Fatal("pendingApprovalInfo doit renvoyer les infos d'approbation MCP")
	}
	if info["command"] != "coolify/get_application" {
		t.Fatalf("Attendu command 'coolify/get_application', reçu %v", info["command"])
	}
	if info["detail"] != mcpDetail {
		t.Fatalf("Attendu detail %s, reçu %v", mcpDetail, info["detail"])
	}

	// 2. Le mobile soumet l'approbation avec la portée "conversation"
	submitJSON := `{"type":"submit_approval","requestId":"req-approve-mcp","cascadeId":"casc-mcp-1","callId":"call-mcp-1","trajectoryId":"traj-mcp-1","stepIndex":368,"decision":"allow","approvalType":"mcp_tool","scope":"conversation","command":"coolify/get_application"}`
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(submitJSON)); err != nil {
		t.Fatalf("Erreur envoi submit_approval: %v", err)
	}

	// 3. Réception des messages : lecture de "response" et du broadcast "approval_resolved"
	client.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var seenResponse, seenResolved bool
	for !seenResponse || !seenResolved {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("Erreur lecture WebSocket: %v", err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(b, &msg); err != nil {
			continue
		}
		if msg["type"] == "response" && msg["requestId"] == "req-approve-mcp" {
			seenResponse = true
		} else if msg["type"] == "approval_resolved" {
			seenResolved = true
			data, _ := msg["data"].(map[string]interface{})
			if data["decision"] != "allow" || data["source"] != "remote" {
				t.Fatalf("approval_resolved incomplet ou source erronée: %+v", data)
			}
		}
	}
	client.conn.SetReadDeadline(time.Time{})

	// 4. Language Server a bien reçu SubmitToolApproval
	if fake.submitted != 1 {
		t.Fatalf("SubmitToolApproval attendu 1 fois, appelé %d fois", fake.submitted)
	}
	got, ok := fake.lastApproval.(*submitApprovalCall)
	if !ok || got == nil || !got.confirm {
		t.Fatalf("SubmitToolApproval doit avoir confirm=true: %+v", fake.lastApproval)
	}
}

// TestMcpApproval_DesktopApprove vérifie le scénario 2 :
// L'approbation est en attente sur le daemon.
// L'utilisateur approuve directement sur l'IDE Desktop.
// Le flux réactif notifie que WaitingForInput passe à false.
// Le daemon nettoie l'approbation et diffuse approval_resolved (source=desktop) pour fermer la carte mobile.
func TestMcpApproval_DesktopApprove(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// Attendre que le client WebSocket soit bien enregistré côté serveur
	for i := 0; i < 50; i++ {
		gw.mu.Lock()
		clientCount := len(gw.clients)
		gw.mu.Unlock()
		if clientCount > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Approbation posée
	gw.MarkApprovalPending("casc-desktop-1", connectrpc.StreamEvent{
		CallID:         "call-mcp-2",
		TrajectoryID:   "traj-mcp-2",
		StepIndex:      370,
		Tool:           "mcp_tool",
		Detail:         `{"ServerName":"coolify","ToolName":"deploy"}`,
		InteractionNum: connectrpc.InteractionMcp,
	})

	if !gw.hasPendingApproval("casc-desktop-1") {
		t.Fatal("Approbation doit être active")
	}

	// Simulation du retour réactif : l'IDE Desktop a résolu l'interaction
	gw.reactiveSyncUpdates(map[string]connectrpc.ReactiveUpdate{
		"casc-desktop-1": {
			CascadeID:       "casc-desktop-1",
			WaitingForInput: false, // Résolu côté Desktop !
		},
	})

	// Le daemon doit avoir nettoyé l'approbation locale
	if gw.hasPendingApproval("casc-desktop-1") {
		t.Fatal("L'approbation doit être nettoyée suite à la résolution Desktop")
	}

	// Le client mobile reçoit immédiatement approval_resolved avec source=desktop
	client.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("Attendu approval_resolved après résolution desktop: %v", err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(b, &msg); err != nil {
			continue
		}
		if msg["type"] == "approval_resolved" {
			data, _ := msg["data"].(map[string]interface{})
			if data["source"] != "desktop" {
				t.Fatalf("Attendu source='desktop', reçu %v", data["source"])
			}
			break
		}
	}
	client.conn.SetReadDeadline(time.Time{})
}

// TestMcpApproval_MobileDenyWithReason vérifie le scénario 3 :
// L'utilisateur mobile refuse l'outil MCP en fournissant une directive alternative.
func TestMcpApproval_MobileDenyWithReason(t *testing.T) {
	fake := &fakeApprovalRPC{}
	ts, gw := newTestServerWithGW(fake)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	gw.MarkApprovalPending("casc-deny-1", connectrpc.StreamEvent{
		CallID:         "call-mcp-3",
		TrajectoryID:   "traj-mcp-3",
		StepIndex:      372,
		Tool:           "mcp_tool",
		Detail:         `{"ServerName":"coolify","ToolName":"restart_database"}`,
		InteractionNum: connectrpc.InteractionMcp,
	})

	denyJSON := `{"type":"submit_approval","requestId":"req-deny","cascadeId":"casc-deny-1","callId":"call-mcp-3","trajectoryId":"traj-mcp-3","stepIndex":372,"decision":"deny","approvalType":"mcp_tool","denyReason":"Ne pas redémarrer maintenant","command":"coolify/restart_database"}`
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(denyJSON)); err != nil {
		t.Fatalf("Erreur envoi deny: %v", err)
	}

	client.conn.SetReadDeadline(time.Now().Add(3 * time.Second))
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
			if data["decision"] != "deny" {
				t.Fatalf("Attendu decision 'deny', reçu %v", data["decision"])
			}
		}
	}
	client.conn.SetReadDeadline(time.Time{})

	if fake.submitted != 1 {
		t.Fatalf("SubmitToolApproval attendu 1 fois, reçu %d", fake.submitted)
	}
	got, ok := fake.lastApproval.(*submitApprovalCall)
	if !ok || got == nil || got.confirm {
		t.Fatal("SubmitToolApproval doit avoir confirm=false pour deny")
	}
}
