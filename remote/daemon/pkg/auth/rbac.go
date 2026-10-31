package auth

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"sync"
)

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleUser     Role = "user"
	RoleReadOnly Role = "readonly"
)

var (
	ErrUnauthorized = errors.New("authentication failed: invalid or missing token")
	ErrForbidden    = errors.New("forbidden: insufficient permissions for this resource")
)

type Identity struct {
	UserID string `json:"userId"`
	Role   Role   `json:"role"`
	Token  string `json:"-"`
}

type RBACManager struct {
	mu           sync.RWMutex
	adminToken   string
	tokens       map[string]*Identity // token -> identity
	users        map[string]*Identity // userId -> identity
	authDisabled bool
}

func NewRBACManager(adminToken string) *RBACManager {
	cleanAdminToken := strings.TrimSpace(adminToken)
	disabled := cleanAdminToken == "" || strings.EqualFold(cleanAdminToken, "none") || strings.EqualFold(cleanAdminToken, "disabled")

	mgr := &RBACManager{
		adminToken:   cleanAdminToken,
		tokens:       make(map[string]*Identity),
		users:        make(map[string]*Identity),
		authDisabled: disabled,
	}

	if !disabled {
		adminIdent := &Identity{
			UserID: "admin",
			Role:   RoleAdmin,
			Token:  cleanAdminToken,
		}
		mgr.tokens[cleanAdminToken] = adminIdent
		mgr.users["admin"] = adminIdent
	}

	return mgr
}

func (m *RBACManager) IsDisabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.authDisabled
}

func (m *RBACManager) AdminToken() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.adminToken
}

func (m *RBACManager) RegisterUser(userID, token string, role Role) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanToken := strings.TrimSpace(token)
	if cleanToken == "" {
		return fmt.Errorf("token cannot be empty")
	}
	if userID == "" {
		return fmt.Errorf("userId cannot be empty")
	}

	ident := &Identity{
		UserID: userID,
		Role:   role,
		Token:  cleanToken,
	}

	m.tokens[cleanToken] = ident
	m.users[userID] = ident
	return nil
}

func (m *RBACManager) Authenticate(receivedToken string) (*Identity, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.authDisabled {
		return &Identity{
			UserID: "admin",
			Role:   RoleAdmin,
		}, nil
	}

	received := strings.TrimSpace(receivedToken)
	if strings.HasPrefix(strings.ToLower(received), "bearer ") {
		received = strings.TrimSpace(received[7:])
	}

	if received == "" {
		return nil, ErrUnauthorized
	}

	// Constant time check against admin token
	if m.adminToken != "" && subtle.ConstantTimeCompare([]byte(m.adminToken), []byte(received)) == 1 {
		return m.users["admin"], nil
	}

	// Check user tokens
	for tok, ident := range m.tokens {
		if subtle.ConstantTimeCompare([]byte(tok), []byte(received)) == 1 {
			return ident, nil
		}
	}

	return nil, ErrUnauthorized
}

func (m *RBACManager) CanAccessSession(ident *Identity, sessionOwnerID string) bool {
	if ident == nil {
		return false
	}
	if ident.Role == RoleAdmin {
		return true
	}
	// If session has no owner (legacy or unowned), allow access
	if sessionOwnerID == "" {
		return true
	}
	return ident.UserID == sessionOwnerID
}

func (m *RBACManager) CanMutateSession(ident *Identity, sessionOwnerID string) bool {
	if ident == nil {
		return false
	}
	if ident.Role == RoleReadOnly {
		return false
	}
	return m.CanAccessSession(ident, sessionOwnerID)
}
