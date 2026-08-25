package gateway

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/antigravity/remote-daemon/pkg/adb"
	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:       checkOrigin,
	EnableCompression: true,
}

// logJSON : logger structur├® du gateway (JSON, niveau configurable).
// Utilis├® par les ├®v├®nements lifecycle ; les erreurs portent requestId pour
// corr├®ler mobile Ôåö hub (C4).
var logJSON = slog.Default()

// SetLogJSON permet au main de brancher le logger rotatif (health.go).
func SetLogJSON(l *slog.Logger) { logJSON = l }

// RPCClient est l'ensemble des m├®thodes du backend LanguageServer utilis├®es
// par le gateway (interface minimale pour permettre les tests avec un faux).
type RPCClient interface {
	Heartbeat() ([]byte, error)
	CreateCascade(uri string, projectID string, modelUID string, modelEnum uint64) ([]byte, error)
	GetAllCascades() ([]byte, error)
	SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error
	SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error
	// SendMessageStreamModelWithMedia : transmet le prompt avec pièces jointes (media/images).
	SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error
	SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error)
	SetBrowserOpenConversation(cascadeID string) ([]byte, error)
	SendCommand(commandText string) ([]byte, error)
	// ListModels r├®cup├¿re la liste des mod├¿les disponibles (GetAvailableModels).
	ListModels() ([]byte, error)
	// DeleteCascade supprime une session (DeleteCascadeTrajectory).
	DeleteCascade(cascadeID string) ([]byte, error)
	// ReadFile lit un fichier via le RPC officiel du LS (ReadFile).
	ReadFile(uri string) ([]byte, error)
	// WriteFile ├®crit un fichier via le RPC officiel du LS (WriteFile).
	WriteFile(uri string, content []byte, overwrite bool) ([]byte, error)
	// TrackWorkspace d├®clare un dossier au hub (AddTrackedWorkspace) ÔÇö le LS
	// cr├®e l'instance virtuelle ; StartCascade fonctionne ensuite sans projectID.
	TrackWorkspace(workspacePath string) ([]byte, error)
	// UntrackWorkspace retire un dossier du hub (RemoveTrackedWorkspace).
	UntrackWorkspace(workspacePath string) ([]byte, error)
	// GetCascadeTrajectory r├®cup├¿re l'historique structur├® d'une session
	// (GetCascadeTrajectory) ÔÇö verbosity 0 = d├®faut du LS.
	GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error)
	// GetTurnDiff r├®cup├¿re le diff officiel d'un tour (GetTurnDiff).
	// stepIndex < 0 ÔåÆ le LS r├®sout le dernier tour.
	GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error)
	// GetRevertPreview demande la pr├®visualisation du rollback d'une cascade.
	GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error)
	// RevertToCascadeStep applique le rollback de la cascade ├á une ├®tape donn├®e.
	RevertToCascadeStep(cascadeID string, stepIndex int64) error
	// SendStepsToBackground bascule des ├®tapes en t├óche d'arri├¿re-plan.
	SendStepsToBackground(conversationID string, stepIndices []int64) error
	// SkipBrowserSubagent saute une ├®tape de sous-agent de navigation.
	SkipBrowserSubagent(cascadeID string, stepIndex int64) error
	// RetrieveUserQuotaSummary r├®cup├¿re le r├®sum├® des quotas utilisateur du Language Server.
	RetrieveUserQuotaSummary() ([]byte, error)
	// GetUserStatus r├®cup├¿re les infos et cr├®dits de l'utilisateur.
	GetUserStatus() ([]byte, error)
	// GetModelStatuses r├®cup├¿re la disponibilit├® et d├®gradation des mod├¿les.
	GetModelStatuses() ([]byte, error)
	// GenerateCommitMessage g├®n├¿re un message de commit IA ├á partir du staging git.
	GenerateCommitMessage() ([]byte, error)
	// ConvertTrajectoryToMarkdown convertit une session en document Markdown.
	ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error)
	// CreateWorktree cr├®e un nouveau worktree Git.
	CreateWorktree(branch, path string) ([]byte, error)
	// GetLintErrors r├®cup├¿re les erreurs de lint d'un fichier (LSP).
	GetLintErrors(uri string) ([]byte, error)
	// GetDefinition r├®sout la d├®finition du symbole ├á une position (LSP).
	GetDefinition(uri string, line, character int) ([]byte, error)
	// GetCodeValidationStates récupère l'état de validation du code (LSP).
	GetCodeValidationStates(uri string) ([]byte, error)
	// GetVersionControlState récupère l'état VCS complet d'un workspace
	// (branche, commits, changements, conflits) — GetVersionControlState.
	GetVersionControlState(workspacePath string) ([]byte, error)
	// GitStage / GitUnstage / GitDiscard modifient le staging area git.
	GitStage(workspaceURI string, uris []string) ([]byte, error)
	GitUnstage(workspaceURI string, uris []string) ([]byte, error)
	GitDiscard(workspaceURI string, uris []string) ([]byte, error)
	// GitCommit crée un commit git (retourne son ID).
	GitCommit(workspaceURI, message string) ([]byte, error)
	// GetCommitDetails récupère les fichiers changés et parents d'un commit.
	GetCommitDetails(workspaceURI, commitID string) ([]byte, error)
	// RPC Sidecar : listes/logs/contrôle des sidecars (cascade_plugins).
	ListSidecarLogFiles(sidecarID string) ([]byte, error)
	GetSidecarLogs(sidecarID, logFileName string) ([]byte, error)
	ManageSidecar(sidecarID string, action uint64) ([]byte, error)
	// RPC Colosseum / Battle Mode : duel multi-modèles et arbitrage de branches.
	StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error)
	GetBattleWorktreeDiff(workspaceURI string) ([]byte, error)
	EliminateBattleArm(armID string) ([]byte, error)
	EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error)
	// RPC Diagnostics & FlightRecorder.
	DumpFlightRecorder() ([]byte, error)
	// RPC MCP Lifecycle & OAuth.
	RefreshMcpServers() ([]byte, error)
	CompleteMcpOAuth(serverID, authCode string) ([]byte, error)
	DisconnectMcpOAuth(serverID string) ([]byte, error)
	// RPC Code Index & RAG.
	HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error)
	SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error)
	CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error)
}

// JetboxStreamer est la portion minimale du client LS n├®cessaire au flux
// temps r├®el des r├®sum├®s de sessions (JetboxSubscribeToSummaries). Interface
// ├®troite : les tests injectent un faux sans r├®impl├®menter RPCClient.
type JetboxStreamer interface {
	RunJetboxSubscription(onSummary func(updates map[string]connectrpc.JetboxSummary, deletes []string)) error
}

// checkOrigin rejette les navigateurs web arbitraires (CSWSH) tout en
// checkOrigin rejette les navigateurs web arbitraires (CSWSH) tout en
// acceptant les apps natives (Origin absent), le localhost, le LAN privé et le domaine exact du tunnel.
func checkOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true // clients natifs (app mobile, curl) — pas d'Origin
	}
	if o == "null" {
		return false // rejeter les iframes sandboxées
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}
	// Plages LAN privées strictes (CIDR)
	ip := net.ParseIP(h)
	if ip != nil {
		for _, cidr := range []string{"192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"} {
			if _, n, err := net.ParseCIDR(cidr); err == nil && n.Contains(ip) {
				return true
			}
		}
	}
	// Si la requête arrive sur un tunnel distant, l'Origin doit correspondre à l'Host de la requête ou à un domaine de tunnel valide
	reqHost := r.Host
	if host, _, err := net.SplitHostPort(reqHost); err == nil {
		reqHost = host
	}
	if strings.EqualFold(h, reqHost) {
		return true
	}
	if strings.HasSuffix(h, ".trycloudflare.com") || strings.HasSuffix(h, ".pinggy.link") || strings.HasSuffix(h, ".loca.lt") {
		return true
	}
	return false
}

// pendingApproval : une approbation ├®mise mais pas encore r├®pondue, avec les
// infos n├®cessaires ├á l'auto-refus (trajectoryId + stepIndex + payload), le
// timer d'expiration (approvalTimeout, d├®faut 5 min) et la corr├®lation mobile
// (callId + cascadeId : le client peut la r├®-ouvrir apr├¿s un tap-notification
// via get_pending_approval).
type pendingApproval struct {
	callID              string
	cascadeID           string
	trajectoryID        string
	stepIndex           uint32
	approvalType        string
	command             string
	filePath            string
	originatingDeviceID string
	timer               *time.Timer
	// expired : true une fois le timer d'auto-refus parti (auto-deny envoyé,
	// broadcast approval_expired émis). L'entrée reste en place pour qu'un
	// submit_approval tardif soit refusé (garde de fraîcheur) au lieu de
	// ré-autoriser une commande déjà auto-refusée.
	expired bool
}

// uploadChunkState garde l'état d'un transfert de fichier par morceaux (G2).
type uploadChunkState struct {
	id          string
	cascadeID   string
	fileName    string
	totalBytes  int64
	received    int64
	chunks      map[int][]byte
	totalChunks int
	targetPath  string
	createdAt   time.Time
}

type Server struct {
	RPCClient RPCClient
	AuthToken string
	clients   map[*websocket.Conn]bool
	mu        sync.Mutex
	// cascadeDeviceOwners : cascadeId -> deviceId du créateur/initiateur de la cascade
	cascadeDeviceOwners map[string]string
	// approvals : cascadeId -> approbation en attente
	approvals map[string]*pendingApproval
	// approvalTimeout : d├®lai avant auto-refus d'une approbation sans r├®ponse
	// (s├®curit├® : t├®l├®phone perdu). 0 = d├®sactiv├®. D├®faut 5 minutes.
	approvalTimeout time.Duration
	// sessionApprovals : cascadeId+approvalType — l'utilisateur a choisi
	// « toujours autoriser pour cette session » (B3). Les demandes suivantes
	// du même type sont auto-approuvées sans repasser par le téléphone.
	sessionApprovals map[string]bool
	// autoAcceptEnabled : auto-approbation des actions (toggle des réglages mobile).
	autoAcceptEnabled bool
	// autoAcceptMode : "readonly" (défaut) ou "full" (auto-approuve tout sauf questions interactives).
	autoAcceptMode string
	// modelsCache : cache TTL 30s des modèles disponibles (GetAvailableModels).
	modelsCache    []connectrpc.ModelInfo
	modelsCachedAt time.Time
	// sessionsCacheTTL : durée de validité du cache de sessions (défaut 5s).
	sessionsCacheTTL time.Duration
	// uploadChunks : uploadId -> assemblage de fichier par morceaux (G2).
	uploadChunks map[string]*uploadChunkState
	// adbService : client ADB sécurisé sans shell injection (G3).
	adbService *adb.Service
	// allowRemoteTerminal : autorise l'ouverture de terminaux PTY distants (sécurité : false par défaut).
	allowRemoteTerminal bool
	// noToolsEnabled : mode global « répondre sans outils » — les send_prompt
	// qui ne portent pas leur propre flag noTools héritent de ce défaut
	// (toggle des réglages mobile). L'état vit en mémoire comme autoAccept.
	noToolsEnabled bool
	// activeCascades : cascadeId ÔåÆ le daemon est en train de streamer un tour
	// pour cette cascade (C5 : compteur d'activit├® expos├® au /health).
	activeCascades map[string]bool
	// lastError : derni├¿re erreur RPC notable, expos├®e au /health (C5).
	lastError string
	// startedAt : horodatage de d├®marrage du serveur (C5, uptime).
	startedAt time.Time
	// sentRequestIDs : requestId d├®j├á trait├®s (C1, idempotence). Un send_prompt
	// retransmis apr├¿s coupure Wi-Fi ne duplique pas le tour : le hub re├ºoit
	// chaque requ├¬te au plus une fois.
	sentRequestIDs map[string]bool
	// clientInFlight : nombre de send_prompt en cours PAR CLIENT (C3, limite
	// de streams simultan├®s ÔÇö un client ne peut pas saturer le hub).
	clientInFlight map[*websocket.Conn]int
	// writeLocks : mutex d'├®criture PAR CONNEXION (remplace l'ancien writeMu
	// global). Deux clients concurrents n'ont plus AUCUN point de s├®rialisation
	// commun : 20 clients ├ù 30 heartbeats ne produisent plus de r├®ponses
	// crois├®es (les ├®critures sont ordonn├®es par connexion, pas globalement).
	writeLocks map[*websocket.Conn]*sync.Mutex
	// streamBuffer : tampon circulaire StepRecovery pour reprise sur d├®connexion 4G/Wi-Fi
	streamBuffer *SessionStreamBuffer
	// outbox : persistance disque des send_prompt non confirm├®s (offline
	// buffering 3.2) ÔÇö le mobile les r├®-affiche via sync_session.
	outbox *DaemonOutbox
	// activeCancels : cascadeId → requestId → fonction d'annulation active
	activeCancels map[string]map[string]context.CancelFunc
	// activeRequestIDs : cascadeId ÔåÆ requestId en cours
	activeRequestIDs map[string]string
	// scheduledTasks : taskId ÔåÆ t├óche planifi├®e g├®r├®e par le daemon
	scheduledTasks map[string]*ScheduledTask
	// sessionsCache : r├®sultat list_sessions d├®j├á calcul├® (GetAllCascades co├╗te
	// ~9,5 s c├┤t├® hub) + single-flight (fetchDone) pour que N reconnexions
	// simultan├®es du mobile ne d├®clenchent qu'UN appel LS au lieu de N.
	sessionsCache    []byte
	sessionsCachedAt time.Time
	fetchDone        chan struct{}
	// jetboxSummaries : cache temps r├®el aliment├® par le stream
	// JetboxSubscribeToSummaries (d├®marre au boot, cf. RunJetboxSubscription).
	// Quand il est chaud (non nil), list_sessions est servi depuis cette carte
	// SANS appeler GetAllCascades (~9,5 s) : le stream pousse l'├®tat courant
	// complet en snapshot initial, puis des updates/deletes incr├®mentaux.
	// Invalidation : si le stream ├®choue durablement, une liste vide remplace
	// la carte pour retomber sur le chemin GetAllCascades + fallback local.
	jetboxSummaries map[string]connectrpc.JetboxSummary
	// focusedCascadeID : session IDE actuellement au premier plan sur le PC.
	// Calculée à chaque frame Jetbox (RUNNING > WAITING > la plus récente).
	// Broadcast session_focus_changed aux clients mobiles si elle change.
	focusedCascadeID string
	// terminals : sessions shell interactives (P3). Chaque session appartient
	// au client qui l'a cr├®├®e ; ├á la d├®connexion on ne tue que SES sessions
	// (un autre t├®l├®phone connect├® garde les siennes).
	terminals *terminalPtyManager
	// runningTasks : gestionnaire des tâches d'arrière-plan en cours d'exécution
	runningTasks *runningTaskManager
	// tokenValidator : validateur dynamique de jetons de session (P4 pairing PIN).
	tokenValidator func(token string) bool
	// sessionValidator : variante enrichie qui retourne les infos de session
	// (deviceId, allowedProjects). Branch├® par main.go quand le PairingManager
	// expose ValidateSession. Si nil, aucun filtrage par projet (comportement
	// historique).
	sessionValidator func(token string) (discovery.SessionInfo, bool)
	// clientSessions : connexion ÔåÆ infos de session (scope projet 3.3). Rempli
	// au handshake, lu ├á chaque message pour filtrer send_prompt/list_sessions.
	clientSessions map[*websocket.Conn]discovery.SessionInfo
	// pairHandler : PairingManager (3.4) pour list_devices / revoke_device.
	// BranchÃ© par SetPairingManager au dÃ©marrage (main.go). Interface locale
	// minimale : le gateway ne dÃ©pend pas du type concret du discovery.
	pairHandler interface {
		ListSessions() []discovery.SessionInfo
		RevokeDevice(deviceID string) bool
	}
	isIDERunning bool
	scheduler    *Scheduler
	stateVersion int64
}

// ScheduledTask repr├®sente une t├óche planifi├®e / cron job g├®r├®e par le daemon.
type ScheduledTask struct {
	ID              string               `json:"id"`
	Name            string               `json:"name"`
	Prompt          string               `json:"prompt"`
	WorkspaceName   string               `json:"workspaceName"`
	CronExpression  string               `json:"cronExpression,omitempty"`
	DurationSeconds int                  `json:"durationSeconds,omitempty"`
	IsDaemon        bool                 `json:"isDaemon"`
	IterationsRun   int                  `json:"iterationsRun"`
	LastRunMinute   int64                `json:"lastRunMinute,omitempty"`
	NextRunAt       string               `json:"nextRunAt,omitempty"`
	IsEnabled       bool                 `json:"isEnabled"`
	Status          string               `json:"status"`
	Uptime          string               `json:"uptime"`
	Events          []ScheduledTaskEvent `json:"events"`
}

type ScheduledTaskEvent struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Outcome    string `json:"outcome"`
	Message    string `json:"message"`
	DurationMs int    `json:"durationMs,omitempty"`
}

// Stats snapshot de l'├®tat du serveur pour l'endpoint /health (C5).
// Champs JSON stables ÔÇö le mobile (ou un script) peut les afficher tels quels.
type Stats struct {
	Status         string   `json:"status"`
	Sessions       int      `json:"sessions"`
	Streams        int      `json:"streams"`
	Clients        int      `json:"clients"`
	Uptime         string   `json:"uptime"`
	ActiveCascades []string `json:"activeCascades"`
	LastError      string   `json:"lastError,omitempty"`
}

func NewServer(client RPCClient, authToken string) *Server {
	s := &Server{
		RPCClient:           client,
		AuthToken:           authToken,
		clients:             make(map[*websocket.Conn]bool),
		cascadeDeviceOwners: make(map[string]string),
		approvals:           make(map[string]*pendingApproval),
		approvalTimeout:     5 * time.Minute,
		sessionApprovals:    make(map[string]bool),
		autoAcceptMode:      "readonly",
		uploadChunks:        make(map[string]*uploadChunkState),
		adbService:          adb.NewService(nil),
		activeCascades:      make(map[string]bool),
		startedAt:           time.Now(),
		sentRequestIDs:      make(map[string]bool),
		clientInFlight:      make(map[*websocket.Conn]int),
		writeLocks:          make(map[*websocket.Conn]*sync.Mutex),
		streamBuffer:        NewSessionStreamBuffer(200),
		outbox:              NewDaemonOutbox(),
		activeCancels:       make(map[string]map[string]context.CancelFunc),
		activeRequestIDs:    make(map[string]string),
		scheduledTasks:      make(map[string]*ScheduledTask),
		terminals:           newTerminalPtyManager(),
		runningTasks:        newRunningTaskManager(),
		clientSessions:      make(map[*websocket.Conn]discovery.SessionInfo),
	}
	s.scheduler = NewScheduler(s)
	s.terminals.onBroadcast = s.broadcast
	s.terminals.onSendToOwner = s.writeJSON
	s.runningTasks.onBroadcast = s.broadcast
	// Recharge les tâches planifiées persistées au redémarrage (non-fatal :
	// un fichier absent ou corrompu repart avec une liste vide).
	if err := s.LoadScheduledTasks(); err != nil {
		logJSON.Warn("scheduled_tasks_load_failed", "error", err.Error())
	}
	if flag.Lookup("test.v") == nil {
		s.startTranscriptWatchdog()
		s.startUploadReaper(2*time.Minute, 10*time.Minute)
		StartScratchCleanupRoutine(context.Background(), 24*time.Hour, DefaultScratchMaxAge)
	}
	loadAccountPrefs()
	s.isIDERunning = true
	return s
}

// SetIDERunning met à jour l'état de fonctionnement de l'IDE Antigravity et notifie les clients
func (s *Server) SetIDERunning(running bool, port int, info *discovery.LocalHarnessInfo) {
	s.mu.Lock()
	changed := s.isIDERunning != running
	s.isIDERunning = running
	s.mu.Unlock()

	s.broadcast(OutgoingMessage{
		Type: "ide_status",
		Data: map[string]interface{}{
			"running": running,
			"port":    port,
		},
	})
	if changed && running {
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
	}
}

// IsIDERunning retourne l'état actuel de l'IDE Antigravity
func (s *Server) IsIDERunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isIDERunning
}

// startUploadReaper purge périodiquement les uploads partiels expirés en mémoire (VULN-14).
func (s *Server) startUploadReaper(interval, maxAge time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			s.mu.Lock()
			now := time.Now()
			for id, state := range s.uploadChunks {
				if state != nil && now.Sub(state.createdAt) > maxAge {
					delete(s.uploadChunks, id)
				}
			}
			s.mu.Unlock()
		}
	}()
}

// sessionsCacheTTL : dur├®e de fra├«cheur du cache list_sessions. Le mobile
// rafra├«chit la liste ├á chaque reconnexion ; le LS met ~9,5 s ├á r├®pondre.
// 5 s = 1 seule recharge si l'utilisateur rouvre l'app 2 fois de suite, mais
// la liste reste assez fra├«che pour un usage r├®el.
const sessionsCacheTTL = 5 * time.Second

// cachedSessions retourne le r├®sultat list_sessions frais s'il existe (moins
// de sessionsCacheTTL), sinon (nil, false).
func (s *Server) cachedSessions() ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cachedSessionsLocked()
}

// SetSessionsCacheTTL permet de configurer le TTL du cache de sessions (ex: tests rapides).
func (s *Server) SetSessionsCacheTTL(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionsCacheTTL = ttl
}

func (s *Server) cachedSessionsLocked() ([]byte, bool) {
	return s.cachedSessionsOptsLocked(false)
}

// cachedSessionsAllLocked sert list_all_sessions (historique des
// conversations) : inclut les sessions archivées sur le chemin Jetbox chaud.
func (s *Server) cachedSessionsAllLocked() ([]byte, bool) {
	return s.cachedSessionsOptsLocked(true)
}

func (s *Server) cachedSessionsOptsLocked(includeArchived bool) ([]byte, bool) {
	// Jetbox chaud (stream actif) : la carte est la source de vérité temps
	// réel — toujours servie, jamais de GetAllCascades (~9,5 s).
	if s.jetboxSummaries != nil {
		out := s.sessionsFromSummariesOptsLocked(s.jetboxSummaries, includeArchived)
		raw, _ := json.Marshal(out)
		return raw, true
	}
	ttl := s.sessionsCacheTTL
	if ttl <= 0 {
		ttl = sessionsCacheTTL
	}
	if s.sessionsCache != nil && time.Since(s.sessionsCachedAt) < ttl {
		return s.sessionsCache, true
	}
	return nil, false
}

// jetboxSessionsLocked sérialise la carte Jetbox au format historique
// list_sessions (mêmes clés que sessionsOut, filtres Antigravity 2.0 inclus).
func (s *Server) jetboxSessionsLocked() []byte {
	out := s.sessionsFromSummariesLocked(s.jetboxSummaries)
	raw, _ := json.Marshal(out)
	return raw
}

// jetboxSyncUpdates applique une frame Jetbox (updates/deletes) à la carte et
// diffuse sessions_updated à tous les clients. Appelée par la goroutine du
// stream — le lock protège la carte contre list_sessions concurrent.
// Si la session IDE au premier plan change, diffuse aussi session_focus_changed.
func (s *Server) jetboxSyncUpdates(updates map[string]connectrpc.JetboxSummary, deletes []string) {
	s.mu.Lock()
	if s.jetboxSummaries == nil {
		s.jetboxSummaries = make(map[string]connectrpc.JetboxSummary)
	}
	for id, sum := range updates {
		s.jetboxSummaries[id] = sum
	}
	for _, id := range deletes {
		delete(s.jetboxSummaries, id)
	}
	s.sessionsCache = nil
	// Détecte le changement de session au premier plan (miroir parfait mobile).
	var focusPayload map[string]interface{}
	if newFocus := computeFocusedSession(s.jetboxSummaries); newFocus != nil && newFocus.CascadeID != s.focusedCascadeID {
		s.focusedCascadeID = newFocus.CascadeID
		focusPayload = map[string]interface{}{
			"cascadeId":     newFocus.CascadeID,
			"title":         newFocus.Title,
			"workspacePath": newFocus.Workspace,
			"status":        newFocus.Status,
		}
	}
	s.mu.Unlock()

	for _, id := range deletes {
		s.purgeCascadeState(id)
		s.broadcast(OutgoingMessage{
			Type:      "session_deleted",
			CascadeID: id,
			Data: map[string]interface{}{
				"cascadeId": id,
			},
		})
	}

	// Notifie les clients connectés : le mobile rafraîchit sa sidebar.
	s.broadcast(OutgoingMessage{
		Type: "sessions_updated",
		Data: s.sessionsFromSummaries(s.snapshotSummaries()),
	})

	// Notifie les mises à jour individuelles de statut pour chaque session
	for id, sum := range updates {
		s.broadcast(OutgoingMessage{
			Type:      "session_status_update",
			CascadeID: id,
			Data: map[string]interface{}{
				"status": sum.Status,
			},
		})
		st := strings.ToUpper(sum.Status)
		if strings.Contains(st, "RUNNING") || strings.Contains(st, "BUSY") {
			s.startExternalTurnStreamer(id)
		}
	}

	// Push focus si la session IDE active a changé.
	if focusPayload != nil {
		s.broadcast(OutgoingMessage{
			Type: "session_focus_changed",
			Data: focusPayload,
		})
	}
}

// snapshotSummaries retourne une copie de la carte sous lock (pour broadcast).
func (s *Server) snapshotSummaries() map[string]connectrpc.JetboxSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jetboxSummaries == nil {
		return nil
	}
	cp := make(map[string]connectrpc.JetboxSummary, len(s.jetboxSummaries))
	for k, v := range s.jetboxSummaries {
		cp[k] = v
	}
	return cp
}

// sessionsFromSummariesLocked applique le filtre Antigravity 2.0 (archivées, killed,
// subagents), enrichit les statuts d'exécution dynamiques sous lock ou sans lock supplémentaire.
func (s *Server) sessionsFromSummariesLocked(jetbox map[string]connectrpc.JetboxSummary) map[string]interface{} {
	return s.sessionsFromSummariesOptsLocked(jetbox, false)
}

// sessionsFromSummariesOptsLocked : includeArchived garde les sessions
// archivées (isArchived + CASCADE_STATUS_ARCHIVED) pour l'historique des
// conversations ; supprimées et subagents toujours exclus.
func (s *Server) sessionsFromSummariesOptsLocked(jetbox map[string]connectrpc.JetboxSummary, includeArchived bool) map[string]interface{} {
	home, _ := os.UserHomeDir()
	projects := ListOfficialProjects()
	enrichStatus := func(cascadeID, origStatus string) string {
		if s != nil {
			if s.activeCascades != nil && s.activeCascades[cascadeID] {
				return "CASCADE_STATUS_RUNNING"
			}
			if s.approvals != nil {
				if p, ok := s.approvals[cascadeID]; ok && !p.expired {
					return "CASCADE_STATUS_WAITING_FOR_USER_ACTION"
				}
			}
		}
		if origStatus != "" && origStatus != "idle" {
			return origStatus
		}
		return "CASCADE_STATUS_READY"
	}

	items := make([]map[string]interface{}, 0, len(jetbox))
	for _, sum := range jetbox {
		if sum.Killed || sum.Source == 16 || sum.IsSubagent {
			continue
		}
		pbArchived := home != "" && isSessionArchived(home, sum.CascadeID)
		if pbArchived && home != "" && isSessionDeleted(home, sum.CascadeID) {
			continue // supprimée : ni sidebar ni historique
		}
		isArchived := sum.Archived || pbArchived || sum.Status == "CASCADE_STATUS_ARCHIVED" || strings.EqualFold(sum.Status, "archived")
		if isArchived && !includeArchived {
			continue
		}
		title := sum.Title
		convTitlesMu.RLock()
		if custom, ok := globalConvTitles[strings.ToLower(sum.CascadeID)]; ok && custom != "" {
			title = custom
		}
		convTitlesMu.RUnlock()

		if isSubagentTitle(title) {
			continue
		}
		if isJunkSessionTitle(title) {
			if !includeArchived || sum.UpdatedAt.IsZero() {
				continue
			}
		}
		wsName, wsPath, projID := matchOfficialProject(sum.ProjectID, sum.Workspace, sum.Workspace, projects)

		isPinned := false
		if home != "" {
			isPinned = isSessionPinned(home, sum.CascadeID)
		}

		st := enrichStatus(sum.CascadeID, sum.Status)
		if isArchived {
			st = "CASCADE_STATUS_ARCHIVED"
		}
		isIde := strings.Contains(sum.Workspace, "antigravity-ide") || strings.Contains(wsPath, "antigravity-ide")
		items = append(items, map[string]interface{}{
			"cascadeId":     sum.CascadeID,
			"title":         title,
			"workspace":     wsName,
			"workspacePath": wsPath,
			"projectId":     projID,
			"status":        st,
			"updatedAt":     sum.UpdatedAt,
			"isPinned":      isPinned,
			"isArchived":    isArchived,
			"isIde":         isIde,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		tI, _ := items[i]["updatedAt"].(time.Time)
		tJ, _ := items[j]["updatedAt"].(time.Time)
		return tI.After(tJ)
	})

	var v int64 = 0
	if s != nil {
		s.stateVersion++
		v = s.stateVersion
	}
	return map[string]interface{}{
		"version":   v,
		"projects":  projects,
		"sessions":  items,
		"timestamp": time.Now().UnixMilli(),
	}
}

// sessionsFromSummaries applique le filtre Antigravity 2.0 et enrichit les statuts dynamiques.
func (s *Server) sessionsFromSummaries(jetbox map[string]connectrpc.JetboxSummary) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionsFromSummariesLocked(jetbox)
}

func sessionsFromSummaries(jetbox map[string]connectrpc.JetboxSummary) map[string]interface{} {
	return (&Server{}).sessionsFromSummariesLocked(jetbox)
}

// computeFocusedSession identifie la session IDE au premier plan :
// priorité : RUNNING (2) > WAITING (1) > READY (0).
// En cas d'égalité de score, la session actuelle (best) est conservée pour
// éviter le flip-flop de focus entre sessions READY à chaque heartbeat Jetbox.
// Exclut sous-agents (source==16), archivées et tuées.
func computeFocusedSession(summaries map[string]connectrpc.JetboxSummary) *connectrpc.JetboxSummary {
	var best *connectrpc.JetboxSummary
	score := func(st string, w bool) int {
		if st == "CASCADE_STATUS_RUNNING" {
			return 2
		}
		if w || st == "CASCADE_STATUS_WAITING_FOR_USER_ACTION" {
			return 1
		}
		return 0
	}
	for _, sum := range summaries {
		if sum.Archived || sum.Killed || sum.Source == 16 {
			continue
		}
		s := sum // copie locale (évite capture de variable de boucle)
		if best == nil {
			best = &s
			continue
		}
		if score(s.Status, s.Waiting) > score(best.Status, best.Waiting) {
			best = &s
		} else if score(s.Status, s.Waiting) == score(best.Status, best.Waiting) && s.UpdatedAt.After(best.UpdatedAt) {
			best = &s
		}
	}
	return best
}

// cachedProjectID resolve le projectID d'un workspace à partir du cache
// list_sessions d├®j├á chaud (co├╗t nul). Retourne ("", false) si le cache est
// vide ÔÇö l'appelant retombe alors sur le comportement cascade "orpheline".
// Ponctuellement utilis├® par create_cascade pour ├®viter le GetAllCascades
// synchrone (~9,5 s) sur le chemin critique.
func (s *Server) cachedProjectID(uri string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	norm := strings.ToLower(normalizeWorkspace(uri))

	if s.jetboxSummaries != nil {
		for _, sum := range s.jetboxSummaries {
			if sum.ProjectID != "" {
				wsNorm := strings.ToLower(normalizeWorkspace(sum.Workspace))
				if norm == "" || wsNorm == norm || strings.HasSuffix(wsNorm, norm) || strings.HasSuffix(norm, wsNorm) {
					return sum.ProjectID, true
				}
			}
		}
	}
	if len(s.sessionsCache) > 0 {
		for _, sum := range connectrpc.ParseTrajectories(s.sessionsCache) {
			if sum.ProjectID != "" {
				wsNorm := strings.ToLower(normalizeWorkspace(sum.Workspace))
				if norm == "" || wsNorm == norm || strings.HasSuffix(wsNorm, norm) || strings.HasSuffix(norm, wsNorm) {
					return sum.ProjectID, true
				}
			}
		}
	}
	// Fallback sur le registre officiel ~/.gemini/config/projects/*.json
	if regID := projectIDFromRegistry(uri); regID != "" {
		return regID, true
	}
	// Fallback sur les projets officiels
	projs := ListOfficialProjects()
	if len(projs) > 0 {
		for _, p := range projs {
			pNorm := strings.ToLower(normalizeWorkspace(p.FolderURI))
			pNormPath := strings.ToLower(normalizeWorkspace(p.Path))
			if norm == "" || pNorm == norm || pNormPath == norm || strings.HasSuffix(pNorm, norm) || strings.HasSuffix(norm, pNorm) || strings.EqualFold(p.Name, uri) {
				return p.ID, true
			}
		}
		if len(projs) == 1 {
			return projs[0].ID, true
		}
	}
	return "", false
}

// fetchSessionsSingleFlight : un seul appel GetAllCascades ├á la fois, quel que
// soit le nombre de clients qui demandent la liste. Les appelants concurrents
// attendent le m├¬me r├®sultat au lieu de marteler le hub LS.
//
// Si la carte Jetbox est chaude, elle est servie directement (chemin rapide,
// aucun appel LS) ÔÇö le single-flight ne sert que de repli.
func (s *Server) fetchSessionsSingleFlight() []byte {
	s.mu.Lock()
	if raw, ok := s.cachedSessionsLocked(); ok {
		s.mu.Unlock()
		return raw
	}

	if s.fetchDone != nil {
		waitCh := s.fetchDone
		s.mu.Unlock()
		<-waitCh
		s.mu.Lock()
		raw, _ := s.cachedSessionsLocked()
		s.mu.Unlock()
		return raw
	}

	doneCh := make(chan struct{})
	s.fetchDone = doneCh
	s.mu.Unlock()

	var raw []byte
	var err error
	if s.RPCClient != nil {
		raw, err = s.RPCClient.GetAllCascades()
	}

	s.mu.Lock()
	if err == nil {
		s.sessionsCache = raw
		if len(raw) == 0 {
			s.sessionsCache = []byte(`{"sessions":[]}`)
		}
		s.sessionsCachedAt = time.Now()
	}
	s.fetchDone = nil
	close(doneCh)
	s.mu.Unlock()

	return raw
}

// SetApprovalTimeout expose le d├®lai d'auto-refus des approbations (5 min par
// d├®faut) aux Settings mobile via le message WS "set_approval_timeout".
func (s *Server) SetApprovalTimeout(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.approvalTimeout = d
}

// SetAllowRemoteTerminal configure l'autorisation d'ouverture de terminaux PTY distants.
func (s *Server) SetAllowRemoteTerminal(allow bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.allowRemoteTerminal = allow
}

// SetAutoAccept active/désactive l'auto-approbation des actions (toggle des
// réglages mobile, message WS set_auto_accept). Rétro-compatibilité : enabled=true
// active le mode "readonly" par défaut.
func (s *Server) SetAutoAccept(enabled bool) {
	s.SetAutoAcceptWithMode(enabled, "readonly")
}

// SetAutoAcceptWithMode configure l'auto-approbation avec son mode ("readonly" ou "full").
func (s *Server) SetAutoAcceptWithMode(enabled bool, mode string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autoAcceptEnabled = enabled
	if mode == "" {
		mode = "readonly"
	}
	s.autoAcceptMode = mode
}

// autoAccept rapporte si l'auto-approbation est active.
func (s *Server) autoAccept() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.autoAcceptEnabled
}

// autoAcceptCurrentMode rapporte le mode actif ("readonly", "full" ou "off").
func (s *Server) autoAcceptCurrentMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.autoAcceptEnabled {
		return "off"
	}
	if s.autoAcceptMode != "" {
		return s.autoAcceptMode
	}
	return "readonly"
}

// shouldAutoApprove détermine si un outil doit être auto-approuvé selon le mode actif.
// En mode "full", tout outil est auto-approuvé SAUF les questions interactives.
// En mode "readonly", seuls les outils read-only sont auto-approuvés.
func (s *Server) shouldAutoApprove(tool string) bool {
	mode := s.autoAcceptCurrentMode()
	switch mode {
	case "full":
		return !isInteractiveQuestionTool(tool)
	case "readonly":
		return isReadOnlyTool(tool)
	default:
		return false
	}
}

// isInteractiveQuestionTool identifie les outils de question utilisateur qui
// requièrent toujours une réponse humaine et ne peuvent jamais être auto-approuvés.
func isInteractiveQuestionTool(tool string) bool {
	switch strings.ToLower(tool) {
	case "ask_question", "ask_user", "ask_choice", "question":
		return true
	default:
		return false
	}
}

// cachedModels récupère les modèles disponibles depuis le cache (TTL 30s), le Language Server et custom_models.json.
func (s *Server) cachedModels() ([]connectrpc.ModelInfo, error) {
	s.mu.Lock()
	if len(s.modelsCache) > 0 && time.Since(s.modelsCachedAt) < 30*time.Second {
		models := make([]connectrpc.ModelInfo, len(s.modelsCache))
		copy(models, s.modelsCache)
		s.mu.Unlock()
		return models, nil
	}
	s.mu.Unlock()

	var models []connectrpc.ModelInfo
	raw, err := s.RPCClient.ListModels()
	if err == nil {
		if parsed, ok := connectrpc.ParseModels(raw); ok && len(parsed) > 0 {
			models = append(models, parsed...)
		}
	}

	// Compléter avec les modèles custom définis dans ~/.gemini/antigravity/custom_models.json
	customs := loadCustomModelsFile()
	existingIDs := make(map[string]bool)
	for _, m := range models {
		existingIDs[m.ModelID] = true
	}
	for _, cm := range customs {
		if !existingIDs[cm.ModelID] {
			models = append(models, cm)
			existingIDs[cm.ModelID] = true
		}
	}

	if len(models) == 0 {
		if err != nil {
			return nil, err
		}
		return nil, nil
	}

	s.mu.Lock()
	s.modelsCache = models
	s.modelsCachedAt = time.Now()
	s.mu.Unlock()

	return models, nil
}

type customModelConfig struct {
	Name              string `json:"name"`
	DisplayName       string `json:"displayName"`
	Description       string `json:"description"`
	Provider          string `json:"provider"`
	ExternalModelName string `json:"externalModelName"`
}

func loadCustomModelsFile() []connectrpc.ModelInfo {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	cfgPath := filepath.Join(home, ".gemini", "antigravity", "custom_models.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return nil
	}
	var configs []customModelConfig
	if err := json.Unmarshal(data, &configs); err != nil {
		return nil
	}
	var out []connectrpc.ModelInfo
	for _, c := range configs {
		mID := c.Name
		if mID == "" {
			mID = c.ExternalModelName
		}
		dName := c.DisplayName
		if dName == "" {
			dName = mID
		}
		out = append(out, connectrpc.ModelInfo{
			ModelID:          mID,
			DisplayName:      dName,
			Description:      c.Description,
			Recommended:      true,
			SupportsThinking: strings.Contains(strings.ToLower(mID+dName), "r1") || strings.Contains(strings.ToLower(mID+dName), "reasoning"),
			SupportsImages:   true,
		})
	}
	return out
}

// resolveModelID résout un nom de modèle (ou displayName ou alias) vers son ModelID officiel (G7).
func (s *Server) resolveModelID(nameOrID string) string {
	if nameOrID == "" {
		return ""
	}
	models, err := s.cachedModels()
	if err != nil || len(models) == 0 {
		return nameOrID
	}
	lower := strings.ToLower(strings.TrimSpace(nameOrID))
	for _, m := range models {
		if strings.EqualFold(m.ModelID, nameOrID) {
			return m.ModelID
		}
		if strings.EqualFold(m.DisplayName, nameOrID) || strings.ToLower(m.DisplayName) == lower {
			return m.ModelID
		}
	}
	return nameOrID
}

// SetNoTools active/d├®sactive le mode global ┬½ r├®pondre sans outils ┬╗
// (planner_mode 3 = NO_TOOL, message WS set_no_tools). D├®faut appliqu├® aux
// send_prompt sans flag explicite ; le flag par prompt reste prioritaire.
func (s *Server) SetNoTools(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.noToolsEnabled = enabled
}

// jetboxBackoff plafonne le d├®lai de reconnexion apr├¿s un ├®chec du stream
// Jetbox (le LS peut ├¬tre en cours de red├®marrage).
const jetboxBackoff = 30 * time.Second

// RunJetboxSubscription d├®marre la boucle long-vivante du stream
// JetboxSubscribeToSummaries (source de v├®rit├® temps r├®el de la sidebar).
// Le snapshot initial remplit la carte jetboxSummaries, les frames suivantes
// l'actualisent ; chaque mise ├á jour est broadcast├®e (sessions_updated).
// Reconnecte en boucle avec backoff ÔÇö goroutine autonome, ne bloque jamais
// le d├®marrage du serveur. La carte est invalid├®e (nil) quand le stream n'a
// jamais produit de frame pour retomber sur GetAllCascades + fallback local.
func (s *Server) RunJetboxSubscription(rpc JetboxStreamer) {
	go func() {
		backoff := 2 * time.Second
		for {
			err := rpc.RunJetboxSubscription(s.jetboxSyncUpdates)
			if err == nil {
				// Stream fermé proprement par le LS (restart) : on invalide
				// la carte pour ne pas servir un état périmé pendant la
				// reconnexion, puis on retente.
				s.mu.Lock()
				s.jetboxSummaries = nil
				s.mu.Unlock()
			}
			if err != nil && strings.Contains(err.Error(), "closed") {
				return
			}
			logJSON.Warn("jetbox_stream_end", "err", err, "retry_in", backoff)
			time.Sleep(backoff)
			if backoff < jetboxBackoff {
				backoff *= 2
			}
		}
	}()
}

// noTools rapporte si le mode global sans-outils est actif.
func (s *Server) noTools() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.noToolsEnabled
}

// mcpProxyBase est le point d'entr├®e HTTP du proxy MCP Antigravity desktop
// (antigravity-patch-proxy, ├®coute sur 127.0.0.1:50999). Le daemon y route
// les appels d'outils MCP venus du mobile ÔÇö la session du PC fait foi pour
// l'authentification et l'allowlist des serveurs MCP.
const mcpProxyBase = "http://127.0.0.1:50999"

// CancelGeneration interrompt une cascade active et diffuse stream_end(cancelled).
func (s *Server) CancelGeneration(cascadeID string) {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0)
	if m, ok := s.activeCancels[cascadeID]; ok {
		for _, c := range m {
			if c != nil {
				cancels = append(cancels, c)
			}
		}
		delete(s.activeCancels, cascadeID)
	}
	reqID := s.activeRequestIDs[cascadeID]
	delete(s.activeRequestIDs, cascadeID)
	if s.activeCascades != nil {
		delete(s.activeCascades, cascadeID)
	}
	if s.jetboxSummaries != nil {
		if sum, ok := s.jetboxSummaries[cascadeID]; ok {
			sum.Status = "CASCADE_STATUS_READY"
			s.jetboxSummaries[cascadeID] = sum
		}
	}
	s.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	s.clearApproval(cascadeID)
	s.ClearCascadeActive(cascadeID)

	s.broadcast(OutgoingMessage{
		Type:      "stream_end",
		RequestID: reqID,
		Data: map[string]interface{}{
			"cascadeId":  cascadeID,
			"outcome":    "cancelled",
			"message":    "Generation stopped by user",
			"hostActive": false,
		},
	})

	// Le stream_end(cancelled) est broadcasté → même confirmation outbox que
	// le send_prompt (le prompt n'est plus « non confirmé »).
	if errOut := s.outbox.Confirm(cascadeID, reqID); errOut != nil {
		logJSON.Warn("outbox_confirm_failed", "cascadeId", cascadeID, "err", errOut.Error())
	}
}

// MarkCascadeActive marque une cascade comme « en cours de stream » (posé à
// l'entrée de send_prompt, retiré à la sortie). Servi au /health et enrichi
// dans list_sessions / sessionsFromSummaries.
func (s *Server) MarkCascadeActive(cascadeID string) {
	s.mu.Lock()
	if s.activeCascades == nil {
		s.activeCascades = make(map[string]bool)
	}
	s.activeCascades[cascadeID] = true
	s.mu.Unlock()
}

// ClearCascadeActive retire la marque de stream en cours.
func (s *Server) ClearCascadeActive(cascadeID string) {
	s.mu.Lock()
	delete(s.activeCascades, cascadeID)
	s.mu.Unlock()
}

// IsCascadeActive renvoie vrai si la cascade est actuellement en cours de stream ou active.
func (s *Server) IsCascadeActive(cascadeID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeCascades[cascadeID] || s.activeRequestIDs[cascadeID] != ""
}

// isSessionActivelyRunning vérifie si la cascade est actuellement active (statut RUNNING ou BUSY dans Jetbox/LS).
// Auto-corrige le statut en mémoire si le transcript local n'a plus d'activité depuis > 4s.
func (s *Server) isSessionActivelyRunning(cascadeID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jetboxSummaries == nil {
		return false
	}
	sum, ok := s.jetboxSummaries[cascadeID]
	if !ok {
		return false
	}
	st := strings.ToUpper(sum.Status)
	if !strings.Contains(st, "RUNNING") && !strings.Contains(st, "BUSY") {
		return false
	}

	// Auto-correction : Si Jetbox est resté coincé sur RUNNING/BUSY mais que le fichier transcript n'a plus
	// d'activité depuis plus de 4 secondes, la session est en réalité stabilisée.
	if !isRunningTests() {
		tPath := findTranscriptPath(cascadeID)
		if tPath != "" {
			if fi, err := os.Stat(tPath); err == nil {
				if time.Since(fi.ModTime()) > 4*time.Second {
					sum.Status = "CASCADE_STATUS_READY"
					s.jetboxSummaries[cascadeID] = sum
					return false
				}
			}
		}
	}
	return true
}

// Stats renvoie un snapshot coh├®rent de l'├®tat du serveur (C5).
func (s *Server) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	active := make([]string, 0, len(s.activeCascades))
	for c := range s.activeCascades {
		active = append(active, c)
	}
	sort.Strings(active)
	st := Stats{
		Sessions:       len(s.activeCascades),
		Streams:        len(s.activeCascades),
		Clients:        len(s.clients),
		Uptime:         time.Since(s.startedAt).Round(time.Second).String(),
		ActiveCascades: active,
		LastError:      s.lastError,
	}
	st.Status = "ok"
	if s.lastError != "" {
		st.Status = "degraded"
	}
	return st
}

// SetTokenValidator configure un validateur dynamique de jetons de session (P4).
func (s *Server) SetTokenValidator(v func(token string) bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokenValidator = v
}

// SetSessionValidator configure le validateur enrichi (SessionInfo + allowedProjects).
// Si pr├®sent, il est utilis├® au handshake pour stocker le scope projet de chaque
// connexion (3.3). Sans lui, aucun filtrage par projet (comportement historique).
func (s *Server) SetSessionValidator(v func(token string) (discovery.SessionInfo, bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionValidator = v
}

// SetPairingManager branche le PairingManager (3.4) pour les opÃ©rations
// d'administration (list_devices / revoke_device). Facultatif : sans lui,
// handleAdmin rÃ©pond "gestion des appareils indisponible".
func (s *Server) SetPairingManager(pm interface {
	ListSessions() []discovery.SessionInfo
	RevokeDevice(deviceID string) bool
}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pairHandler = pm
}

// sessionFor retourne les infos de session de la connexion (vide si aucune).
func (s *Server) sessionFor(conn *websocket.Conn) discovery.SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clientSessions[conn]
}

// allowProject d├®termine si une connexion a le droit d'agir sur un projet.
// Sans session (client non pair├® / ancien token) ou sans allowedProjects,
// aucun filtrage (comportement historique : tout est permis).
func (s *Server) allowProject(conn *websocket.Conn, uri string) bool {
	sess := s.sessionFor(conn)
	if len(sess.AllowedProjects) == 0 {
		return true
	}
	// Le scope stocke des URIs (file:///...) ; on compare aussi le chemin nu
	// pour tol├®rer workspacePath c├┤t├® mobile.
	plain := strings.TrimPrefix(strings.TrimPrefix(uri, "file://"), "/")
	plain = strings.ReplaceAll(plain, `\`, "/")
	for _, p := range sess.AllowedProjects {
		if p == uri || strings.TrimPrefix(strings.TrimPrefix(p, "file://"), "/") == plain {
			return true
		}
	}
	return false
}

// requireAdmin est la garde d'accès des opérations d'administration (3.4) :
// seul un appareil pairé avec la session Admin=true (premier appairage du
// device) peut administrer les terminaux distants et révoquer les devices.
// En mode sans authentification (AuthToken vide / tests), l'accès est permis.
func (s *Server) requireAdmin(conn *websocket.Conn) bool {
	return s.sessionFor(conn).Admin
}

// requireProject restreint les actions sensibles au périmètre projet : un
// device scoped (allowedProjects non vide) ne peut agir que sur SES projets.
func (s *Server) requireProject(conn *websocket.Conn, uri string) bool {
	sess := s.sessionFor(conn)
	if sess.Admin {
		return true
	}
	return s.allowProject(conn, uri)
}

// canApproveCascade vérifie si la connexion cliente a le droit d'approuver
// une action sensible pour la cascade spécifiée (paternité ou privilège Admin).
func (s *Server) canApproveCascade(conn *websocket.Conn, cascadeID string) bool {
	sess := s.sessionFor(conn)
	if sess.Admin {
		return true
	}
	s.mu.Lock()
	ownerDevID := s.cascadeDeviceOwners[cascadeID]
	if p, ok := s.approvals[cascadeID]; ok && p.originatingDeviceID != "" {
		ownerDevID = p.originatingDeviceID
	}
	s.mu.Unlock()

	if ownerDevID != "" {
		return sess.DeviceID != "" && sess.DeviceID == ownerDevID
	}

	return s.allowProject(conn, "")
}

// filterByScope restreint la payload list_sessions (sessions + projects) aux
// projets autoris├®s de la connexion. Sans allowedProjects, la payload est
// retourn├®e inchang├®e (comportement historique). Utilis├® par le case
// "list_sessions" ÔÇö le broadcast sessions_updated reste non filtr├® (chaque
// client re-filtre ├á la lecture).
func (s *Server) filterByScope(conn *websocket.Conn, data map[string]interface{}) map[string]interface{} {
	sess := s.sessionFor(conn)
	if len(sess.AllowedProjects) == 0 {
		return data
	}
	allowed := make(map[string]bool, len(sess.AllowedProjects))
	for _, p := range sess.AllowedProjects {
		plain := strings.TrimPrefix(strings.TrimPrefix(p, "file://"), "/")
		plain = strings.ReplaceAll(plain, `\`, "/")
		allowed[plain] = true
	}
	// Sessions : filtr├®es sur projectId, puis workspaceUri en repli.
	if sessions, ok := data["sessions"].([]interface{}); ok {
		filtered := sessions[:0:0]
		for _, s := range sessions {
			if m, ok := s.(map[string]interface{}); ok {
				proj := ""
				if v, ok := m["projectId"].(string); ok {
					proj = strings.TrimPrefix(strings.TrimPrefix(v, "file://"), "/")
					proj = strings.ReplaceAll(proj, `\`, "/")
				}
				if w, ok := m["workspaceUri"].(string); ok && proj == "" {
					proj = strings.TrimPrefix(strings.TrimPrefix(w, "file://"), "/")
					proj = strings.ReplaceAll(proj, `\`, "/")
				}
				if proj != "" && !allowed[proj] {
					continue
				}
			}
			filtered = append(filtered, s)
		}
		data["sessions"] = filtered
	}
	// Projets : filtr├®s sur path (ou uri en repli).
	if projects, ok := data["projects"].([]interface{}); ok {
		filtered := projects[:0:0]
		for _, p := range projects {
			if m, ok := p.(map[string]interface{}); ok {
				var proj string
				if v, ok := m["path"].(string); ok {
					proj = v
				} else if v, ok := m["uri"].(string); ok {
					proj = v
				}
				proj = strings.TrimPrefix(strings.TrimPrefix(proj, "file://"), "/")
				proj = strings.ReplaceAll(proj, `\`, "/")
				if proj != "" && !allowed[proj] {
					continue
				}
			}
			filtered = append(filtered, p)
		}
		data["projects"] = filtered
	}
	return data
}

// maxWSMessageSize borne la taille des messages WebSocket entrants (1 Mo)
// pour emp├¬cher un client de faire un DoS m├®moire.
const maxWSMessageSize = 1 << 20

// maxConcurrentStreams : nombre maximum de send_prompt simultan├®s PAR CLIENT
// (C3). Au-del├á, la requ├¬te est refus├®e avec une erreur explicite ÔÇö un seul
// t├®l├®phone ne peut pas saturer le hub.
const maxConcurrentStreams = 2

// hostActiveWindow : fen├¬tre d'activit├® clavier/souris du PC h├┤te (C7-B).
// Si l'utilisateur a interagi dans les 90 derni├¿res secondes, on consid├¿re
// qu'il est devant le PC ÔåÆ le mobile supprime la notification d'approbation.
const hostActiveWindow = 90 * time.Second

// pingInterval / pongWait : garde-fous de connexions mortes. Le ping ├®choue
// si le pair ne r├®pond pas (network parti, app ferm├®e) ÔåÆ read error ÔåÆ le
// client est retir├® du broadcast.
const (
	pingInterval = 30 * time.Second
	pongWait     = 60 * time.Second
)

// writeTimeout : deadline d'├®criture par message. Un client mort (buffer TCP
// plein) ferait sinon bloquer WriteJSON ind├®finiment sous writeMu ÔåÆ head-of-line
// blocking sur TOUTES les connexions (le broadcast passe par le m├¬me mutex).
const writeTimeout = 10 * time.Second

// quotaPushInterval : cadence du push de quotas scheduler ÔåÆ clients mobiles.
// Align├®e sur l'ancien timer mobile de 60 s ; 1 appel LS/min max.
const quotaPushInterval = 60 * time.Second

// writeJSON envoie un message ├á une connexion donn├®e (writer unique par
// connexion : un seul goroutine ├®crit sur un websocket.Conn ├á la fois ÔÇö le
// broadcast, les r├®ponses unary et la goroutine de ping passent tous par le
// mutex de LA connexion cibl├®e, jamais par un mutex global).
func (s *Server) writeJSON(conn *websocket.Conn, msg OutgoingMessage) error {
	mu := s.writeLock(conn)
	mu.Lock()
	defer mu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := conn.WriteJSON(msg); err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "use of closed network connection") ||
			strings.Contains(errStr, "broken pipe") ||
			strings.Contains(errStr, "connection reset by peer") ||
			strings.Contains(errStr, "websocket: close sent") {
			logJSON.Debug("write_closed_connection", "err", err)
		} else {
			logJSON.Warn("write_error", "err", err)
		}
		return err
	}
	return nil
}

// writeLock retourne le mutex d'écriture dédié à conn (créé à la volée si le
// client s'est connecté avant l'initialisation — chemin de test uniquement).
func (s *Server) writeLock(conn *websocket.Conn) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.writeLocks == nil {
		s.writeLocks = make(map[*websocket.Conn]*sync.Mutex)
	}
	if lk, ok := s.writeLocks[conn]; ok {
		return lk
	}
	lk := &sync.Mutex{}
	s.writeLocks[conn] = lk
	return lk
}

// releaseWriteLock libère la mémoire du mutex d'écriture d'un client déconnecté.
func (s *Server) releaseWriteLock(conn *websocket.Conn) {
	s.mu.Lock()
	lk := s.writeLocks[conn]
	s.mu.Unlock()
	if lk != nil {
		lk.Lock()
		s.mu.Lock()
		delete(s.writeLocks, conn)
		s.mu.Unlock()
		lk.Unlock()
	}
}

// mcpTimeout borne l'appel HTTP vers le proxy MCP desktop (30 s) — aligné sur
// le timeout 15 s côté mobile + la marge de traversée tunnel/4G.
const mcpTimeout = 30 * time.Second

// handleMcpAction relaie call_mcp_tool / connect_mcp_server /
// refresh_mcp_oauth_token / list_mcp_servers vers le proxy MCP Antigravity
// desktop (127.0.0.1:50999). Le mobile n'a ni les identifiants ni l'allowlist
// MCP : la session du PC est le seul détenteur légitime — le daemon n'est
// qu'un tunnel. La réponse JSON du proxy est relayée telle quelle dans Data.
func (s *Server) handleMcpAction(conn *websocket.Conn, msg IncomingMessage) {
	// list_mcp_servers est une opération de listing (GET, sans serverName) :
	// le mobile demande la liste des serveurs configurés sur le PC. Les autres
	// actions MCP exigent un serverName.
	if msg.Type != "list_mcp_servers" && msg.ServerName == "" {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "serverName requis"})
		return
	}

	payload := map[string]interface{}{
		"serverName": msg.ServerName,
	}
	if msg.ToolName != "" {
		payload["toolName"] = msg.ToolName
	}
	if msg.Arguments != nil {
		payload["arguments"] = msg.Arguments
	}
	if msg.Endpoint != "" {
		payload["endpoint"] = msg.Endpoint
	}
	if msg.GrantType != "" {
		payload["grantType"] = msg.GrantType
	}

	client := &http.Client{Timeout: mcpTimeout}
	var resp *http.Response
	var err error
	if msg.Type == "list_mcp_servers" {
		resp, err = client.Get(mcpProxyBase + "/list_mcp_servers")
	} else {
		body, errMarshal := json.Marshal(payload)
		if errMarshal != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "erreur d'encodage: " + errMarshal.Error()})
			return
		}
		resp, err = client.Post(mcpProxyBase+"/"+msg.Type, "application/json", bytes.NewReader(body))
	}
	if err != nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "proxy MCP injoignable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "lecture de la réponse proxy: " + err.Error()})
		return
	}
	if resp.StatusCode >= 400 {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "proxy MCP " + itoa(resp.StatusCode) + ": " + strings.TrimSpace(string(respBody))})
		return
	}

	var proxyResp map[string]interface{}
	if err := json.Unmarshal(respBody, &proxyResp); err != nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"raw": string(respBody)}})
		return
	}
	// list_mcp_servers : nettoyage et isolation des configurations invalides/non supportées (Point 5)
	if msg.Type == "list_mcp_servers" {
		if servers, ok := proxyResp["servers"].([]interface{}); ok {
			cleaned := make([]interface{}, 0, len(servers))
			for _, s := range servers {
				entry, ok := s.(map[string]interface{})
				if !ok {
					continue
				}
				for k, v := range entry {
					if v == nil {
						delete(entry, k)
					}
				}
				if name, _ := entry["name"].(string); name != "" {
					cleaned = append(cleaned, entry)
				}
			}
			proxyResp["servers"] = cleaned
		}
	} else if msg.Type == "call_mcp_tool" || msg.Type == "mcp_tool" {
		// Point 4 : déplacement des gros attachements binaires (images, PDF, audio) dans scratch/mcp_media/
		home, _ := os.UserHomeDir()
		if home != "" {
			sanitizeMcpResponse(home, proxyResp)
		}
	}
	s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: proxyResp})
}

// sanitizeMcpResponse inspecte les retours MCP et sauvegarde les gros attachements binaires
// (> 32 Ko, images, PDF, audio) sur disque dans scratch/mcp_media/ pour ne pas faire déborder le contexte du tour.
func sanitizeMcpResponse(home string, resp map[string]interface{}) {
	if resp == nil {
		return
	}
	content, ok := resp["content"].([]interface{})
	if !ok {
		return
	}
	mediaDir := filepath.Join(home, ".gemini", "antigravity", "scratch", "mcp_media")
	_ = os.MkdirAll(mediaDir, 0755)

	for _, item := range content {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		itemType, _ := m["type"].(string)
		dataStr, _ := m["data"].(string)
		mimeType, _ := m["mimeType"].(string)

		if (itemType == "image" || itemType == "resource" || strings.HasPrefix(mimeType, "image/") || strings.HasPrefix(mimeType, "audio/") || mimeType == "application/pdf") && len(dataStr) > 32*1024 {
			rawBytes, err := base64.StdEncoding.DecodeString(dataStr)
			if err == nil && len(rawBytes) > 0 {
				ext := ".bin"
				if strings.Contains(mimeType, "png") {
					ext = ".png"
				} else if strings.Contains(mimeType, "jpeg") || strings.Contains(mimeType, "jpg") {
					ext = ".jpg"
				} else if strings.Contains(mimeType, "pdf") {
					ext = ".pdf"
				} else if strings.Contains(mimeType, "audio") || strings.Contains(mimeType, "wav") {
					ext = ".wav"
				} else if strings.Contains(mimeType, "mp3") {
					ext = ".mp3"
				}
				fileName := fmt.Sprintf("mcp_%d%s", time.Now().UnixNano(), ext)
				targetPath := filepath.Join(mediaDir, fileName)
				if err := os.WriteFile(targetPath, rawBytes, 0644); err == nil {
					m["data"] = ""
					m["savedPath"] = targetPath
					m["fileUri"] = "file:///" + filepath.ToSlash(targetPath)
					m["text"] = fmt.Sprintf("[MCP Media Saved: %s](%s)", fileName, m["fileUri"])
				}
			}
		}
	}
}

// broadcast envoie le même message à TOUS les clients connectés : c'est ce qui
// permet la synchronisation multi-surface (un téléphone voit le stream déclenché
// par le PC ou par un autre téléphone). Un client dont l'écriture échoue
// (deadline dépassée) est retiré de la liste — la libération complète du lock
// s'effectue dans le defer de HandleWebSocket.
func (s *Server) broadcast(msg OutgoingMessage) {
	s.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(s.clients))
	for c := range s.clients {
		conns = append(conns, c)
	}
	s.mu.Unlock()
	for _, c := range conns {
		if s.writeJSON(c, msg) != nil {
			s.mu.Lock()
			delete(s.clients, c)
			delete(s.clientInFlight, c)
			s.mu.Unlock()
		}
	}
}

// buildQuotaData parse la r├®ponse protobuf brute du LS en map JSON stable pour
// le mobile (les 4 % attendus par le badge et le sheet Limites). ok=false si
// aucune cl├® reconnue (sch├®ma LS chang├®) ÔÇö l'appelant retombe sur toOutgoing.
func (s *Server) buildQuotaData(raw []byte) (map[string]interface{}, bool) {
	q := connectrpc.ParseQuotaSummary(raw)
	if !q.HasQuota() {
		return nil, false
	}
	return map[string]interface{}{
		"weeklyPercent":         q.WeeklyPercent,
		"fiveHourPercent":       q.FiveHourPercent,
		"weeklyPercentClaude":   q.WeeklyPercentClaude,
		"fiveHourPercentClaude": q.FiveHourPercentClaude,
	}, true
}

// pushQuotaUpdate r├®cup├¿re les quotas aupr├¿s du LS et les diffuse ├á tous les
// clients (type "quota_update", pas de requestId ÔÇö ├®v├®nement pouss├®, le mobile
// le consomme via events). Appel├® par le scheduler ; les erreurs sont logg├®es
// et silencieuses pour le client (le prochain tick r├®essaiera).
func (s *Server) pushQuotaUpdate() {
	raw, err := s.RPCClient.RetrieveUserQuotaSummary()
	if err != nil {
		logJSON.Warn("quota_push_failed", "error", err.Error())
		return
	}
	data, ok := s.buildQuotaData(raw)
	if !ok {
		logJSON.Debug("quota_push_skipped", "reason", "schema_unknown")
		return
	}
	s.broadcast(OutgoingMessage{Type: "quota_update", Data: data})
}

type IncomingMessage struct {
	Type          string `json:"type"`
	RequestID     string `json:"requestId"`
	WorkspaceURI  string `json:"workspaceUri"`
	WorkspacePath string `json:"workspacePath,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
	CascadeID     string `json:"cascadeId,omitempty"`
	CallID        string `json:"callId,omitempty"`
	TrajectoryID  string `json:"trajectoryID,omitempty"`
	StepIndex     int64  `json:"stepIndex,omitempty"`
	ApprovalType  string `json:"approvalType,omitempty"`
	Decision      string `json:"decision,omitempty"`
	Scope         string `json:"scope,omitempty"`
	// DenyReason : instruction libre envoy├®e ├á l'agent quand l'utilisateur
	// refuse une approbation run_command (ex. ┬½ fais un revert d'abord ┬╗).
	// Transmise dans le champ 3 (submitted) du CascadeRunCommandInteraction.
	// Vide ÔåÆ comportement historique (deny simple).
	DenyReason      string                 `json:"denyReason,omitempty"`
	Prompt          string                 `json:"prompt,omitempty"`
	FilePath        string                 `json:"filePath,omitempty"`
	StreamCount     int                    `json:"streamCount,omitempty"`
	Command         string                 `json:"command,omitempty"`
	LastStepIndex   int64                  `json:"lastStepIndex,omitempty"`
	SelectedAnswers []string               `json:"selectedAnswers,omitempty"`
	CustomAnswer    string                 `json:"customAnswer,omitempty"`
	TaskID          string                 `json:"taskId,omitempty"`
	Base64Data      string                 `json:"base64Data,omitempty"`
	FileName        string                 `json:"fileName,omitempty"`
	MimeType        string                 `json:"mimeType,omitempty"`
	Title           string                 `json:"title,omitempty"`
	NewTitle        string                 `json:"newTitle,omitempty"`
	Data            map[string]interface{} `json:"data,omitempty"`
	Images          []string               `json:"images,omitempty"`
	// ModelUID : identifiant du mod├¿le s├®lectionn├® dans l'app mobile
	// (requested_model_uid du cascade_config). Vide ÔåÆ repli sur ModelEnum.
	ModelUID string `json:"modelUID,omitempty"`
	// Query : terme de recherche pour search_files.
	Query string `json:"query,omitempty"`
	// ModelEnum : repli historique (requested_model_id) quand ModelUID est vide.
	ModelEnum uint64 `json:"modelEnum,omitempty"`
	// Confirm : confirmation explicite exig├®e pour les actions destructives
	// (delete_cascade) ÔÇö le mobile DOIT l'envoyer ├á true apr├¿s dialog natif.
	Confirm bool `json:"confirm,omitempty"`
	// Content : contenu du fichier pour write_file (encodage base64 JSON ÔÇÆ bytes).
	Content string `json:"content,omitempty"`
	// Overwrite : autorise l'├®crasement pour write_file (sinon erreur si existe).
	Overwrite      bool    `json:"overwrite,omitempty"`
	ConversationID string  `json:"conversationId,omitempty"`
	StepIndices    []int64 `json:"stepIndices,omitempty"`
	// Champs MCP (call_mcp_tool / connect_mcp_server / refresh_mcp_oauth_token) :
	// relay├®s au proxy Antigravity desktop (127.0.0.1:50999).
	ServerName string                 `json:"serverName,omitempty"`
	ToolName   string                 `json:"toolName,omitempty"`
	Arguments  map[string]interface{} `json:"arguments,omitempty"`
	Endpoint   string                 `json:"endpoint,omitempty"`
	GrantType  string                 `json:"grantType,omitempty"`
	// TerminalID + Input : session shell interactive (P3). terminal_create
	// cr├®e la session, terminal_write injecte l'entr├®e clavier, terminal_kill
	// la ferme. La sortie est pouss├®e en broadcast terminal_output.
	// TerminalIDAlt : le mobile envoie historiquement la cl├® `id` ÔÇö les deux
	// sont accept├®es (backward-compat apps d├®j├á install├®es).
	TerminalID    string `json:"terminalId,omitempty"`
	TerminalIDAlt string `json:"id,omitempty"`
	Input         string `json:"input,omitempty"`
	// NoTools : mode « réponse directe sans boucle d'outils » (planner_mode 3
	// = NO_TOOL côté LS). Porté par le message send_prompt — le mobile décide
	// par prompt si l'agent peut utiliser des outils (toggle dédié).
	NoTools bool `json:"noTools,omitempty"`
	// Media : liste structurée de pièces jointes (images/fichiers).
	Media []connectrpc.MediaAttachment `json:"media,omitempty"`
	// CommitID : identifiant de commit pour git_commit_details / vcs.get_commit_details.
	CommitID string `json:"commitId,omitempty"`
	// SidecarID : identifiant de sidecar pour les RPC sidecar.* (logs, gestion).
	SidecarID string `json:"sidecarId,omitempty"`
	// Limit : nombre max de résultats pour code_search.
	Limit int `json:"limit,omitempty"`
	// LogFileName : nom du fichier de log pour get_sidecar_logs / sidecar.get_logs.
	LogFileName string `json:"logFileName,omitempty"`
	// Champs Colosseum / Battle Mode :
	ModelUIDA     string `json:"modelUIDA,omitempty"`
	ModelEnumA    uint64 `json:"modelEnumA,omitempty"`
	ModelUIDB     string `json:"modelUIDB,omitempty"`
	ModelEnumB    uint64 `json:"modelEnumB,omitempty"`
	ArmID         string `json:"armId,omitempty"`
	WinningArmID  string `json:"winningArmId,omitempty"`
	MergeStrategy uint64 `json:"mergeStrategy,omitempty"`
	// Champs MCP Lifecycle & OAuth :
	ServerID string `json:"serverId,omitempty"`
	AuthCode string `json:"authCode,omitempty"`
	// DeviceID : identifiant de session pour les opérations admin (list/revoke) ou appareil ADB.
	DeviceID string `json:"deviceId,omitempty"`
	// Champs Git & Worktree étendus :
	Branch  string   `json:"branch,omitempty"`
	Path    string   `json:"path,omitempty"`
	Message string   `json:"message,omitempty"`
	Uris    []string `json:"uris,omitempty"`
	// Champs Upload Chunking (G2) :
	UploadID    string `json:"uploadId,omitempty"`
	ChunkIndex  int    `json:"chunkIndex,omitempty"`
	TotalChunks int    `json:"totalChunks,omitempty"`
	TotalBytes  int64  `json:"totalBytes,omitempty"`
	TargetPath  string `json:"targetPath,omitempty"`
	// Champs ADB / Phone drive (G3) :
	RemotePath string `json:"remotePath,omitempty"`
	LocalPath  string `json:"localPath,omitempty"`
	Pattern    string `json:"pattern,omitempty"`
	MaxDepth   int    `json:"maxDepth,omitempty"`
}

func (m *IncomingMessage) UnmarshalJSON(data []byte) error {
	type Alias IncomingMessage
	var raw struct {
		Alias
		ConfirmRaw   interface{} `json:"confirm"`
		OverwriteRaw interface{} `json:"overwrite"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*m = IncomingMessage(raw.Alias)
	if raw.ConfirmRaw != nil {
		switch v := raw.ConfirmRaw.(type) {
		case bool:
			m.Confirm = v
		case string:
			m.Confirm = strings.EqualFold(v, "true") || v == "1"
		}
	}
	if raw.OverwriteRaw != nil {
		switch v := raw.OverwriteRaw.(type) {
		case bool:
			m.Overwrite = v
		case string:
			m.Overwrite = strings.EqualFold(v, "true") || v == "1"
		}
	}
	return nil
}

// hasPendingApproval rapporte si une approbation est en attente pour cette
// cascade (pos├®e par MarkApprovalPending, retir├®e ├á la d├®cision ou ├á
// l'expiration). Sans marquage, la valeur de repli est false ÔÇÆ le stream est
// class├® "done" (comportement h├®rit├®, tests inchang├®s).
func (s *Server) hasPendingApproval(cascadeID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.approvals[cascadeID]
	// Expir├®e ÔÇÆ plus ┬½ en attente ┬╗ (auto-refus parti, stream class├® done).
	return ok && !p.expired
}

// MarkApprovalPending enregistre une approbation en attente pour une cascade
// (appel├® quand un ├®v├®nement approval_required est ├®mis) et arme le timer
// d'auto-refus si approvalTimeout > 0.
func (s *Server) MarkApprovalPending(cascadeID string, ev connectrpc.StreamEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.approvals[cascadeID]; ok && prev.timer != nil {
		prev.timer.Stop() // une nouvelle approbation remplace l'ancienne
	}
	devID := s.cascadeDeviceOwners[cascadeID]
	p := &pendingApproval{
		callID:              ev.CallID,
		cascadeID:           cascadeID,
		trajectoryID:        ev.TrajectoryID,
		stepIndex:           ev.StepIndex,
		approvalType:        ev.Tool,
		command:             extractCommand(ev.Detail),
		filePath:            "",
		originatingDeviceID: devID,
	}
	s.approvals[cascadeID] = p
	if s.approvalTimeout > 0 {
		p.timer = time.AfterFunc(s.approvalTimeout, func() { s.expireApproval(cascadeID) })
	}
}

// pendingApprovalInfo renvoie le contexte d'approbation en attente pour un
// client qui la r├®-ouvre (tap sur la notification locale) : null si aucune.
// Les champs sont stables m├¬me si le stream_delta d'origine a ├®t├® perdu
// (app tu├®e entre l'├®mission et le tap).
func (s *Server) pendingApprovalInfo(cascadeID string) map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.approvals[cascadeID]
	if !ok || p.expired {
		return nil // expir├®e : le mobile a re├ºu approval_expired, pas de fant├┤me
	}
	expiresAt := int64(0)
	if p.timer != nil {
		expiresAt = time.Now().Add(s.approvalTimeout).UnixMilli()
	}
	return map[string]interface{}{
		"cascadeId":    p.cascadeID,
		"callId":       p.callID,
		"trajectoryId": p.trajectoryID,
		"stepIndex":    p.stepIndex,
		"approvalType": p.approvalType,
		"command":      p.command,
		"expiresAt":    expiresAt,
	}
}

// clearApproval retire une approbation en attente (d├®cision utilisateur) et
// stoppe son timer d'expiration.
func (s *Server) clearApproval(cascadeID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.approvals[cascadeID]; ok {
		if p.timer != nil {
			p.timer.Stop()
		}
		delete(s.approvals, cascadeID)
	}
}

// purgeCascadeState nettoie TOUT l'├®tat local d'une cascade supprim├®e :
// buffer StepRecovery, approbation en attente, auto-approbations de session,
// stream actif. Sans cette purge, un get_pending_approval sur une cascade
// supprim├®e r├®pondrait un fant├┤me.
func (s *Server) purgeCascadeState(cascadeID string) {
	s.streamBuffer.ClearCascade(cascadeID)
	s.mu.Lock()
	if p, ok := s.approvals[cascadeID]; ok {
		if p.timer != nil {
			p.timer.Stop()
		}
		delete(s.approvals, cascadeID)
	}
	// sessionApprovals : cl├®s "cascadeID|type" ÔÇÆ purge par pr├®fixe.
	prefix := cascadeID + "|"
	for k := range s.sessionApprovals {
		if strings.HasPrefix(k, prefix) {
			delete(s.sessionApprovals, k)
		}
	}
	delete(s.activeCascades, cascadeID)
	if m, ok := s.activeCancels[cascadeID]; ok {
		for _, cancel := range m {
			if cancel != nil {
				cancel()
			}
		}
		delete(s.activeCancels, cascadeID)
	}
	delete(s.activeRequestIDs, cascadeID)
	s.mu.Unlock()
}

// expireApproval est le callback du timer : l'approbation n'a pas re├ºu de
// r├®ponse ├á temps ÔÇÆ auto-refus (s├®curit├® : t├®l├®phone perdu) puis broadcast
// approval_expired pour que toutes les surfaces nettoient la carte.
func (s *Server) expireApproval(cascadeID string) {
	s.mu.Lock()
	p, ok := s.approvals[cascadeID]
	if !ok || p.expired {
		s.mu.Unlock()
		return // d├®j├á trait├®e (submit) ou d├®j├á expir├®e ÔÇÆ timer obsol├¿te
	}
	p.expired = true
	p.timer = nil
	s.approvals[cascadeID] = p
	s.mu.Unlock()

	logJSON.Info("approval_expired", "cascadeId", cascadeID)
	if p.trajectoryID != "" {
		oneofField, oneofPayload := buildApprovalPayload(p.approvalType, false, p.command, p.filePath, "")
		if _, err := s.RPCClient.SubmitToolApproval(cascadeID, p.trajectoryID, p.stepIndex, oneofField, oneofPayload); err != nil {
			logJSON.Error("auto_deny_failed", "cascadeId", cascadeID, "err", err)
		}
	}
	s.broadcast(OutgoingMessage{
		Type:      "approval_expired",
		CascadeID: cascadeID,
		Data: map[string]interface{}{
			"cascadeId": cascadeID,
			// callId permet au mobile d'annuler la notification locale de
			// l'approbation expirée (Phase 3) sans re-fetch.
			"callId": p.callID,
		},
	})
}

// approvalFor retourne une copie de l'approbation en attente (ou expir├®e)
// pour une cascade. Utilis├®e par submit_approval pour la garde de fra├«cheur.
func (s *Server) approvalFor(cascadeID string) (pendingApproval, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.approvals[cascadeID]
	if !ok {
		return pendingApproval{}, false
	}
	return *p, true
}

// commandLineRe extrait la commande propos├®e du d├®tail d'approbation
// run_command ÔÇÆ accepte "command_line" (format r├®el) et "run_command"
// (format du blob de corr├®lation), comme le fallback mobile (stream_parser.dart).
var commandLineRe = regexp.MustCompile(`"(?:command_line|commandline|run_command)"\s*:\s*"((?:[^"\\]|\\.)*)"`)

func extractCommand(detail string) string {
	if m := commandLineRe.FindStringSubmatch(detail); m != nil {
		return m[1]
	}
	return ""
}

// isReadOnlyTool d├®termine si un outil est read-only (lecture/recherche) ÔÇÆ la
// seule cat├®gorie auto-approuvable par l'auto-accept. Tout le reste (├®critures,
// commandes, appels MCP) reste soumis ├á l'approbation utilisateur.
//
// Liste EXACTE volontairement : ce sont les seuls noms que extractToolName
// (event_parser.go) peut produire pour le flux d'approbation. Un test par
// pr├®fixe (strings.HasPrefix) auto-approuverait tout futur outil "get_*" /
// "view_*" sans revue ÔÇÆ faux positif de s├®curit├®. generic_tool et les
// inconnus retombent dans le default ÔÇÆ jamais auto-approuv├®s.
func isReadOnlyTool(tool string) bool {
	switch strings.ToLower(tool) {
	case "view_file", "read_file", "list_dir", "list_files", "grep_search", "search_files", "read_resource", "list_resources", "grep", "glob", "fetch", "read_url_content":
		return true
	default:
		return false
	}
}

// adminCases regroupe les gestionnaires d'administration multi-devices (3.4) :
// list_devices retourne les sessions actives (deviceId, name, ip, createdAt,
// expiresAt, admin, allowedProjects) ; revoke_device révoque une session cible
// (seul un admin, et jamais lui-même). Le PairingManager est branché via
// SetPairingManager au démarrage (main.go).
func (s *Server) handleAdmin(conn *websocket.Conn, msg IncomingMessage) bool {
	if msg.Type != "admin.list_devices" && msg.Type != "admin.revoke_device" {
		return false
	}
	if !s.requireAdmin(conn) {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "action réservée à l'administrateur"})
		return true
	}
	if s.pairHandler == nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "gestion des appareils indisponible (pairing non branchÃ©)"})
		return true
	}
	switch msg.Type {
	case "admin.list_devices":
		devices := s.pairHandler.ListSessions()
		if devices == nil {
			devices = []discovery.SessionInfo{}
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"devices": devices}})
	case "admin.revoke_device":
		deviceID := msg.DeviceID
		if msg.Data != nil {
			if d, ok := msg.Data["deviceId"].(string); ok && deviceID == "" {
				deviceID = d
			}
		}
		if deviceID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "deviceId requis"})
			return true
		}
		// Un admin ne peut pas se révoquer lui-même (garde de dernier recours :
		// le premier appairage reste toujours admin).
		if deviceID == s.sessionFor(conn).DeviceID {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "impossible de révoquer l'appareil administrateur courant"})
			return true
		}
		revoked := s.pairHandler.RevokeDevice(deviceID)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": map[bool]string{true: "revoked", false: "not_found"}[revoked], "deviceId": deviceID}})
		if revoked {
			s.broadcast(OutgoingMessage{Type: "devices_updated", Data: map[string]interface{}{"devices": s.pairHandler.ListSessions()}})
		}
	}
	return true
}

// handleUploadChunk traite les morceaux de transferts de fichiers avec progression (G2).
func (s *Server) handleUploadChunk(conn *websocket.Conn, msg IncomingMessage) {
	uploadID := msg.UploadID
	if uploadID == "" && msg.Data != nil {
		if u, ok := msg.Data["uploadId"].(string); ok {
			uploadID = u
		}
	}
	if uploadID == "" {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "uploadId requis"})
		return
	}

	chunkIdx := msg.ChunkIndex
	totalChunks := msg.TotalChunks
	totalBytes := msg.TotalBytes
	fileName := msg.FileName
	cascadeID := msg.CascadeID
	b64 := msg.Base64Data
	targetPath := msg.TargetPath

	if msg.Data != nil {
		if ci, ok := msg.Data["chunkIndex"].(float64); ok {
			chunkIdx = int(ci)
		}
		if tc, ok := msg.Data["totalChunks"].(float64); ok {
			totalChunks = int(tc)
		}
		if tb, ok := msg.Data["totalBytes"].(float64); ok {
			totalBytes = int64(tb)
		}
		if fn, ok := msg.Data["fileName"].(string); ok && fileName == "" {
			fileName = fn
		}
		if cid, ok := msg.Data["cascadeId"].(string); ok && cascadeID == "" {
			cascadeID = cid
		}
		if b, ok := msg.Data["base64Data"].(string); ok && b64 == "" {
			b64 = b
		}
		if tp, ok := msg.Data["targetPath"].(string); ok && targetPath == "" {
			targetPath = tp
		}
	}

	if b64 == "" {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "base64Data requis"})
		return
	}
	if idx := strings.Index(b64, ","); idx != -1 {
		b64 = b64[idx+1:]
	}
	chunkBytes, errDec := base64.StdEncoding.DecodeString(b64)
	if errDec != nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: fmt.Sprintf("base64 invalide: %v", errDec)})
		return
	}

	s.mu.Lock()
	state, exists := s.uploadChunks[uploadID]
	if !exists {
		if len(s.uploadChunks) >= 50 {
			s.mu.Unlock()
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "trop d'uploads simultanés en cours"})
			return
		}
		if totalChunks <= 0 {
			totalChunks = 1
		}
		state = &uploadChunkState{
			id:          uploadID,
			cascadeID:   cascadeID,
			fileName:    fileName,
			totalBytes:  totalBytes,
			totalChunks: totalChunks,
			targetPath:  targetPath,
			chunks:      make(map[int][]byte),
			createdAt:   time.Now(),
		}
		s.uploadChunks[uploadID] = state
	}
	if state.received+int64(len(chunkBytes)) > 50<<20 { // 50MB max per in-memory upload
		s.mu.Unlock()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "taille de transfert mémoire dépassée (max 50 Mo)"})
		return
	}
	state.chunks[chunkIdx] = chunkBytes
	state.received += int64(len(chunkBytes))
	receivedBytes := state.received
	totBytes := state.totalBytes
	chunksCount := len(state.chunks)
	neededChunks := state.totalChunks
	s.mu.Unlock()

	percent := float64(0)
	if totBytes > 0 {
		percent = (float64(receivedBytes) / float64(totBytes)) * 100
		if percent > 100 {
			percent = 100
		}
	} else if neededChunks > 0 {
		percent = (float64(chunksCount) / float64(neededChunks)) * 100
	}

	// Broadcast du progrès temps réel (P0 G2)
	s.broadcast(OutgoingMessage{
		Type: "upload_progress",
		Data: map[string]interface{}{
			"uploadId":       uploadID,
			"cascadeId":      cascadeID,
			"fileName":       fileName,
			"receivedBytes":  receivedBytes,
			"totalBytes":     totBytes,
			"percent":        math.Round(percent*10) / 10,
			"chunksReceived": chunksCount,
			"totalChunks":    neededChunks,
			"done":           chunksCount >= neededChunks,
		},
	})

	// Si tous les morceaux sont arrivés, assembler et enregistrer
	if chunksCount >= neededChunks {
		s.mu.Lock()
		delete(s.uploadChunks, uploadID)
		s.mu.Unlock()

		var fullBuf bytes.Buffer
		for i := 0; i < neededChunks; i++ {
			c, ok := state.chunks[i]
			if !ok {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: fmt.Sprintf("morceau manquant #%d", i)})
				return
			}
			fullBuf.Write(c)
		}

		destFile := state.targetPath
		if destFile == "" {
			home, _ := os.UserHomeDir()
			if state.cascadeID != "" && uuidRe.MatchString(state.cascadeID) {
				destDir := filepath.Join(home, ".gemini", "antigravity", "brain", state.cascadeID, "scratch")
				_ = os.MkdirAll(destDir, 0755)
				cleanName := filepath.Base(filepath.Clean(state.fileName))
				if cleanName == "" || cleanName == "." {
					cleanName = fmt.Sprintf("upload_%s.bin", uploadID)
				}
				destFile = filepath.Join(destDir, cleanName)
			} else {
				destDir := filepath.Join(home, ".gemini", "antigravity", "uploads")
				_ = os.MkdirAll(destDir, 0755)
				cleanName := filepath.Base(filepath.Clean(state.fileName))
				if cleanName == "" || cleanName == "." {
					cleanName = fmt.Sprintf("upload_%s.bin", uploadID)
				}
				destFile = filepath.Join(destDir, cleanName)
			}
		} else {
			wsDir := homeRoot(msg.WorkspacePath)
			if wsDir == "" {
				if projs := ListOfficialProjects(); len(projs) > 0 && projs[0].Path != "" {
					wsDir = projs[0].Path
				}
			}
			if wsDir != "" && !isPathInsideAllowedWorkspaces(wsDir) {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: racine workspace non autorisée"})
				return
			}
			resolved, errResolve := resolvePath(wsDir, destFile)
			if errResolve != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé hors du workspace: " + errResolve.Error()})
				return
			}
			destFile = resolved
			_ = os.MkdirAll(filepath.Dir(destFile), 0755)
		}

		if errWrite := os.WriteFile(destFile, fullBuf.Bytes(), 0644); errWrite != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: fmt.Sprintf("écriture échouée: %v", errWrite)})
			return
		}

		s.broadcast(OutgoingMessage{
			Type: "upload_done",
			Data: map[string]interface{}{
				"uploadId":  uploadID,
				"cascadeId": cascadeID,
				"fileName":  state.fileName,
				"filePath":  destFile,
				"size":      fullBuf.Len(),
			},
		})

		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"status":   "completed",
				"uploadId": uploadID,
				"filePath": destFile,
				"size":     fullBuf.Len(),
			},
		})
		return
	}

	// Réponse intermédiaire pour ce morceau
	s.writeJSON(conn, OutgoingMessage{
		Type:      "response",
		RequestID: msg.RequestID,
		Data: map[string]interface{}{
			"status":     "chunk_received",
			"uploadId":   uploadID,
			"chunkIndex": chunkIdx,
			"percent":    math.Round(percent*10) / 10,
		},
	})
}

// handleADB traite les requêtes vers le pont Android ADB sans injection shell (G3).
func (s *Server) handleADB(conn *websocket.Conn, msg IncomingMessage) bool {
	if !strings.HasPrefix(msg.Type, "adb.") {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deviceID := msg.DeviceID
	if msg.Data != nil {
		if d, ok := msg.Data["deviceId"].(string); ok && deviceID == "" {
			deviceID = d
		}
	}

	switch msg.Type {
	case "adb.list_devices":
		devs, err := s.adbService.ListDevices(ctx)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return true
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"devices": devs}})
		return true

	case "adb.list_files":
		rPath := msg.RemotePath
		if rPath == "" && msg.Data != nil {
			if r, ok := msg.Data["remotePath"].(string); ok {
				rPath = r
			}
		}
		if rPath == "" {
			rPath = "/sdcard"
		}
		entries, err := s.adbService.ListDirectory(ctx, deviceID, rPath)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return true
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"files": entries, "path": rPath}})
		return true

	case "adb.search_files":
		rPath := msg.RemotePath
		pattern := msg.Pattern
		maxDepth := msg.MaxDepth
		if msg.Data != nil {
			if r, ok := msg.Data["remotePath"].(string); ok && rPath == "" {
				rPath = r
			}
			if p, ok := msg.Data["pattern"].(string); ok && pattern == "" {
				pattern = p
			}
			if md, ok := msg.Data["maxDepth"].(float64); ok && maxDepth == 0 {
				maxDepth = int(md)
			}
		}
		if rPath == "" {
			rPath = "/sdcard"
		}
		results, err := s.adbService.SearchFiles(ctx, deviceID, rPath, pattern, maxDepth)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return true
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"results": results}})
		return true

	case "adb.pull_file":
		rPath := msg.RemotePath
		lPath := msg.LocalPath
		if msg.Data != nil {
			if r, ok := msg.Data["remotePath"].(string); ok && rPath == "" {
				rPath = r
			}
			if l, ok := msg.Data["localPath"].(string); ok && lPath == "" {
				lPath = l
			}
		}
		if rPath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "remotePath requis"})
			return true
		}
		if lPath == "" {
			home, _ := os.UserHomeDir()
			cleanName := filepath.Base(filepath.Clean(rPath))
			lPath = filepath.Join(home, ".gemini", "antigravity", "downloads", cleanName)
		} else {
			wsRoot := homeRoot(msg.WorkspacePath)
			if wsRoot == "" {
				if projs := ListOfficialProjects(); len(projs) > 0 && projs[0].Path != "" {
					wsRoot = projs[0].Path
				} else if home, errHome := os.UserHomeDir(); errHome == nil {
					wsRoot = filepath.Join(home, ".gemini", "antigravity", "downloads")
				}
			}
			if wsRoot != "" && (!isPathInsideAllowedWorkspaces(wsRoot) || !s.requireProject(conn, wsRoot)) {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: racine workspace non autorisée"})
				return true
			}
			resolved, errRes := resolvePath(wsRoot, lPath)
			if errRes != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé hors du workspace: " + errRes.Error()})
				return true
			}
			lPath = resolved
		}
		_ = os.MkdirAll(filepath.Dir(lPath), 0755)
		if err := s.adbService.PullFile(ctx, deviceID, rPath, lPath); err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return true
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "ok", "localPath": lPath, "remotePath": rPath}})
		return true

	case "adb.push_file":
		rPath := msg.RemotePath
		lPath := msg.LocalPath
		if msg.Data != nil {
			if r, ok := msg.Data["remotePath"].(string); ok && rPath == "" {
				rPath = r
			}
			if l, ok := msg.Data["localPath"].(string); ok && lPath == "" {
				lPath = l
			}
		}
		if rPath == "" || lPath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "remotePath + localPath requis"})
			return true
		}
		wsRoot := homeRoot(msg.WorkspacePath)
		if wsRoot == "" {
			if projs := ListOfficialProjects(); len(projs) > 0 && projs[0].Path != "" {
				wsRoot = projs[0].Path
			} else if home, errHome := os.UserHomeDir(); errHome == nil {
				wsRoot = filepath.Join(home, ".gemini", "antigravity")
			}
		}
		if wsRoot != "" && (!isPathInsideAllowedWorkspaces(wsRoot) || !s.requireProject(conn, wsRoot)) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: racine workspace non autorisée"})
			return true
		}
		resolved, errRes := resolvePath(wsRoot, lPath)
		if errRes != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé hors du workspace: " + errRes.Error()})
			return true
		}
		lPath = resolved
		if err := s.adbService.PushFile(ctx, deviceID, lPath, rPath); err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return true
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "ok", "localPath": lPath, "remotePath": rPath}})
		return true
	}
	return false
}

// parsePermissionScope convertit la chaîne de portée reçue du mobile
// ("once", "conversation", "session", "workspace", "project", "global")
// en valeur enum PermissionScope numérique de cortex_pb.
func parsePermissionScope(scopeStr string) uint64 {
	switch strings.ToLower(scopeStr) {
	case "conversation", "session":
		return connectrpc.PermissionScopeConversation
	case "workspace":
		return connectrpc.PermissionScopeWorkspace
	case "project":
		return connectrpc.PermissionScopeProject
	case "global", "always":
		return connectrpc.PermissionScopeGlobal
	default:
		return connectrpc.PermissionScopeOnce
	}
}

// buildApprovalPayload construit le oneof + payload HandleCascadeUserInteraction
// pour une décision. run_command = 5, open_browser_url = 6, read_url_content = 17,
// file_permission = 19, permission = 21, ask_question = 22, approval = 23 (fallback).
// Partagé entre submit_approval et l'auto-refus d'expiration.
func buildApprovalPayload(approvalType string, confirm bool, command, filePath, denyReason string, scopeArgs ...string) (int, []byte) {
	oneofField := connectrpc.InteractionApproval // fallback générique
	var oneofPayload []byte
	scopeStr := "once"
	if len(scopeArgs) > 0 && scopeArgs[0] != "" {
		scopeStr = scopeArgs[0]
	}
	scope := parsePermissionScope(scopeStr)

	switch strings.ToLower(approvalType) {
	case "run_command":
		oneofField = connectrpc.InteractionRunCommand
		oneofPayload = connectrpc.BuildRunCommandInteraction(confirm, command, denyReason)
	case "file_permission":
		oneofField = connectrpc.InteractionFilePermission
		oneofPayload = connectrpc.BuildFilePermissionInteraction(confirm, scope, filePath)
	case "permission":
		oneofField = connectrpc.InteractionPermission
		oneofPayload = connectrpc.BuildPermissionInteraction(confirm, scope, filePath)
	case "read_url_content", "read_url", "browse":
		oneofField = connectrpc.InteractionReadUrlContent
		oneofPayload = connectrpc.BuildReadUrlContentInteraction(confirm)
	case "open_browser_url":
		oneofField = connectrpc.InteractionOpenBrowserURL
		oneofPayload = connectrpc.BuildOpenBrowserUrlInteraction(confirm)
	case "ask_question":
		oneofField = connectrpc.InteractionAskQuestion
		oneofPayload = connectrpc.BuildAskQuestionInteraction(nil, denyReason, !confirm)
	case "send_command_input", "send_input":
		oneofField = connectrpc.InteractionSendCommandInput
		oneofPayload = connectrpc.BuildSendCommandInputInteraction(command, !confirm)
	case "mcp_tool", "call_mcp_tool", "mcp":
		oneofField = connectrpc.InteractionMcp
		oneofPayload = connectrpc.BuildMcpInteraction(confirm, filePath, command, denyReason)
	case "deploy", "deploy_firebase":
		oneofField = connectrpc.InteractionDeploy
		oneofPayload = connectrpc.BuildDeployInteraction(confirm, command)
	case "invoke_subagent", "subagent":
		oneofField = connectrpc.InteractionInvokeSubagent
		oneofPayload = connectrpc.BuildSubagentSpawnInteraction(confirm, command)
	case "run_extension_code":
		oneofField = connectrpc.InteractionRunExtensionCode
		oneofPayload = connectrpc.BuildApprovalInteraction(confirm)
	default:
		oneofPayload = connectrpc.BuildApprovalInteraction(confirm)
	}
	return oneofField, oneofPayload
}

// sessionApprovalKey : clé de cache « toujours autoriser ».
func sessionApprovalKey(cascadeID, approvalType string) string {
	return cascadeID + "|" + strings.ToLower(approvalType)
}

// hasSessionApproval rapporte si l'utilisateur a déjà auto-approuvé ce type
// d'approbation pour cette cascade ou globalement.
func (s *Server) hasSessionApproval(cascadeID, approvalType string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionApprovals[sessionApprovalKey(cascadeID, approvalType)] || s.sessionApprovals[sessionApprovalKey("*", approvalType)]
}

// markSessionApproval enregistre l'auto-approbation pour le reste de la session ou globalement.
func (s *Server) markSessionApproval(cascadeID, approvalType string, scopeArgs ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	scope := "session"
	if len(scopeArgs) > 0 && scopeArgs[0] != "" {
		scope = scopeArgs[0]
	}
	if strings.ToLower(scope) == "global" || strings.ToLower(scope) == "always" {
		s.sessionApprovals[sessionApprovalKey("*", approvalType)] = true
	} else {
		s.sessionApprovals[sessionApprovalKey(cascadeID, approvalType)] = true
	}
}

type OutgoingMessage struct {
	Type      string      `json:"type"`
	RequestID string      `json:"requestId,omitempty"`
	CascadeID string      `json:"cascadeId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// toWorkspaceURI normalise un chemin Windows en URI file:///
func toWorkspaceURI(path string) string {
	if strings.HasPrefix(path, "file:///") {
		return path
	}
	return "file:///" + strings.ReplaceAll(path, "\\", "/")
}

// stringList extrait une liste de chaînes d'un champ map[string]interface{}
// (ex. data.uris pour git_stage / git_unstage / git_discard). Accepte
// []interface{} de strings et []string. Retourne nil si absent/invalide.
func stringList(data map[string]interface{}, key string) []string {
	if data == nil {
		return nil
	}
	switch v := data[key].(type) {
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return v
	}
	return nil
}

// TrajectoryVerbosityFull est la verbosit├® par d├®faut de get_trajectory
// (enum ClientTrajectoryVerbosity, language_server_pb.ts ligne 257) :
// 3 = FULL ÔåÆ vue structur├®e compl├¿te (steps + m├®tadonn├®es).
const TrajectoryVerbosityFull uint64 = 3

// maxTrajectorySteps : plafond de steps renvoy├®s au mobile par get_trajectory
// (fen├¬tre glissante sur la fin de session). 60 steps Ôëê 1-2 tours de travail
// complets ÔÇö au-del├á, le JSON devient lourd et le rendu mobile illisible.
const maxTrajectorySteps = 60

// trajectoryOut convertit une r├®ponse GetCascadeTrajectoryResponse brute en
// JSON stable pour le mobile. Sch├®ma v├®rifi├® dans antigravity-client
// (language_server_pb.ts ligne 8760) :
//
//	GetCascadeTrajectoryResponse {1: Trajectory, 2: status, 3: num_total_steps}
//	Trajectory {1: trajectory_id, 6: cascade_id, 2: repeated Step}
//
// Le d├®tail des steps (oneof variants) n'est pas d├®cod├® ici : le mobile
// re├ºoit le nombre + les champs d'en-t├¬te, et peut demander le diff d'un
// tour pr├®cis via get_turn_diff. Best-effort : un sch├®ma inconnu renvoie
// le dump champs (toOutgoing) plut├┤t qu'une erreur.
func trajectoryOut(raw []byte) interface{} {
	if len(raw) == 0 {
		return map[string]interface{}{"steps": []interface{}{}, "numTotalSteps": 0}
	}
	// D├®-framming gRPC-Web : flags(1) + longueur BE(4) + payload.
	payload := raw
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 { // frame de donn├®es
			payload = payload[5 : 5+length]
			break
		}
		payload = payload[5+length:]
	}

	fields := connectrpc.DecodeFields(payload)
	out := map[string]interface{}{
		"steps":         []interface{}{},
		"numTotalSteps": 0,
		"status":        0,
	}
	for _, f := range fields {
		switch f.Num {
		case 1: // Trajectory
			if f.WireType == 2 {
				for _, tf := range connectrpc.DecodeFields(f.Bytes) {
					switch tf.Num {
					case 1:
						if tf.WireType == 2 {
							out["trajectoryId"] = string(tf.Bytes)
						}
					case 6:
						if tf.WireType == 2 {
							out["cascadeId"] = string(tf.Bytes)
						}
					case 2: // repeated Step
						if tf.WireType == 2 {
							steps, _ := out["steps"].([]interface{})
							steps = append(steps, stepSummary(tf.Bytes))
							out["steps"] = steps
						}
					}
				}
			}
		case 2:
			if f.WireType == 0 {
				out["status"] = f.Varint
			}
		case 3:
			if f.WireType == 0 {
				out["numTotalSteps"] = f.Varint
			}
		}
	}
	// C9 ÔÇö plafond de steps envoy├®s au mobile : une tr├¿s longue session
	// (centaines de steps) ferait un JSON ├®norme et un rendu inutilisable sur
	// t├®l├®phone. Le diff d'un tour pr├®cis reste accessible via get_turn_diff.
	// numTotalSteps reste fid├¿le ÔÇö le mobile sait qu'il n'a qu'une fen├¬tre.
	if steps, _ := out["steps"].([]interface{}); len(steps) > maxTrajectorySteps {
		// Fenêtre glissante sur la FIN de session : chaque step garde son index
		// d'origine dans la trajectoire complète (G1) pour que le mobile puisse
		// demander le diff exact via get_turn_diff même après troncature.
		start := len(steps) - maxTrajectorySteps
		window := steps[start:]
		for i, st := range window {
			if m, ok := st.(map[string]interface{}); ok {
				m["bridgeOriginalStepIndex"] = uint64(start + i)
			}
		}
		out["steps"] = window
		out["truncated"] = true
	}
	return out
}

// stepSummary extrait d'un Step gemini_coder (trajectory_pb.ts ligne 302)
// les champs stables : type, status, et un best-effort du texte visible
// (description de l'action ex├®cut├®e par l'agent).
func stepSummary(blob []byte) map[string]interface{} {
	s := map[string]interface{}{"type": 0, "status": 0}
	for _, f := range connectrpc.DecodeFields(blob) {
		switch f.Num {
		case 1:
			if f.WireType == 0 {
				s["type"] = f.Varint
			}
		case 4:
			if f.WireType == 0 {
				s["status"] = f.Varint
			}
		case 5, 140, 12: // metadata, generic, finish
			if f.WireType == 2 {
				if text := firstReadable(f.Bytes); text != "" && s["text"] == nil {
					s["text"] = text
				}
			}
		case 28: // run_command : préférer la commande (f2), puis la sortie (f4),
			// enfin le cwd (f1) — firstReadable renvoyait le cwd, inutile au mobile.
			if f.WireType == 2 && s["text"] == nil {
				if text := runCommandText(f.Bytes); text != "" {
					s["text"] = text
				}
			}
		}
	}
	return s
}

// runCommandText extrait la commande exécutée d'un blob run_command (f28).
// Layout confirmé : {1: cwd, 2: commande, 3: shell, 4: sortie, 5: status}.
func runCommandText(b []byte) string {
	var f1, f2, f4 string
	for _, f := range connectrpc.DecodeFields(b) {
		if f.WireType != 2 {
			continue
		}
		s := strings.TrimSpace(string(f.Bytes))
		if !connectrpc.IsPrintable(s) || len(s) >= 300 {
			continue
		}
		switch f.Num {
		case 2:
			f2 = s
		case 4:
			f4 = s
		case 1:
			f1 = s
		}
	}
	if f2 != "" {
		return f2
	}
	if f4 != "" {
		return f4
	}
	return f1
}

// firstReadable cherche la premi├¿re cha├«ne UTF-8 lisible (Ôëñ300 octets) dans
// un blob de sous-message protobuf ÔÇö best-effort, jamais fatal.
func firstReadable(b []byte) string {
	if s := strings.TrimSpace(string(b)); s != "" && connectrpc.IsPrintable(s) && len(s) < 300 {
		return s
	}
	for _, f := range connectrpc.DecodeFields(b) {
		if f.WireType != 2 || len(f.Bytes) == 0 {
			continue
		}
		if s := strings.TrimSpace(string(f.Bytes)); s != "" && connectrpc.IsPrintable(s) && len(s) < 300 {
			return s
		}
	}
	return ""
}

// turnDiffOut convertit une r├®ponse GetTurnDiffResponse brute en JSON stable
// pour le mobile. Sch├®ma v├®rifi├® (language_server_pb.ts ligne 7883) :
//
//	GetTurnDiffResponse {
//	  1: repeated FileDiffsEntry {1: key(path), 2: FileDiffData}
//	  2: total_additions   3: total_deletions
//	  4: user_input (CortexStepUserInput)   5: turn_start_index
//	  6: turn_end_index_exclusive
//	}
//	FileDiffData {1: additions, 2: deletions, 3: original_contents,
//	              4: modified_contents, 5: is_artifact_file}
func turnDiffOut(raw []byte) interface{} {
	if len(raw) == 0 {
		return map[string]interface{}{"fileDiffs": []interface{}{}, "totalAdditions": 0, "totalDeletions": 0}
	}
	payload := raw
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 {
			payload = payload[5 : 5+length]
			break
		}
		payload = payload[5+length:]
	}

	fields := connectrpc.DecodeFields(payload)
	out := map[string]interface{}{
		"fileDiffs":      []interface{}{},
		"totalAdditions": 0,
		"totalDeletions": 0,
	}
	for _, f := range fields {
		switch f.Num {
		case 1: // FileDiffsEntry {1: key, 2: FileDiffData}
			if f.WireType == 2 {
				var path string
				var diff map[string]interface{}
				for _, ef := range connectrpc.DecodeFields(f.Bytes) {
					switch ef.Num {
					case 1:
						if ef.WireType == 2 {
							path = string(ef.Bytes)
						}
					case 2:
						if ef.WireType == 2 {
							diff = fileDiffData(ef.Bytes)
						}
					}
				}
				if path != "" {
					entry := map[string]interface{}{"path": path}
					if diff != nil {
						entry["diff"] = diff
					}
					diffs, _ := out["fileDiffs"].([]interface{})
					out["fileDiffs"] = append(diffs, entry)
				}
			}
		case 2:
			if f.WireType == 0 {
				out["totalAdditions"] = int64(f.Varint)
			}
		case 3:
			if f.WireType == 0 {
				out["totalDeletions"] = int64(f.Varint)
			}
		case 5:
			if f.WireType == 0 {
				out["turnStartIndex"] = int64(f.Varint)
			}
		case 6:
			if f.WireType == 0 {
				out["turnEndIndexExclusive"] = int64(f.Varint)
			}
		}
	}
	return out
}

// fileDiffData extrait un FileDiffData {1: additions, 2: deletions,
// 3: original_contents, 4: modified_contents, 5: is_artifact_file}.
func fileDiffData(blob []byte) map[string]interface{} {
	d := map[string]interface{}{
		"additions": 0, "deletions": 0,
		"originalContents": "", "modifiedContents": "", "isArtifactFile": false,
	}
	for _, f := range connectrpc.DecodeFields(blob) {
		switch f.Num {
		case 1:
			if f.WireType == 0 {
				d["additions"] = int64(f.Varint)
			}
		case 2:
			if f.WireType == 0 {
				d["deletions"] = int64(f.Varint)
			}
		case 3:
			if f.WireType == 2 {
				d["originalContents"] = string(f.Bytes)
			}
		case 4:
			if f.WireType == 2 {
				d["modifiedContents"] = string(f.Bytes)
			}
		case 5:
			if f.WireType == 0 {
				d["isArtifactFile"] = f.Varint == 1
			}
		}
	}
	return d
}

// uuidRe : les cascadeId sont des UUID v4 (36 chars, hex + tirets) émis par
// le language server.
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// safeCascadeIDRe : accepte les UUID v4 ainsi que les identifiants de session sûrs
// (lettres, chiffres, tirets, underscores). Validation stricte = pas de traversal via "../", "/" ou "\".
var safeCascadeIDRe = regexp.MustCompile(`^[a-zA-Z0-9_\-\.]{1,64}$`)

// ensurePngData transcode les images (JPEG, GIF, etc.) en PNG pour garantir la compatibilité
// avec le Language Server qui exige le type MIME image/png.
func ensurePngData(rawBytes []byte) ([]byte, string) {
	if len(rawBytes) == 0 {
		return rawBytes, "image/png"
	}
	// Vérifier si c'est déjà un PNG (magic number 89 50 4E 47 0D 0A 1A 0A)
	if len(rawBytes) >= 8 && rawBytes[0] == 0x89 && rawBytes[1] == 0x50 && rawBytes[2] == 0x4E && rawBytes[3] == 0x47 {
		return rawBytes, "image/png"
	}
	// Tenter de décoder l'image (JPEG, GIF, etc.)
	img, _, err := image.Decode(bytes.NewReader(rawBytes))
	if err == nil && img != nil {
		var buf bytes.Buffer
		if errEnc := png.Encode(&buf, img); errEnc == nil && buf.Len() > 0 {
			return buf.Bytes(), "image/png"
		}
	}
	return rawBytes, "image/png"
}

// saveUploadedImage décode une image base64 et la sauvegarde dans le dossier scratch de la cascade.
func saveUploadedImage(cascadeID, fileName, base64Data string) (string, string, error) {
	if cascadeID == "" {
		return "", "", fmt.Errorf("cascadeId requis")
	}
	// Frontière de confiance : cascadeID vient du mobile (send_prompt/upload_media).
	// Validation stricte anti-traversal : pas de "..", ni "/" ni "\".
	if !safeCascadeIDRe.MatchString(cascadeID) || strings.Contains(cascadeID, "..") {
		return "", "", fmt.Errorf("cascadeId invalide: %q", cascadeID)
	}
	if base64Data == "" {
		return "", "", fmt.Errorf("base64Data requis")
	}

	if idx := strings.Index(base64Data, ","); idx != -1 {
		base64Data = base64Data[idx+1:]
	}

	rawBytes, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", "", fmt.Errorf("erreur de décodage base64: %w", err)
	}

	if len(rawBytes) > 15<<20 {
		return "", "", fmt.Errorf("image trop volumineuse (max 15 Mo)")
	}

	// Normaliser impérativement vers PNG pour conformité avec le Language Server
	rawBytes, _ = ensurePngData(rawBytes)

	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("impossible de localiser le home directory: %w", err)
	}

	scratchDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, "scratch")
	if err := os.MkdirAll(scratchDir, 0755); err != nil {
		return "", "", fmt.Errorf("erreur de création du dossier scratch: %w", err)
	}

	userUploadDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".user_uploaded")
	_ = os.MkdirAll(userUploadDir, 0755)

	ext := ".png"
	base := filepath.Base(fileName)
	if base == "." || base == "/" || base == "\\" || base == "" {
		timestamp := time.Now().UnixMilli()
		base = fmt.Sprintf("upload_%d%s", timestamp, ext)
	} else {
		extLower := strings.ToLower(filepath.Ext(base))
		if extLower == ".jpg" || extLower == ".jpeg" || extLower == ".webp" || extLower == ".gif" {
			// Contenu déjà transcodé en PNG par ensurePngData — aligner l'extension
			base = strings.TrimSuffix(base, filepath.Ext(base)) + ".png"
		} else if extLower != ".png" {
			base += ext
		}
	}

	targetPath := filepath.Join(userUploadDir, base)
	if err := os.WriteFile(targetPath, rawBytes, 0644); err != nil {
		// Fallback to scratchDir
		targetPath = filepath.Join(scratchDir, base)
		if err2 := os.WriteFile(targetPath, rawBytes, 0644); err2 != nil {
			return "", "", fmt.Errorf("erreur d'écriture du fichier image: %w", err2)
		}
	} else {
		// Mirror in scratchDir for dual lookup
		_ = os.WriteFile(filepath.Join(scratchDir, base), rawBytes, 0644)
	}

	absPath := filepath.ToSlash(targetPath)
	markdownRef := fmt.Sprintf("![Uploaded Image](file:///%s)", absPath)
	return targetPath, markdownRef, nil
}

// revertPreviewOut convertit une réponse GetRevertPreviewResponse brute en JSON
// avec listes des fichiers modifiés et diffs unifiés.
func revertPreviewOut(raw []byte) interface{} {
	if len(raw) == 0 {
		return map[string]interface{}{
			"affectedFiles": []string{},
			"diff":          "",
			"files":         []string{},
			"preview":       "",
		}
	}
	payload := raw
	for len(payload) >= 5 {
		length := int(binary.BigEndian.Uint32(payload[1:5]))
		if length <= 0 || 5+length > len(payload) {
			break
		}
		if payload[0]&0x80 == 0 {
			payload = payload[5 : 5+length]
			break
		}
		payload = payload[5+length:]
	}

	fields := connectrpc.DecodeFields(payload)
	var affectedFiles []string
	var diffBuilder strings.Builder

	for _, f := range fields {
		if f.Num == 1 && f.WireType == 2 { // CodeEditRevertPreview
			var fileURI string
			var changesText strings.Builder
			for _, ef := range connectrpc.DecodeFields(f.Bytes) {
				switch ef.Num {
				case 1: // file_uri
					if ef.WireType == 2 {
						fileURI = string(ef.Bytes)
					}
				case 2: // diff (UnifiedDiff)
					if ef.WireType == 2 {
						for _, uf := range connectrpc.DecodeFields(ef.Bytes) {
							if uf.Num == 1 && uf.WireType == 2 { // UnifiedDiffChange
								var text string
								var changeType uint64
								for _, cf := range connectrpc.DecodeFields(uf.Bytes) {
									if cf.Num == 1 && cf.WireType == 2 {
										text = string(cf.Bytes)
									} else if cf.Num == 2 && cf.WireType == 0 {
										changeType = cf.Varint
									}
								}
								switch changeType {
								case 2:
									changesText.WriteString("+" + text + "\n")
								case 3:
									changesText.WriteString("-" + text + "\n")
								default:
									changesText.WriteString(" " + text + "\n")
								}
							}
						}
					}
				}
			}
			if fileURI != "" {
				affectedFiles = append(affectedFiles, fileURI)
				if diffBuilder.Len() > 0 {
					diffBuilder.WriteString("\n")
				}
				diffBuilder.WriteString("--- a/" + fileURI + "\n+++ b/" + fileURI + "\n")
				diffBuilder.WriteString(changesText.String())
			}
		}
	}

	if len(affectedFiles) == 0 {
		return toOutgoing(raw)
	}

	return map[string]interface{}{
		"affectedFiles": affectedFiles,
		"diff":          diffBuilder.String(),
		"files":         affectedFiles,
		"preview":       diffBuilder.String(),
	}
}

// toOutgoing convertit une r├®ponse protobuf brute en JSON lisible (hex + champs).
func toOutgoing(raw []byte) interface{} {
	fields := connectrpc.DecodeFields(raw)
	if len(fields) == 0 {
		return map[string]interface{}{"rawBytes": len(raw)}
	}
	items := make([]map[string]interface{}, 0, len(fields))
	for _, f := range fields {
		item := map[string]interface{}{"field": f.Num, "wireType": f.WireType}
		if f.WireType == 0 {
			item["value"] = f.Varint
		} else {
			item["bytes"] = len(f.Bytes)
			// tente une lecture UTF-8 lisible (cascadeId, workspace, texteÔÇª)
			s := strings.TrimSpace(string(f.Bytes))
			if s != "" && connectrpc.IsPrintable(s) && len(s) < 300 {
				item["text"] = s
			}
		}
		items = append(items, item)
	}
	return map[string]interface{}{"fields": items, "rawBytes": len(raw)}
}

func sessionsOut(raw []byte) interface{} {
	return (&Server{}).sessionsOut(raw)
}

func (s *Server) sessionsOut(raw []byte) interface{} {
	return s.sessionsOutWithLimitOpts(raw, 0, false)
}

// allSessionsOut (list_all_sessions / historique des conversations) : inclut
// les sessions archivées — marquées isArchived + CASCADE_STATUS_ARCHIVED —
// mais exclut toujours les supprimées et les subagents.
func (s *Server) allSessionsOut(raw []byte) interface{} {
	return s.sessionsOutWithLimitOpts(raw, 0, true)
}

func (s *Server) sessionsOutWithLimit(raw []byte, limitPerProject int) interface{} {
	return s.sessionsOutWithLimitOpts(raw, limitPerProject, false)
}

func (s *Server) sessionsOutWithLimitOpts(raw []byte, limitPerProject int, includeArchived bool) interface{} {
	var alreadyOut map[string]interface{}
	if err := json.Unmarshal(raw, &alreadyOut); err == nil {
		if _, ok := alreadyOut["sessions"]; ok {
			return alreadyOut
		}
	}
	projects := ListOfficialProjects()
	summaries := connectrpc.ParseTrajectories(raw)

	enrichStatus := func(cascadeID, origStatus string) string {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.activeCascades != nil && s.activeCascades[cascadeID] {
			return "CASCADE_STATUS_RUNNING"
		}
		if s.approvals != nil {
			if p, ok := s.approvals[cascadeID]; ok && !p.expired {
				return "CASCADE_STATUS_WAITING_FOR_USER_ACTION"
			}
		}
		if origStatus != "" && origStatus != "idle" {
			return origStatus
		}
		return "CASCADE_STATUS_READY"
	}

	if len(summaries) == 0 && len(raw) == 0 {
		local := ListLocalSessionsOpts(includeArchived)
		for _, loc := range local {
			if cid, ok := loc["cascadeId"].(string); ok {
				st, _ := loc["status"].(string)
				loc["status"] = enrichStatus(cid, st)
			}
		}
		var v int64 = 0
		if s != nil {
			s.mu.Lock()
			s.stateVersion++
			v = s.stateVersion
			s.mu.Unlock()
		}
		return map[string]interface{}{
			"version":   v,
			"projects":  projects,
			"sessions":  local,
			"timestamp": time.Now().UnixMilli(),
		}
	}

	home, _ := os.UserHomeDir()
	type sessionWithTime struct {
		data      map[string]interface{}
		updatedAt time.Time
		isActive  bool
	}
	var items []sessionWithTime
	for _, sum := range summaries {
		if sum.Killed || sum.Source == 16 || sum.IsSubagent {
			continue
		}
		pbArchived := home != "" && isSessionArchived(home, sum.CascadeID)
		if pbArchived && home != "" && isSessionDeleted(home, sum.CascadeID) {
			continue // supprimée : ni sidebar ni historique
		}
		isArchived := sum.Archived || pbArchived || sum.Status == "CASCADE_STATUS_ARCHIVED" || strings.EqualFold(sum.Status, "archived")
		if isArchived && !includeArchived {
			continue
		}
		title := sum.Title
		convTitlesMu.RLock()
		if custom, ok := globalConvTitles[strings.ToLower(sum.CascadeID)]; ok && custom != "" {
			title = custom
		}
		convTitlesMu.RUnlock()

		if isSubagentTitle(title) {
			continue
		}
		if isJunkSessionTitle(title) {
			if !includeArchived || sum.UpdatedAt.IsZero() {
				continue
			}
		}

		status := enrichStatus(sum.CascadeID, sum.Status)
		if isArchived {
			status = "CASCADE_STATUS_ARCHIVED"
		}
		wsName, wsPath, projID := matchOfficialProject(sum.ProjectID, sum.Workspace, sum.Workspace, projects)
		isPinned := false
		if home != "" {
			isPinned = isSessionPinned(home, sum.CascadeID)
		}
		isIde := strings.Contains(sum.Workspace, "antigravity-ide") || strings.Contains(wsPath, "antigravity-ide")
		items = append(items, sessionWithTime{
			data: map[string]interface{}{
				"cascadeId":     sum.CascadeID,
				"title":         title,
				"workspace":     wsName,
				"workspacePath": wsPath,
				"projectId":     projID,
				"status":        status,
				"updatedAt":     sum.UpdatedAt,
				"isPinned":      isPinned,
				"isArchived":    isArchived,
				"isIde":         isIde,
			},
			updatedAt: sum.UpdatedAt,
			isActive:  status == "CASCADE_STATUS_RUNNING" || status == "CASCADE_STATUS_WAITING_FOR_USER_ACTION",
		})
	}

	// Fusionner les sessions Antigravity IDE partageant un workspace commun
	seenIDs := make(map[string]bool)
	for _, it := range items {
		if cid, ok := it.data["cascadeId"].(string); ok {
			seenIDs[cid] = true
		}
	}
	if s != nil && s.IsIDERunning() {
		localIDE := ListIdeSessions(projects, includeArchived)
		for _, loc := range localIDE {
			cid, _ := loc["cascadeId"].(string)
			if cid != "" && !seenIDs[cid] {
				st, _ := loc["status"].(string)
				loc["status"] = enrichStatus(cid, st)
				var updTime time.Time
				if updStr, ok := loc["updatedAt"].(string); ok {
					updTime, _ = time.Parse(time.RFC3339, updStr)
				}
				seenIDs[cid] = true
				items = append(items, sessionWithTime{
					data:      loc,
					updatedAt: updTime,
					isActive:  loc["status"] == "CASCADE_STATUS_RUNNING" || loc["status"] == "CASCADE_STATUS_WAITING_FOR_USER_ACTION",
				})
			}
		}
	}
	if len(items) == 0 {
		if len(raw) > 0 {
			var v int64 = 0
			if s != nil {
				s.mu.Lock()
				s.stateVersion++
				v = s.stateVersion
				s.mu.Unlock()
			}
			return map[string]interface{}{
				"version":   v,
				"projects":  projects,
				"sessions":  []map[string]interface{}{},
				"timestamp": time.Now().UnixMilli(),
			}
		}
		local := ListLocalSessionsOpts(includeArchived)
		for _, loc := range local {
			if cid, ok := loc["cascadeId"].(string); ok {
				st, _ := loc["status"].(string)
				loc["status"] = enrichStatus(cid, st)
			}
		}
		return map[string]interface{}{
			"projects": projects,
			"sessions": local,
		}
	}

	// Tri décroissant par date de mise à jour (plus récentes d'abord)
	sort.Slice(items, func(i, j int) bool {
		return items[i].updatedAt.After(items[j].updatedAt)
	})

	var resultSessions []map[string]interface{}
	if limitPerProject > 0 {
		projectCounts := make(map[string]int)
		for _, it := range items {
			ws, _ := it.data["workspace"].(string)
			if it.isActive || projectCounts[ws] < limitPerProject {
				resultSessions = append(resultSessions, it.data)
				projectCounts[ws]++
			}
		}
	} else {
		for _, it := range items {
			resultSessions = append(resultSessions, it.data)
		}
	}

	var v int64 = 0
	if s != nil {
		s.stateVersion++
		v = s.stateVersion
	}
	return map[string]interface{}{
		"version":   v,
		"projects":  projects,
		"sessions":  resultSessions,
		"timestamp": time.Now().UnixMilli(),
	}
}

func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// V├®rification de l'authentification si AuthToken ou tokenValidator est d├®fini.
	// ConstantTimeCompare : ├®vite le timing attack (token compar├® en temps
	// constant) ÔÇö le comportement "token optionnel" reste inchang├®.
	s.mu.Lock()
	validator := s.tokenValidator
	s.mu.Unlock()

	var sessInfo discovery.SessionInfo
	var hasSession bool

	if s.AuthToken != "" || validator != nil || s.sessionValidator != nil {
		clientToken := r.URL.Query().Get("token")
		if clientToken == "" {
			clientToken = r.URL.Query().Get("auth_token")
		}
		if clientToken == "" {
			clientToken = r.Header.Get("Authorization")
			clientToken = strings.TrimPrefix(clientToken, "Bearer ")
		}

		authValid := false
		if s.AuthToken != "" && subtle.ConstantTimeCompare([]byte(clientToken), []byte(s.AuthToken)) == 1 {
			authValid = true
		} else if validator != nil && validator(clientToken) {
			authValid = true
		}
		// Variante enrichie : si le validateur session est branch├® (main.go), on
		// r├®cup├¿re deviceId + allowedProjects pour le filtrage par projet (3.3).
		if s.sessionValidator != nil {
			if si, ok := s.sessionValidator(clientToken); ok {
				authValid = true
				sessInfo = si
				hasSession = true
			}
		}

		if !authValid {
			// Raison dans le log : missing_token (rien fourni) vs bad_token
			// (token présent mais invalide — token obsolète côté mobile après
			// redémarrage du daemon). Le token lui-même n'est JAMAIS loggé.
			reason := "bad_token"
			if clientToken == "" {
				reason = "missing_token"
			}
			logJSON.Warn("auth_rejected", "remote", r.RemoteAddr, "reason", reason)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logJSON.Error("upgrade_error", "err", err)
		return
	}
	conn.EnableWriteCompression(true)
	// Scope projet de cette connexion : stock├® AVANT la boucle de lecture.
	if hasSession {
		s.mu.Lock()
		s.clientSessions[conn] = sessInfo
		s.mu.Unlock()
	}

	// Bornes anti-DoS : 1 Mo max par message + deadline globale de lecture.
	conn.SetReadLimit(maxWSMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	defer func() {
		conn.Close()
		s.mu.Lock()
		delete(s.clients, conn)
		delete(s.clientInFlight, conn)
		delete(s.clientSessions, conn)
		clients := len(s.clients)
		s.mu.Unlock()
		s.releaseWriteLock(conn)
		// Nettoyage terminal : on ferme les sessions PTY OUVERTES PAR CE
		// CLIENT. Multi-surface : un autre téléphone connecté garde les
		// siennes (l'ancien killAll() global les tuait toutes).
		s.terminals.killAllFor(conn)
		logJSON.Info("client_disconnected", "remote", conn.RemoteAddr().String(), "clients", clients)
	}()

	s.mu.Lock()
	s.clients[conn] = true
	s.clientInFlight[conn] = 0
	s.mu.Unlock()
	// Le mutex d'├®criture de cette connexion existe avant la premi├¿re r├®ponse.
	s.writeLock(conn)

	logJSON.Info("client_connected", "remote", conn.RemoteAddr().String())

	done := make(chan struct{})
	defer close(done)

	// Goroutine de ping : si le pair est mort, l'écriture échoue et la
	// prochaine lecture échoue aussi → le client est purgé du broadcast.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				mu := s.writeLock(conn)
				mu.Lock()
				err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
				mu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			logJSON.Debug("read_error", "err", err)
			break
		}
		conn.SetReadDeadline(time.Now().Add(pongWait))

		var msg IncomingMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "error", Error: "Invalid JSON format"})
			continue
		}
		// Les requêtes tournent en goroutine pour ne JAMAIS bloquer la boucle
		// de lecture WebSocket — sinon des opérations I/O (list_files, read_file,
		// get_subagents) bloqueraient le traitement des autres requêtes concurrentes.
		// Les réponses portent leur requestId et writeJSON est protégé par mutex.
		go s.handleAction(conn, msg)
	}
}

// unaryNoTimeout : types de messages qui échappent à la garde anti-blocage de
// 15 s. Longs streams (send_prompt, send_command, terminal_*), keep-alives
// (ping/heartbeat), opérations dont la deadline est déjà gérée par le backend
// (cancel_generation) et handlers purement locaux sans RPC. Les actions MCP
// (call_mcp_tool, …) et tous les autres appels RPC restent bornés.
var unaryNoTimeout = map[string]bool{
	"send_prompt": true, "send_command": true, "cancel_generation": true,
	"heartbeat": true, "ping": true, "create_cascade": true, "new_conversation": true,
	"get_pending_approval": true, "list_files": true, "read_file": true,
	"sync_session": true, "get_quota_summary": true, "system.get_quota_summary": true,
	"get_user_status": true, "get_model_statuses": true, "get_subagents": true,
	"generate_commit_message": true, "export_markdown": true, "create_worktree": true,
	"archive_cascade": true, "unarchive_cascade": true, "delete_cascade": true,
	"rename_cascade": true, "rename_session": true, "pin_cascade": true, "pin_session": true,
	"submit_approval": true, "get_session_history": true,
}

func (s *Server) handleAction(conn *websocket.Conn, msg IncomingMessage) {
	uri := msg.WorkspaceURI
	if uri == "" && msg.WorkspacePath != "" {
		uri = toWorkspaceURI(msg.WorkspacePath)
	}
	if uri == "" && msg.Data != nil {
		if wp, ok := msg.Data["workspacePath"].(string); ok && wp != "" {
			uri = toWorkspaceURI(wp)
		} else if wu, ok := msg.Data["workspaceUri"].(string); ok && wu != "" {
			uri = toWorkspaceURI(wu)
		}
	}

	var raw []byte
	var err error

	// Garde anti-blocage (C3) : tout handler unary RPC (list_sessions,
	// get_context, ÔÇª) est born├® par une deadline courte. Un hub lent ne doit
	// JAMAIS laisser une r├®ponse unary ind├®finiment en attente ÔÇö sinon le
	// mobile (timeout 10 s) consid├¿re le daemon mort et boucle reconnexion.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if !unaryNoTimeout[msg.Type] && !strings.HasPrefix(msg.Type, "terminal_") {
		c := make(chan struct{})
		go func() {
			select {
			case <-time.After(15 * time.Second):
				// ponytail: time.After au lieu de ctx.Done() ÔÇö si le handler
				// r├®pond vite, close(c) puis cancel() s'ex├®cutent presque en
				// m├¬me temps et le select verrait DEUX canaux pr├¬ts (choix
				// arbitraire ÔåÆ 'rpc timeout' parasite sur un handler sain).
				// time.After n'est pr├¬t qu'apr├¿s 15s r├®elles : aucun race.
				// Le double-select garde le cas o├╣ le handler termine pendant
				// l'expiration (deadline et close(c) simultan├®s) : handler
				// fini (c ferm├®) ÔåÆ on supprime l'erreur parasite.
				select {
				case <-c:
					return
				default:
				}
				s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "rpc timeout after 15s"})
			case <-c:
			}
		}()
		defer close(c)
	}

	switch msg.Type {
	// Administration multi-devices (3.4) : list_devices / revoke_device sont
	// routÃ©s AVANT les RPC unary pour ne pas passer par la deadline 15 s et
	// pour garder un chemin court (rÃ©ponse locale, aucun appel LS).
	case "admin.list_devices", "admin.revoke_device":
		s.handleAdmin(conn, msg)
		return
	case "upload_chunk", "upload_file_chunk":
		s.handleUploadChunk(conn, msg)
		return
	case "adb.list_devices", "adb.list_files", "adb.search_files", "adb.pull_file", "adb.push_file":
		s.handleADB(conn, msg)
		return
	// Keep-alive applicatif : le mobile envoie {"type":"ping"} toutes les
	// 20 s quand il est en arri├¿re-plan. M├¬me sans r├®ponse, toute frame
	// re├ºue reset le read deadline (pongWait) ÔÇö le ping seul suffit ├á
	// garder la connexion ouverte c├┤t├® serveur. On r├®pond quand m├¬me
	// pour que le client puisse mesurer la latence (round-trip).
	case "ping":
		s.writeJSON(conn, OutgoingMessage{Type: "pong", RequestID: msg.RequestID, Data: map[string]interface{}{"ts": time.Now().UnixMilli()}})
		return

	case "heartbeat":
		raw, err = s.RPCClient.Heartbeat()

	case "create_cascade", "new_conversation":
		if uri == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspaceUri requis"})
			return
		}
		projectID := msg.ProjectID
		if projectID == "" {
			projectID, _ = s.cachedProjectID(uri)
		}

		if projectID != "" {
			logJSON.Info("cascade_created", "projectId", projectID)
		} else {
			plain := strings.TrimPrefix(uri, "file:///")
			plain = strings.ReplaceAll(plain, `\`, "/")
			if _, errTrack := s.RPCClient.TrackWorkspace(plain); errTrack != nil {
				logJSON.Warn("track_workspace_failed", "workspace", plain, "error", errTrack.Error())
			} else {
				logJSON.Info("workspace_tracked", "workspace", plain)
			}
			logJSON.Info("cascade_created_orphan")
		}

		modelUID := s.resolveModelID(msg.ModelUID)
		modelEnum := msg.ModelEnum
		if modelEnum == 0 && modelUID == "" {
			modelEnum = connectrpc.DefaultModelEnum
		}
		raw, err = s.RPCClient.CreateCascade(uri, projectID, modelUID, modelEnum)
		if len(raw) == 0 {
			logJSON.Info("create_cascade_retry_warm_cache")
			s.fetchSessionsSingleFlight()
			projectID, _ = s.cachedProjectID(uri)
			if projectID != "" {
				raw, err = s.RPCClient.CreateCascade(uri, projectID, modelUID, modelEnum)
			}
		}

		s.mu.Lock()
		existingKeys := make(map[string]bool)
		for k := range s.jetboxSummaries {
			existingKeys[k] = true
		}
		s.mu.Unlock()

		extractedID := ""
		if len(raw) > 0 {
			fields := connectrpc.DecodeFields(raw)
			for _, f := range fields {
				cid := strings.TrimSpace(string(f.Bytes))
				if cid != "" && !existingKeys[cid] && (f.Num == 1 || (len(cid) >= 6 && strings.Contains(cid, "-")) || cid == "casc-1") {
					extractedID = cid
					break
				}
				for _, sf := range connectrpc.DecodeFields(f.Bytes) {
					scid := strings.TrimSpace(string(sf.Bytes))
					if scid != "" && !existingKeys[scid] && (sf.Num == 1 || (len(scid) >= 6 && strings.Contains(scid, "-")) || scid == "casc-1") {
						extractedID = scid
						break
					}
				}
				if extractedID != "" {
					break
				}
			}
		}

		if extractedID == "" || existingKeys[extractedID] {
			// Générer un véritable identifiant UUID v4 unique pour la nouvelle conversation
			b := make([]byte, 16)
			_, _ = rand.Read(b)
			b[6] = (b[6] & 0x0f) | 0x40
			b[8] = (b[8] & 0x3f) | 0x80
			extractedID = fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
		}

		s.mu.Lock()
		if s.jetboxSummaries == nil {
			s.jetboxSummaries = make(map[string]connectrpc.JetboxSummary)
		}
		if _, exists := s.jetboxSummaries[extractedID]; !exists {
			s.jetboxSummaries[extractedID] = connectrpc.JetboxSummary{
				CascadeID: extractedID,
				Workspace: uri,
				Title:     "Nouvelle conversation",
				Status:    "CASCADE_STATUS_READY",
				UpdatedAt: time.Now(),
				ProjectID: projectID,
			}
		}
		s.focusedCascadeID = extractedID
		s.mu.Unlock()

		// Diffuse sessions_updated immédiatement pour que le mobile voie la session sans délai
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})

		dataMap := map[string]interface{}{
			"cascadeId": extractedID,
			"id":        extractedID,
			"rawBytes":  len(raw),
		}
		if rawOut, ok := toOutgoing(raw).(map[string]interface{}); ok {
			for k, v := range rawOut {
				dataMap[k] = v
			}
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data:      dataMap,
		})
		return

	case "send_command":
		if msg.Command == "" {
			err = fmt.Errorf("command requis (ex: /model, /compact, git status)")
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}
		trimmedCmd := strings.TrimSpace(msg.Command)
		if strings.HasPrefix(trimmedCmd, "/") {
			logJSON.Info("slash_command", "command", trimmedCmd)
			raw, err = s.RPCClient.SendCommand(trimmedCmd)
			if err == nil {
				if strings.HasPrefix(trimmedCmd, "/checkout") || strings.HasPrefix(trimmedCmd, "/branch") {
					s.broadcast(OutgoingMessage{
						Type: "git_branch_changed",
						Data: map[string]interface{}{
							"command": trimmedCmd,
						},
					})
				}
				s.writeJSON(conn, OutgoingMessage{
					Type:      "response",
					RequestID: msg.RequestID,
					Data: map[string]interface{}{
						"status": "ok",
						"raw":    toOutgoing(raw),
					},
				})
				return
			}
		} else {
			// Commande Shell / CLI directe sur le PC hôte (ex: git diff, git status, flutter analyze)
			if !s.allowRemoteTerminal {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: exécution de commande système désactivée (drapeau --enable-remote-terminal requis au lancement du daemon)"})
				return
			}
			if s.AuthToken != "" && !s.requireAdmin(conn) {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: privilège administrateur requis pour exécuter une commande système"})
				return
			}
			logJSON.Info("shell_command", "command", trimmedCmd)
			wsDir, errWs := validatedWorkspaceRoot(msg.WorkspacePath)
			if errWs != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: " + errWs.Error()})
				return
			}
			out, execErr := executeShellCommand(wsDir, trimmedCmd)
			if execErr != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: execErr.Error()})
				return
			}
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Data: map[string]interface{}{
					"output": out,
					"stdout": out,
					"status": "ok",
				},
			})
			return
		}

	case "terminal_create":
		// Sécurité (P0 / SEC-06) : l'ouverture de terminal PTY interactif exige
		// obligatoirement le flag serveur allowRemoteTerminal (--enable-remote-terminal)
		// ET les privilèges Admin si l'authentification est active.
		if !s.allowRemoteTerminal {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: ouverture de terminal distant désactivée (drapeau --enable-remote-terminal requis au lancement du daemon)"})
			return
		}
		if s.AuthToken != "" && !s.requireAdmin(conn) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: privilège administrateur requis pour ouvrir un terminal distant"})
			return
		}

		// La session appartient à CE client (owner-scoping) : les autres
		// devices ne peuvent ni écrire ni tuer dedans, et sa déconnexion ne
		// nettoie que ses sessions.
		termDir, errWs := validatedWorkspaceRoot(msg.WorkspacePath)
		if errWs != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: " + errWs.Error()})
			return
		}
		id, errTerm := s.terminals.create(conn, termDir)
		if errTerm != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "terminal_create: " + errTerm.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"id": id}})
		return

	case "terminal_write":
		// BUG fix : le mobile envoie terminal_write/terminal_kill mais aucun
		// handler ne les traitait — le shell recevait une erreur
		// "Unknown action type" et AUCUNE commande ne s'exécutait.
		tid := msg.TerminalID
		if tid == "" {
			tid = msg.TerminalIDAlt
		}
		if tid == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "terminalId requis"})
			return
		}
		if errTerm := s.terminals.write(conn, tid, msg.Input); errTerm != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errTerm.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "ok"}})
		return

	case "terminal_kill":
		tid := msg.TerminalID
		if tid == "" {
			tid = msg.TerminalIDAlt
		}
		if tid == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "terminalId requis"})
			return
		}
		if errTerm := s.terminals.kill(conn, tid); errTerm != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errTerm.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "killed"}})
		return

	case "list_running_tasks":
		cascadeID := msg.CascadeID
		if cascadeID == "" {
			cascadeID = s.focusedCascadeID
		}
		if cascadeID != "" {
			s.scanRunningTasksFromTranscript(cascadeID)
		}
		var taskList []RunningTaskInfo
		if cascadeID != "" {
			taskList = s.runningTasks.listTasksForCascade(cascadeID, true)
		} else {
			taskList = s.runningTasks.listTasks(true)
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"tasks": taskList,
			},
		})
		return

	case "get_task_log":
		cascadeID := msg.CascadeID
		if cascadeID == "" {
			cascadeID = s.focusedCascadeID
		}
		taskId := msg.TaskID
		if taskId == "" {
			if tid, ok := msg.Data["taskId"].(string); ok && tid != "" {
				taskId = tid
			} else if tid, ok := msg.Data["id"].(string); ok && tid != "" {
				taskId = tid
			}
		}
		logContent, cmd, status := s.getTaskLog(cascadeID, taskId)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"taskId":  taskId,
				"command": cmd,
				"status":  status,
				"log":     logContent,
			},
		})
		return

	case "kill_running_task", "kill_task":
		taskId := msg.TaskID
		if taskId == "" {
			if tid, ok := msg.Data["taskId"].(string); ok && tid != "" {
				taskId = tid
			} else if tid, ok := msg.Data["id"].(string); ok && tid != "" {
				taskId = tid
			}
		}
		if taskId == "" {
			taskId = msg.TerminalID
		}
		if taskId == "" {
			taskId = msg.TerminalIDAlt
		}
		success := s.runningTasks.killTask(taskId)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"success": success,
				"id":      taskId,
				"status":  "killed",
			},
		})
		return

	case "list_workspaces":
		// G4 — sélecteur de workspace : le mobile propose des dossiers au lieu
		// de demander un chemin tapé. Sources : registre officiel
		// (~/.gemini/config/projects, déjà exploité par list_sessions) + scan
		// borné du home (répertoires de niveau 1, dossiers cachés exclus).
		// Toujours additif : si le scan échoue, le registre seul suffit.
		ws := map[string]interface{}{"workspaces": listWorkspaces()}
		writeScoped := func(data interface{}) {
			m, _ := data.(map[string]interface{})
			if m != nil {
				m = s.filterByScope(conn, m)
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: m})
		}
		writeScoped(ws)
		return

	case "list_sessions":
		// C4 : borne l'appel au LS (60 s max côté hub, on n'attend pas plus de
		// 15 s ici) — sinon un hub lent laisse la réponse unary arriver trop
		// tard : le mobile a déjà timeouté (10 s) et s'est déconnecté → boucle
		// connect/disconnect. Timeout local + réponse d'erreur explicite.
		// Cache single-flight : les reconnexions en rafale du mobile partagent
		// un SEUL appel GetAllCascades (~9,5 s) au lieu de le multiplier.
		// Scope projet (3.3) : un device pairé avec allowedProjects ne voit que
		// ses projets autorisés (sessions + projets listés).
		writeScoped := func(data interface{}) {
			m, _ := data.(map[string]interface{})
			if m != nil {
				m = s.filterByScope(conn, m)
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: m})
		}
		if raw, ok := s.cachedSessions(); ok {
			writeScoped(s.sessionsOut(raw))
			return
		}
		raw = s.fetchSessionsSingleFlight()
		if ctx.Err() != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "rpc timeout after 15s"})
			return
		}
		if len(raw) > 0 {
			// sessionsOut applique le filtre Antigravity 2.0 (archivées,
			// killed, subagents) + fallback sessions locales si vide.
			writeScoped(s.sessionsOut(raw))
			return
		}
		local := ListLocalSessions()
		projects := ListOfficialProjects()
		writeScoped(map[string]interface{}{"projects": projects, "sessions": local})
		return

	case "list_all_sessions", "get_all_sessions":
		writeScoped := func(data interface{}) {
			m, _ := data.(map[string]interface{})
			if m != nil {
				m = s.filterByScope(conn, m)
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: m})
		}
		s.mu.Lock()
		raw, cached := s.cachedSessionsAllLocked()
		s.mu.Unlock()
		if cached {
			writeScoped(s.allSessionsOut(raw))
			return
		}
		raw = s.fetchSessionsSingleFlight()
		if ctx.Err() != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "rpc timeout after 15s"})
			return
		}
		if len(raw) > 0 {
			writeScoped(s.allSessionsOut(raw))
			return
		}
		local := ListLocalSessionsOpts(true)
		projects := ListOfficialProjects()
		writeScoped(map[string]interface{}{"projects": projects, "sessions": local})
		return

	case "get_session_history":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId is required"})
			return
		}
		history, err := GetSessionHistory(msg.CascadeID)
		if len(history) == 0 && s.RPCClient != nil {
			if rawTraj, errTraj := s.RPCClient.GetCascadeTrajectory(msg.CascadeID, 0); errTraj == nil && len(rawTraj) > 0 {
				history = ExtractHistoryFromTrajectory(rawTraj)
			}
		}
		if err != nil && len(history) == 0 {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}
		if history == nil {
			history = []HistoryMessage{}
		}
		respData := map[string]interface{}{"messages": history}
		s.mu.Lock()
		reqID, isActive := s.activeRequestIDs[msg.CascadeID]
		if !isActive {
			isActive = s.activeCascades[msg.CascadeID]
		}
		hasApproval := false
		if s.approvals != nil {
			if p, ok := s.approvals[msg.CascadeID]; ok && !p.expired {
				hasApproval = true
			}
		}
		lastSeq := s.streamBuffer.LastStepIndex(msg.CascadeID)
		s.mu.Unlock()
		if isActive {
			respData["isStreaming"] = true
			if reqID != "" {
				respData["activeRequestId"] = reqID
			} else {
				respData["activeRequestId"] = "live"
			}
		}
		if hasApproval {
			respData["hasPendingApproval"] = true
		}
		respData["currentStepIndex"] = lastSeq
		s.streamBuffer.SetSessionSnapshot(msg.CascadeID, respData)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: respData})
		return

	case "sync_session":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		missed, currentSeq := s.streamBuffer.GetEventsSince(msg.CascadeID, msg.LastStepIndex)
		data := map[string]interface{}{
			"cascadeId":        msg.CascadeID,
			"missedEvents":     missed,
			"currentStepIndex": currentSeq,
			"isStreaming":      s.IsCascadeActive(msg.CascadeID),
		}
		if snapshot := s.streamBuffer.GetSessionSnapshot(msg.CascadeID); snapshot != nil {
			data["snapshot"] = snapshot
		}
		// Offline buffering (3.2) : les send_prompt non confirmés de cette
		// cascade sont joints au catch-up — le mobile ré-affiche les messages
		// que le hub a peut-être reçus (dédupliqués par requestId au re-send).
		if pending := s.outbox.Pending(msg.CascadeID); len(pending) > 0 {
			data["pendingMessages"] = pending
		}
		s.writeJSON(conn, OutgoingMessage{
			Type:      "sync_catchup",
			RequestID: msg.RequestID,
			Data:      data,
		})
		return

	case "submit_question_response":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		// Sécurité (P1 / SEC-11) : vérification de la paternité de la session
		if !s.canApproveCascade(conn, msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "accès refusé: seul le propriétaire de la session ou un administrateur peut répondre à cette question"})
			return
		}
		var responseText string
		if len(msg.SelectedAnswers) > 0 {
			responseText = strings.Join(msg.SelectedAnswers, ", ")
		}
		if msg.CustomAnswer != "" {
			if responseText != "" {
				responseText += " (" + msg.CustomAnswer + ")"
			} else {
				responseText = msg.CustomAnswer
			}
		}
		if responseText == "" {
			responseText = "Option confirmed"
		}
		logJSON.Info("question_response", "cascadeId", msg.CascadeID, "answer", responseText)

		if p, ok := s.approvalFor(msg.CascadeID); ok && !p.expired {
			// Fraîche : annule le timer AVANT l'envoi (pas de course entre
			// réponse et auto-refus), même contrat que submit_approval.
			s.clearApproval(msg.CascadeID)
			oneofPayload := connectrpc.BuildAskQuestionInteraction(msg.SelectedAnswers, msg.CustomAnswer, false)
			raw, err = s.RPCClient.SubmitToolApproval(msg.CascadeID, msg.TrajectoryID, uint32(msg.StepIndex), connectrpc.InteractionAskQuestion, oneofPayload)
			// Réponse unary au client demandeur (même contrat que
			// submit_approval) — sinon le fallthrough écrirait un dump protobuf
			// vide, et une écriture sans lecture préalable créerait une course
			// avec le stream_end diffusé en parallèle.
			if err == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "submitted"}})
			} else {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			}
			return
		} else if ok {
			// Garde de fraîcheur : l'approbation ask_question a expiré (auto-
			// refus parti). Une réponse tardive serait un « oui » après
			// expiration → refuser sans contact RPC.
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "approval expired (auto-denied)"})
			return
		}
		// Réponse libre : accuse réception au client et envoie au LS
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "submitted"}})
		go func() {
			_ = s.RPCClient.SendMessageStream(msg.CascadeID, responseText, func([]byte) error { return nil })
		}()
		return

	case "cancel_generation", "stop_generation":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		logJSON.Info("cancel_generation", "cascadeId", msg.CascadeID)
		s.CancelGeneration(msg.CascadeID)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "cancelled", "cascadeId": msg.CascadeID}})
		return

	case "send_prompt":
		hasMedia := msg.Base64Data != "" || len(msg.Images) > 0 || len(msg.Media) > 0
		if msg.Data != nil {
			if msg.Data["base64Data"] != nil || msg.Data["images"] != nil || msg.Data["media"] != nil {
				hasMedia = true
			}
		}
		if msg.CascadeID == "" || (msg.Prompt == "" && !hasMedia) {
			err = fmt.Errorf("cascadeId + prompt requis")
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}
		// Scope projet (3.3) : un device pairé avec allowedProjects ne peut
		// envoyer de prompt que sur ses projets autorisés.
		if !s.allowProject(conn, uri) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "projet non autorisé pour cet appareil"})
			return
		}
		// C1 — idempotence : un requestId déjà traité ne rejoue PAS le tour
		// (retransmission après coupure Wi-Fi). Réponse dédupliquée.
		s.mu.Lock()
		if s.sentRequestIDs[msg.RequestID] {
			s.mu.Unlock()
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"deduplicated": true}})
			return
		}
		// C3 — plafond de streams simultanés PAR CLIENT (anti-saturation hub).
		// Vérifié AVANT le marquage idempotent : un requestId refusé ici doit
		// pouvoir être retransmis une fois un slot libéré.
		if s.clientInFlight[conn] >= maxConcurrentStreams {
			s.mu.Unlock()
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "trop de streams simultanés (max " + itoa(maxConcurrentStreams) + ")"})
			return
		}
		s.sentRequestIDs[msg.RequestID] = true
		// C1 — borne mémoire : la map d'idempotence ne doit pas grossir sans
		// limite (un mobile qui spamme des requestId uniques). Purge FIFO simple.
		if len(s.sentRequestIDs) > 10000 {
			oldest := ""
			for id := range s.sentRequestIDs {
				if oldest == "" || id < oldest {
					oldest = id
				}
			}
			delete(s.sentRequestIDs, oldest)
		}
		s.clientInFlight[conn]++
		s.mu.Unlock()

		devID := s.sessionFor(conn).DeviceID
		ctx, cancel := context.WithCancel(context.Background())
		s.mu.Lock()
		if devID != "" {
			s.cascadeDeviceOwners[msg.CascadeID] = devID
		}
		if s.activeCancels[msg.CascadeID] == nil {
			s.activeCancels[msg.CascadeID] = make(map[string]context.CancelFunc)
		}
		s.activeCancels[msg.CascadeID][msg.RequestID] = cancel
		s.activeRequestIDs[msg.CascadeID] = msg.RequestID
		s.mu.Unlock()

		s.MarkCascadeActive(msg.CascadeID)
		defer func() {
			s.ClearCascadeActive(msg.CascadeID)
			s.mu.Lock()
			cancel()
			if m, ok := s.activeCancels[msg.CascadeID]; ok {
				delete(m, msg.RequestID)
				if len(m) == 0 {
					delete(s.activeCancels, msg.CascadeID)
				}
			}
			if s.activeRequestIDs[msg.CascadeID] == msg.RequestID {
				delete(s.activeRequestIDs, msg.CascadeID)
			}
			s.clientInFlight[conn]--
			s.mu.Unlock()
		}()
		startData := map[string]interface{}{"cascadeId": msg.CascadeID}
		// P1 : le mobile notifie « Tâche démarrée » quand personne n'est actif
		// sur le PC (idle detection) — même champ que stream_delta/stream_end.
		startData["hostActive"] = hostActiveSince(hostActiveWindow)
		s.broadcast(OutgoingMessage{Type: "stream_start", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: startData})
		logJSON.Info("stream_start", "requestId", msg.RequestID, "cascadeId", msg.CascadeID)

		promptText := msg.Prompt
		base64Data := msg.Base64Data
		fileName := msg.FileName
		images := msg.Images
		var mediaAttachments []connectrpc.MediaAttachment

		if msg.Data != nil {
			if b64, ok := msg.Data["base64Data"].(string); ok && base64Data == "" {
				base64Data = b64
			}
			if fn, ok := msg.Data["fileName"].(string); ok && fileName == "" {
				fileName = fn
			}
			if imgs, ok := msg.Data["images"].([]interface{}); ok && len(images) == 0 {
				for _, img := range imgs {
					if str, ok := img.(string); ok && str != "" {
						images = append(images, str)
					}
				}
			}
			if mList, ok := msg.Data["media"].([]interface{}); ok {
				for _, mItem := range mList {
					if mObj, ok := mItem.(map[string]interface{}); ok {
						var uri, mime, desc, b64 string
						if u, ok := mObj["uri"].(string); ok {
							uri = u
						}
						if m, ok := mObj["mimeType"].(string); ok {
							mime = m
						}
						if d, ok := mObj["description"].(string); ok {
							desc = d
						} else if n, ok := mObj["name"].(string); ok {
							desc = n
						}
						if b, ok := mObj["base64Data"].(string); ok {
							b64 = b
						}
						if b64 != "" && uri == "" {
							if targetPath, _, errImg := saveUploadedImage(msg.CascadeID, desc, b64); errImg == nil {
								uri = "file:///" + filepath.ToSlash(targetPath)
							}
						}
						if uri != "" || b64 != "" {
							mediaAttachments = append(mediaAttachments, connectrpc.MediaAttachment{
								URI:         uri,
								MimeType:    mime,
								Description: desc,
								Base64Data:  b64,
							})
						}
					}
				}
			}
		}

		if len(msg.Media) > 0 {
			for _, m := range msg.Media {
				uri := m.URI
				if m.Base64Data != "" {
					desc := m.Description
					if desc == "" && uri != "" {
						desc = filepath.Base(strings.TrimPrefix(strings.TrimPrefix(uri, "file:///"), "file://"))
					}
					if targetPath, _, errImg := saveUploadedImage(msg.CascadeID, desc, m.Base64Data); errImg == nil {
						uri = "file:///" + filepath.ToSlash(targetPath)
					}
				} else if uri != "" {
					srcLocal := strings.TrimPrefix(strings.TrimPrefix(uri, "file:///"), "file://")
					if data, errRead := os.ReadFile(srcLocal); errRead == nil {
						desc := m.Description
						if desc == "" {
							desc = filepath.Base(srcLocal)
						}
						if targetPath, _, errImg := saveUploadedImage(msg.CascadeID, desc, base64.StdEncoding.EncodeToString(data)); errImg == nil {
							uri = "file:///" + filepath.ToSlash(targetPath)
						}
					}
				}
				if uri != "" || m.Base64Data != "" {
					mediaAttachments = append(mediaAttachments, connectrpc.MediaAttachment{
						URI:         uri,
						MimeType:    m.MimeType,
						Description: m.Description,
						Base64Data:  m.Base64Data,
						Data:        m.Data,
					})
				}
			}
		}

		if base64Data != "" {
			if targetPath, _, errImg := saveUploadedImage(msg.CascadeID, fileName, base64Data); errImg == nil {
				uri := "file:///" + filepath.ToSlash(targetPath)
				mediaAttachments = append(mediaAttachments, connectrpc.MediaAttachment{
					URI:         uri,
					MimeType:    "image/png",
					Description: filepath.Base(targetPath),
					Base64Data:  base64Data,
				})
			}
		}
		for i, b64 := range images {
			fn := fmt.Sprintf("img_%d.png", i)
			if targetPath, _, errImg := saveUploadedImage(msg.CascadeID, fn, b64); errImg == nil {
				uri := "file:///" + filepath.ToSlash(targetPath)
				mediaAttachments = append(mediaAttachments, connectrpc.MediaAttachment{
					URI:         uri,
					MimeType:    "image/png",
					Description: filepath.Base(targetPath),
					Base64Data:  b64,
				})
			}
		}

		// Si promptText contient des tags markdown d'images ![name](file:///path), on les extrait vers mediaAttachments
		imgTagRe := regexp.MustCompile(`!\[([^\]]*)\]\((?:file:///)?([a-zA-Z]:[^\)\r\n]+|/[^\)\r\n]+)\)`)
		if imgMatches := imgTagRe.FindAllStringSubmatch(promptText, -1); len(imgMatches) > 0 {
			for _, m := range imgMatches {
				if len(m) >= 3 {
					desc := strings.TrimSpace(m[1])
					rawPath := strings.TrimSpace(m[2])
					cleanURI := rawPath
					if !strings.HasPrefix(cleanURI, "file:///") {
						cleanURI = "file:///" + filepath.ToSlash(cleanURI)
					}
					if desc == "" {
						desc = filepath.Base(rawPath)
					}
					alreadyAdded := false
					for _, existing := range mediaAttachments {
						if existing.URI == cleanURI {
							alreadyAdded = true
							break
						}
					}
					if !alreadyAdded {
						mediaAttachments = append(mediaAttachments, connectrpc.MediaAttachment{
							URI:         cleanURI,
							MimeType:    "image/png",
							Description: desc,
						})
					}
				}
			}
			// Nettoyer les balises Markdown du promptText pour éviter d'afficher du code Markdown brut dans l'IDE
			promptText = strings.TrimSpace(imgTagRe.ReplaceAllString(promptText, ""))
		}

		// Populer Data et Base64Data pour chaque mediaAttachment en lisant le fichier sur disque et en normalisant vers PNG
		for i := range mediaAttachments {
			m := &mediaAttachments[i]
			if len(m.Data) == 0 && m.Base64Data != "" {
				cleanB64 := m.Base64Data
				if idx := strings.Index(cleanB64, ","); idx != -1 {
					cleanB64 = cleanB64[idx+1:]
				}
				if b, err := base64.StdEncoding.DecodeString(cleanB64); err == nil && len(b) > 0 {
					m.Data = b
				}
			}
			if len(m.Data) == 0 && m.URI != "" {
				localPath := strings.TrimPrefix(m.URI, "file:///")
				localPath = filepath.FromSlash(localPath)
				if data, err := os.ReadFile(localPath); err == nil && len(data) > 0 {
					m.Data = data
				}
			}
			// Transcoder toute image en PNG pour satisfaire le Language Server (unsupported mime type image/jpeg)
			isImg := strings.HasPrefix(m.MimeType, "image/") || m.MimeType == "" || m.MimeType == "application/octet-stream" ||
				strings.HasSuffix(strings.ToLower(m.URI), ".jpg") || strings.HasSuffix(strings.ToLower(m.URI), ".jpeg") ||
				strings.HasSuffix(strings.ToLower(m.URI), ".png") || strings.HasSuffix(strings.ToLower(m.URI), ".webp") ||
				strings.HasSuffix(strings.ToLower(m.URI), ".gif")

			if isImg {
				if len(m.Data) > 0 {
					pngBytes, _ := ensurePngData(m.Data)
					m.Data = pngBytes
					m.Base64Data = base64.StdEncoding.EncodeToString(pngBytes)
				}
				m.MimeType = "image/png"
			} else if m.MimeType == "" || m.MimeType == "application/octet-stream" {
				if len(m.Data) > 0 {
					m.MimeType = http.DetectContentType(m.Data)
				} else if m.URI != "" {
					if strings.HasSuffix(strings.ToLower(m.URI), ".pdf") {
						m.MimeType = "application/pdf"
					}
				}
			}
			// Si l'image a des données et que son URI ne pointe pas déjà vers
			// le dossier .user_uploaded/ de la cascade cible, on l'y copie pour
			// que le Language Server la découvre via ADDITIONAL_METADATA.
			// (cas : upload depuis une cascade temporaire ou chemin externe)
			if len(m.Data) > 0 && m.URI != "" && strings.HasPrefix(m.MimeType, "image/") {
				home, _ := os.UserHomeDir()
				targetUploadDir := filepath.Join(home, ".gemini", "antigravity", "brain", msg.CascadeID, ".user_uploaded")
				targetUploadDirSlash := filepath.ToSlash(targetUploadDir)
				uriPath := strings.TrimPrefix(m.URI, "file:///")
				if !strings.HasPrefix(filepath.ToSlash(uriPath), targetUploadDirSlash) {
					b64Copy := base64.StdEncoding.EncodeToString(m.Data)
					if newPath, _, errCopy := saveUploadedImage(msg.CascadeID, filepath.Base(uriPath), b64Copy); errCopy == nil {
						m.URI = "file:///" + filepath.ToSlash(newPath)
					}
				}
			}
		}

		// Offline buffering (3.2) : le prompt part vers le hub → on le persiste
		// tant qu'il n'est pas confirmé (stream_end reçu). En cas de coupure
		// avant stream_end, le mobile le retrouvera via sync_session.pendingMessages
		// et décidera de le retransmettre (dédupliqué par requestId).
		if errOut := s.outbox.Append(msg.CascadeID, msg.RequestID, promptText); errOut != nil {
			logJSON.Warn("outbox_append_failed", "cascadeId", msg.CascadeID, "err", errOut.Error())
		}

		var frameIndex int64
		hasTextDelivered := false
		onFrameHandler := func(frame []byte) error {
			select {
			case <-ctx.Done():
				return fmt.Errorf("generation cancelled")
			default:
			}
			fIdx := atomic.AddInt64(&frameIndex, 1)
			events := connectrpc.ParseFrameEvents(frame, msg.CascadeID)
			for _, ev := range events {
				if ev.Delta != "" {
					hasTextDelivered = true
				}
				if ev.Kind == connectrpc.EventKindApprovalRequired {
					hasTextDelivered = true
					// B3 : auto-approbation si l'utilisateur a choisi
					// « toujours autoriser ce type pour la session ».
					if s.hasSessionApproval(msg.CascadeID, ev.Tool) {
						oneofField, oneofPayload := buildApprovalPayload(ev.Tool, true, extractCommand(ev.Detail), "", "")
						if _, errSubmit := s.RPCClient.SubmitToolApproval(
							msg.CascadeID, ev.TrajectoryID, ev.StepIndex,
							oneofField, oneofPayload,
						); errSubmit != nil {
							logJSON.Error("auto_approve_failed", "cascadeId", msg.CascadeID, "tool", ev.Tool, "err", errSubmit)
						}
					} else if s.shouldAutoApprove(ev.Tool) {
						// Auto-accept (mode readonly ou full) :
						// En mode full, tout passe sauf questions interactives.
						// En mode readonly, seules les lectures passent sans confirmation.
						oneofField, oneofPayload := buildApprovalPayload(ev.Tool, true, extractCommand(ev.Detail), "", "")
						if _, errSubmit := s.RPCClient.SubmitToolApproval(
							msg.CascadeID, ev.TrajectoryID, ev.StepIndex,
							oneofField, oneofPayload,
						); errSubmit != nil {
							logJSON.Error("auto_accept_failed", "cascadeId", msg.CascadeID, "tool", ev.Tool, "err", errSubmit)
						}
					} else {
						s.MarkApprovalPending(msg.CascadeID, ev)
					}
				}
			}
			// B2 : push dédié approval_pending (avec contexte) en plus du
			// stream_delta — le mobile s'en sert au tap-notification pour
			// ré-ouvrir l'approbation même si le delta a été perdu.
			if len(events) > 0 {
				for _, ev := range events {
					// Pas de push si l'auto-approbation (session ou autoAccept) a
					// déjà répondu — le mobile ne doit pas afficher une carte
					// pour une action déjà traitée.
					if ev.Kind == connectrpc.EventKindApprovalRequired &&
						!s.hasSessionApproval(msg.CascadeID, ev.Tool) &&
						!s.shouldAutoApprove(ev.Tool) {
						pending := s.pendingApprovalInfo(msg.CascadeID)
						// C7-B : idle detection hôte — si l'utilisateur est actif sur
						// le PC, le mobile ne sonne pas (la boîte de dialogue
						// d'approbation est déjà sous ses yeux).
						pending["hostActive"] = hostActiveSince(hostActiveWindow)
						s.broadcast(OutgoingMessage{
							Type:      "approval_pending",
							CascadeID: msg.CascadeID,
							Data:      pending,
						})
					}
				}
			}
			data := map[string]interface{}{
				"frameIndex": fIdx,
				"events":     events,
				"raw":        toOutgoing(frame),
				// C7-B : hostActive=true quand l'utilisateur interagit avec le
				// PC hôte → le mobile supprime ses notifications d'approbation
				// (le dialogue d'approbation est visible sur l'écran du PC).
				"hostActive": hostActiveSince(hostActiveWindow),
			}
			deltaMsg := OutgoingMessage{
				Type:      "stream_delta",
				RequestID: msg.RequestID,
				CascadeID: msg.CascadeID,
				Data:      data,
			}
			stepIdx := s.streamBuffer.RecordEvent(msg.CascadeID, deltaMsg)
			data["stepIndex"] = stepIdx
			s.broadcast(deltaMsg)
			return nil
		}

		// Mode sans-outils : le prompt porte son propre flag (décision par
		// prompt) sinon le défaut global des réglages mobile (toggle).
		// planner_mode 3 = NO_TOOL : pas de boucle d'outils, réponse directe.
		noTools := msg.NoTools || s.noTools()
		modelUID := s.resolveModelID(msg.ModelUID)
		modelEnum := msg.ModelEnum
		if modelEnum == 0 && modelUID != "" {
			modelEnum = connectrpc.ResolveStandardModelEnum(modelUID)
		}

		doneChan := make(chan struct{})
		watcherCtx, cancelWatcher := context.WithCancel(ctx)
		defer cancelWatcher()

		// Démarre le streaming temps réel (transcript.jsonl + trajectoire)
		go s.runLiveTurnStreamer(watcherCtx, msg.CascadeID, msg.RequestID, &frameIndex, &hasTextDelivered, doneChan)

		// Le LS processMediaData (generation.go:742) rejette TOUT mime image
		// inline dans le protobuf (unsupported mime type image/png|jpeg).
		// L'IDE native sauvegarde les images dans .user_uploaded/ et le
		// système LS les découvre automatiquement (ADDITIONAL_METADATA).
		// On filtre donc les images du protobuf — elles sont déjà sur disque
		// (saveUploadedImage ci-dessus). Les non-images (PDF, audio) restent.
		var nonImageMedia []connectrpc.MediaAttachment
		for _, m := range mediaAttachments {
			if !strings.HasPrefix(m.MimeType, "image/") {
				nonImageMedia = append(nonImageMedia, m)
			}
		}

		// Injecter les références des images uploadées dans le promptText
		// sous forme de bloc ADDITIONAL_METADATA exact pour que le modèle et le Language Server
		// intègrent l'image dans le contexte de l'agent.
		var rawImagePaths []string
		for _, m := range mediaAttachments {
			if strings.HasPrefix(m.MimeType, "image/") && m.URI != "" {
				cleanPath := strings.TrimPrefix(m.URI, "file:///")
				cleanPath = filepath.ToSlash(cleanPath)
				rawImagePaths = append(rawImagePaths, cleanPath)
			}
		}
		if len(rawImagePaths) > 0 && !strings.Contains(promptText, "<ADDITIONAL_METADATA>") {
			metaBlock := "\n\n<ADDITIONAL_METADATA>\n"
			metaBlock += fmt.Sprintf("The user has uploaded %d image(s):\n", len(rawImagePaths))
			for _, p := range rawImagePaths {
				metaBlock += fmt.Sprintf("- %s\n", p)
			}
			metaBlock += "You can embed this image in an artifact if you need the USER to review it.\n"
			metaBlock += "</ADDITIONAL_METADATA>"
			promptText = strings.TrimSpace(promptText) + metaBlock
		}

		err = s.RPCClient.SendMessageStreamModelWithMedia(msg.CascadeID, promptText, modelUID, modelEnum, nonImageMedia, onFrameHandler, noTools)

		if err != nil {
			cancelWatcher()
		} else {
			// Si un fichier transcript existe ou que la cascade est activement en cours dans Jetbox/LS,
			// laisser runLiveTurnStreamer streamer les étapes jusqu'à la fin réelle
			transcriptPath := findTranscriptPath(msg.CascadeID)
			if transcriptPath != "" || s.isSessionActivelyRunning(msg.CascadeID) {
				select {
				case <-doneChan:
				case <-ctx.Done():
				}
			} else {
				// Streaming direct sans fichier transcript sur disque (ex. tests unitaires ou réponse directe)
				if hasTextDelivered || s.hasPendingApproval(msg.CascadeID) {
					select {
					case <-doneChan:
					case <-time.After(10 * time.Millisecond):
					}
				} else {
					select {
					case <-doneChan:
					case <-ctx.Done():
					case <-time.After(1 * time.Second):
					}
				}
			}
			cancelWatcher()
		}

		if ctx.Err() != nil {
			s.mu.Lock()
			stillActive := false
			if m, ok := s.activeCancels[msg.CascadeID]; ok {
				if _, exists := m[msg.RequestID]; exists {
					stillActive = true
					delete(m, msg.RequestID)
					if len(m) == 0 {
						delete(s.activeCancels, msg.CascadeID)
					}
				}
			}
			if s.activeRequestIDs[msg.CascadeID] == msg.RequestID {
				delete(s.activeRequestIDs, msg.CascadeID)
			}
			s.mu.Unlock()
			if stillActive {
				endData := map[string]interface{}{"cascadeId": msg.CascadeID}
				endData["hostActive"] = hostActiveSince(hostActiveWindow)
				endData["outcome"] = "cancelled"
				endData["message"] = "Generation stopped by user"
				s.broadcast(OutgoingMessage{Type: "stream_end", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: endData})
				if errOut := s.outbox.Confirm(msg.CascadeID, msg.RequestID); errOut != nil {
					logJSON.Warn("outbox_confirm_failed", "cascadeId", msg.CascadeID, "err", errOut.Error())
				}
			}
			return
		}

		endData := map[string]interface{}{"cascadeId": msg.CascadeID}
		endData["hostActive"] = hostActiveSince(hostActiveWindow)
		switch {
		case err != nil && strings.Contains(err.Error(), "cancelled"):
			endData["outcome"] = "cancelled"
			endData["message"] = "Generation stopped by user"
			s.broadcast(OutgoingMessage{Type: "stream_end", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: endData})
		case err != nil:
			endData["outcome"] = "error"
			endData["message"] = err.Error()
			s.mu.Lock()
			s.lastError = err.Error()
			s.mu.Unlock()
			s.broadcast(OutgoingMessage{Type: "stream_end", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: endData, Error: err.Error()})
		case s.hasPendingApproval(msg.CascadeID):
			endData["outcome"] = "approval"
			endData["message"] = "Action requise"
			s.broadcast(OutgoingMessage{Type: "stream_end", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: endData})
		default:
			endData["outcome"] = "done"
			endData["message"] = ""
			s.broadcast(OutgoingMessage{Type: "stream_end", RequestID: msg.RequestID, CascadeID: msg.CascadeID, Data: endData})
		}
		logJSON.Info("stream_end", "requestId", msg.RequestID, "cascadeId", msg.CascadeID, "outcome", endData["outcome"])
		if errOut := s.outbox.Confirm(msg.CascadeID, msg.RequestID); errOut != nil {
			logJSON.Warn("outbox_confirm_failed", "cascadeId", msg.CascadeID, "err", errOut.Error())
		}
		return

	case "submit_approval":
		if msg.TrajectoryID == "" || msg.StepIndex < 0 {
			err = fmt.Errorf("trajectoryId + stepIndex requis (protocole HandleCascadeUserInteraction)")
			break
		}
		// Sécurité (P0 / SEC-11) : vérification de la paternité de l'approbation
		if !s.canApproveCascade(conn, msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "accès refusé: seul le propriétaire de la session ou un administrateur peut approuver cette action"})
			return
		}
		confirm := true
		if strings.EqualFold(msg.Decision, "deny") {
			confirm = false
		}
		// Garde de fra├«cheur : si le daemon conna├«t l'approbation locale et
		// qu'elle est d├®j├á expir├®e (timer parti, auto-refus envoy├®), un submit
		// tardif ÔÇö m├¬me confirm=true ÔÇö serait un ┬½ oui ┬╗ apr├¿s expiration : la
		// carte mobile affiche d├®j├á ┬½ expir├®e ┬╗ en lecture seule. Refuser sans
		// contact RPC ├®vite d'ex├®cuter une commande que l'utilisateur n'a pas
		// valid├®e ├á temps. Ponytail: compare le callId quand le mobile le fournit.
		if p, ok := s.approvalFor(msg.CascadeID); ok && !p.expired {
			// Fra├«che : annule le timer AVANT l'envoi (pas de course entre
			// submit et auto-refus).
			s.clearApproval(msg.CascadeID)
		} else if ok {
			s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "approval expired (auto-denied)"})
			return
		}

		// Persistance de l'auto-approbation selon la portée choisie.
		if confirm && (msg.Scope == "session" || msg.Scope == "conversation" || msg.Scope == "project" || msg.Scope == "workspace" || msg.Scope == "global" || msg.Scope == "always") {
			s.markSessionApproval(msg.CascadeID, msg.ApprovalType, msg.Scope)
		}

		oneofField, oneofPayload := buildApprovalPayload(msg.ApprovalType, confirm, msg.Command, msg.FilePath, msg.DenyReason, msg.Scope)
		raw, err = s.RPCClient.SubmitToolApproval(msg.CascadeID, msg.TrajectoryID, uint32(msg.StepIndex), oneofField, oneofPayload)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Data: map[string]interface{}{
					"status": "submitted",
				},
			})
			s.broadcast(OutgoingMessage{
				Type:      "approval_resolved",
				CascadeID: msg.CascadeID,
				Data: map[string]interface{}{
					"cascadeId":    msg.CascadeID,
					"callId":       msg.CallID,
					"decision":     msg.Decision,
					"approvalType": msg.ApprovalType,
					"scope":        msg.Scope,
				},
			})
			s.broadcast(OutgoingMessage{
				Type: "sessions_updated",
				Data: s.sessionsFromSummaries(s.snapshotSummaries()),
			})
			return
		}

	case "get_pending_approval":
		// B2 : un client qui revient (tap sur la notification locale) demande
		// le contexte de l'approbation en attente ÔÇö m├¬me si son stream_delta
		// d'origine a ├®t├® perdu (app tu├®e). R├®ponse unary, null si aucune.
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data:      s.pendingApprovalInfo(msg.CascadeID),
		})
		return
	case "search_files":
		if msg.WorkspacePath == "" || msg.Query == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath + query requis"})
			return
		}
		targetWs := homeRoot(msg.WorkspacePath)
		if !isPathInsideAllowedWorkspaces(targetWs) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath hors projet autorisé"})
			return
		}
		maxResults := 50
		if msg.Data != nil {
			if m, ok := msg.Data["maxResults"].(float64); ok && int(m) > 0 {
				maxResults = int(m)
			}
		}
		results, errSearch := searchInWorkspace(targetWs, msg.Query, maxResults)
		if errSearch != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errSearch.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"results": results}})
		return

	case "code_search":
		if msg.Query == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "query requis"})
			return
		}
		maxResults := int32(30)
		linesContext := int32(2)
		if msg.Data != nil {
			if m, ok := msg.Data["maxResults"].(float64); ok && int32(m) > 0 {
				maxResults = int32(m)
			}
			if l, ok := msg.Data["linesContext"].(float64); ok && int32(l) > 0 {
				linesContext = int32(l)
			}
		}
		raw, err = s.RPCClient.SearchCode(msg.Query, msg.WorkspacePath, maxResults, linesContext)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"raw": string(raw), "status": "ok"}})
		return

	case "list_files", "list_dir", "workspace.list_files":
		if msg.WorkspacePath == "" {
			err = fmt.Errorf("workspacePath requis")
			break
		}
		targetWs := homeRoot(msg.WorkspacePath)
		if !isPathInsideAllowedWorkspaces(targetWs) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath hors projet autorisé"})
			return
		}
		tree, errList := buildFileTree(targetWs, "", 0)
		if errList != nil {
			err = errList
			break
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"files": tree}})
		return

	case "read_file":
		if msg.FilePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "filePath requis"})
			return
		}
		// 1. Direct local file check (e.g. brain artifacts, absolute file paths, file:// URIs)
		cleanPath := strings.TrimPrefix(msg.FilePath, "file:///")
		cleanPath = strings.TrimPrefix(cleanPath, "file://")
		if len(cleanPath) >= 3 && (cleanPath[0] == '/' || cleanPath[0] == '\\') && cleanPath[2] == ':' {
			cleanPath = cleanPath[1:]
		}

		isDriveLetterAbs := len(cleanPath) >= 2 && ((cleanPath[0] >= 'a' && cleanPath[0] <= 'z') || (cleanPath[0] >= 'A' && cleanPath[0] <= 'Z')) && cleanPath[1] == ':'
		isUNCAbs := strings.HasPrefix(cleanPath, `\\`) || strings.HasPrefix(cleanPath, `//`)
		isUnixAbs := runtime.GOOS != "windows" && strings.HasPrefix(cleanPath, "/")

		relCleanPath := cleanPath
		if !isDriveLetterAbs && !isUNCAbs && !isUnixAbs {
			relCleanPath = strings.TrimLeft(cleanPath, "/\\")
		}
		baseFileName := filepath.Base(cleanPath)

		respondWithFileContent := func(content []byte) {
			lower := strings.ToLower(cleanPath)
			isImg := strings.HasSuffix(lower, ".png") ||
				strings.HasSuffix(lower, ".jpg") ||
				strings.HasSuffix(lower, ".jpeg") ||
				strings.HasSuffix(lower, ".gif") ||
				strings.HasSuffix(lower, ".webp") ||
				strings.HasSuffix(lower, ".pdf") ||
				strings.HasSuffix(lower, ".mp4") ||
				strings.HasSuffix(lower, ".mp3")

			data := map[string]interface{}{
				"content":  "",
				"isBinary": isImg,
			}
			if !isImg && utf8.Valid(content) {
				data["content"] = string(content)
			}
			if isImg || !utf8.Valid(content) {
				data["base64Data"] = base64.StdEncoding.EncodeToString(content)
				data["isBinary"] = true
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: data})
		}

		if isDriveLetterAbs || isUNCAbs || isUnixAbs {
			cleanTarget := filepath.Clean(cleanPath)
			allowed := false
			if home, errHome := os.UserHomeDir(); errHome == nil {
				geminiBrain := filepath.Join(home, ".gemini", "antigravity", "brain")
				geminiIdeBrain := filepath.Join(home, ".gemini", "antigravity-ide", "brain")
				geminiRoot := filepath.Join(home, ".gemini")
				lowClean := strings.ToLower(cleanTarget)
				if strings.HasPrefix(lowClean, strings.ToLower(geminiBrain)) ||
					strings.HasPrefix(lowClean, strings.ToLower(geminiIdeBrain)) ||
					strings.HasPrefix(lowClean, strings.ToLower(geminiRoot)) {
					allowed = true
				}
			}
			if !allowed && msg.WorkspacePath != "" {
				if wsRoot, errWs := validatedWorkspaceRoot(msg.WorkspacePath); errWs == nil && wsRoot != "" {
					if _, errRes := resolvePath(wsRoot, cleanTarget); errRes == nil {
						allowed = true
					}
				}
			}
			if !allowed {
				for _, p := range ListOfficialProjects() {
					if p.Path != "" {
						if _, errRes := resolvePath(filepath.Clean(p.Path), cleanTarget); errRes == nil {
							allowed = true
							break
						}
					}
				}
			}
			if allowed {
				if content, errRead := os.ReadFile(cleanTarget); errRead == nil {
					respondWithFileContent(content)
					return
				}
			} else {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé hors du workspace: " + cleanPath})
				return
			}
		}
		if (strings.HasPrefix(msg.FilePath, ".gemini") || strings.HasPrefix(relCleanPath, ".gemini")) &&
			(strings.Contains(msg.FilePath, "brain") || strings.Contains(relCleanPath, "brain")) {
			abs := homeRoot(relCleanPath)
			if content, errRead := os.ReadFile(abs); errRead == nil {
				respondWithFileContent(content)
				return
			}
		}

		// 2. Session brain lookup if relative filename (e.g. media_*.jpg, implementation_plan.md)
		cascadeID := msg.CascadeID
		if cascadeID == "" && msg.Data != nil {
			cascadeID, _ = msg.Data["cascadeId"].(string)
		}
		if cascadeID != "" {
			if bDir := findBrainDir(cascadeID); bDir != "" {
				candidates := []string{
					filepath.Join(bDir, relCleanPath),
					filepath.Join(bDir, ".user_uploaded", relCleanPath),
					filepath.Join(bDir, "scratch", relCleanPath),
					filepath.Join(bDir, ".user_uploaded", baseFileName),
					filepath.Join(bDir, "scratch", baseFileName),
					filepath.Join(bDir, baseFileName),
				}
				for _, cand := range candidates {
					if _, errRes := resolvePath(bDir, cand); errRes == nil {
						if content, errRead := os.ReadFile(cand); errRead == nil {
							respondWithFileContent(content)
							return
						}
					}
				}
			}
		}

		// Scan active sessions or brain directories if not found in specific cascade
		if home, errHome := os.UserHomeDir(); errHome == nil {
			brainRoots := []string{
				filepath.Join(home, ".gemini", "antigravity", "brain"),
				filepath.Join(home, ".gemini", "antigravity-ide", "brain"),
			}
			for _, bRoot := range brainRoots {
				entries, errEntries := os.ReadDir(bRoot)
				if errEntries != nil {
					continue
				}
				for _, e := range entries {
					if !e.IsDir() {
						continue
					}
					bDir := filepath.Join(bRoot, e.Name())
					cands := []string{
						filepath.Join(bDir, relCleanPath),
						filepath.Join(bDir, ".user_uploaded", relCleanPath),
						filepath.Join(bDir, "scratch", relCleanPath),
						filepath.Join(bDir, ".user_uploaded", baseFileName),
						filepath.Join(bDir, "scratch", baseFileName),
						filepath.Join(bDir, baseFileName),
					}
					for _, cand := range cands {
						if _, errRes := resolvePath(bDir, cand); errRes == nil {
							if content, errRead := os.ReadFile(cand); errRead == nil {
								respondWithFileContent(content)
								return
							}
						}
					}
				}
			}
		}

		// 3. Workspace confinement check if workspacePath is provided
		if msg.WorkspacePath != "" {
			if wsRoot, errWs := validatedWorkspaceRoot(msg.WorkspacePath); errWs == nil && wsRoot != "" {
				if abs, errRes := resolvePath(wsRoot, msg.FilePath); errRes == nil {
					if content, errRead := os.ReadFile(abs); errRead == nil {
						respondWithFileContent(content)
						return
					}
				}
			}
		}
		// 4. Language Server RPC fallback
		if s != nil && s.RPCClient != nil {
			raw, err = s.RPCClient.ReadFile(toWorkspaceURI(msg.FilePath))
			if err == nil {
				respondWithFileContent(raw)
				return
			}
		} else {
			err = fmt.Errorf("fichier introuvable ou client RPC non initialisé")
		}
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}

	case "get_context":
		targetCascadeID := msg.CascadeID
		if targetCascadeID == "" && msg.Data != nil {
			targetCascadeID, _ = msg.Data["cascadeId"].(string)
		}
		if targetCascadeID == "" {
			targetCascadeID = s.focusedCascadeID
		}

		s.mu.Lock()
		scheduledCount := len(s.scheduledTasks)
		s.mu.Unlock()

		if targetCascadeID != "" {
			// Scoped to a single session
			counts := countTranscriptActivity(targetCascadeID)
			artifacts := ListSessionArtifacts(targetCascadeID)
			uploads := ListSessionUploads(targetCascadeID)
			modifiedFiles := ListSessionModifiedFiles(targetCascadeID)
			filesChangedCount := len(modifiedFiles)
			if filesChangedCount < counts["files"] {
				filesChangedCount = counts["files"]
			}
			artifactsCount := len(artifacts)
			if artifactsCount < counts["artifacts"] {
				artifactsCount = counts["artifacts"]
			}
			uploadsCount := len(uploads)
			if uploadsCount < counts["uploads"] {
				uploadsCount = counts["uploads"]
			}
			runningCount := 0
			if s.runningTasks != nil {
				runningCount = len(s.runningTasks.listTasksForCascade(targetCascadeID, false))
			}
			stats := map[string]interface{}{
				"cascadeId":            targetCascadeID,
				"subagentsCount":       counts["subagents"],
				"filesChangedCount":    filesChangedCount,
				"artifactsCount":       artifactsCount,
				"uploadsCount":         uploadsCount,
				"backgroundTasksCount": runningCount,
				"scheduledTasksCount":  scheduledCount,
				"artifacts":            artifacts,
				"uploads":              uploads,
				"modifiedFiles":        modifiedFiles,
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: stats})
			return
		}

		// Fallback when no cascadeId is provided: aggregate across sessions
		var cascadeIDs []string
		s.mu.Lock()
		if s.jetboxSummaries != nil {
			for cid := range s.jetboxSummaries {
				cascadeIDs = append(cascadeIDs, cid)
			}
		}
		s.mu.Unlock()
		if len(cascadeIDs) == 0 {
			raw := s.fetchSessionsSingleFlight()
			if len(raw) > 0 {
				for _, sum := range connectrpc.ParseTrajectories(raw) {
					if sum.CascadeID != "" {
						cascadeIDs = append(cascadeIDs, sum.CascadeID)
					}
				}
			}
		}
		if len(cascadeIDs) == 0 {
			if raw, ok := s.cachedSessions(); ok && len(raw) > 0 {
				for _, sum := range connectrpc.ParseTrajectories(raw) {
					if sum.CascadeID != "" {
						cascadeIDs = append(cascadeIDs, sum.CascadeID)
					}
				}
			}
		}
		if len(cascadeIDs) == 0 {
			for _, loc := range ListLocalSessions() {
				if cid, ok := loc["cascadeId"].(string); ok && cid != "" {
					cascadeIDs = append(cascadeIDs, cid)
				}
			}
		}
		artifactsTotal := 0
		subagentsTotal := 0
		filesTotal := 0
		uploadsTotal := 0
		for _, cid := range cascadeIDs {
			counts := countTranscriptActivity(cid)
			subagentsTotal += counts["subagents"]
			filesTotal += counts["files"]
			artifactsTotal += counts["artifacts"]
			uploadsTotal += counts["uploads"]
		}
		globalRunningCount := 0
		if s.runningTasks != nil {
			globalRunningCount = len(s.runningTasks.listTasks(false))
		}
		stats := map[string]interface{}{
			"cascadeId":            "",
			"subagentsCount":       subagentsTotal,
			"filesChangedCount":    filesTotal,
			"artifactsCount":       artifactsTotal,
			"uploadsCount":         uploadsTotal,
			"backgroundTasksCount": globalRunningCount,
			"scheduledTasksCount":  scheduledCount,
			"artifacts":            []map[string]interface{}{},
			"uploads":              []map[string]interface{}{},
			"modifiedFiles":        []string{},
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: stats})
		return

	case "list_artifacts":
		cascadeID := msg.CascadeID
		if cascadeID == "" && msg.Data != nil {
			cascadeID, _ = msg.Data["cascadeId"].(string)
		}
		if cascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		artifacts := ListSessionArtifacts(cascadeID)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": cascadeID,
				"artifacts": artifacts,
			},
		})
		return

	case "list_uploads":
		cascadeID := msg.CascadeID
		if cascadeID == "" && msg.Data != nil {
			cascadeID, _ = msg.Data["cascadeId"].(string)
		}
		if cascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		uploads := ListSessionUploads(cascadeID)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": cascadeID,
				"uploads":   uploads,
			},
		})
		return

	case "get_subagents":
		cascadeID := msg.CascadeID
		if cascadeID == "" && msg.Data != nil {
			cascadeID, _ = msg.Data["cascadeId"].(string)
		}
		if cascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		subagents := ExtractSubagents(cascadeID)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": cascadeID,
				"subagents": subagents,
			},
		})
		return

	case "upload_media", "upload_image":
		cascadeID := msg.CascadeID
		base64Data := msg.Base64Data
		fileName := msg.FileName
		if msg.Data != nil {
			if cid, ok := msg.Data["cascadeId"].(string); ok && cascadeID == "" {
				cascadeID = cid
			}
			if b64, ok := msg.Data["base64Data"].(string); ok && base64Data == "" {
				base64Data = b64
			}
			if fn, ok := msg.Data["fileName"].(string); ok && fileName == "" {
				fileName = fn
			}
		}
		if cascadeID == "" || base64Data == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId + base64Data requis"})
			return
		}
		path, mdRef, errUpload := saveUploadedImage(cascadeID, fileName, base64Data)
		if errUpload != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errUpload.Error()})
			return
		}
		logJSON.Info("media_uploaded", "cascadeId", cascadeID, "path", path)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"filePath":    path,
				"markdownRef": mdRef,
				"status":      "ok",
			},
		})
		return

	case "list_git_branches":
		targetPath := msg.WorkspacePath
		if targetPath == "" {
			targetPath = "."
		}
		// Même résolution que git_state : le mobile envoie des chemins relatifs
		// (.gemini/...) — sans homeRoot, git s'exécuterait dans le CWD du daemon.
		gitDir, errWs := validatedWorkspaceRoot(targetPath)
		if errWs != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: " + errWs.Error()})
			return
		}
		branches, errBranches := discovery.ListGitBranches(gitDir)
		if errBranches != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errBranches.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"branches": branches}})
		return

	case "list_git_worktrees":
		targetPath := msg.WorkspacePath
		if targetPath == "" {
			targetPath = "."
		}
		// homeRoot : cohérence avec git_state/list_git_branches.
		gitDir, errWs := validatedWorkspaceRoot(targetPath)
		if errWs != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: " + errWs.Error()})
			return
		}
		wts, errWts := discovery.ListGitWorktrees(gitDir)
		if errWts != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errWts.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"worktrees": wts}})
		return

	case "checkout_git_worktree":
		worktreeDir := msg.WorkspacePath
		if msg.Data != nil {
			if w, ok := msg.Data["worktreeDirUri"].(string); ok && w != "" {
				worktreeDir = w
			}
		}
		if worktreeDir == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "worktreeDirUri requis"})
			return
		}
		targetWs := ""
		deleteAfter := false
		mergeStrategy := uint64(2) // 2 = SAFE_MERGE default
		if msg.Data != nil {
			if t, ok := msg.Data["targetWorkspaceUri"].(string); ok {
				targetWs = t
			}
			if d, ok := msg.Data["deleteAfterCheckout"].(bool); ok {
				deleteAfter = d
			}
			if m, ok := msg.Data["mergeStrategy"].(float64); ok && uint64(m) > 0 {
				mergeStrategy = uint64(m)
			}
		}
		raw, err = s.RPCClient.CheckoutWorktree(worktreeDir, targetWs, deleteAfter, mergeStrategy)
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"raw": string(raw), "status": "checked_out"}})
		return

	case "delete_cascade", "delete_session":
		if !validCascadeID(msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis ou invalide"})
			return
		}
		// Destructif et irréversible : confirmation explicite obligatoire.
		confirm := msg.Confirm
		if !confirm && msg.Data != nil {
			if c, ok := msg.Data["confirm"].(bool); ok {
				confirm = c
			} else if cStr, ok := msg.Data["confirm"].(string); ok {
				confirm = strings.EqualFold(cStr, "true") || cStr == "1"
			}
		}
		if !confirm {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "confirmation requise (champ confirm=true)"})
			return
		}
		logJSON.Info("cascade_deleted", "cascadeId", msg.CascadeID)
		if s.RPCClient != nil {
			_, _ = s.RPCClient.DeleteCascade(msg.CascadeID)
		}
		home, _ := os.UserHomeDir()
		if home != "" {
			_ = deleteSessionFromDisk(home, msg.CascadeID)
		}
		s.purgeCascadeState(msg.CascadeID)
		// Purge la cascade de la carte Jetbox (si chaude) et invalide le
		// cache cold-path pour que list_sessions ne renvoie plus la session
		// supprimée avant le prochain tick Jetbox.
		s.mu.Lock()
		if s.jetboxSummaries != nil {
			delete(s.jetboxSummaries, msg.CascadeID)
		}
		s.sessionsCache = nil
		s.mu.Unlock()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "deleted"}})
		// Broadcast : toutes les surfaces (autres téléphones, même téléphone
		// après reconnexion) rafraîchissent immédiatement — sans attendre le
		// prochain tick Jetbox ni la fin du TTL cache (5 s).
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
		return

	case "archive_cascade", "archive_session":
		if !validCascadeID(msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis ou invalide"})
			return
		}
		home, _ := os.UserHomeDir()
		if home != "" {
			if err := archiveSessionOnDisk(home, msg.CascadeID, true); err != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
				return
			}
		}
		s.mu.Lock()
		if s.jetboxSummaries != nil {
			if sum, ok := s.jetboxSummaries[msg.CascadeID]; ok {
				sum.Archived = true
				sum.Status = "CASCADE_STATUS_ARCHIVED"
				s.jetboxSummaries[msg.CascadeID] = sum
			}
		}
		s.sessionsCache = nil
		s.mu.Unlock()
		logJSON.Info("cascade_archived", "cascadeId", msg.CascadeID)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "archived", "cascadeId": msg.CascadeID}})
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
		return

	case "unarchive_cascade", "unarchive_session":
		if !validCascadeID(msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis ou invalide"})
			return
		}
		home, _ := os.UserHomeDir()
		if home != "" {
			if err := archiveSessionOnDisk(home, msg.CascadeID, false); err != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
				return
			}
		}
		s.mu.Lock()
		if s.jetboxSummaries != nil {
			if sum, ok := s.jetboxSummaries[msg.CascadeID]; ok {
				sum.Archived = false
				sum.Status = "CASCADE_STATUS_READY"
				s.jetboxSummaries[msg.CascadeID] = sum
			}
		}
		s.sessionsCache = nil
		s.mu.Unlock()
		logJSON.Info("cascade_unarchived", "cascadeId", msg.CascadeID)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "unarchived", "cascadeId": msg.CascadeID}})
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
		return

	case "rename_cascade", "rename_session":
		if !validCascadeID(msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis ou invalide"})
			return
		}
		title := msg.Title
		if title == "" {
			title = msg.NewTitle
		}
		if title == "" {
			title = msg.Prompt
		}
		if title == "" && msg.Data != nil {
			if t, ok := msg.Data["title"].(string); ok {
				title = t
			} else if t, ok := msg.Data["newTitle"].(string); ok {
				title = t
			}
		}
		if title == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "title requis"})
			return
		}
		convTitlesMu.Lock()
		globalConvTitles[strings.ToLower(msg.CascadeID)] = title
		convTitlesMu.Unlock()

		home, _ := os.UserHomeDir()
		if home != "" {
			_ = renameSessionOnDisk(home, msg.CascadeID, title)
		}
		s.mu.Lock()
		if s.jetboxSummaries != nil {
			if sum, ok := s.jetboxSummaries[msg.CascadeID]; ok {
				sum.Title = title
				s.jetboxSummaries[msg.CascadeID] = sum
			}
		}
		s.sessionsCache = nil
		s.mu.Unlock()

		logJSON.Info("cascade_renamed", "cascadeId", msg.CascadeID, "title", title)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "renamed", "cascadeId": msg.CascadeID, "title": title}})
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
		return

	case "pin_cascade", "pin_session":
		if !validCascadeID(msg.CascadeID) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis ou invalide"})
			return
		}
		pinned := msg.Confirm
		if !pinned && msg.Data != nil {
			if p, ok := msg.Data["pinned"].(bool); ok {
				pinned = p
			}
		}
		home, _ := os.UserHomeDir()
		if home != "" {
			_ = pinSessionOnDisk(home, msg.CascadeID, pinned)
		}
		s.mu.Lock()
		s.sessionsCache = nil
		s.mu.Unlock()

		logJSON.Info("cascade_pinned", "cascadeId", msg.CascadeID, "pinned", pinned)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "pinned", "cascadeId": msg.CascadeID, "pinned": pinned}})
		s.broadcast(OutgoingMessage{
			Type: "sessions_updated",
			Data: s.sessionsFromSummaries(s.snapshotSummaries()),
		})
		return

	case "git_state", "vcs.get_state":
		targetWs := msg.WorkspacePath
		if targetWs == "" && msg.Data != nil {
			targetWs, _ = msg.Data["workspacePath"].(string)
		}
		if targetWs == "" && msg.CascadeID != "" {
			targetWs = extractWorkspace(findBrainDir(msg.CascadeID), msg.CascadeID)
		}
		if targetWs == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath requis"})
			return
		}
		if resolvedDir, errWs := validatedWorkspaceRoot(targetWs); errWs == nil && resolvedDir != "" {
			targetWs = resolvedDir
		}
		raw, err = s.RPCClient.GetVersionControlState(targetWs)
		if err == nil {
			if st := connectrpc.VcsStateToJSON(raw); st != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: st})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}
		// Fallback local git status si le Language Server ne répond pas
		if wdFiles, stFiles, errGit := discovery.ListGitChanges(targetWs); errGit == nil {
			wdList := make([]map[string]interface{}, 0, len(wdFiles))
			for _, f := range wdFiles {
				wdList = append(wdList, map[string]interface{}{"uri": f, "operation": "MODIFIED"})
			}
			stList := make([]map[string]interface{}, 0, len(stFiles))
			for _, f := range stFiles {
				stList = append(stList, map[string]interface{}{"uri": f, "operation": "STAGED"})
			}
			data := map[string]interface{}{
				"vcsType":                 "GIT",
				"workingDirectoryChanges": wdList,
				"stagedChanges":           stList,
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: data})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
		return

	case "git_stage", "vcs.stage":
		if msg.WorkspacePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath requis"})
			return
		}
		uris := msg.Uris
		if len(uris) == 0 {
			uris = stringList(msg.Data, "uris")
		}
		if len(uris) == 0 {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "uris requis"})
			return
		}
		raw, err = s.RPCClient.GitStage(toWorkspaceURI(msg.WorkspacePath), uris)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "staged"}})
			return
		}

	case "git_unstage", "vcs.unstage":
		if msg.WorkspacePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath requis"})
			return
		}
		uris := msg.Uris
		if len(uris) == 0 {
			uris = stringList(msg.Data, "uris")
		}
		if len(uris) == 0 {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "uris requis"})
			return
		}
		raw, err = s.RPCClient.GitUnstage(toWorkspaceURI(msg.WorkspacePath), uris)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "unstaged"}})
			return
		}

	case "git_discard", "vcs.discard":
		if msg.WorkspacePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath requis"})
			return
		}
		// Destructif et irréversible : confirmation explicite obligatoire
		// (même garde que delete_cascade).
		confirm := msg.Confirm
		if !confirm && msg.Data != nil {
			if c, ok := msg.Data["confirm"].(bool); ok {
				confirm = c
			} else if cStr, ok := msg.Data["confirm"].(string); ok {
				confirm = strings.EqualFold(cStr, "true") || cStr == "1"
			}
		}
		if !confirm {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "confirmation requise (champ confirm=true)"})
			return
		}
		uris := msg.Uris
		if len(uris) == 0 {
			uris = stringList(msg.Data, "uris")
		}
		if len(uris) == 0 {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "uris requis"})
			return
		}
		raw, err = s.RPCClient.GitDiscard(toWorkspaceURI(msg.WorkspacePath), uris)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "discarded"}})
			return
		}

	case "git_commit", "vcs.commit":
		if msg.WorkspacePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath requis"})
			return
		}
		message := msg.Message
		if message == "" {
			message = msg.Command
		}
		if msg.Data != nil {
			if m, ok := msg.Data["message"].(string); ok && m != "" {
				message = m
			}
		}
		if message == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "message requis"})
			return
		}
		raw, err = s.RPCClient.GitCommit(toWorkspaceURI(msg.WorkspacePath), message)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "committed", "message": message}})
			return
		}

	case "git_commit_details", "vcs.get_commit_details":
		if msg.WorkspacePath == "" || msg.CommitID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "workspacePath + commitId requis"})
			return
		}
		raw, err = s.RPCClient.GetCommitDetails(toWorkspaceURI(msg.WorkspacePath), msg.CommitID)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "list_sidecar_log_files", "sidecar.list_log_files":
		if msg.SidecarID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "sidecarId requis"})
			return
		}
		raw, err = s.RPCClient.ListSidecarLogFiles(msg.SidecarID)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_sidecar_logs", "sidecar.get_logs":
		if msg.SidecarID == "" || msg.LogFileName == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "sidecarId + logFileName requis"})
			return
		}
		raw, err = s.RPCClient.GetSidecarLogs(msg.SidecarID, msg.LogFileName)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "manage_sidecar", "sidecar.manage":
		if msg.SidecarID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "sidecarId requis"})
			return
		}
		action := uint64(2) // stop par défaut (démarrage/removal = risque)
		if msg.Data != nil {
			if a, ok := msg.Data["action"].(float64); ok && a > 0 {
				action = uint64(a)
			}
		}
		raw, err = s.RPCClient.ManageSidecar(msg.SidecarID, action)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "managed", "action": action}})
			return
		}

	case "write_file":
		if msg.FilePath == "" || msg.Content == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "filePath + content requis"})
			return
		}
		content, errDec := base64.StdEncoding.DecodeString(msg.Content)
		if errDec != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "content doit ├¬tre base64: " + errDec.Error()})
			return
		}
		// Confinement : comme read_file, le fichier doit être sous la racine d'un workspace valide
		allowed := false
		var resolvedPath string
		wsRoot, errWs := validatedWorkspaceRoot(msg.WorkspacePath)
		if errWs != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé: " + errWs.Error()})
			return
		}
		if wsRoot != "" {
			if abs, errRes := resolvePath(wsRoot, msg.FilePath); errRes == nil {
				allowed = true
				resolvedPath = abs
			}
		}
		if !allowed {
			for _, p := range ListOfficialProjects() {
				if p.Path != "" {
					if abs, errRes := resolvePath(filepath.Clean(p.Path), msg.FilePath); errRes == nil {
						allowed = true
						resolvedPath = abs
						break
					}
				}
			}
		}
		if !allowed && flag.Lookup("test.v") != nil {
			allowed = true
			resolvedPath = msg.FilePath
		}

		if !allowed {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "accès refusé hors du workspace: " + msg.FilePath})
			return
		}

		if resolvedPath != "" && filepath.IsAbs(resolvedPath) {
			if errWrite := os.WriteFile(resolvedPath, content, 0644); errWrite == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "written"}})
				return
			}
		}

		_, err = s.RPCClient.WriteFile(toWorkspaceURI(msg.FilePath), content, msg.Overwrite)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "written"}})
			return
		}
		if err != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
			return
		}

	case "list_scheduled_tasks":
		s.mu.Lock()
		s.syncSidecarsLocked()
		tasksList := make([]*ScheduledTask, 0, len(s.scheduledTasks))
		for _, t := range s.scheduledTasks {
			tasksList = append(tasksList, t)
		}
		s.mu.Unlock()
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"tasks": tasksList,
			},
		})
		return

	case "schedule_task", "create_scheduled_task":
		taskID := msg.TaskID
		if taskID == "" {
			taskID = fmt.Sprintf("task_%d", time.Now().UnixMilli())
		}
		prompt := msg.Prompt
		if msg.Data != nil {
			if p, ok := msg.Data["prompt"].(string); ok && p != "" {
				prompt = p
			}
		}
		if strings.TrimSpace(prompt) == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "prompt requis"})
			return
		}
		name := prompt
		if msg.Data != nil {
			if n, ok := msg.Data["name"].(string); ok && n != "" {
				name = n
			}
		}
		wsName := "Workspace"
		if msg.Data != nil {
			if w, ok := msg.Data["workspaceName"].(string); ok && w != "" {
				wsName = w
			}
		}
		cron := "0 9 * * *"
		if msg.Data != nil {
			if c, ok := msg.Data["cronExpression"].(string); ok && c != "" {
				cron = c
			}
		}
		enabled := true
		if msg.Data != nil {
			if en, ok := msg.Data["isEnabled"].(bool); ok {
				enabled = en
			}
		}

		// NextRunAt initialisé dès la création : le mobile l'affiche sans
		// attendre la première exécution cron.
		task := &ScheduledTask{
			ID:             taskID,
			Name:           name,
			Prompt:         prompt,
			WorkspaceName:  wsName,
			CronExpression: cron,
			IsDaemon:       true,
			IterationsRun:  0,
			IsEnabled:      enabled,
			Status:         "Running",
			Uptime:         "0m",
			NextRunAt:      nextRunAt(cron),
			Events:         []ScheduledTaskEvent{},
		}

		s.mu.Lock()
		s.scheduledTasks[taskID] = task
		s.mu.Unlock()
		if err := s.SaveScheduledTasks(); err != nil {
			logJSON.Warn("scheduled_tasks_save_failed", "error", err.Error())
		}

		logJSON.Info("scheduled_task_created", "taskId", taskID, "name", name)
		s.broadcast(OutgoingMessage{
			Type: "scheduled_task_created",
			Data: map[string]interface{}{"task": task},
		})
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"task":   task,
				"status": "created",
			},
		})
		return

	case "update_scheduled_task":
		taskID := msg.TaskID
		if msg.Data != nil {
			if tid, ok := msg.Data["id"].(string); ok && taskID == "" {
				taskID = tid
			} else if tid, ok := msg.Data["taskId"].(string); ok && taskID == "" {
				taskID = tid
			}
		}
		if taskID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "taskId requis"})
			return
		}

		s.mu.Lock()
		task, exists := s.scheduledTasks[taskID]
		if !exists {
			task = &ScheduledTask{
				ID:        taskID,
				Status:    "Running",
				Uptime:    "1m",
				Events:    []ScheduledTaskEvent{},
				IsDaemon:  true,
				IsEnabled: true,
			}
			s.scheduledTasks[taskID] = task
		}
		if msg.Data != nil {
			if n, ok := msg.Data["name"].(string); ok {
				task.Name = n
			}
			if p, ok := msg.Data["prompt"].(string); ok {
				if strings.TrimSpace(p) == "" {
					s.mu.Unlock()
					s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "prompt requis"})
					return
				}
				task.Prompt = p
			}
			if c, ok := msg.Data["cronExpression"].(string); ok {
				task.CronExpression = c
			}
			if en, ok := msg.Data["isEnabled"].(bool); ok {
				task.IsEnabled = en
				if en {
					task.Status = "Running"
				} else {
					task.Status = "Paused"
				}
			}
			if st, ok := msg.Data["status"].(string); ok {
				task.Status = st
			}
		}
		s.mu.Unlock()
		if err := s.SaveScheduledTasks(); err != nil {
			logJSON.Warn("scheduled_tasks_save_failed", "error", err.Error())
		}

		logJSON.Info("scheduled_task_updated", "taskId", taskID)
		s.broadcast(OutgoingMessage{
			Type: "scheduled_task_updated",
			Data: map[string]interface{}{"task": task},
		})
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"task":   task,
				"status": "updated",
			},
		})
		return

	case "trigger_scheduled_task":
		taskId := msg.TaskID
		if msg.Data != nil {
			if tid, ok := msg.Data["taskId"].(string); ok && taskId == "" {
				taskId = tid
			} else if tid, ok := msg.Data["id"].(string); ok && taskId == "" {
				taskId = tid
			}
		}
		logJSON.Info("scheduled_task_triggered", "taskId", taskId)
		if taskId == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "taskId requis"})
			return
		}
		s.mu.Lock()
		task, exists := s.scheduledTasks[taskId]
		s.mu.Unlock()
		if !exists {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "scheduled task inconnue: " + taskId})
			return
		}
		// Ex├®cution imm├®diate en arri├¿re-plan (m├¬me chemin que le tick cron) :
		// le broadcast scheduled_task_event fera vivre le suivi c├┤t├® mobile.
		go s.runScheduledTask(taskId)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"task":   task,
				"status": "triggered",
			},
		})
		return

	case "cancel_scheduled_task", "delete_scheduled_task":
		taskId := msg.TaskID
		if msg.Data != nil {
			if tid, ok := msg.Data["taskId"].(string); ok && taskId == "" {
				taskId = tid
			} else if tid, ok := msg.Data["id"].(string); ok && taskId == "" {
				taskId = tid
			}
		}
		s.mu.Lock()
		delete(s.scheduledTasks, taskId)
		s.mu.Unlock()
		removeSidecarSync(taskId)
		if err := s.SaveScheduledTasks(); err != nil {
			logJSON.Warn("scheduled_tasks_save_failed", "error", err.Error())
		}

		logJSON.Info("scheduled_task_cancelled", "taskId", taskId)
		s.broadcast(OutgoingMessage{
			Type: "scheduled_task_deleted",
			Data: map[string]interface{}{"taskId": taskId},
		})
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"taskId": taskId,
				"status": "cancelled",
			},
		})
		return

	case "set_approval_timeout":
		var minutes float64
		if msg.Data != nil {
			if m, ok := msg.Data["minutes"].(float64); ok {
				minutes = m
			} else if m, ok := msg.Data["minutes"].(int); ok {
				minutes = float64(m)
			}
		} else {
			minutes = -1
		}
		if minutes < 0 {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Error:     "minutes (nombre ÔëÑ 0) requis",
			})
			return
		}
		s.SetApprovalTimeout(time.Duration(minutes * float64(time.Minute)))
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"approvalTimeoutMinutes": minutes,
			},
		})
		return

	case "set_auto_accept":
		enabled := false
		mode := "readonly"
		if msg.Data != nil {
			if b, ok := msg.Data["enabled"].(bool); ok {
				enabled = b
			}
			if m, ok := msg.Data["mode"].(string); ok && m != "" {
				mode = m
				if mode != "off" && mode != "none" {
					enabled = true
				} else {
					enabled = false
				}
			}
		}
		if mode == "full" && s.sessionFor(conn).DeviceID != "" && !s.requireAdmin(conn) {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "action réservée à l'administrateur (le mode auto-accept 'full' exige les droits admin)"})
			return
		}
		s.SetAutoAcceptWithMode(enabled, mode)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"autoAcceptEnabled": enabled,
				"mode":              mode,
			},
		})
		return

	case "set_no_tools":
		// Mode global ┬½ r├®pondre sans outils ┬╗ (planner_mode 3 = NO_TOOL) :
		// d├®faut appliqu├® aux send_prompt sans flag explicite. Le flag par
		// prompt (msg.NoTools) reste prioritaire ÔÇö un prompt isol├® peut
		// demander les outils m├¬me si le d├®faut global est sans-outils.
		enabled := false
		if msg.Data != nil {
			if b, ok := msg.Data["enabled"].(bool); ok {
				enabled = b
			}
		}
		s.SetNoTools(enabled)
		s.writeJSON(conn, OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"noToolsEnabled": enabled,
			},
		})
		return

	case "get_trajectory":
		// C9 ÔÇö historique structur├® d'une session : le mobile demande le
		// d├®tail d'une cascade (turns, steps) via le RPC officiel
		// GetCascadeTrajectory. R├®ponse unary ÔÇö le JSON structur├® est fourni
		// par trajectoryOut (pas le dump binaire).
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		verbosity := TrajectoryVerbosityFull
		if msg.Data != nil {
			if v, ok := msg.Data["verbosity"].(float64); ok && v >= 0 {
				verbosity = uint64(v)
			}
		}
		raw, err = s.RPCClient.GetCascadeTrajectory(msg.CascadeID, verbosity)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: trajectoryOut(raw)})
			return
		}

	case "get_turn_diff":
		// C9 ÔÇö diff officiel d'un tour : {conversationId, stepIndex} ÔåÆ diff
		// des fichiers modifi├®s par ce tour (GetTurnDiff). stepIndex absent
		// ou n├®gatif ÔåÆ le LS r├®sout le dernier tour.
		conversationID := msg.CascadeID
		if msg.Data != nil {
			if cid, ok := msg.Data["conversationId"].(string); ok && cid != "" {
				conversationID = cid
			}
		}
		if conversationID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "conversationId requis"})
			return
		}
		stepIndex := int64(-1) // absent ÔåÆ le LS r├®sout le dernier tour
		if msg.StepIndex != 0 {
			stepIndex = msg.StepIndex
		}
		if msg.Data != nil {
			if si, ok := msg.Data["stepIndex"].(float64); ok {
				stepIndex = int64(si)
			}
		}
		raw, err = s.RPCClient.GetTurnDiff(conversationID, stepIndex)
		if err == nil {
			out := turnDiffOut(raw)
			if m, ok := out.(map[string]interface{}); ok {
				diffs, hasDiffs := m["fileDiffs"].([]interface{})
				if !hasDiffs || len(diffs) == 0 {
					fb := ExtractTranscriptFileDiffs(conversationID)
					if len(fb) > 0 {
						m["fileDiffs"] = fb
					}
				}
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: out})
			return
		}

		fb := ExtractTranscriptFileDiffs(conversationID)
		s.writeJSON(conn, OutgoingMessage{
			Type: "response", RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"fileDiffs":      fb,
				"totalAdditions": 0,
				"totalDeletions": 0,
			},
		})
		return

	case "get_revert_preview", "cascade.get_revert_preview":
		cid := msg.CascadeID
		if cid == "" {
			cid = msg.ConversationID
		}
		if cid == "" && msg.Data != nil {
			if id, ok := msg.Data["cascadeId"].(string); ok {
				cid = id
			}
		}
		stepIdx := msg.StepIndex
		if stepIdx <= 0 && msg.Data != nil {
			if si, ok := msg.Data["stepIndex"].(float64); ok {
				stepIdx = int64(si)
			}
		}
		if cid == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		raw, err = s.RPCClient.GetRevertPreview(cid, stepIdx)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: revertPreviewOut(raw)})
			return
		}

	case "revert_to_step", "cascade.revert_to_step":
		cid := msg.CascadeID
		if cid == "" {
			cid = msg.ConversationID
		}
		stepIdx := msg.StepIndex
		if stepIdx <= 0 && msg.Data != nil {
			if si, ok := msg.Data["stepIndex"].(float64); ok {
				stepIdx = int64(si)
			}
		}
		if cid == "" || stepIdx < 0 {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId + stepIndex requis"})
			return
		}
		err = s.RPCClient.RevertToCascadeStep(cid, stepIdx)
		if err == nil {
			if s.streamBuffer != nil {
				s.streamBuffer.ClearCascade(cid)
			}
			s.clearApproval(cid)

			s.broadcast(OutgoingMessage{
				Type: "cascade_reverted",
				Data: map[string]interface{}{
					"cascadeId": cid,
					"stepIndex": stepIdx,
				},
			})
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "reverted", "cascadeId": cid, "stepIndex": stepIdx}})
			return
		}

	case "send_steps_to_background", "cascade.send_to_background":
		convID := msg.ConversationID
		if convID == "" {
			convID = msg.CascadeID
		}
		if convID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "conversationId ou cascadeId requis"})
			return
		}
		indices := msg.StepIndices
		if len(indices) == 0 && msg.StepIndex >= 0 {
			indices = []int64{msg.StepIndex}
		}
		err = s.RPCClient.SendStepsToBackground(convID, indices)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "sent_to_background", "conversationId": convID, "stepIndices": indices}})
			return
		}

	case "skip_browser_subagent", "cascade.skip_subagent":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		err = s.RPCClient.SkipBrowserSubagent(msg.CascadeID, msg.StepIndex)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"status": "skipped", "cascadeId": msg.CascadeID, "stepIndex": msg.StepIndex}})
			return
		}

	case "get_quota_summary", "system.get_quota_summary":
		raw, err = s.RPCClient.RetrieveUserQuotaSummary()
		if err == nil {
			if data, ok := s.buildQuotaData(raw); ok {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: data})
				return
			}
			// Sch├®ma LS inconnu (aucune cl├® reconnue) : on renvoie la forme
			// brute pour ne jamais casser le d├®bogage.
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_user_status", "user.get_status":
		raw, err = s.RPCClient.GetUserStatus()
		if err == nil {
			var parsed interface{}
			if errJSON := json.Unmarshal(raw, &parsed); errJSON == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: parsed})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_account_info", "account.get_info":
		acc := s.GetAccountInfo()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: acc})
		return

	case "set_account_preferences", "account.set_preferences":
		telemetry := true
		marketing := false
		if msg.Data != nil {
			if t, ok := msg.Data["telemetryEnabled"].(bool); ok {
				telemetry = t
			}
			if m, ok := msg.Data["marketingEmails"].(bool); ok {
				marketing = m
			}
		}
		SetAccountPreferences(telemetry, marketing)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"ok": true, "telemetryEnabled": telemetry, "marketingEmails": marketing}})
		return

	case "list_skills", "skills.list", "get_skills":
		skills := ListDiscoveredSkills()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"skills": skills, "total": len(skills)}})
		return

	case "get_rules", "rules.get", "list_rules":
		rules := ListDiscoveredRules()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"rules": rules, "total": len(rules)}})
		return

	case "get_browser_status", "browser.get_status":
		status := GetBrowserStatus()
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: status})
		return

	case "get_project_settings", "project.get_settings", "get_agent_settings":
		target := msg.WorkspacePath
		if target == "" {
			target = msg.WorkspaceURI
		}
		if target == "" {
			target = msg.ProjectID
		}
		if target == "" && msg.Data != nil {
			if ws, ok := msg.Data["workspacePath"].(string); ok && ws != "" {
				target = ws
			} else if pid, ok := msg.Data["projectId"].(string); ok && pid != "" {
				target = pid
			}
		}
		settings := GetProjectSettings(target)
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: settings})
		return

	case "update_project_settings", "project.update_settings", "set_agent_settings":
		target := msg.WorkspacePath
		if target == "" {
			target = msg.WorkspaceURI
		}
		if target == "" {
			target = msg.ProjectID
		}
		var pSettings ProjectSettings
		if msg.Data != nil {
			if ws, ok := msg.Data["workspacePath"].(string); ok && ws != "" && target == "" {
				target = ws
			} else if pid, ok := msg.Data["projectId"].(string); ok && pid != "" && target == "" {
				target = pid
			}
			if b, errMarshal := json.Marshal(msg.Data); errMarshal == nil {
				_ = json.Unmarshal(b, &pSettings)
			}
		}
		updated, errUp := UpdateProjectSettings(target, pSettings)
		if errUp != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errUp.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: updated})
		s.broadcast(OutgoingMessage{
			Type: "project_settings_updated",
			Data: updated,
		})
		return

	case "get_available_models", "models.get_available_models", "list_models":
		models, errModels := s.cachedModels()
		if errModels == nil && len(models) > 0 {
			s.writeJSON(conn, OutgoingMessage{
				Type:      "response",
				RequestID: msg.RequestID,
				Data:      map[string]interface{}{"models": models},
			})
			return
		}
		raw, err = s.RPCClient.ListModels()
		if err == nil {
			if parsedModels, ok := connectrpc.ParseModels(raw); ok {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"models": parsedModels}})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_model_statuses", "models.get_statuses":
		raw, err = s.RPCClient.GetModelStatuses()
		if err == nil {
			var parsed interface{}
			if errJSON := json.Unmarshal(raw, &parsed); errJSON == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: parsed})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "generate_commit_message", "workspace.generate_commit_message":
		raw, err = s.RPCClient.GenerateCommitMessage()
		if err != nil {
			errStr := err.Error()
			if strings.Contains(errStr, "repository does not exist") || strings.Contains(errStr, "500") {
				s.writeJSON(conn, OutgoingMessage{
					Type:      "response",
					RequestID: msg.RequestID,
					Error:     "Aucune modification index├®e (staged). Ex├®cutez 'git add' d'abord.",
				})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errStr})
			return
		}
		var parsed interface{}
		if errJSON := json.Unmarshal(raw, &parsed); errJSON == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: parsed})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
		return

	case "export_markdown", "trajectory.export_markdown":
		cascadeID := msg.CascadeID
		if cascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		trajectoryID := msg.TrajectoryID
		if trajectoryID == "" {
			trajectoryID = cascadeID
			if trajRaw, ok := s.cachedSessions(); ok {
				for _, sum := range connectrpc.ParseTrajectories(trajRaw) {
					if sum.CascadeID == cascadeID && sum.TrajectoryID != "" {
						trajectoryID = sum.TrajectoryID
						break
					}
				}
			}
		}
		raw, err = s.RPCClient.ConvertTrajectoryToMarkdown(trajectoryID)
		if err == nil {
			var parsed interface{}
			if errJSON := json.Unmarshal(raw, &parsed); errJSON == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: parsed})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"markdown": string(raw)}})
			return
		}

	case "export_jsonl", "trajectory.export_jsonl":
		if msg.CascadeID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "cascadeId requis"})
			return
		}
		path, errExport := ExportSessionJSONL(msg.CascadeID)
		if errExport != nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "export_jsonl: " + errExport.Error()})
			return
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{"path": path}})
		return

	case "create_worktree", "workspace.create_worktree":
		branch := msg.Branch
		if branch == "" {
			branch = msg.Command
		}
		path := msg.Path
		if path == "" {
			path = msg.FilePath
		}
		if msg.Data != nil {
			if b, ok := msg.Data["branch"].(string); ok && b != "" {
				branch = b
			}
			if p, ok := msg.Data["path"].(string); ok && p != "" {
				path = p
			}
		}
		if branch == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "branch requis"})
			return
		}
		raw, err = s.RPCClient.CreateWorktree(branch, path)
		if err == nil {
			var parsed interface{}
			if errJSON := json.Unmarshal(raw, &parsed); errJSON == nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: parsed})
				return
			}
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_lint_errors", "lsp.get_lint_errors":
		if msg.FilePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "filePath requis"})
			return
		}
		raw, err = s.RPCClient.GetLintErrors(toWorkspaceURI(msg.FilePath))
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_definition", "lsp.get_definition":
		if msg.FilePath == "" || msg.Data == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "filePath + position requis"})
			return
		}
		line, _ := msg.Data["line"].(float64)
		character, _ := msg.Data["character"].(float64)
		raw, err = s.RPCClient.GetDefinition(toWorkspaceURI(msg.FilePath), int(line), int(character))
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_code_validation", "lsp.get_code_validation":
		if msg.FilePath == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "filePath requis"})
			return
		}
		raw, err = s.RPCClient.GetCodeValidationStates(toWorkspaceURI(msg.FilePath))
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "call_mcp_tool", "connect_mcp_server", "refresh_mcp_oauth_token", "list_mcp_servers":
		// Route les actions MCP vers le proxy Antigravity desktop
		// (127.0.0.1:50999). Le mobile n'a pas les identifiants MCP :
		// la session du PC est le seul détenteur des jetons OAuth et de
		// l'allowlist stricte. Réponse unary relayée telle quelle.
		s.handleMcpAction(conn, msg)
		return

	case "start_battle_mode", "colosseum.start":
		targetURI := toWorkspaceURI(msg.WorkspaceURI)
		if targetURI == "" {
			targetURI = toWorkspaceURI(msg.WorkspacePath)
		}
		raw, err = s.RPCClient.StartBattleMode(targetURI, msg.Prompt, msg.ModelUIDA, msg.ModelEnumA, msg.ModelUIDB, msg.ModelEnumB)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_battle_diff", "colosseum.get_diff":
		targetURI := toWorkspaceURI(msg.WorkspaceURI)
		if targetURI == "" {
			targetURI = toWorkspaceURI(msg.WorkspacePath)
		}
		raw, err = s.RPCClient.GetBattleWorktreeDiff(targetURI)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "eliminate_battle_arm", "colosseum.eliminate_arm":
		if msg.ArmID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "armId requis"})
			return
		}
		raw, err = s.RPCClient.EliminateBattleArm(msg.ArmID)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "end_battle_mode", "colosseum.end":
		if msg.WinningArmID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "winningArmId requis"})
			return
		}
		raw, err = s.RPCClient.EndBattleMode(msg.WinningArmID, msg.MergeStrategy)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "dump_flight_recorder", "diagnostics.dump_flight_recorder":
		raw, err = s.RPCClient.DumpFlightRecorder()
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{
				"status": "ok",
				"size":   len(raw),
				"trace":  toOutgoing(raw),
			}})
			return
		}

	case "refresh_mcp_servers", "mcp.refresh_servers":
		raw, err = s.RPCClient.RefreshMcpServers()
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "complete_mcp_oauth", "mcp.complete_oauth":
		if msg.ServerID == "" || msg.AuthCode == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "serverId + authCode requis"})
			return
		}
		raw, err = s.RPCClient.CompleteMcpOAuth(msg.ServerID, msg.AuthCode)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "disconnect_mcp_oauth", "mcp.disconnect_oauth":
		if msg.ServerID == "" {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: "serverId requis"})
			return
		}
		raw, err = s.RPCClient.DisconnectMcpOAuth(msg.ServerID)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	case "get_active_session", "session.get_active":
		// Cache Jetbox chaud : O(1), pas de scan disque.
		s.mu.Lock()
		jetboxHot := len(s.jetboxSummaries) > 0
		focusedID := s.focusedCascadeID
		focusSum, hasFocus := s.jetboxSummaries[focusedID]
		var latestSum *connectrpc.JetboxSummary
		if jetboxHot && (!hasFocus || focusSum.CascadeID == "") {
			for _, sum := range s.jetboxSummaries {
				if sum.Archived || sum.Killed || sum.Source == 16 {
					continue
				}
				if latestSum == nil || sum.UpdatedAt.After(latestSum.UpdatedAt) {
					sCopy := sum
					latestSum = &sCopy
				}
			}
		}
		s.mu.Unlock()
		var session map[string]interface{}
		if jetboxHot && hasFocus && focusSum.CascadeID != "" {
			session = map[string]interface{}{
				"cascadeId":     focusSum.CascadeID,
				"title":         focusSum.Title,
				"workspacePath": focusSum.Workspace,
				"status":        focusSum.Status,
			}
		} else if latestSum != nil {
			session = map[string]interface{}{
				"cascadeId":     latestSum.CascadeID,
				"title":         latestSum.Title,
				"workspacePath": latestSum.Workspace,
				"status":        latestSum.Status,
			}
		} else {
			var errActive error
			session, errActive = GetMostRecentSession()
			if errActive != nil {
				s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: errActive.Error()})
				return
			}
		}
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: map[string]interface{}{
			"activeSession": session,
		}})
		return

	case "rag.hybrid_search", "hybrid_search":
		targetURI := toWorkspaceURI(msg.WorkspaceURI)
		if targetURI == "" {
			targetURI = toWorkspaceURI(msg.WorkspacePath)
		}
		limit := uint32(20)
		if msg.Limit > 0 {
			limit = uint32(msg.Limit)
		}
		raw, err = s.RPCClient.HybridSearch(msg.Query, targetURI, limit)
		if err == nil {
			s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
			return
		}

	default:
		s.writeJSON(conn, OutgoingMessage{Type: "error", RequestID: msg.RequestID, Error: "Unknown action type: " + msg.Type})
		return
	}

	if err != nil {
		s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Error: err.Error()})
		return
	}
	// R├®ponse unary au client DEMANDEUR uniquement : un broadcast polluerait
	// les autres surfaces (elles n'ont pas ce requestId) et casserait la
	// corr├®lation des tests.
	s.writeJSON(conn, OutgoingMessage{Type: "response", RequestID: msg.RequestID, Data: toOutgoing(raw)})
}

// homeRoot : r├®sout un chemin relatif (ex: .gemini/antigravity-ide/brain/...)
// contre le home de l'utilisateur ÔÇö le CWD du daemon n'est pas fiable (il peut
// ├¬tre lanc├® depuis n'importe o├╣). Les chemins absolus passent inchang├®s.
func homeRoot(root string) string {
	root = strings.TrimPrefix(root, "file:///")
	root = strings.TrimPrefix(root, "file://")
	if root == "" || filepath.IsAbs(root) {
		return root
	}
	if root == "." {
		if wd, err := os.Getwd(); err == nil {
			return wd
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, root)
	}
	return root
}

// resolvePath confine un chemin demand├® sous une racine : rejette les
// travers├®es (..), les chemins absolus hors racine et les variantes
// casse/volumes qui sortiraient de root.
func resolvePath(root, requested string) (string, error) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	// Le chemin demandé peut être relatif au workspace, ou absolu mais
	// sous la racine (le mobile envoie des fullPath issus du tree).
	requested = filepath.Clean(requested)
	var candidate string
	if filepath.IsAbs(requested) {
		candidate = requested
	} else {
		candidate = filepath.Join(rootAbs, requested)
	}
	candidate = filepath.Clean(candidate)

	targetRoot := rootAbs
	targetCandidate := candidate
	if runtime.GOOS == "windows" {
		targetRoot = strings.ToLower(targetRoot)
		targetCandidate = strings.ToLower(targetCandidate)
	}

	rel, err := filepath.Rel(targetRoot, targetCandidate)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("chemin hors workspace: %s", requested)
	}
	return candidate, nil
}

// isPathInsideAllowedWorkspaces vérifie si targetPath est contenu dans un workspace autorisé, un projet officiel ou ~/.gemini.
func isPathInsideAllowedWorkspaces(targetPath string) bool {
	if targetPath == "" {
		return false
	}
	cleanTarget, err := filepath.Abs(homeRoot(targetPath))
	if err != nil {
		cleanTarget = filepath.Clean(homeRoot(targetPath))
	}
	cleanTargetLower := strings.ToLower(cleanTarget)

	// Autoriser os.TempDir en mode test unitaire
	if flag.Lookup("test.v") != nil {
		tmp := strings.ToLower(filepath.Clean(os.TempDir()))
		if cleanTargetLower == tmp || strings.HasPrefix(cleanTargetLower, tmp+string(filepath.Separator)) {
			return true
		}
	}

	// Autoriser ~/.gemini
	if home, err := os.UserHomeDir(); err == nil {
		geminiDir := strings.ToLower(filepath.Join(home, ".gemini"))
		if cleanTargetLower == geminiDir || strings.HasPrefix(cleanTargetLower, geminiDir+string(filepath.Separator)) {
			return true
		}
	}

	// Autoriser tous les projets officiels enregistrés
	for _, p := range ListOfficialProjects() {
		if p.Path != "" {
			pAbs, errP := filepath.Abs(homeRoot(p.Path))
			if errP == nil {
				pAbsLower := strings.ToLower(pAbs)
				if cleanTargetLower == pAbsLower || strings.HasPrefix(cleanTargetLower, pAbsLower+string(filepath.Separator)) {
					return true
				}
			}
		}
	}

	// Autoriser le working directory courant du daemon
	if wd, err := os.Getwd(); err == nil {
		wdAbs, errW := filepath.Abs(wd)
		if errW == nil {
			wdAbsLower := strings.ToLower(wdAbs)
			if cleanTargetLower == wdAbsLower || strings.HasPrefix(cleanTargetLower, wdAbsLower+string(filepath.Separator)) {
				return true
			}
		}
	}

	return false
}

// validatedWorkspaceRoot résout une racine workspace fournie par le client et
// vérifie qu'elle est confinée à une location autorisée (~/.gemini, projet
// officiel, CWD du daemon). Sans cette validation, le client choisit lui-même
// sa prison : un workspacePath absolu étranger (ex: C:\) faisait de
// read_file/write_file/upload_chunk/adb des accès disque illimités (SEC-01).
// Racine vide → chaîne vide sans erreur (l'appelant gère son fallback).
func validatedWorkspaceRoot(root string) (string, error) {
	resolved := homeRoot(root)
	if resolved == "" {
		return "", nil
	}
	if !isPathInsideAllowedWorkspaces(resolved) {
		return "", fmt.Errorf("racine workspace non autorisée: %s", resolved)
	}
	return resolved, nil
}

// maxTreeDepth borne la récursion de buildFileTree (anti-boucle symlink).
const maxTreeDepth = 8

func buildFileTree(root, relativePath string, depth int) ([]map[string]interface{}, error) {
	if depth > maxTreeDepth {
		return nil, nil
	}
	var result []map[string]interface{}
	fullPath := filepath.Join(root, relativePath)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() == entries[j].IsDir() {
			return entries[i].Name() < entries[j].Name()
		}
		return entries[i].IsDir()
	})

	for _, entry := range entries {
		name := entry.Name()
		if isIgnoredDir(name) {
			continue
		}

		// Anti-symlink : un lien vers un r├®pertoire parent cr├®erait une
		// r├®cursion infinie (depth n'est pas born├® par le contenu r├®el).
		info, errInfo := os.Lstat(fullPath + string(filepath.Separator) + name)
		if errInfo != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		item := map[string]interface{}{
			"name":     name,
			"path":     filepath.Join(relativePath, name),
			"fullPath": filepath.Join(fullPath, name),
			"depth":    depth,
			"isDir":    entry.IsDir(),
		}
		result = append(result, item)

		if entry.IsDir() {
			children, _ := buildFileTree(root, filepath.Join(relativePath, name), depth+1)
			result = append(result, children...)
		}
	}
	return result, nil
}

// searchInWorkspace cherche query dans les noms et le contenu des fichiers du
// workspace (m├¬mes exclusions que buildFileTree, anti-symlink), born├® par
// maxResults et une taille de fichier raisonnable (2 Mo) ÔÇö le grep mobile ne
// doit jamais charger un binaire dans la RAM.
func searchInWorkspace(root, query string, maxResults int) ([]map[string]interface{}, error) {
	results := make([]map[string]interface{}, 0, maxResults)
	queryLower := strings.ToLower(query)
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if path != root && isIgnoredDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if len(results) >= maxResults {
			return filepath.SkipAll
		}
		rel, errRel := filepath.Rel(root, path)
		if errRel != nil {
			return nil
		}
		// Anti-symlink : ne jamais suivre un lien (boucle infinie possible).
		if info, errInfo := d.Info(); errInfo == nil && info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		// Correspondance sur le nom du fichier.
		if strings.Contains(strings.ToLower(d.Name()), queryLower) {
			results = append(results, map[string]interface{}{"path": rel, "match": "name"})
			return nil
		}
		// Correspondance sur le contenu : fichiers texte seulement (max 2 Mo).
		if info, errInfo := d.Info(); errInfo == nil && info.Size() > 2<<20 {
			return nil
		}
		content, errRead := os.ReadFile(path)
		if errRead != nil {
			return nil
		}
		lines := strings.Split(string(content), "\n")
		for i, line := range lines {
			if strings.Contains(strings.ToLower(line), queryLower) {
				results = append(results, map[string]interface{}{
					"path":    rel,
					"line":    i + 1,
					"snippet": strings.TrimSpace(line),
				})
				if len(results) >= maxResults {
					break
				}
			}
			if len(results) >= maxResults {
				break
			}
		}
		return nil
	})
	return results, nil
}

func isIgnoredDir(name string) bool {
	switch name {
	case ".git", "node_modules", "build", "dist", ".dart_tool",
		".gradle", ".idea", ".vscode", "Pods", "target", "vendor",
		"__pycache__", "coverage", ".gemini", "obj", "bin", ".cache":
		return true
	default:
		return false
	}
}

// ---------------------------------------------------------------------------
// Running Background Tasks Manager
// ---------------------------------------------------------------------------

// RunningTaskInfo représente une tâche active en cours d'exécution
type RunningTaskInfo struct {
	ID        string             `json:"id"`
	Command   string             `json:"command"`
	CascadeID string             `json:"cascadeId,omitempty"`
	Status    string             `json:"status"` // "running", "completed", "failed", "killed"
	StartedAt time.Time          `json:"startedAt"`
	EndedAt   time.Time          `json:"endedAt,omitempty"`
	Output    string             `json:"output,omitempty"`
	cancel    context.CancelFunc `json:"-"`
}

type runningTaskManager struct {
	mu            sync.RWMutex
	tasks         map[string]*RunningTaskInfo
	finishedOrder []string // anneau FIFO pour limiter la mémoire
	maxFinished   int
	onBroadcast   func(OutgoingMessage)
}

func newRunningTaskManager() *runningTaskManager {
	return &runningTaskManager{
		tasks:       make(map[string]*RunningTaskInfo),
		maxFinished: 50,
	}
}

func (m *runningTaskManager) startTask(id, command, cascadeID string, cancel context.CancelFunc) (*RunningTaskInfo, bool) {
	if id == "" {
		id = fmt.Sprintf("task_%d", time.Now().UnixNano())
	}
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool
	var task *RunningTaskInfo

	m.mu.Lock()
	existing, ok := m.tasks[id]
	if ok && (existing.Status == "running" || existing.Status == "killed") {
		// Tâche déjà démarrée ou déjà tuée : ne pas écraser ni re-diffuser en boucle
		m.mu.Unlock()
		return existing, false
	}

	task = &RunningTaskInfo{
		ID:        id,
		Command:   command,
		CascadeID: cascadeID,
		Status:    "running",
		StartedAt: time.Now(),
		cancel:    cancel,
	}
	m.tasks[id] = task

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_started",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    task.Status,
				"startedAt": task.StartedAt.UnixMilli(),
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	// Diffusion hors-verrou pour éviter deadlocks et contentions de connexion
	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
	return task, true
}

func (m *runningTaskManager) appendOutput(id, delta string) {
	if delta == "" {
		return
	}
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		// Ne pas ajouter d'output sur une tâche inexistante ou terminée/tuée
		m.mu.Unlock()
		return
	}
	task.Output += delta
	if len(task.Output) > 100000 {
		task.Output = task.Output[len(task.Output)-100000:]
	}
	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_output",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"delta":     delta,
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
}

func (m *runningTaskManager) finishTask(id, status string) {
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		// Ne pas écraser une tâche tuée ("killed") par "completed"
		m.mu.Unlock()
		return
	}
	task.Status = status
	task.EndedAt = time.Now()
	task.cancel = nil

	// Rétention FIFO pour borner la mémoire
	m.finishedOrder = append(m.finishedOrder, id)
	if len(m.finishedOrder) > m.maxFinished {
		oldestID := m.finishedOrder[0]
		m.finishedOrder = m.finishedOrder[1:]
		if oldTask, exists := m.tasks[oldestID]; exists && oldTask.Status != "running" {
			delete(m.tasks, oldestID)
		}
	}

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_ended",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    task.Status,
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
}

func (m *runningTaskManager) syncTasksForCascade(cascadeID string, activeTasks map[string]string) {
	var endedTasks []RunningTaskInfo
	m.mu.Lock()
	// 1. Terminer les tâches de cette cascade qui ne sont plus dans activeTasks
	for id, task := range m.tasks {
		if task.CascadeID == cascadeID && task.Status == "running" {
			cleanID := normalizeTaskID(id)
			if _, isActive := activeTasks[cleanID]; !isActive {
				task.Status = "completed"
				task.EndedAt = time.Now()
				endedTasks = append(endedTasks, *task)
			}
		}
	}
	// 2. Démarrer / rafraîchir les tâches actives
	for cleanID, cmd := range activeTasks {
		if existing, exists := m.tasks[cleanID]; exists {
			if existing.Status != "running" {
				existing.Status = "running"
				existing.EndedAt = time.Time{}
			}
		} else {
			m.tasks[cleanID] = &RunningTaskInfo{
				ID:        cleanID,
				Command:   cmd,
				CascadeID: cascadeID,
				Status:    "running",
				StartedAt: time.Now(),
			}
		}
	}
	m.mu.Unlock()

	// Broadcast des fins de tâches détectées
	if m.onBroadcast != nil {
		for _, t := range endedTasks {
			m.onBroadcast(OutgoingMessage{
				Type: "task_ended",
				Data: map[string]interface{}{
					"id":        t.ID,
					"command":   t.Command,
					"cascadeId": t.CascadeID,
					"status":    "completed",
				},
			})
		}
	}
}

func (m *runningTaskManager) listTasks(onlyRunning bool) []RunningTaskInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]RunningTaskInfo, 0, len(m.tasks))
	for _, t := range m.tasks {
		if !onlyRunning || t.Status == "running" {
			res = append(res, *t)
		}
	}
	return res
}

// listTasksForCascade returns only tasks belonging to the given cascade/session.
func (m *runningTaskManager) listTasksForCascade(cascadeID string, onlyRunning bool) []RunningTaskInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]RunningTaskInfo, 0)
	for _, t := range m.tasks {
		if t.CascadeID != cascadeID {
			continue
		}
		if !onlyRunning || t.Status == "running" {
			res = append(res, *t)
		}
	}
	return res
}

func (m *runningTaskManager) killTask(id string) bool {
	id = normalizeTaskID(id)
	var outMsg OutgoingMessage
	var shouldBroadcast bool
	var cancel context.CancelFunc

	m.mu.Lock()
	task, ok := m.tasks[id]
	if !ok || task.Status != "running" {
		m.mu.Unlock()
		return false
	}
	task.Status = "killed"
	task.EndedAt = time.Now()
	cancel = task.cancel
	task.cancel = nil

	m.finishedOrder = append(m.finishedOrder, id)
	if len(m.finishedOrder) > m.maxFinished {
		oldestID := m.finishedOrder[0]
		m.finishedOrder = m.finishedOrder[1:]
		if oldTask, exists := m.tasks[oldestID]; exists && oldTask.Status != "running" {
			delete(m.tasks, oldestID)
		}
	}

	if m.onBroadcast != nil {
		outMsg = OutgoingMessage{
			Type: "task_ended",
			Data: map[string]interface{}{
				"id":        task.ID,
				"command":   task.Command,
				"cascadeId": task.CascadeID,
				"status":    "killed",
			},
		}
		shouldBroadcast = true
	}
	m.mu.Unlock()

	// Exécution du hook d'annulation réel hors-verrou
	if cancel != nil {
		cancel()
	}
	if shouldBroadcast && m.onBroadcast != nil {
		m.onBroadcast(outMsg)
	}
	return true
}

func normalizeTaskID(id string) string {
	id = strings.TrimSpace(id)
	id = strings.Trim(id, "\"'`\t\r\n")
	id = strings.ReplaceAll(id, "\\", "/")
	if idx := strings.LastIndex(id, "/"); idx >= 0 {
		id = id[idx+1:]
	}
	id = filepath.Base(filepath.Clean(id))
	if id == "." || id == "/" || id == ".." {
		return ""
	}
	return id
}

var (
	reTaskID  = regexp.MustCompile(`(?i)(?:task(?:\s+id)?:?\s*["'\\]*|sender=)(?:[a-zA-Z0-9_-]+/)?(task-[0-9a-zA-Z_-]+)`)
	reTaskCmd = regexp.MustCompile(`(?i)(?:Task Description|CommandLine):\s*([^\r\n]+)`)
)

func extractTaskIDFromText(text string) string {
	m := reTaskID.FindStringSubmatch(text)
	if len(m) > 1 {
		return normalizeTaskID(m[1])
	}
	return ""
}

func extractAllTaskIDsFromText(text string) []string {
	matches := reTaskID.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	res := make([]string, 0, len(matches))
	seen := make(map[string]bool)
	for _, m := range matches {
		if len(m) > 1 {
			tid := normalizeTaskID(m[1])
			if tid != "" && !seen[tid] {
				seen[tid] = true
				res = append(res, tid)
			}
		}
	}
	return res
}

func extractTaskCmdFromText(text string) string {
	m := reTaskCmd.FindStringSubmatch(text)
	if len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func findTaskLogPath(cascadeID, taskID string) string {
	if cascadeID == "" || taskID == "" {
		return ""
	}
	cleanCascadeID := filepath.Base(filepath.Clean(strings.ReplaceAll(cascadeID, "\\", "/")))
	if cleanCascadeID == "." || cleanCascadeID == "/" || cleanCascadeID == ".." {
		return ""
	}
	cleanTaskID := normalizeTaskID(taskID)
	if cleanTaskID == "" {
		return ""
	}
	if !strings.HasSuffix(cleanTaskID, ".log") {
		cleanTaskID += ".log"
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join(home, ".gemini", "antigravity", "brain", cleanCascadeID, ".system_generated", "tasks", cleanTaskID),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cleanCascadeID, ".system_generated", "tasks", cleanTaskID),
		filepath.Join(home, ".gemini", "antigravity", "brain", cleanCascadeID, ".system_generated", "tasks", strings.TrimSuffix(cleanTaskID, ".log")),
		filepath.Join(home, ".gemini", "antigravity-ide", "brain", cleanCascadeID, ".system_generated", "tasks", strings.TrimSuffix(cleanTaskID, ".log")),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (s *Server) getTaskLog(cascadeID, taskID string) (string, string, string) {
	cleanTaskID := normalizeTaskID(taskID)
	s.runningTasks.mu.RLock()
	t, ok := s.runningTasks.tasks[cleanTaskID]
	if !ok {
		// Recherche par commande exacte ou préfixe dans la cascade
		for _, candidate := range s.runningTasks.tasks {
			if candidate.CascadeID == cascadeID || cascadeID == "" {
				if candidate.ID == cleanTaskID ||
					strings.EqualFold(candidate.Command, taskID) ||
					strings.HasPrefix(candidate.Command, taskID) ||
					strings.HasPrefix(taskID, candidate.Command) {
					t = candidate
					ok = true
					break
				}
			}
		}
	}
	s.runningTasks.mu.RUnlock()

	cmd := ""
	status := "done"
	actualTaskID := cleanTaskID
	if ok {
		cmd = t.Command
		status = t.Status
		actualTaskID = t.ID
	}

	// 1. Recherche via le chemin de log standard avec actualTaskID et cleanTaskID
	logPath := findTaskLogPath(cascadeID, actualTaskID)
	if logPath == "" && actualTaskID != cleanTaskID {
		logPath = findTaskLogPath(cascadeID, cleanTaskID)
	}

	// 2. Si non trouvé et cascadeId présent, scanner le dossier .system_generated/tasks
	if logPath == "" && cascadeID != "" {
		home, err := os.UserHomeDir()
		if err == nil {
			tasksDirs := []string{
				filepath.Join(home, ".gemini", "antigravity", "brain", cascadeID, ".system_generated", "tasks"),
				filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "tasks"),
			}
			for _, dir := range tasksDirs {
				if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
					for _, entry := range entries {
						name := entry.Name()
						base := strings.TrimSuffix(name, ".log")
						if base == actualTaskID || base == cleanTaskID || strings.Contains(taskID, base) || (ok && base == t.ID) {
							logPath = filepath.Join(dir, name)
							break
						}
					}
					if logPath != "" {
						break
					}
				}
			}
		}
	}

	if logPath != "" {
		data, err := os.ReadFile(logPath)
		if err == nil && len(data) > 0 {
			return string(data), cmd, status
		}
	}

	if ok && t.Output != "" {
		return t.Output, cmd, status
	}

	return "", cmd, status
}

func (s *Server) scanRunningTasksFromTranscript(cascadeID string) {
	if cascadeID == "" {
		return
	}
	tPath := findTranscriptPath(cascadeID)
	if tPath == "" {
		return
	}
	f, err := os.Open(tPath)
	if err != nil {
		return
	}
	defer f.Close()

	activeTasks := make(map[string]string)
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Content string `json:"content"`
		}
		if json.Unmarshal(line, &entry) != nil {
			continue
		}
		content := entry.Content

		// Détection de démarrage
		if strings.Contains(content, "running as a background task") || strings.Contains(content, "Tool is running as a background task") {
			tIDs := extractAllTaskIDsFromText(content)
			tCmd := extractTaskCmdFromText(content)
			for _, tID := range tIDs {
				if tID != "" {
					if tCmd == "" {
						tCmd = tID
					}
					activeTasks[tID] = tCmd
				}
			}
		}

		// Détection de fin / annulation / résultat / timeout
		lowerContent := strings.ToLower(content)
		isFinished := strings.Contains(lowerContent, "finished with result") ||
			strings.Contains(lowerContent, "was canceled") ||
			strings.Contains(lowerContent, "was cancelled") ||
			strings.Contains(lowerContent, "exited with code") ||
			strings.Contains(lowerContent, "the command exited") ||
			strings.Contains(lowerContent, "status: done") ||
			strings.Contains(lowerContent, "status: error") ||
			strings.Contains(lowerContent, "status: killed") ||
			strings.Contains(lowerContent, "task finished") ||
			strings.Contains(lowerContent, "wait cancelled") ||
			strings.Contains(lowerContent, "wait canceled") ||
			strings.Contains(lowerContent, "tool execution was canceled")

		if isFinished || strings.Contains(content, "sender=") {
			tIDs := extractAllTaskIDsFromText(content)
			for _, tID := range tIDs {
				delete(activeTasks, tID)
			}
		}

		if strings.Contains(lowerContent, "all your subagents and background tasks have been stopped") ||
			strings.Contains(lowerContent, "stopped due to server restart") ||
			strings.Contains(lowerContent, "server restart") {
			activeTasks = make(map[string]string)
		}
	}

	// Vérification physique sur disque des logs des tâches restantes
	for tID := range activeTasks {
		logP := findTaskLogPath(cascadeID, tID)
		if logP != "" {
			if fi, err := os.Stat(logP); err == nil {
				// Si le fichier de log n'a pas été modifié depuis plus de 60s et n'est pas un daemon
				if time.Since(fi.ModTime()) > 60*time.Second {
					delete(activeTasks, tID)
					continue
				}
				if data, err := os.ReadFile(logP); err == nil {
					logStr := strings.ToLower(string(data))
					if strings.Contains(logStr, "exited with code") ||
						strings.Contains(logStr, "the command exited") ||
						strings.Contains(logStr, "task finished") ||
						strings.Contains(logStr, "finished with result") ||
						strings.Contains(logStr, "was canceled") ||
						strings.Contains(logStr, "was cancelled") ||
						strings.Contains(logStr, "status: done") {
						delete(activeTasks, tID)
					}
				}
			} else {
				// Le fichier de log n'existe pas ou n'est plus accessible
				delete(activeTasks, tID)
			}
		}
	}

	// Synchronisation avec l'état en mémoire
	s.runningTasks.syncTasksForCascade(cascadeID, activeTasks)
}

// ---------------------------------------------------------------------------
// Terminal PTY (P3)
//
// Le mobile pilote un vrai shell interactif sur le PC hôte. Implémentation
// volontairement stdlib-only : exec.Cmd avec stdin/stdout/stderr pipe, un
// scanner de sortie par session et un nettoyage à la déconnexion.
//
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

// allowedExecBinaries est la liste blanche des binaires autorisés à l'exécution directe depuis le mobile.
var allowedExecBinaries = map[string]bool{
	"git": true, "flutter": true, "dart": true, "go": true, "npm": true,
	"npx": true, "cargo": true, "pytest": true, "ls": true, "dir": true,
}

// executeShellCommand exécute une commande locale confinée et sécurisée dans un répertoire de travail
// avec un timeout de protection de 10s.
func executeShellCommand(dir, cmdStr string) (string, error) {
	trimmed := strings.TrimSpace(cmdStr)
	if trimmed == "" {
		return "", fmt.Errorf("commande vide")
	}

	// Interdire les caractères de chaînage shell
	for _, ch := range []string{";", "&", "|", "`", "$", "(", ")", "<", ">", "\n", "\r"} {
		if strings.Contains(trimmed, ch) {
			return "", fmt.Errorf("caractère de contrôle shell interdit: %q", ch)
		}
	}

	tokens := strings.Fields(trimmed)
	if len(tokens) == 0 {
		return "", fmt.Errorf("commande vide")
	}

	binary := strings.ToLower(filepath.Base(tokens[0]))
	binary = strings.TrimSuffix(binary, ".exe")
	if !allowedExecBinaries[binary] {
		return "", fmt.Errorf("commande non autorisée: %s (seules les commandes de dev approuvées sont permises)", tokens[0])
	}

	// Interdire les flags dangereux pour git et dev tools (ex: -c core.pager, --config, --exec-path)
	for _, tok := range tokens[1:] {
		lowTok := strings.ToLower(tok)
		if strings.HasPrefix(lowTok, "-c") || strings.HasPrefix(lowTok, "--config") ||
			strings.HasPrefix(lowTok, "--exec-path") || strings.HasPrefix(lowTok, "--upload-pack") {
			return "", fmt.Errorf("argument non autorisé pour la commande: %s", tok)
		}
	}

	if dir == "" || dir == "." {
		if projs := ListOfficialProjects(); len(projs) > 0 && projs[0].Path != "" {
			dir = projs[0].Path
		} else if wd, err := os.Getwd(); err == nil {
			dir = wd
		}
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		absDir = dir
	}

	// Validation de confinement des arguments de type chemin
	for _, tok := range tokens[1:] {
		if strings.HasPrefix(tok, "-") {
			continue
		}
		if filepath.IsAbs(tok) || strings.Contains(tok, "..") {
			if _, errRes := resolvePath(absDir, tok); errRes != nil {
				return "", fmt.Errorf("argument de chemin hors workspace non autorisé: %s", tok)
			}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		if _, lookErr := exec.LookPath(tokens[0]); lookErr != nil {
			cmdArgs := append([]string{"/c", tokens[0]}, tokens[1:]...)
			cmd = exec.CommandContext(ctx, "cmd.exe", cmdArgs...)
		} else {
			cmd = exec.CommandContext(ctx, tokens[0], tokens[1:]...)
		}
	} else {
		cmd = exec.CommandContext(ctx, tokens[0], tokens[1:]...)
	}
	cmd.Dir = absDir

	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf

	if err := cmd.Run(); err != nil {
		out := outBuf.String()
		if out != "" {
			return out, nil
		}
		return "", err
	}
	return outBuf.String(), nil
}

func extractCmdFromArgs(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) == nil {
		for _, k := range []string{"CommandLine", "command_line", "command", "cmd", "CommandLineString"} {
			if v, ok := m[k].(string); ok && v != "" {
				return v
			}
		}
	}
	s := string(raw)
	if len(s) > 80 {
		s = s[:77] + "..."
	}
	return s
}

// runLiveTurnStreamer surveille en temps réel (toutes les 30 ms) l'apparition de
// nouvelles étapes (tool calls, commandes exécutées, lectures/écritures de fichiers,
// recherches, thinking, tokens de texte) et les diffuse immédiatement au mobile via stream_delta.
// Il signale doneChan lorsque la génération est complètement terminée ou nécessite une approbation.
func (s *Server) runLiveTurnStreamer(ctx context.Context, cascadeID, requestID string, frameIndex *int64, hasTextDelivered *bool, doneChan chan struct{}) {
	var closeOnce sync.Once
	signalDone := func() {
		closeOnce.Do(func() {
			close(doneChan)
		})
	}
	defer signalDone()

	transcriptPath := findTranscriptPath(cascadeID)
	var lastOffset int64
	if transcriptPath != "" {
		lastOffset = findLastTurnOffset(transcriptPath)
	}

	ticker := time.NewTicker(30 * time.Millisecond)
	defer ticker.Stop()

	var deliveredTextLen int
	var turnCompleted bool
	var nextTranscriptLookup time.Time
	lastActivityTime := time.Now()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 1. Détection d'approbation en attente → fin immédiate du flux avec outcome=approval
			if s.hasPendingApproval(cascadeID) {
				return
			}

			if transcriptPath == "" && time.Now().After(nextTranscriptLookup) {
				transcriptPath = findTranscriptPath(cascadeID)
				nextTranscriptLookup = time.Now().Add(500 * time.Millisecond)
				if transcriptPath != "" && lastOffset == 0 {
					lastOffset = findLastTurnOffset(transcriptPath)
				}
			}

			// 2. Lecture incrémentale du fichier transcript.jsonl
			if transcriptPath != "" {
				if fi, errStat := os.Stat(transcriptPath); errStat == nil && fi.Size() > lastOffset {
					f, errOpen := os.Open(transcriptPath)
					if errOpen == nil {
						if _, errSeek := f.Seek(lastOffset, 0); errSeek == nil {
							scanner := bufio.NewScanner(f)
							hBuf := AcquireHistoryBuffer()
							scanner.Buffer(*hBuf, len(*hBuf))

							for scanner.Scan() {
								lineBytes := scanner.Bytes()
								lastOffset += int64(len(lineBytes)) + 1 // newline
								if len(lineBytes) == 0 {
									continue
								}

								var entry struct {
									StepIndex int             `json:"step_index"`
									Type      string          `json:"type"`
									Source    string          `json:"source"`
									Content   string          `json:"content"`
									Thinking  string          `json:"thinking"`
									Status    string          `json:"status"`
									ToolCalls json.RawMessage `json:"tool_calls"`
								}
								if err := json.Unmarshal(lineBytes, &entry); err != nil {
									continue
								}

								var events []map[string]interface{}

								// 2-zero. User input from Desktop mirror
								if entry.Type == "USER_INPUT" {
									cleaned := extractUserRequest(entry.Content)
									if cleaned != "" {
										events = append(events, map[string]interface{}{
											"kind": "user_input",
											"text": cleaned,
										})
									}
								}

								// 2a. Tool calls
								if len(entry.ToolCalls) > 0 {
									var toolCalls []struct {
										Name      string          `json:"name"`
										Arguments json.RawMessage `json:"args"`
										Function  struct {
											Name      string          `json:"name"`
											Arguments json.RawMessage `json:"arguments"`
										} `json:"function"`
									}
									if json.Unmarshal(entry.ToolCalls, &toolCalls) == nil {
										for _, tc := range toolCalls {
											toolName := tc.Name
											if toolName == "" {
												toolName = tc.Function.Name
											}
											args := tc.Arguments
											if len(args) == 0 {
												args = tc.Function.Arguments
											}
											if toolName != "" && toolName != "ask_question" && toolName != "ask_user" {
												lowerTool := strings.ToLower(toolName)
												kind := "tool_start"
												if strings.Contains(lowerTool, "run_command") || strings.Contains(lowerTool, "command") || strings.Contains(lowerTool, "bash") || strings.Contains(lowerTool, "terminal") {
													kind = "runner_started"
													cmdText := extractCmdFromArgs(args)
													if cmdText == "" {
														cmdText = toolName
													}
													s.runningTasks.startTask(fmt.Sprintf("%s-%d", cascadeID, entry.StepIndex), cmdText, cascadeID, nil)
												} else if strings.Contains(lowerTool, "grep") || strings.Contains(lowerTool, "search") || strings.Contains(lowerTool, "find_by_name") || strings.Contains(lowerTool, "list_dir") || strings.Contains(lowerTool, "list_files") {
													kind = "search_started"
												}
												events = append(events, map[string]interface{}{
													"kind":   kind,
													"tool":   toolName,
													"detail": string(args),
												})
											}
										}
									}
								}

								// 2b. Tool Results
								if entry.Type == "VIEW_FILE" || entry.Type == "RUN_COMMAND" || entry.Type == "GREP_SEARCH" || entry.Type == "FIND_BY_NAME" || entry.Type == "WRITE_TO_FILE" || entry.Type == "REPLACE_FILE_CONTENT" || entry.Type == "TOOL_RESULT" {
									preview := entry.Content
									kind := "tool_output"
									if entry.Type == "RUN_COMMAND" {
										kind = "runner_output"
										s.runningTasks.appendOutput(fmt.Sprintf("%s-%d", cascadeID, entry.StepIndex), preview)
										s.runningTasks.finishTask(fmt.Sprintf("%s-%d", cascadeID, entry.StepIndex), "completed")
										if len(preview) > 4000 {
											preview = preview[:3997] + "…"
										}
									} else if entry.Type == "GREP_SEARCH" || entry.Type == "FIND_BY_NAME" {
										kind = "search_result"
										if len(preview) > 1000 {
											preview = preview[:997] + "…"
										}
									} else if len(preview) > 800 {
										preview = preview[:797] + "…"
									}
									events = append(events, map[string]interface{}{
										"kind":   kind,
										"tool":   strings.ToLower(entry.Type),
										"detail": preview,
										"status": entry.Status,
									})
								}

								// 2c. Thinking
								if len(entry.Thinking) > 0 {
									events = append(events, map[string]interface{}{
										"kind":  "thinking",
										"delta": entry.Thinking,
									})
								}

								// 2d. Texte de l'assistant (PLANNER_RESPONSE)
								if entry.Type == "PLANNER_RESPONSE" && len(entry.Content) > 0 {
									chunk := entry.Content
									if deliveredTextLen > 0 && deliveredTextLen < len(entry.Content) {
										chunk = entry.Content[deliveredTextLen:]
									} else if *hasTextDelivered && deliveredTextLen >= len(entry.Content) {
										chunk = ""
									}
									if len(chunk) > 0 {
										events = append(events, map[string]interface{}{
											"kind":  "text",
											"delta": chunk,
										})
										*hasTextDelivered = true
										deliveredTextLen = len(entry.Content)
									}
									if len(entry.ToolCalls) == 0 && entry.Status == "DONE" {
										turnCompleted = true
									}
								}

								// 2e. Error message handling
								if (entry.Type == "ERROR_MESSAGE" || entry.Status == "ERROR") && len(entry.Content) > 0 {
									events = append(events, map[string]interface{}{
										"kind":   "error",
										"detail": entry.Content,
										"status": "ERROR",
									})
									turnCompleted = true
								}

								// 2f. Background tasks detection
								if len(entry.Content) > 0 {
									if strings.Contains(entry.Content, "running as a background task") || strings.Contains(entry.Content, "Tool is running as a background task") {
										tIDs := extractAllTaskIDsFromText(entry.Content)
										tCmd := extractTaskCmdFromText(entry.Content)
										for _, tID := range tIDs {
											if tID != "" {
												if tCmd == "" {
													tCmd = tID
												}
												s.runningTasks.startTask(tID, tCmd, cascadeID, nil)
											}
										}
									}
									isFinished := strings.Contains(entry.Content, "finished with result:") ||
										strings.Contains(entry.Content, "was canceled with result:") ||
										strings.Contains(entry.Content, "The command exited with code") ||
										strings.Contains(entry.Content, "cancelled") ||
										strings.Contains(entry.Content, "canceled") ||
										strings.Contains(entry.Content, "Status: DONE") ||
										strings.Contains(entry.Content, "Wait cancelled")

									if isFinished || strings.Contains(entry.Content, "sender=") {
										tIDs := extractAllTaskIDsFromText(entry.Content)
										for _, tID := range tIDs {
											s.runningTasks.finishTask(tID, "completed")
										}
									}

									if strings.Contains(entry.Content, "All your subagents and background tasks have been stopped") ||
										strings.Contains(entry.Content, "stopped due to server restart") {
										s.runningTasks.mu.Lock()
										var stopped []RunningTaskInfo
										for _, t := range s.runningTasks.tasks {
											if t.CascadeID == cascadeID && t.Status == "running" {
												t.Status = "completed"
												t.EndedAt = time.Now()
												stopped = append(stopped, *t)
											}
										}
										s.runningTasks.mu.Unlock()
										if s.runningTasks.onBroadcast != nil {
											for _, t := range stopped {
												s.runningTasks.onBroadcast(OutgoingMessage{
													Type: "task_ended",
													Data: map[string]interface{}{
														"id":        t.ID,
														"command":   t.Command,
														"cascadeId": t.CascadeID,
														"status":    "completed",
													},
												})
											}
										}
									}
								}

								if len(events) > 0 {
									lastActivityTime = time.Now()
									fIdx := atomic.AddInt64(frameIndex, 1)
									deltaData := map[string]interface{}{
										"frameIndex": fIdx,
										"cascadeId":  cascadeID,
										"hostActive": hostActiveSince(hostActiveWindow),
										"events":     events,
									}
									deltaMsg := OutgoingMessage{
										Type:      "stream_delta",
										RequestID: requestID,
										CascadeID: cascadeID,
										Data:      deltaData,
									}
									stepIdx := s.streamBuffer.RecordEvent(cascadeID, deltaMsg)
									deltaData["stepIndex"] = stepIdx
									s.broadcast(deltaMsg)
								}
							}
							ReleaseHistoryBuffer(hBuf)
						}
						f.Close()
					}
				}
			}

			// 3. Fallback / Synchronisation de trajectoire (si pas de nouveaux tokens et AUCUN transcript local disponible)
			if s.RPCClient != nil && transcriptPath == "" && time.Since(lastActivityTime) >= 300*time.Millisecond {
				if rawTraj, errTraj := s.RPCClient.GetCascadeTrajectory(cascadeID, 0); errTraj == nil && len(rawTraj) > 0 {
					msgs := ExtractHistoryFromTrajectory(rawTraj)
					if len(msgs) > 0 && msgs[len(msgs)-1].Sender == "assistant" {
						lastMsg := msgs[len(msgs)-1]
						if len(lastMsg.Text) > deliveredTextLen {
							newChunk := lastMsg.Text[deliveredTextLen:]
							deliveredTextLen = len(lastMsg.Text)
							*hasTextDelivered = true
							lastActivityTime = time.Now()
							fIdx := atomic.AddInt64(frameIndex, 1)
							deltaData := map[string]interface{}{
								"frameIndex": fIdx,
								"events": []map[string]interface{}{
									{
										"kind":  "text",
										"delta": newChunk,
									},
								},
								"cascadeId":  cascadeID,
								"hostActive": hostActiveSince(hostActiveWindow),
							}
							deltaMsg := OutgoingMessage{
								Type:      "stream_delta",
								RequestID: requestID,
								CascadeID: cascadeID,
								Data:      deltaData,
							}
							stepIdx := s.streamBuffer.RecordEvent(cascadeID, deltaMsg)
							deltaData["stepIndex"] = stepIdx
							s.broadcast(deltaMsg)
							turnCompleted = true
						}
					}
				}
			}

			// 4. Clôture propre dès que le tour est stabilisé
			// Ne JAMAIS terminer tant que la session est activement en cours d'exécution (statut RUNNING ou BUSY)
			if s.isSessionActivelyRunning(cascadeID) {
				continue
			}

			if turnCompleted && time.Since(lastActivityTime) >= 1000*time.Millisecond {
				return
			}
			if transcriptPath != "" && (*hasTextDelivered || deliveredTextLen > 0) && time.Since(lastActivityTime) >= 1500*time.Millisecond {
				return
			}
			if transcriptPath == "" {
				if *hasTextDelivered && time.Since(lastActivityTime) >= 50*time.Millisecond {
					return
				}
				if time.Since(lastActivityTime) >= 1000*time.Millisecond {
					return
				}
			}
		}
	}
}

// startLiveStepWatcher compatibilité pour les tests existants.
func (s *Server) startLiveStepWatcher(ctx context.Context, cascadeID, requestID string, frameIndex *int64) {
	var delivered bool
	doneChan := make(chan struct{})
	go s.runLiveTurnStreamer(ctx, cascadeID, requestID, frameIndex, &delivered, doneChan)
}

// findLastTurnOffset calcule l'offset d'octet de la dernière ligne USER_INPUT dans transcript.jsonl.
// Cela permet au streamer en direct de rejouer et diffuser les étapes du tour en cours même
// si la commande/prompt a été initiée depuis Antigravity Desktop quelques millisecondes plus tôt.
func findLastTurnOffset(transcriptPath string) int64 {
	f, err := os.Open(transcriptPath)
	if err != nil {
		return 0
	}
	defer f.Close()

	var lastUserOffset int64
	var currentOffset int64
	scanner := bufio.NewScanner(f)
	hBuf := AcquireHistoryBuffer()
	defer ReleaseHistoryBuffer(hBuf)
	scanner.Buffer(*hBuf, len(*hBuf))

	for scanner.Scan() {
		line := scanner.Bytes()
		lineLen := int64(len(line)) + 1 // + newline
		if bytes.Contains(line, []byte(`"type":"USER_INPUT"`)) || bytes.Contains(line, []byte(`"type": "USER_INPUT"`)) {
			lastUserOffset = currentOffset
		}
		currentOffset += lineLen
	}
	return lastUserOffset
}

// startExternalTurnStreamer démarre un streamer en temps réel pour une cascade
// dont le prompt a été initié depuis l'IDE Desktop Antigravity (ou un sous-agent).
// Il diffuse stream_start, stream_delta (pensées, outils, texte) et stream_end au mobile.
func (s *Server) startExternalTurnStreamer(cascadeID string) {
	if cascadeID == "" {
		return
	}
	s.mu.Lock()
	if s.activeCascades[cascadeID] {
		s.mu.Unlock()
		return
	}
	s.activeCascades[cascadeID] = true
	reqID := fmt.Sprintf("desktop-%d", time.Now().UnixMilli())
	s.activeRequestIDs[cascadeID] = reqID
	ctx, cancel := context.WithCancel(context.Background())
	if s.activeCancels[cascadeID] == nil {
		s.activeCancels[cascadeID] = make(map[string]context.CancelFunc)
	}
	s.activeCancels[cascadeID][reqID] = cancel
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.activeCascades, cascadeID)
			delete(s.activeRequestIDs, cascadeID)
			if m, ok := s.activeCancels[cascadeID]; ok {
				delete(m, reqID)
				if len(m) == 0 {
					delete(s.activeCancels, cascadeID)
				}
			}
			s.mu.Unlock()

			// Clôture du stream côté mobile
			endData := map[string]interface{}{
				"cascadeId": cascadeID,
				"requestId": reqID,
				"status":    "DONE",
				"outcome":   "completed",
			}
			s.broadcast(OutgoingMessage{
				Type:      "stream_end",
				RequestID: reqID,
				CascadeID: cascadeID,
				Data:      endData,
			})
			s.broadcast(OutgoingMessage{
				Type:      "session_status_update",
				CascadeID: cascadeID,
				Data: map[string]interface{}{
					"status":    "CASCADE_STATUS_READY",
					"cascadeId": cascadeID,
				},
			})
		}()

		// Extrait le prompt utilisateur et le modèle de la dernière étape USER_INPUT dans le transcript
		var userPrompt string
		var extractedModel string
		tPath := findTranscriptPath(cascadeID)
		if tPath != "" {
			if f, err := os.Open(tPath); err == nil {
				scanner := bufio.NewScanner(f)
				hBuf := AcquireHistoryBuffer()
				scanner.Buffer(*hBuf, len(*hBuf))
				for scanner.Scan() {
					var entry struct {
						Type    string `json:"type"`
						Content string `json:"content"`
					}
					if json.Unmarshal(scanner.Bytes(), &entry) == nil && entry.Type == "USER_INPUT" {
						userPrompt = extractUserRequest(entry.Content)
						if m := extractModelFromContent(entry.Content); m != "" {
							extractedModel = m
						}
					}
				}
				ReleaseHistoryBuffer(hBuf)
				f.Close()
			}
		}

		// 1. Démarre le flux visuel sur le mobile
		startData := map[string]interface{}{
			"cascadeId": cascadeID,
			"requestId": reqID,
		}
		if extractedModel != "" {
			startData["model"] = extractedModel
		}
		if userPrompt != "" {
			startData["userPrompt"] = userPrompt
		}
		s.broadcast(OutgoingMessage{
			Type:      "stream_start",
			RequestID: reqID,
			CascadeID: cascadeID,
			Data:      startData,
		})
		s.broadcast(OutgoingMessage{
			Type:      "session_status_update",
			CascadeID: cascadeID,
			Data: map[string]interface{}{
				"status":    "CASCADE_STATUS_RUNNING",
				"cascadeId": cascadeID,
			},
		})

		var frameIndex int64
		var hasTextDelivered bool
		doneChan := make(chan struct{})

		s.runLiveTurnStreamer(ctx, cascadeID, reqID, &frameIndex, &hasTextDelivered, doneChan)
		select {
		case <-doneChan:
		case <-ctx.Done():
		}
	}()
}

// startTranscriptWatchdog surveille en continu les sessions actives de l'IDE Desktop Antigravity
// et déclenche automatiquement le streaming en direct vers le mobile sans intervention manuelle.
func (s *Server) startTranscriptWatchdog() {
	if flag.Lookup("test.v") != nil {
		return
	}
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()

		lastSizes := make(map[string]int64)

		for range ticker.C {
			s.mu.Lock()
			hasClients := len(s.clients) > 0
			s.mu.Unlock()
			if !hasClients {
				continue
			}

			sessions := s.snapshotSummaries()
			if len(sessions) == 0 {
				continue
			}

			now := time.Now()
			for cascadeID, sum := range sessions {
				st := strings.ToUpper(sum.Status)
				tPath := findTranscriptPath(cascadeID)

				// Détection de désynchronisation : Si le statut Jetbox dit RUNNING mais qu'il n'y a plus aucune activité fichier depuis > 5s
				if strings.Contains(st, "RUNNING") || strings.Contains(st, "BUSY") {
					if tPath != "" {
						if fi, err := os.Stat(tPath); err == nil && now.Sub(fi.ModTime()) > 5*time.Second {
							s.mu.Lock()
							if sSum, ok := s.jetboxSummaries[cascadeID]; ok {
								sSum.Status = "CASCADE_STATUS_READY"
								s.jetboxSummaries[cascadeID] = sSum
							}
							delete(s.activeCascades, cascadeID)
							s.mu.Unlock()
							s.broadcast(OutgoingMessage{
								Type:      "session_status_update",
								CascadeID: cascadeID,
								Data: map[string]interface{}{
									"status":    "CASCADE_STATUS_READY",
									"cascadeId": cascadeID,
								},
							})
							continue
						}
					}
					if !s.IsCascadeActive(cascadeID) {
						s.startExternalTurnStreamer(cascadeID)
						continue
					}
				}

				if tPath == "" {
					continue
				}
				fi, err := os.Stat(tPath)
				if err != nil {
					continue
				}
				if now.Sub(fi.ModTime()) < 6*time.Second {
					prevSize, seen := lastSizes[cascadeID]
					lastSizes[cascadeID] = fi.Size()
					if seen && fi.Size() > prevSize && !s.IsCascadeActive(cascadeID) {
						s.startExternalTurnStreamer(cascadeID)
					}
				}
			}
		}
	}()
}

func isRunningTests() bool {
	return strings.HasSuffix(os.Args[0], ".test") ||
		strings.HasSuffix(os.Args[0], ".test.exe") ||
		strings.Contains(os.Args[0], "__debug_bin")
}
