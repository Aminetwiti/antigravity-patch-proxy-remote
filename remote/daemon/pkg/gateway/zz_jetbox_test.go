package gateway

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// fakeJetboxStreamer simule le stream JetboxSubscribeToSummaries : le test
// pousse des frames (updates/deletes) via push, exactement comme le ferait
// la goroutine RunJetboxSubscription. Les frames poussées avant l'installation
// du callback sont mises en file et rejouées (même comportement que le
// snapshot initial du vrai stream, qui peut précéder la connexion WS).
type fakeJetboxStreamer struct {
	mu      sync.Mutex
	onF     func(updates map[string]connectrpc.JetboxSummary, deletes []string)
	closed  chan struct{}
	pending []jetboxFrameCall
	ready   chan struct{}
}

type jetboxFrameCall struct {
	updates map[string]connectrpc.JetboxSummary
	deletes []string
}

func newFakeJetboxStreamer() *fakeJetboxStreamer {
	return &fakeJetboxStreamer{closed: make(chan struct{}), ready: make(chan struct{})}
}

func (f *fakeJetboxStreamer) RunJetboxSubscription(onSummary func(updates map[string]connectrpc.JetboxSummary, deletes []string)) error {
	select {
	case <-f.closed:
		return errors.New("stream closed")
	default:
	}
	f.mu.Lock()
	f.onF = onSummary
	if f.ready != nil {
		close(f.ready)
	}
	pending := f.pending
	f.pending = nil
	f.mu.Unlock()
	for _, c := range pending {
		onSummary(c.updates, c.deletes)
	}
	// Le vrai stream est long-vivant ; on bloque jusqu'à closeStream.
	<-f.closed
	return errors.New("stream closed")
}

func (f *fakeJetboxStreamer) closeStream() {
	select {
	case <-f.closed:
	default:
		close(f.closed)
	}
}

func (f *fakeJetboxStreamer) push(updates map[string]connectrpc.JetboxSummary, deletes []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.onF != nil {
		f.onF(updates, deletes)
		return
	}
	f.pending = append(f.pending, jetboxFrameCall{updates: updates, deletes: deletes})
}

// TestJetboxFeedsListSessions — le stream Jetbox (snapshot initial) alimente
// list_sessions sans AUCUN appel GetAllCascades (~9,5 s) : le backend counting
// ne doit jamais être sollicité une fois la carte chaude.
func TestJetboxFeedsListSessions(t *testing.T) {
	backend := &countingCascadesClient{}
	ts, gw := newTestServerWithGW(backend)
	defer ts.Close()

	jetbox := newFakeJetboxStreamer()
	defer jetbox.closeStream()
	gw.RunJetboxSubscription(jetbox)
	<-jetbox.ready

	// Snapshot initial du stream : une session.
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"11111111-2222-3333-4444-555555555555": {
			CascadeID: "11111111-2222-3333-4444-555555555555",
			Title:     "session jetbox",
			Workspace: "file:///c:/work",
			ProjectID: "proj-a",
			Status:    "CASCADE_STATUS_READY",
		},
	}, nil)

	for i := 0; i < 50 && gw.snapshotSummaries() == nil; i++ {
		time.Sleep(10 * time.Millisecond)
	}

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "list_sessions", "requestId": "l1"})
	resp := client.recv(t)
	if resp["error"] != nil {
		t.Fatalf("list_sessions: %v", resp["error"])
	}
	data, _ := resp["data"].(map[string]interface{})
	sessions, _ := data["sessions"].([]interface{})
	if len(sessions) != 1 {
		t.Fatalf("attendu 1 session jetbox, reçu %d (%v)", len(sessions), sessions)
	}
	first := sessions[0].(map[string]interface{})
	if first["cascadeId"] != "11111111-2222-3333-4444-555555555555" || first["title"] != "session jetbox" {
		t.Fatalf("session inattendue: %v", first)
	}
	// La source de vérité est le stream : GetAllCascades ne doit JAMAIS
	// avoir été appelé (0 appel = latence 9,5 s éliminée).
	if calls := backend.callCount(); calls != 0 {
		t.Fatalf("GetAllCascades appelé %d fois alors que jetbox est chaud", calls)
	}
}

// TestJetboxSyncBroadcasts — chaque frame du stream (updates/deletes) est
// broadcastée en sessions_updated à tous les clients connectés.
func TestJetboxSyncBroadcasts(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	jetbox := newFakeJetboxStreamer()
	defer jetbox.closeStream()
	gw.RunJetboxSubscription(jetbox)
	<-jetbox.ready

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()
	time.Sleep(50 * time.Millisecond)

	recvSessionsUpdated := func() map[string]interface{} {
		for {
			m := client.recv(t)
			if m["type"] == "sessions_updated" {
				return m
			}
		}
	}

	jetbox.push(map[string]connectrpc.JetboxSummary{
		"casc-1": {CascadeID: "casc-1", Title: "nouvelle session", Status: "CASCADE_STATUS_READY"},
		"casc-2": {CascadeID: "casc-2", Title: "seconde session", Status: "CASCADE_STATUS_READY"},
	}, nil)

	msg := recvSessionsUpdated()
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu sessions_updated, reçu %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	sessions, _ := data["sessions"].([]interface{})
	if len(sessions) != 2 {
		t.Fatalf("attendu 2 sessions dans le broadcast, reçu %v", data)
	}

	// Suppression : la session supprimée disparaît du broadcast suivant
	// (celle qui reste est conservée).
	jetbox.push(nil, []string{"casc-1"})
	msg = recvSessionsUpdated()
	if msg["type"] != "sessions_updated" {
		t.Fatalf("attendu sessions_updated (delete), reçu %v", msg)
	}
	data, _ = msg["data"].(map[string]interface{})
	sessions, _ = data["sessions"].([]interface{})
	if len(sessions) != 1 {
		t.Fatalf("attendu 1 session après delete, reçu %v", data)
	}
	first := sessions[0].(map[string]interface{})
	if first["cascadeId"] != "casc-2" {
		t.Fatalf("session restante inattendue: %v", first)
	}
}

// TestSessionFocusChangedBroadcast — quand la session IDE au premier plan change
// via le stream Jetbox, le daemon émet session_focus_changed avant sessions_updated.
func TestSessionFocusChangedBroadcast(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	jetbox := newFakeJetboxStreamer()
	defer jetbox.closeStream()
	gw.RunJetboxSubscription(jetbox)
	<-jetbox.ready

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	now := time.Now()
	// Première frame : 2 sessions READY — focus = la plus récente.
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"casc-old": {CascadeID: "casc-old", Title: "vieille session", Status: "CASCADE_STATUS_READY", UpdatedAt: now.Add(-10 * time.Minute)},
		"casc-new": {CascadeID: "casc-new", Title: "session récente", Status: "CASCADE_STATUS_READY", UpdatedAt: now},
	}, nil)

	// On attend session_focus_changed (envoyé avant sessions_updated).
	var focusMsg map[string]interface{}
	for i := 0; i < 10; i++ {
		msg, err := client.recvSafe()
		if err == nil && msg["type"] == "session_focus_changed" {
			focusMsg = msg
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if focusMsg == nil {
		t.Fatal("session_focus_changed non reçu après le premier push Jetbox")
	}
	data, _ := focusMsg["data"].(map[string]interface{})
	if data["cascadeId"] != "casc-new" {
		t.Fatalf("focus attendu sur casc-new, reçu %v", data)
	}

	// Deuxième frame : casc-old passe en RUNNING → nouveau focus.
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"casc-old": {CascadeID: "casc-old", Title: "vieille session", Status: "CASCADE_STATUS_RUNNING", UpdatedAt: now.Add(-10 * time.Minute)},
	}, nil)

	for i := 0; i < 10; i++ {
		msg, err := client.recvSafe()
		if err == nil && msg["type"] == "session_focus_changed" {
			focusMsg = msg
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	data, _ = focusMsg["data"].(map[string]interface{})
	if data["cascadeId"] != "casc-old" {
		t.Fatalf("focus attendu sur casc-old (RUNNING), reçu %v", data)
	}
}

// TestComputeFocusedSession — vérifie les règles de priorité :
// RUNNING (2) > WAITING (1) > READY (0, tri par UpdatedAt).
func TestComputeFocusedSession(t *testing.T) {
	now := time.Now()
	summaries := map[string]connectrpc.JetboxSummary{
		"a": {CascadeID: "a", Status: "CASCADE_STATUS_READY", UpdatedAt: now.Add(-1 * time.Minute)},
		"b": {CascadeID: "b", Status: "CASCADE_STATUS_READY", UpdatedAt: now},
		"c": {CascadeID: "c", Status: "CASCADE_STATUS_RUNNING", UpdatedAt: now.Add(-5 * time.Minute)},
	}
	best := computeFocusedSession(summaries)
	if best == nil || best.CascadeID != "c" {
		t.Fatalf("attendu 'c' (RUNNING), reçu %v", best)
	}

	// Sous-agent exclu.
	summaries["d"] = connectrpc.JetboxSummary{CascadeID: "d", Status: "CASCADE_STATUS_RUNNING", Source: 16}
	best = computeFocusedSession(summaries)
	if best == nil || best.CascadeID != "c" {
		t.Fatalf("sous-agent ne doit pas être sélectionné, reçu %v", best)
	}

	// Archived exclu.
	summaries["e"] = connectrpc.JetboxSummary{CascadeID: "e", Status: "CASCADE_STATUS_RUNNING", Archived: true}
	best = computeFocusedSession(summaries)
	if best == nil || best.CascadeID != "c" {
		t.Fatalf("session archivée ne doit pas être sélectionnée, reçu %v", best)
	}
}
