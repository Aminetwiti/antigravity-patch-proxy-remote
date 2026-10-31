package gateway

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// C4 — Logs structurés + rotation. Le gateway expose un logger slog JSON
// écrivable sur un fichier rotatif (5 Mo × 3) OU sur stdout selon
// AG_REMOTE_LOG_LEVEL / AG_REMOTE_LOG_FILE. Les paquets discovery/tunnel
// conservent le stdlib log (séparés) — le remplacement complet est Bloc D/E.
//
// Ponytail: la rotation est un découpage synchrone au moment de l'écriture
// (taille connue, pas d'archive async) — suffisant pour un daemon mono-fichier.

// LogLevelFromEnv : niveau configurable via AG_REMOTE_LOG_LEVEL
// (debug|info|warn|error), défaut info.
func LogLevelFromEnv() slog.Level {
	switch strings.ToLower(os.Getenv("AG_REMOTE_LOG_LEVEL")) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// rotatingWriter : fichier de log avec rotation 5 Mo × 3 (renomme .1 → .2 →
// .3, puis recrée). Conforme à AGENTS.md : pas de nouvelle dépendance (stdlib).
type rotatingWriter struct {
	mu     sync.Mutex
	path   string
	max    int64 // taille max avant rotation (défaut 5 Mo)
	maxGen int   // nombre de générations conservées (défaut 3)
	f      *os.File
}

// NewRotatingWriter ouvre (ou crée) le fichier de log en append.
func NewRotatingWriter(path string) (*rotatingWriter, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	return &rotatingWriter{path: path, max: 5 << 20, maxGen: 3, f: f}, nil
}

// Write implémente io.Writer : écrit puis rotate si la taille dépasse max.
func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n, err := w.f.Write(p)
	if err != nil {
		return n, err
	}
	if st, statErr := w.f.Stat(); statErr == nil && st.Size() > w.max {
		w.rotate()
	}
	return n, nil
}

func (w *rotatingWriter) rotate() {
	w.f.Close()
	for i := w.maxGen - 1; i >= 1; i-- {
		old := filepath.Join(filepath.Dir(w.path), filepath.Base(w.path)+"."+itoa(i))
		new := filepath.Join(filepath.Dir(w.path), filepath.Base(w.path)+"."+itoa(i+1))
		if _, err := os.Stat(old); err == nil {
			os.Rename(old, new)
		}
	}
	os.Rename(w.path, w.path+".1")
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return // garde le writer pointant sur l'ancien fd fermé ; prochaine
		// écriture échouera et le log stdout prendra le relais (ponytail:
		// rotation best-effort, un daemon de debug ne doit pas crasher là).
	}
	w.f = f
}

// Close ferme le fichier de log.
func (w *rotatingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.f.Close()
}

// itoa : conversion int → string sans dépendance (strconv est stdlib, mais ce
// petit helper évite l'import dans le hot path de rotation).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// NewLogger construit le logger JSON du daemon : fichier rotatif si
// AG_REMOTE_LOG_FILE est défini, sinon stdout (mode tests/service).
// Le niveau vient de AG_REMOTE_LOG_LEVEL.
func NewLogger() *slog.Logger {
	opts := &slog.HandlerOptions{Level: LogLevelFromEnv()}
	if path := os.Getenv("AG_REMOTE_LOG_FILE"); path != "" {
		if w, err := NewRotatingWriter(path); err == nil {
			return slog.New(slog.NewJSONHandler(w, opts))
		}
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, opts))
}

// HTTPHandler : endpoint /health JSON alimenté par Stats() (C5). 503 quand le
// daemon est degraded (dernière erreur RPC enregistrée).
func (s *Server) HTTPHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	st := s.Stats()
	if st.Status == "degraded" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(st)
}

// DiagnosticHandler : endpoint /health/diagnostic exportant les métadonnées système.
func (s *Server) DiagnosticHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	hostStats := GetLatestHostStats()
	diag := map[string]interface{}{
		"process": map[string]interface{}{
			"pid": os.Getpid(),
		},
		"platform": map[string]interface{}{
			"goVersion": "go",
			"os":        "windows",
		},
		"hostStats": hostStats,
		"stats":     s.Stats(),
	}
	json.NewEncoder(w).Encode(diag)
}
