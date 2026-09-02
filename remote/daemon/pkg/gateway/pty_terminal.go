package gateway

import (
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/gorilla/websocket"
)

// ponytail: pas de vrai PTY (creack/pty) — sur Windows un PTY natif exigerait
// une dépendance CGO (conpty). Ce pipe-based shell couvre l'usage mobile
// (cd, git, npm, ls) ; plafond connu : pas de TUIO/tty raw, pas de resize.
// Upgrade path : brancher creack/pty sur les builds non-Windows.
// ---------------------------------------------------------------------------

// terminalSession : une session shell interactive. La sortie du processus
// est lue par une goroutine qui broadcast terminal_output.
type terminalSession struct {
	id    string
	owner *websocket.Conn // client qui a cr├®├® la session (owner-scoping)
	cmd   *exec.Cmd
	stdin io.WriteCloser
	mu    sync.Mutex
	// closed : kill() explicite a d├®j├á eu lieu ; closing : le processus est
	// en cours de terminaison (les pump cessent de broadcast la sortie).
	closed  bool
	closing bool
}

// terminalPtyManager poss├¿de toutes les sessions terminal du daemon.
// La cl├® id est un identifiant opaque renvoy├® au mobile.
type terminalPtyManager struct {
	mu        sync.Mutex
	sessions  map[string]*terminalSession
	nextID    int
	shellPath string
	// onBroadcast : hook vers le Server (s.broadcast) pour diffuser la
	// sortie terminal si aucun propriétaire n'est défini.
	onBroadcast func(OutgoingMessage)
	// onSendToOwner : hook vers Server.writeJSON pour router la sortie terminal
	// UNIQUEMENT vers la connexion du client propriétaire (isolation multi-clients).
	onSendToOwner func(*websocket.Conn, OutgoingMessage) error
}

func newTerminalPtyManager() *terminalPtyManager {
	sh := "sh"
	if runtime.GOOS == "windows" {
		sh = "cmd.exe"
	} else if _, err := exec.LookPath("bash"); err == nil {
		sh = "bash"
	}
	return &terminalPtyManager{
		sessions:  make(map[string]*terminalSession),
		shellPath: sh,
	}
}

// create lance un shell interactif dans dir pour le client owner et retourne
// son id. La session est retirée de la map quand le shell sort tout seul
// (commande exit) — pas seulement via kill().
func (m *terminalPtyManager) create(owner *websocket.Conn, dir string) (string, error) {
	if dir == "" {
		dir = "."
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	cmd := exec.Command(m.shellPath)
	cmd.Dir = abs
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	m.mu.Lock()
	m.nextID++
	id := fmt.Sprintf("pty-%d", m.nextID)
	sess := &terminalSession{id: id, owner: owner, cmd: cmd, stdin: stdin}
	m.sessions[id] = sess
	m.mu.Unlock()

	// Deux goroutines de lecture (stdout + stderr) qui routent vers le propriétaire.
	go m.pump(sess, stdout, "stdout")
	go m.pump(sess, stderr, "stderr")

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		still := m.sessions[sess.id] == sess
		if still {
			// Sortie spontanée (exit) : retire la session de la map — sinon
			// elle resterait zombie jusqu'au killAllFor de la déconnexion.
			delete(m.sessions, sess.id)
		}
		m.mu.Unlock()
		if still {
			m.broadcastExit(sess)
		}
	}()

	return id, nil
}

func (m *terminalPtyManager) pump(sess *terminalSession, r io.Reader, kind string) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			sess.mu.Lock()
			closing := sess.closing
			sess.mu.Unlock()
			if !closing {
				m.broadcastOutput(sess, buf[:n], kind)
			}
		}
		if err != nil {
			return
		}
	}
}

// broadcastOutput émet terminal_output {id, terminalId, data, output, kind} au client propriétaire (ou broadcast si absent).
func (m *terminalPtyManager) broadcastOutput(sess *terminalSession, data []byte, kind string) {
	outStr := string(data)
	msg := OutgoingMessage{
		Type: "terminal_output",
		Data: map[string]interface{}{
			"id":         sess.id,
			"terminalId": sess.id,
			"data":       outStr,
			"output":     outStr,
			"kind":       kind,
		},
	}
	if m.onSendToOwner != nil && sess.owner != nil {
		m.onSendToOwner(sess.owner, msg)
	} else if m.onBroadcast != nil {
		m.onBroadcast(msg)
	}
}

func (m *terminalPtyManager) broadcastExit(sess *terminalSession) {
	msg := OutgoingMessage{
		Type: "terminal_output",
		Data: map[string]interface{}{
			"id":         sess.id,
			"terminalId": sess.id,
			"data":       "",
			"output":     "",
			"kind":       "exit",
		},
	}
	if m.onSendToOwner != nil && sess.owner != nil {
		m.onSendToOwner(sess.owner, msg)
	} else if m.onBroadcast != nil {
		m.onBroadcast(msg)
	}
}

// write injecte l'entr├®e clavier dans la session (owner-scoped : un client
// ne peut ├®crire que dans SES sessions ÔÇö c'est un shell sur le PC h├┤te).
func (m *terminalPtyManager) write(owner *websocket.Conn, id, input string) error {
	m.mu.Lock()
	sess := m.sessions[id]
	m.mu.Unlock()
	if sess == nil {
		return fmt.Errorf("terminal %q inconnu", id)
	}
	if sess.owner != owner {
		return fmt.Errorf("terminal %q non poss├®d├® par ce client", id)
	}
	sess.mu.Lock()
	closed := sess.closed
	sess.mu.Unlock()
	if closed {
		return fmt.Errorf("terminal %q ferm├®", id)
	}
	_, err := io.WriteString(sess.stdin, input)
	return err
}

// kill termine la session (le processus et la goroutine de lecture).
// Owner-scoped : seul le client qui a cr├®├® la session peut la tuer.
func (m *terminalPtyManager) kill(owner *websocket.Conn, id string) error {
	m.mu.Lock()
	sess := m.sessions[id]
	if sess != nil {
		if sess.owner != owner {
			m.mu.Unlock()
			return fmt.Errorf("terminal %q non poss├®d├® par ce client", id)
		}
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if sess == nil {
		return fmt.Errorf("terminal %q inconnu", id)
	}
	sess.mu.Lock()
	if sess.closed {
		sess.mu.Unlock()
		return nil
	}
	sess.closed = true
	sess.closing = true
	sess.mu.Unlock()
	_ = sess.cmd.Process.Kill()
	_ = sess.stdin.Close()
	return nil
}

// killAllFor ferme les sessions du client owner uniquement (appel├® ├á la
// d├®connexion de CE client). Les sessions des autres clients connect├®s
// survivent ÔÇö sinon un t├®l├®phone qui se d├®connecte tuerait le shell d'un autre.
func (m *terminalPtyManager) killAllFor(owner *websocket.Conn) {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id, sess := range m.sessions {
		if sess.owner == owner {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.kill(owner, id)
	}
}
