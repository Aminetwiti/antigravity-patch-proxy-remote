package gateway

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// fakeReactiveStreamer simule le stream StreamReactiveUpdates : le test pousse
// des frames via push, exactement comme le ferait la goroutine
// RunReactiveSubscription. Les frames poussées avant l'installation du
// callback sont mises en file et rejouées (snapshot initial du vrai stream).
type fakeReactiveStreamer struct {
	mu      sync.Mutex
	onF     func(updates map[string]connectrpc.ReactiveUpdate)
	closed  chan struct{}
	pending []reactiveFrameCall
}

type reactiveFrameCall struct {
	updates map[string]connectrpc.ReactiveUpdate
}

func newFakeReactiveStreamer() *fakeReactiveStreamer {
	return &fakeReactiveStreamer{closed: make(chan struct{})}
}

func (f *fakeReactiveStreamer) RunReactiveSubscription(onUpdate func(updates map[string]connectrpc.ReactiveUpdate)) error {
	f.mu.Lock()
	f.onF = onUpdate
	pending := f.pending
	f.pending = nil
	f.mu.Unlock()
	for _, c := range pending {
		onUpdate(c.updates)
	}
	// Le vrai stream est long-vivant ; on bloque jusqu'à closeStream.
	<-f.closed
	return nil
}

func (f *fakeReactiveStreamer) closeStream() {
	select {
	case <-f.closed:
	default:
		close(f.closed)
	}
}

func (f *fakeReactiveStreamer) push(updates map[string]connectrpc.ReactiveUpdate) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.onF != nil {
		f.onF(updates)
		return
	}
	f.pending = append(f.pending, reactiveFrameCall{updates: updates})
}

// recvTimeout lit un message WS avec un timeout : renvoie nil si aucun message
// n'arrive dans le délai (utilisé pour prouver l'ABSENCE de broadcast).
func recvTimeout(client *wsTestClient) chan map[string]interface{} {
	ch := make(chan map[string]interface{}, 1)
	go func() {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			ch <- nil
			return
		}
		var out map[string]interface{}
		if err := json.Unmarshal(b, &out); err != nil {
			ch <- nil
			return
		}
		ch <- out
	}()
	return ch
}

// TestReactiveApprovalBroadcast — une frame réactive "IDLE + interaction
// demandée" pose l'approbation en attente ET diffuse approval_pending à tous
// les clients connectés (même contrat que le chemin binaire).
func TestReactiveApprovalBroadcast(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	reactive := newFakeReactiveStreamer()
	defer reactive.closeStream()
	gw.RunReactiveSubscription(reactive)

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()
	time.Sleep(30 * time.Millisecond)

	reactive.push(map[string]connectrpc.ReactiveUpdate{
		"casc-r1": {
			CascadeID:            "casc-r1",
			Status:               connectrpc.ReactiveStatusIdle,
			RequestedInteraction: connectrpc.InteractionRunCommand,
			WaitingForInput:      true,
			StepIndex:            2,
			TrajectoryID:         "traj-r1",
			CallID:               "call-r1",
		},
	})

	var msg map[string]interface{}
	for i := 0; i < 15; i++ {
		m, err := client.recvSafe()
		if err != nil {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if m["type"] == "approval_pending" {
			msg = m
			break
		}
	}
	if msg == nil {
		t.Fatalf("attendu approval_pending, aucun reçu")
	}
	data, _ := msg["data"].(map[string]interface{})
	if data["cascadeId"] != "casc-r1" || data["approvalType"] != "run_command" ||
		data["stepIndex"] != float64(2) || data["trajectoryId"] != "traj-r1" {
		t.Fatalf("approval_pending incomplet: %v", data)
	}
	// L'approbation est enregistrée : le mobile peut la rouvrir via
	// get_pending_approval (tap notification) — même contrat que le chemin
	// principal, la carte n'est pas un fantôme.
	if !gw.hasPendingApproval("casc-r1") {
		t.Fatal("approbation réactive non enregistrée (hasPendingApproval=false)")
	}
}

// TestReactiveNoSpuriousApproval — une frame réactive sans interaction
// (running, ou idle sans demande) ne doit NI poser d'approbation NI diffuser
// de message : le mobile ne doit pas voir de carte pour une action inexistante.
func TestReactiveNoSpuriousApproval(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	reactive := newFakeReactiveStreamer()
	defer reactive.closeStream()
	gw.RunReactiveSubscription(reactive)

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// Running sans interaction → aucune carte. Idle sans interaction → aucune
	// carte non plus (WaitingForInput=false).
	reactive.push(map[string]connectrpc.ReactiveUpdate{
		"casc-r2": {CascadeID: "casc-r2", Status: connectrpc.ReactiveStatusRunning},
		"casc-r3": {CascadeID: "casc-r3", Status: connectrpc.ReactiveStatusIdle},
	})

	if gw.hasPendingApproval("casc-r2") || gw.hasPendingApproval("casc-r3") {
		t.Fatal("approbation posée à tort sur une frame sans interaction")
	}
}

// TestReactiveRespectsApprovalGuards — le chemin réactif honore les mêmes
// gardes que le chemin binaire : une auto-approbation de session déjà traitée
// ne doit NI poser de carte NI diffuser approval_pending.
func TestReactiveRespectsApprovalGuards(t *testing.T) {
	t.Run("session_approval_cached", func(t *testing.T) {
		ts, gw := newTestServerWithGW(&fakeRPCClient{})
		defer ts.Close()

		reactive := newFakeReactiveStreamer()
		defer reactive.closeStream()
		gw.RunReactiveSubscription(reactive)

		client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
		defer client.conn.Close()

		// L'utilisateur a déjà coché « toujours autoriser run_command ».
		gw.markSessionApproval("casc-g1", "run_command")

		reactive.push(map[string]connectrpc.ReactiveUpdate{
			"casc-g1": {
				CascadeID:            "casc-g1",
				Status:               connectrpc.ReactiveStatusIdle,
				RequestedInteraction: connectrpc.InteractionRunCommand,
				WaitingForInput:      true,
				StepIndex:            1,
				TrajectoryID:         "traj-g1",
				CallID:               "call-g1",
			},
		})

		if gw.hasPendingApproval("casc-g1") {
			t.Fatal("approbation posée à tort malgré session_approval")
		}
		// Le client ne reçoit rien (pas d'approval_pending fantôme).
		select {
		case <-time.After(300 * time.Millisecond):
		case msg := <-recvTimeout(client):
			t.Fatalf("broadcast inattendu avec session_approval: %v", msg)
		}
	})

	t.Run("unknown_interaction", func(t *testing.T) {
		ts, gw := newTestServerWithGW(&fakeRPCClient{})
		defer ts.Close()

		reactive := newFakeReactiveStreamer()
		defer reactive.closeStream()
		gw.RunReactiveSubscription(reactive)

		client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
		defer client.conn.Close()

		// Interaction de type inconnu (hors whitelist) : aucune carte, aucun
		// broadcast — le chemin principal reste seul juge pour ces types.
		reactive.push(map[string]connectrpc.ReactiveUpdate{
			"casc-g2": {
				CascadeID:            "casc-g2",
				Status:               connectrpc.ReactiveStatusIdle,
				RequestedInteraction: 42,
				WaitingForInput:      true,
				StepIndex:            1,
				TrajectoryID:         "traj-g2",
				CallID:               "call-g2",
			},
		})

		if gw.hasPendingApproval("casc-g2") {
			t.Fatal("approbation posée à tort pour une interaction inconnue")
		}
		select {
		case <-time.After(300 * time.Millisecond):
		case msg := <-recvTimeout(client):
			t.Fatalf("broadcast inattendu pour une interaction inconnue: %v", msg)
		}
	})

	t.Run("404_not_found_handling", func(t *testing.T) {
		old := reactiveNotFoundBackoff
		reactiveNotFoundBackoff = 10 * time.Millisecond
		defer func() { reactiveNotFoundBackoff = old }()

		ts, gw := newTestServerWithGW(&fakeRPCClient{})
		defer ts.Close()

		called := make(chan struct{}, 1)
		gw.RunReactiveSubscription(&errReactiveStreamer{
			err:    errors.New("HTTP 404: 404 page not found"),
			called: called,
		})

		select {
		case <-called:
			// L'appel s'est bien déroulé et l'erreur 404 a été gérée proprement sans panique
		case <-time.After(500 * time.Millisecond):
			t.Fatal("RunReactiveSubscription n'a pas été appelé")
		}
	})
}

type errReactiveStreamer struct {
	err    error
	called chan struct{}
	once   sync.Once
}

func (e *errReactiveStreamer) RunReactiveSubscription(onUpdate func(updates map[string]connectrpc.ReactiveUpdate)) error {
	e.once.Do(func() {
		close(e.called)
	})
	return e.err
}
