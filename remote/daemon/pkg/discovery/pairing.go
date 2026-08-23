package discovery

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrLockedOut  = errors.New("trop de tentatives échouées, temporairement verrouillé")
	ErrInvalidPIN = errors.New("code PIN invalide")
	ErrExpiredPIN = errors.New("code PIN expiré")
)

type SessionInfo struct {
	DeviceID        string    `json:"deviceId"`
	Name            string    `json:"name,omitempty"`
	AllowedProjects []string  `json:"allowedProjects,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
	// Admin : appareil administrateur (r�vocation des autres devices).
	// Seul le premier appairage d'un device (ou un appel explicite) peut
	// l'activer : un device ne peut jamais se promouvoir via /pair.
	Admin bool `json:"admin,omitempty"`
	// IP : adresse d'origine du device (extractIP(remoteAddr) au pairing).
	IP string `json:"ip,omitempty"`
}

type attemptRecord struct {
	count       int
	lockedUntil time.Time
}

// PairingManager gère l'appairage par code PIN éphémère 6 chiffres (P4).
// Il génère un PIN à durée de vie courte (60s), échange le PIN valide contre
// un jeton de session cryptographique (256 bits), et protège contre les
// attaques par force brute avec un verrouillage exponentiel/durée fixe après 5 échecs.
type PairingManager struct {
	mu              sync.RWMutex
	currentPIN      string
	pinExpiresAt    time.Time
	pinTTL          time.Duration
	sessions        map[string]SessionInfo
	attempts        map[string]*attemptRecord
	maxAttempts     int
	lockoutDuration time.Duration
	sessionTTL      time.Duration
	// SEC-03 : budget global de tentatives pour le PIN courant, toutes sources
	// confondues. La clé de verrouillage est l'IP seule — le deviceId étant
	// contrôlé par le client, sa rotation offrait 5 essais neufs à chaque
	// requête. À l'épuisement du budget : régénération immédiate du PIN et gel
	// des tentatives jusqu'à la fin du TTL courant (plafond ~30 essais/min).
	globalAttempts    int
	globalMaxAttempts int
	globalLockUntil   time.Time
	// AllowFirstAdmin : le premier device pairé ne devient Admin que si l'hôte
	// l'a explicitement autorisé (flag --allow-first-admin). Sinon, la
	// promotion passe exclusivement par PromoteAdmin (action hôte). Un scanner
	// Internet qui devine le PIN sur le tunnel public ne gagne donc PAS les
	// droits Admin (shell/PTY/révocation).
	AllowFirstAdmin bool
}

func NewPairingManager() *PairingManager {
	pm := &PairingManager{
		pinTTL:            60 * time.Second,
		sessions:          make(map[string]SessionInfo),
		attempts:          make(map[string]*attemptRecord),
		maxAttempts:       5,
		lockoutDuration:   5 * time.Minute,
		sessionTTL:        30 * 24 * time.Hour, // session 30 jours
		globalMaxAttempts: 30,
	}
	pm.GeneratePIN()
	return pm
}

// regeneratePINLocked remplace le PIN courant et réarme le budget global de
// tentatives. À appeler sous pm.mu exclusivement.
func (pm *PairingManager) regeneratePINLocked() {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		pm.currentPIN = ""
		return
	}
	pm.currentPIN = fmt.Sprintf("%06d", n.Int64())
	pm.pinExpiresAt = time.Now().Add(pm.pinTTL)
	pm.globalAttempts = 0
	pm.globalLockUntil = time.Time{}
}

// GeneratePIN génère un nouveau code à 6 chiffres aléatoire cryptographique.
func (pm *PairingManager) GeneratePIN() string {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	pm.regeneratePINLocked()
	return pm.currentPIN
}

// CurrentPIN retourne le PIN actif et sa durée de validité restante.
// Si le PIN est expiré, un nouveau PIN est automatiquement généré.
func (pm *PairingManager) CurrentPIN() (string, time.Duration) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	if time.Now().After(pm.pinExpiresAt) || pm.currentPIN == "" {
		pm.regeneratePINLocked()
	}
	return pm.currentPIN, time.Until(pm.pinExpiresAt)
}

// VerifyPIN valide le PIN soumis par un client (identifié par ip / deviceId).
// En cas de succès, génère un jeton de session cryptographique et reset les tentatives.
// allowedProjects (optionnel) restreint le device aux projets donnés (scope 3.3).
func (pm *PairingManager) VerifyPIN(remoteAddr, pin, deviceID string, allowedProjects ...[]string) (string, time.Time, error) {
	// SEC-03 : la clé de verrouillage est l'IP seule. Le deviceId est fourni
	// par le client : l'inclure dans la clé permettait de contourner le
	// verrou en tournant les identifiants.
	ip := extractIP(remoteAddr)
	attemptKey := ip

	pm.mu.Lock()
	defer pm.mu.Unlock()

	var allowed []string
	if len(allowedProjects) > 0 {
		allowed = allowedProjects[0]
	}

	now := time.Now()

	// 0. Gel global : budget de tentatives épuisé pour ce PIN (SEC-03)
	if now.Before(pm.globalLockUntil) {
		return "", time.Time{}, fmt.Errorf("%w (nouveau PIN requis, réessayez dans %v)", ErrLockedOut, time.Until(pm.globalLockUntil).Round(time.Second))
	}

	// 1. Vérification anti-brute-force (par IP)
	rec := pm.attempts[attemptKey]
	if rec != nil {
		if now.Before(rec.lockedUntil) {
			return "", time.Time{}, fmt.Errorf("%w (réessayez dans %v)", ErrLockedOut, time.Until(rec.lockedUntil).Round(time.Second))
		}
		if now.After(rec.lockedUntil) && rec.count >= pm.maxAttempts {
			// Verrouillage expiré : reset
			delete(pm.attempts, attemptKey)
			rec = nil
		}
	}

	// 2. Vérification de l'expiration du PIN
	if now.After(pm.pinExpiresAt) {
		return "", time.Time{}, ErrExpiredPIN
	}

	// 3. Comparaison en temps constant pour éviter les attaques temporelles
	match := subtle.ConstantTimeCompare([]byte(strings.TrimSpace(pin)), []byte(pm.currentPIN)) == 1

	if !match {
		if rec == nil {
			rec = &attemptRecord{}
			pm.attempts[attemptKey] = rec
		}
		rec.count++
		pm.globalAttempts++
		if rec.count >= pm.maxAttempts {
			rec.lockedUntil = now.Add(pm.lockoutDuration)
		}
		// Budget global épuisé : nouveau PIN + gel jusqu'à la fin du TTL.
		if pm.globalAttempts >= pm.globalMaxAttempts {
			pm.regeneratePINLocked()
			pm.globalLockUntil = pm.pinExpiresAt
			return "", time.Time{}, fmt.Errorf("%w : %d tentatives échouées, nouveau PIN généré", ErrLockedOut, pm.globalMaxAttempts)
		}
		if rec.lockedUntil.After(now) {
			return "", time.Time{}, fmt.Errorf("%w : %d tentatives échouées, verrouillé pendant %v", ErrLockedOut, rec.count, pm.lockoutDuration)
		}
		return "", time.Time{}, fmt.Errorf("%w (%d/%d tentatives restantes)", ErrInvalidPIN, pm.maxAttempts-rec.count, pm.maxAttempts)
	}

	// 4. Succès : reset des tentatives et génération du token de session
	delete(pm.attempts, attemptKey)
	pm.globalAttempts = 0

	tokenBytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, tokenBytes); err != nil {
		return "", time.Time{}, fmt.Errorf("erreur de génération de jeton: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := now.Add(pm.sessionTTL)

	// SEC-03 : premier pairé = Admin uniquement si l'hôte l'a autorisé.
	isAdmin := false
	if len(pm.sessions) == 0 {
		isAdmin = pm.AllowFirstAdmin
	} else {
		isAdmin = pm.hasAdminSessionLocked(deviceID)
	}

	pm.sessions[token] = SessionInfo{
		DeviceID:        deviceID,
		Name:            "",
		AllowedProjects: allowed,
		CreatedAt:       now,
		ExpiresAt:       expiresAt,
		Admin:           isAdmin,
		IP:              ip,
	}

	// Régénérer un nouveau PIN immédiatement après un appairage réussi
	pm.regeneratePINLocked()

	return token, expiresAt, nil
}

// PromoteAdmin élève un device appairé au rang d'administrateur. Action
// réservée à l'hôte (console/outil local) — jamais exposée via /pair.
func (pm *PairingManager) PromoteAdmin(deviceID string) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	promoted := false
	now := time.Now()
	for token, sess := range pm.sessions {
		if sess.DeviceID == deviceID && now.Before(sess.ExpiresAt) {
			sess.Admin = true
			pm.sessions[token] = sess
			promoted = true
		}
	}
	return promoted
}

// ValidateSession retourne les infos de session si le jeton est valide et non
// expiré. Retourne (SessionInfo{}, false) sinon. C'est l'équivalent enrichi de
// ValidateToken : le gateway en a besoin pour filtrer par projet (3.3).
func (pm *PairingManager) ValidateSession(token string) (SessionInfo, bool) {
	if token == "" {
		return SessionInfo{}, false
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()

	sess, ok := pm.sessions[token]
	if !ok {
		return SessionInfo{}, false
	}
	if !time.Now().Before(sess.ExpiresAt) {
		delete(pm.sessions, token)
		return SessionInfo{}, false
	}
	return sess, true
}

// RevokeDevice invalide tous les jetons de session d'un device donné (équivalent
// removeDevice du backend Node). Retourne false si aucun jeton n'a été révoqué.
func (pm *PairingManager) RevokeDevice(deviceID string) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	revoked := false
	for token, sess := range pm.sessions {
		if sess.DeviceID == deviceID {
			delete(pm.sessions, token)
			revoked = true
		}
	}
	return revoked
}

// hasAdminSessionLocked rapporte si un device possède déjà une session Admin active.
func (pm *PairingManager) hasAdminSessionLocked(deviceID string) bool {
	if deviceID == "" {
		return false
	}
	now := time.Now()
	for _, sess := range pm.sessions {
		if sess.DeviceID == deviceID && sess.Admin && now.Before(sess.ExpiresAt) {
			return true
		}
	}
	return false
}

// ListSessions retourne la liste des sessions actives (pour /admin/devices).
func (pm *PairingManager) ListSessions() []SessionInfo {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	out := make([]SessionInfo, 0, len(pm.sessions))
	for token, sess := range pm.sessions {
		if now.Before(sess.ExpiresAt) {
			out = append(out, sess)
		} else {
			delete(pm.sessions, token)
		}
	}
	return out
}

// ValidateToken vérifie si un jeton de session est valide et non expiré.
func (pm *PairingManager) ValidateToken(token string) bool {
	if token == "" {
		return false
	}
	pm.mu.Lock()
	defer pm.mu.Unlock()

	sess, ok := pm.sessions[token]
	if !ok {
		return false
	}
	if !time.Now().Before(sess.ExpiresAt) {
		delete(pm.sessions, token)
		return false
	}
	return true
}

// HTTPHandler expose l'endpoint de pairing pour le client mobile (POST /pair).
func (pm *PairingManager) HTTPHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if r.Method == http.MethodGet {
			// Sécurité : le PIN ne doit jamais être exposé via HTTP (uniquement console hôte)
			http.Error(w, `{"error":"Méthode non autorisée"}`, http.StatusMethodNotAllowed)
			return
		}

		if r.Method == http.MethodDelete {
			// Sécurité (VULN-06) : la révocation exige une authentification session avec droits Admin.
			token := r.URL.Query().Get("token")
			if token == "" {
				authHeader := r.Header.Get("Authorization")
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
			sess, ok := pm.ValidateSession(token)
			if !ok {
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Authentification requise"})
				return
			}
			if !sess.Admin {
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]string{"error": "Action réservée à l'administrateur"})
				return
			}

			// Révocation d'un device : DELETE /pair?deviceId=xxx (admin hôte).
			deviceID := r.URL.Query().Get("deviceId")
			if deviceID == "" {
				http.Error(w, `{"error":"deviceId requis"}`, http.StatusBadRequest)
				return
			}
			if pm.RevokeDevice(deviceID) {
				json.NewEncoder(w).Encode(map[string]interface{}{"status": "revoked", "deviceId": deviceID})
			} else {
				json.NewEncoder(w).Encode(map[string]interface{}{"status": "not_found", "deviceId": deviceID})
			}
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"Méthode non autorisée"}`, http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			PIN             string   `json:"pin"`
			DeviceID        string   `json:"deviceId"`
			Name            string   `json:"name,omitempty"`
			AllowedProjects []string `json:"allowedProjects,omitempty"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Corps JSON invalide"})
			return
		}

		token, expiresAt, err := pm.VerifyPIN(r.RemoteAddr, req.PIN, req.DeviceID, req.AllowedProjects)
		if err != nil {
			status := http.StatusUnauthorized
			if errors.Is(err, ErrLockedOut) || strings.Contains(err.Error(), ErrLockedOut.Error()) {
				status = http.StatusTooManyRequests
			}
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		// On stocke aussi le nom du device (utile pour le futur /admin/devices).
		pm.mu.Lock()
		if sess, ok := pm.sessions[token]; ok {
			sess.Name = req.Name
			pm.sessions[token] = sess
		}
		pm.mu.Unlock()

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"token":     token,
			"expiresAt": expiresAt.Format(time.RFC3339),
			"status":    "paired",
		})
	}
}

func extractIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}
