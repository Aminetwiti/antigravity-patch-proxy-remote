package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"os"
	"strings"
)

// TokenManager centralise la génération, la résolution et la validation des jetons d'authentification.
type TokenManager struct {
	expectedToken string
	isGenerated   bool
}

// NewTokenManager résout le token selon la priorité :
// 1. Variable d'environnement AG_REMOTE_AUTH_TOKEN ou AG_DAEMON_AUTH_TOKEN
// 2. Valeur passée en argument CLI (--auth-token) si non vide et différente de placeholder
// 3. Génération cryptographique aléatoire (CSPRNG 32 hex chars = 128 bits d'entropie)
func NewTokenManager(flagToken string) (*TokenManager, string, error) {
	token := strings.TrimSpace(os.Getenv("AG_AUTH_TOKEN"))
	if token == "" {
		token = strings.TrimSpace(os.Getenv("AG_REMOTE_AUTH_TOKEN"))
	}
	if token == "" {
		token = strings.TrimSpace(os.Getenv("AG_DAEMON_AUTH_TOKEN"))
	}

	if token == "" && flagToken != "" && flagToken != "mysecret" {
		token = strings.TrimSpace(flagToken)
	}

	// Permettre la désactivation explicite de l'authentification (ex: --auth-token none)
	if strings.EqualFold(token, "none") || strings.EqualFold(token, "disabled") || strings.EqualFold(token, "off") || strings.EqualFold(token, "false") || token == "0" {
		return &TokenManager{
			expectedToken: "",
			isGenerated:   false,
		}, "", nil
	}

	isGenerated := false
	if token == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return nil, "", errors.New("échec de génération aléatoire du token CSPRNG")
		}
		token = hex.EncodeToString(b)
		isGenerated = true
	}

	return &TokenManager{
		expectedToken: token,
		isGenerated:   isGenerated,
	}, token, nil
}

// IsDisabled indique si l'authentification a été désactivée.
func (m *TokenManager) IsDisabled() bool {
	return m.expectedToken == ""
}

// IsGenerated indique si le token a été généré dynamiquement au démarrage.
func (m *TokenManager) IsGenerated() bool {
	return m.isGenerated
}

// ExpectedToken retourne le token attendu pour affichage sécurisé (QR code / log).
func (m *TokenManager) ExpectedToken() string {
	return m.expectedToken
}

// Validate effectue une comparaison en temps constant pour prévenir les timing attacks (CWE-208).
func (m *TokenManager) Validate(receivedToken string) bool {
	if m.expectedToken == "" {
		return true
	}
	received := strings.TrimSpace(receivedToken)
	// Normalisation pour Bearer prefix
	if strings.HasPrefix(strings.ToLower(received), "bearer ") {
		received = strings.TrimSpace(received[7:])
	}
	return subtle.ConstantTimeCompare([]byte(m.expectedToken), []byte(received)) == 1
}
