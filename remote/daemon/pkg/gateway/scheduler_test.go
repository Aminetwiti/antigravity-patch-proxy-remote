package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Les tests cron sont purs et déterministes : ils ne dépendent ni du réseau
// ni de l'environnement Antigravity (contrairement aux TestLiveE2E_* qui sont
// skippés localement). Un échec ici casse l'évaluation de l'expression cron
// — c'est le cœur du moteur de scheduled tasks.

func TestCronMatches(t *testing.T) {
	// Une minute précise : 09:15 UTC le samedi 2026-08-15.
	at := time.Date(2026, 8, 15, 9, 15, 0, 0, time.UTC)

	cases := []struct {
		expr string
		want bool
	}{
		{"15 9 * * *", true},      // minute/heure exactes
		{"14 9 * * *", false},     // minute décalée
		{"15 8 * * *", false},     // heure décalée
		{"* * * * *", true},       // toutes les minutes
		{"*/15 * * * *", true},    // pas de 15 min (15 % 15 == 0)
		{"0,15,30 * * * *", true}, // liste
		{"10-20 9 * * *", true},   // plage minutes
		{"10-14 9 * * *", false},  // plage hors minute
		{"15 9 * * 6", true},      // samedi (2026-08-15 = samedi)
		{"15 9 * * 0", false},     // dimanche
		{"15 9 15 * *", true},     // jour du mois
		{"15 9 16 * *", false},    // mauvais jour du mois
		{"? ? ? ? ?", true},       // alias Quartz pour *
		{"15 9 * * * *", false},   // 6 champs = invalide
		{"not cron", false},       // invalide
		{"60 9 * * *", false},     // minute hors borne
		{"15 9 * * 1-5", false},   // plage de jours ouvrés (samedi exclu)
	}
	for _, c := range cases {
		if got := cronMatches(c.expr, at); got != c.want {
			t.Errorf("cronMatches(%q, %v) = %v, want %v", c.expr, at, got, c.want)
		}
	}
}

func TestNextRunAt(t *testing.T) {
	// nextRunAt cherche dans les 48h à partir de maintenant — on vérifie juste
	// que la valeur retournée est une RFC3339 valide et future.
	for _, expr := range []string{"0 9 * * *", "* * * * *", "*/5 * * * *"} {
		s := nextRunAt(expr)
		if s == "" {
			t.Errorf("nextRunAt(%q) = \"\", want future RFC3339", expr)
			continue
		}
		parsed, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Errorf("nextRunAt(%q) = %q, parse err: %v", expr, s, err)
			continue
		}
		if !parsed.After(time.Now()) {
			t.Errorf("nextRunAt(%q) = %q, not in the future", expr, s)
		}
	}
	if nextRunAt("invalid") != "" {
		t.Error("nextRunAt(invalid) should return empty string")
	}
}

// TestSchedulerQuotaPush vérifie le push de quotas scheduler → clients : un
// client connecté reçoit un broadcast quota_update avec les 4 pourcentages
// décodés (le LS n'est interrogé que si des clients sont là).
func TestSchedulerQuotaPush(t *testing.T) {
	backend := &fakeRPCClient{
		quotaRaw: quotaFrame(t, map[string]float32{
			"gemini-weekly": 0.42,
			"gemini-5h":     0.68,
			"3p-weekly":     0.10,
			"3p-5h":         0.95,
		}),
	}
	srv, server := newTestServerWithGW(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Attendre que le client soit bien enregistré dans le serveur
	regDeadline := time.Now().Add(time.Second)
	for time.Now().Before(regDeadline) {
		server.mu.Lock()
		registered := len(server.clients) > 0
		server.mu.Unlock()
		if registered {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	scheduler := NewScheduler(server)
	// Forcer un push immédiat (horodatage zéro = jamais poussé).
	scheduler.maybePushQuota(time.Now())

	msg, err := client.recvWithRetry(t, 2*time.Second, 20)
	if err != nil {
		t.Fatalf("Attendu broadcast quota_update, non reçu: %v", err)
	}
	if msg["type"] != "quota_update" {
		t.Fatalf("Attendu broadcast quota_update, reçu %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("Données quota manquantes: %v", msg)
	}
	expected := map[string]int{"weeklyPercent": 42, "fiveHourPercent": 68, "weeklyPercentClaude": 10, "fiveHourPercentClaude": 95}
	for k, want := range expected {
		got, _ := data[k].(float64)
		if int(got) != want {
			t.Errorf("%s = %v, attendu %d", k, data[k], want)
		}
	}
	// second appel dans la fenêtre : rien de nouveau
	if err := client.conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	scheduler.maybePushQuota(time.Now().Add(quotaPushInterval - time.Second))
	if _, _, err := client.conn.ReadMessage(); err == nil {
		t.Error("Un push dans la fenêtre d'intervalle n'aurait pas dû émettre de message")
	}
}

func TestExtractCascadeID(t *testing.T) {
	// Réponse protobuf : champ #1 length-delimited "casc-123" (0x0A 0x08 + 8 octets).
	payload := append([]byte{0x0A, 0x08}, []byte("casc-123")...)
	// Frame gRPC-Web : 1 octet de flags (0) + 4 octets de longueur big-endian.
	body := make([]byte, 5+len(payload))
	body[0] = 0x00
	body[1] = byte(len(payload) >> 24)
	body[2] = byte(len(payload) >> 16)
	body[3] = byte(len(payload) >> 8)
	body[4] = byte(len(payload))
	copy(body[5:], payload)
	if got := extractCascadeID(body); got != "casc-123" {
		t.Errorf("extractCascadeID = %q, want \"casc-123\"", got)
	}
	if extractCascadeID(nil) != "" {
		t.Error("extractCascadeID(nil) should be empty")
	}
	if extractCascadeID([]byte{0x01, 0x02}) != "" {
		t.Error("extractCascadeID(garbage) should be empty")
	}
}

// TestTriggerScheduledTaskEndToEnd vérifie le chemin complet du déclenchement
// manuel : trigger_scheduled_task → runScheduledTask → CreateCascade +
// SendMessageStream (via le fake) → événement broadcast avec la tâche à jour.
func TestTriggerScheduledTaskEndToEnd(t *testing.T) {
	backend := &fakeRPCClient{}
	server := NewServer(backend, "")
	scheduler := NewScheduler(server)
	scheduler.Start()
	defer scheduler.Stop()

	// Pré-enregistre une tâche (comme le ferait schedule_task).
	server.mu.Lock()
	server.scheduledTasks["task_e2e"] = &ScheduledTask{
		ID:             "task_e2e",
		Name:           "E2E",
		Prompt:         "bonjour",
		WorkspaceName:  "antigravity-add-model-main",
		CronExpression: "0 9 * * *",
		IsDaemon:       true,
		IsEnabled:      true,
		Status:         "Running",
		Events:         []ScheduledTaskEvent{},
	}
	server.mu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial err: %v", err)
	}
	defer conn.Close()

	req := map[string]interface{}{
		"type":      "trigger_scheduled_task",
		"requestId": "req_trig_e2e",
		"taskId":    "task_e2e",
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}

	// La réponse unary arrive avant (ou après) le broadcast — on lit deux frames.
	var gotResp, gotEvt bool
	for i := 0; i < 2; i++ {
		var m OutgoingMessage
		if err := conn.ReadJSON(&m); err != nil {
			t.Fatalf("ReadJSON err: %v", err)
		}
		if m.RequestID == "req_trig_e2e" {
			if m.Error != "" {
				t.Fatalf("trigger refusé: %s", m.Error)
			}
			gotResp = true
		}
		if m.Type == "scheduled_task_event" {
			data, _ := m.Data.(map[string]interface{})
			if data["task"] == nil {
				t.Fatal("scheduled_task_event sans tâche")
			}
			if data["taskStarted"] != true {
				t.Fatal("scheduled_task_event sans taskStarted=true (P1)")
			}
			gotEvt = true
		}
	}
	if !gotResp || !gotEvt {
		t.Fatalf("réponses manquantes: gotResp=%v gotEvt=%v", gotResp, gotEvt)
	}

	// Le fake doit avoir reçu CreateCascade + SendMessageStream.
	if backend.lastCascade == nil {
		t.Fatal("CreateCascade jamais appelé par runScheduledTask")
	}
	if backend.lastPrompt != "bonjour" {
		t.Fatalf("prompt = %q, want \"bonjour\"", backend.lastPrompt)
	}
	// La tâche doit avoir exécuté une itération.
	server.mu.Lock()
	task := server.scheduledTasks["task_e2e"]
	server.mu.Unlock()
	if task == nil || task.IterationsRun != 1 {
		t.Fatalf("IterationsRun = %v, want 1", task.IterationsRun)
	}
	if len(task.Events) != 1 || task.Events[0].Outcome != "done" {
		t.Fatalf("events = %+v, want 1 done event", task.Events)
	}
}

func TestScheduler_TickDeduplicatesSameMinute(t *testing.T) {
	backend := &fakeRPCClient{}
	_, server := newTestServerWithGW(backend)
	sc := NewScheduler(server)

	server.mu.Lock()
	server.scheduledTasks["t1"] = &ScheduledTask{
		ID:             "t1",
		Prompt:         "check status",
		CronExpression: "* * * * *",
		IsEnabled:      true,
	}
	server.mu.Unlock()

	t0 := time.Date(2026, 8, 17, 10, 0, 0, 0, time.UTC)
	t30 := time.Date(2026, 8, 17, 10, 0, 30, 0, time.UTC)

	sc.tick(t0)
	server.mu.Lock()
	task := server.scheduledTasks["t1"]
	firstRunMinute := task.LastRunMinute
	server.mu.Unlock()

	if firstRunMinute != t0.Unix()/60 {
		t.Fatalf("LastRunMinute = %d, want %d", firstRunMinute, t0.Unix()/60)
	}

	// 2e tick à T+30s dans la même minute -> ne doit pas redéclencher
	sc.tick(t30)
	server.mu.Lock()
	secondRunMinute := server.scheduledTasks["t1"].LastRunMinute
	server.mu.Unlock()

	if secondRunMinute != firstRunMinute {
		t.Fatalf("LastRunMinute a changé à T+30s: %d != %d", secondRunMinute, firstRunMinute)
	}
}

func TestScheduler_ExecuteTaskPromptRejectsEmptyPrompt(t *testing.T) {
	backend := &fakeRPCClient{}
	_, server := newTestServerWithGW(backend)

	err := server.executeTaskPrompt(ScheduledTask{
		ID:     "t_empty",
		Prompt: "   ",
	})
	if err == nil {
		t.Fatal("executeTaskPrompt should fail on empty prompt")
	}
	if backend.lastCascade != nil {
		t.Fatal("CreateCascade must not be called on empty prompt")
	}
}

