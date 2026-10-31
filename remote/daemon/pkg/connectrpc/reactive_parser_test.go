package connectrpc

import "testing"

// TestParseReactiveFrame — une frame du stream StreamReactiveUpdates peut
// arriver sous deux formes : wrapper {updates: {...}} (snapshot/batch) ou
// objet CascadeState direct. Les deux doivent être décodées.
func TestParseReactiveFrame(t *testing.T) {
	cases := []struct {
		name      string
		frame     string
		wantID    string
		wantState int
		wantInter int
		wantWait  bool
	}{
		{
			name:      "wrapper updates",
			frame:     `{"updates":{"casc-1":{"cascadeId":"casc-1","status":"CASCADE_RUN_STATUS_IDLE","requestedInteraction":{"interactionType":"APPROVAL"},"stepIndex":3,"trajectoryId":"traj-1","callId":"call-9"}}}`,
			wantID:    "casc-1",
			wantState: ReactiveStatusIdle,
			wantInter: InteractionApproval,
			wantWait:  true,
		},
		{
			name:      "direct state frame running",
			frame:     `{"cascadeId":"casc-2","status":"CASCADE_RUN_STATUS_RUNNING","requestedInteraction":{}}`,
			wantID:    "casc-2",
			wantState: ReactiveStatusRunning,
			wantInter: InteractionNone,
			wantWait:  false,
		},
		{
			name:      "numeric status and snake_case interaction",
			frame:     `{"cascadeId":"casc-3","status":2,"requestedInteraction":{"interaction_type":"run_command"}}`,
			wantID:    "casc-3",
			wantState: ReactiveStatusRunning,
			wantInter: InteractionRunCommand,
			wantWait:  false,
		},
		{
			name:      "busy status with file_permission interaction",
			frame:     `{"updates":{"casc-4":{"status":4,"requestedInteraction":{"interactionType":"INTERACTION_TYPE_FILE_PERMISSION"}}}}`,
			wantID:    "casc-4",
			wantState: ReactiveStatusBusy,
			wantInter: InteractionFilePermission,
			wantWait:  false,
		},
		{
			name:      "empty frame heartbeat",
			frame:     `{}`,
			wantID:    "",
			wantState: 0,
			wantInter: InteractionNone,
			wantWait:  false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			updates := ParseReactiveFrame([]byte(c.frame))
			if c.wantID == "" {
				if len(updates) != 0 {
					t.Fatalf("frame vide attendue ignorée, reçu %d updates", len(updates))
				}
				return
			}
			u, ok := updates[c.wantID]
			if !ok {
				t.Fatalf("cascade %s absente des updates: %v", c.wantID, updates)
			}
			if u.Status != c.wantState {
				t.Errorf("status = %d, attendu %d", u.Status, c.wantState)
			}
			if u.RequestedInteraction != c.wantInter {
				t.Errorf("requestedInteraction = %d, attendu %d", u.RequestedInteraction, c.wantInter)
			}
			if u.WaitingForInput != c.wantWait {
				t.Errorf("waitingForInput = %t, attendu %t", u.WaitingForInput, c.wantWait)
			}
			if c.wantWait && (u.StepIndex != 3 || u.TrajectoryID != "traj-1" || u.CallID != "call-9") {
				t.Errorf("corrélation non décodée: %+v", u)
			}
		})
	}
}

// TestParseReactiveFrameMalformed — JSON invalide ou champs inattendus ne
// doivent jamais paniquer ni produire de faux positif.
func TestParseReactiveFrameMalformed(t *testing.T) {
	for _, frame := range []string{
		`{not json`,
		`{"updates":{"casc-1":"not-an-object"}}`,
		`{"cascadeId":"casc-1","requestedInteraction":"weird"}`,
		`null`,
		`[]`,
	} {
		updates := ParseReactiveFrame([]byte(frame))
		for id, u := range updates {
			if u.CascadeID == "" && u.Status == 0 {
				t.Fatalf("frame %q → update parasite %s", frame, id)
			}
		}
	}
}
