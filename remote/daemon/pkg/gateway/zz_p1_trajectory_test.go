package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestWebSocketGetTrajectoryAndTurnDiff — vérifie que les deux nouveaux
// actions C9 (get_trajectory, get_turn_diff) :
//  1. propagent correctement cascadeId/conversationId + verbosity/stepIndex
//     jusqu'au RPCClient,
//  2. convertissent la réponse GetCascadeTrajectoryResponse/GetTurnDiffResponse
//     (brute, frame gRPC-Web) en JSON structuré pour le mobile.
//
// Le fake renvoie une vraie réponse GetCascadeTrajectoryResponse encodée à la
// main (schéma vérifié dans antigravity-client language_server_pb.ts) :
//
//	GetCascadeTrajectoryResponse {1: Trajectory, 2: status, 3: num_total_steps}
//	Trajectory {1: trajectory_id, 6: cascade_id, 2: repeated Step}
//	Step {1: type, 4: status}
func TestWebSocketGetTrajectoryAndTurnDiff(t *testing.T) {
	// --- Réponse GetCascadeTrajectoryResponse encodée à la main ---
	step := &protoWriter{}
	step.varint(1, 8)  // type = 8 (CODE_ACTION)
	step.varint(4, 2)  // status = 2 (COMPLETED)
	step2 := &protoWriter{}
	step2.varint(1, 34) // type = 34 (FIND)

	traj := &protoWriter{}
	traj.string(1, "traj-abc")      // trajectory_id
	traj.bytes(2, step.buf)         // step #1
	traj.bytes(2, step2.buf)        // step #2
	traj.string(6, "casc-9")        // cascade_id
	resp := &protoWriter{}
	resp.bytes(1, traj.buf)         // trajectory
	resp.varint(2, 4)               // status = 4 (READY)
	resp.varint(3, 2)               // num_total_steps = 2

	// --- Réponse GetTurnDiffResponse encodée à la main ---
	fd := &protoWriter{}
	fd.varint(1, 3)                        // additions = 3
	fd.varint(2, 1)                        // deletions = 1
	fd.string(3, "old")                    // original_contents
	fd.string(4, "new")                    // modified_contents
	entry := &protoWriter{}
	entry.string(1, "lib/main.dart")       // key = path
	entry.bytes(2, fd.buf)                 // value = FileDiffData
	diffResp := &protoWriter{}
	diffResp.bytes(1, entry.buf)           // file_diffs #1
	diffResp.varint(2, 3)                  // total_additions
	diffResp.varint(3, 1)                  // total_deletions
	diffResp.varint(5, 7)                  // turn_start_index
	diffResp.varint(6, 10)                 // turn_end_index_exclusive

	rpc := &fakeRPCClient{
		trajectoryRaw: connectrpcFrame(resp.buf),
		turnDiffRaw:   connectrpcFrame(diffResp.buf),
	}
	srv := newTestServer(rpc)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial error: %v", err)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))

	send := func(m map[string]interface{}) map[string]interface{} {
		t.Helper()
		b, _ := json.Marshal(m)
		if err := ws.WriteMessage(websocket.TextMessage, b); err != nil {
			t.Fatalf("write error: %v", err)
		}
		_, raw, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("read error: %v", err)
		}
		var out map[string]interface{}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("bad json: %v (%s)", err, string(raw))
		}
		return out
	}

	// 1. get_trajectory : cascadeId + verbosity propagés, réponse structurée.
	res := send(map[string]interface{}{
		"type": "get_trajectory", "requestId": "r1",
		"cascadeId": "casc-9", "data": map[string]interface{}{"verbosity": 3},
	})
	if res["error"] != nil {
		t.Fatalf("get_trajectory erreur: %v", res["error"])
	}
	if rpc.lastTrajectory == nil || rpc.lastTrajectory.cascadeID != "casc-9" || rpc.lastTrajectory.verbosity != 3 {
		t.Fatalf("GetCascadeTrajectory mal propagé: %+v", rpc.lastTrajectory)
	}
	data, _ := res["data"].(map[string]interface{})
	if data == nil || data["cascadeId"] != "casc-9" || data["numTotalSteps"].(float64) != 2 {
		t.Fatalf("trajectory décodée incorrecte: %v", data)
	}
	steps := data["steps"].([]interface{})
	if len(steps) != 2 {
		t.Fatalf("attendu 2 steps, reçu %d", len(steps))
	}
	first := steps[0].(map[string]interface{})
	if first["type"].(float64) != 8 || first["status"].(float64) != 2 {
		t.Fatalf("step[0] mal décodé: %v", first)
	}

	// 2. get_turn_diff : conversationId/stepIndex propagés, diff structuré.
	res = send(map[string]interface{}{
		"type": "get_turn_diff", "requestId": "r2",
		"data": map[string]interface{}{
			"conversationId": "casc-9", "stepIndex": 7,
		},
	})
	if res["error"] != nil {
		t.Fatalf("get_turn_diff erreur: %v", res["error"])
	}
	if rpc.lastTurnDiff == nil || rpc.lastTurnDiff.conversationID != "casc-9" || rpc.lastTurnDiff.stepIndex != 7 {
		t.Fatalf("GetTurnDiff mal propagé: %+v", rpc.lastTurnDiff)
	}
	data, _ = res["data"].(map[string]interface{})
	if data == nil || data["totalAdditions"].(float64) != 3 || data["totalDeletions"].(float64) != 1 {
		t.Fatalf("turn diff décodé incorrect: %v", data)
	}
	diffs := data["fileDiffs"].([]interface{})
	if len(diffs) != 1 {
		t.Fatalf("attendu 1 fileDiff, reçu %d", len(diffs))
	}
	entryOut := diffs[0].(map[string]interface{})
	if entryOut["path"] != "lib/main.dart" {
		t.Fatalf("path incorrect: %v", entryOut["path"])
	}
	diff := entryOut["diff"].(map[string]interface{})
	if diff["additions"].(float64) != 3 || diff["originalContents"] != "old" || diff["modifiedContents"] != "new" {
		t.Fatalf("FileDiffData mal décodé: %v", diff)
	}

	// 3. stepIndex absent → -1 (le LS résout le dernier tour).
	res = send(map[string]interface{}{
		"type": "get_turn_diff", "requestId": "r3",
		"data": map[string]interface{}{"conversationId": "casc-9"},
	})
	if rpc.lastTurnDiff.stepIndex != -1 {
		t.Fatalf("stepIndex absent attendu -1, reçu %d", rpc.lastTurnDiff.stepIndex)
	}
	// 4. cascadeId/conversationId manquant → erreur propre.
	res = send(map[string]interface{}{"type": "get_trajectory", "requestId": "r4"})
	if res["error"] == nil {
		t.Fatal("get_trajectory sans cascadeId devrait échouer")
	}
	res = send(map[string]interface{}{"type": "get_turn_diff", "requestId": "r5"})
	if res["error"] == nil {
		t.Fatal("get_turn_diff sans conversationId devrait échouer")
	}
}

// connectrpcFrame enveloppe un payload protobuf dans la frame gRPC-Web
// (1 octet flag + 4 octets longueur BE) comme le fait connectrpc.Frame.
func connectrpcFrame(payload []byte) []byte {
	out := make([]byte, 5+len(payload))
	out[0] = 0 // data frame, pas de compression
	out[1] = byte(len(payload) >> 24)
	out[2] = byte(len(payload) >> 16)
	out[3] = byte(len(payload) >> 8)
	out[4] = byte(len(payload))
	copy(out[5:], payload)
	return out
}

// TestTrajectoryOutStepCap — le plafond de steps protège le mobile d'un JSON
// énorme : au-delà de maxTrajectorySteps, trajectoryOut renvoie une fenêtre
// glissante sur la FIN de session (steps les plus récents) + truncated=true,
// sans jamais mentir sur numTotalSteps.
func TestTrajectoryOutStepCap(t *testing.T) {
	traj := &protoWriter{}
	traj.string(1, "traj-cap")
	traj.string(6, "casc-cap")
	// maxTrajectorySteps + 5 steps → 65 steps au total.
	for i := 0; i < maxTrajectorySteps+5; i++ {
		st := &protoWriter{}
		st.varint(1, 8)
		st.varint(4, 2)
		traj.bytes(2, st.buf)
	}
	resp := &protoWriter{}
	resp.bytes(1, traj.buf)
	resp.varint(2, 4) // status = READY
	resp.varint(3, uint64(maxTrajectorySteps+5))

	out := trajectoryOut(connectrpcFrame(resp.buf)).(map[string]interface{})
	steps := out["steps"].([]interface{})
	if len(steps) != maxTrajectorySteps {
		t.Fatalf("attendu %d steps plafonnés, reçu %d", maxTrajectorySteps, len(steps))
	}
	if out["truncated"] != true {
		t.Fatal("flag truncated absent alors que le plafond a été atteint")
	}
	if out["numTotalSteps"].(uint64) != uint64(maxTrajectorySteps+5) {
		t.Fatalf("numTotalSteps falsifié: %v", out["numTotalSteps"])
	}
	// G1 : chaque step conservé garde son index d'origine dans la session.
	// Fenêtre = 5 derniers..(5+maxTrajectorySteps-1) → premier index = 5.
	for i, st := range steps {
		m := st.(map[string]interface{})
		idx, ok := m["bridgeOriginalStepIndex"].(uint64)
		if !ok {
			t.Fatalf("bridgeOriginalStepIndex absent au step %d", i)
		}
		if int(idx) != 5+i {
			t.Fatalf("bridgeOriginalStepIndex step %d = %d, attendu %d", i, idx, 5+i)
		}
	}

	// Sous le plafond : aucun flag, tous les steps conservés.
	trajSmall := &protoWriter{}
	trajSmall.string(1, "traj-small")
	for i := 0; i < 3; i++ {
		st := &protoWriter{}
		st.varint(1, 8)
		trajSmall.bytes(2, st.buf)
	}
	respSmall := &protoWriter{}
	respSmall.bytes(1, trajSmall.buf)
	outSmall := trajectoryOut(connectrpcFrame(respSmall.buf)).(map[string]interface{})
	if len(outSmall["steps"].([]interface{})) != 3 {
		t.Fatalf("steps non plafonnés attendus conservés: %v", outSmall["steps"])
	}
	if outSmall["truncated"] != nil {
		t.Fatal("flag truncated ne devrait pas exister sous le plafond")
	}
}
