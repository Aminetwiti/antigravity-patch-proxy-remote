package auth

import (
	"testing"
)

func TestRBACManager(t *testing.T) {
	mgr := NewRBACManager("admin-secret-token")

	// 1. Authenticate admin
	adminIdent, err := mgr.Authenticate("admin-secret-token")
	if err != nil {
		t.Fatalf("failed to auth admin: %v", err)
	}
	if adminIdent.Role != RoleAdmin {
		t.Errorf("expected role admin, got %s", adminIdent.Role)
	}

	// 2. Register user Alice and user Bob
	_ = mgr.RegisterUser("alice", "alice-token", RoleUser)
	_ = mgr.RegisterUser("bob", "bob-token", RoleUser)
	_ = mgr.RegisterUser("viewer", "viewer-token", RoleReadOnly)

	aliceIdent, err := mgr.Authenticate("alice-token")
	if err != nil {
		t.Fatalf("failed to auth alice: %v", err)
	}
	bobIdent, err := mgr.Authenticate("bob-token")
	if err != nil {
		t.Fatalf("failed to auth bob: %v", err)
	}
	if bobIdent.Role != RoleUser {
		t.Errorf("expected bob role user, got %s", bobIdent.Role)
	}
	viewerIdent, err := mgr.Authenticate("viewer-token")
	if err != nil {
		t.Fatalf("failed to auth viewer: %v", err)
	}

	// 3. Ownership checks
	// Alice accessing Alice's session -> allowed
	if !mgr.CanAccessSession(aliceIdent, "alice") {
		t.Errorf("Alice should be able to access Alice's session")
	}
	// Alice mutating Alice's session -> allowed
	if !mgr.CanMutateSession(aliceIdent, "alice") {
		t.Errorf("Alice should be able to mutate Alice's session")
	}

	// Alice accessing Bob's session -> DENIED
	if mgr.CanAccessSession(aliceIdent, "bob") {
		t.Errorf("Alice should NOT be able to access Bob's session")
	}
	// Alice mutating Bob's session -> DENIED
	if mgr.CanMutateSession(aliceIdent, "bob") {
		t.Errorf("Alice should NOT be able to mutate Bob's session")
	}

	// Admin accessing Bob's session -> allowed
	if !mgr.CanAccessSession(adminIdent, "bob") {
		t.Errorf("Admin should be able to access Bob's session")
	}
	// Admin mutating Bob's session -> allowed
	if !mgr.CanMutateSession(adminIdent, "bob") {
		t.Errorf("Admin should be able to mutate Bob's session")
	}

	// ReadOnly viewer mutating viewer's session -> DENIED
	if mgr.CanMutateSession(viewerIdent, "viewer") {
		t.Errorf("ReadOnly viewer should NOT be able to mutate session")
	}
	// ReadOnly viewer reading viewer's session -> allowed
	if !mgr.CanAccessSession(viewerIdent, "viewer") {
		t.Errorf("ReadOnly viewer should be able to read session")
	}
}
