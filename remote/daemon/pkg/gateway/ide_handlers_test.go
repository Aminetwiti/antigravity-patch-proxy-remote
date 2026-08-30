package gateway

import (
	"testing"
)

func TestIsIDESupportedAction(t *testing.T) {
	s := NewServer(nil, "test-token")
	if s == nil {
		t.Fatal("Serveur non instancié")
	}

	supported := []string{
		"ide.list_workspaces",
		"ide.list_sessions",
		"ide.create_session",
		"ide.send_prompt",
		"ide.focus",
		"ide.status",
		"ide.launch",
		"ide.restart",
		"ide.kill",
		"ide_launch",
		"ide_restart",
		"ide_kill",
		"emergency_stop",
	}

	for _, act := range supported {
		if !s.IsIDESupportedAction(act) {
			t.Errorf("Action attendue supportée: %s", act)
		}
	}

	unsupported := []string{
		"ide.unknown",
		"other_action",
		"",
	}

	for _, act := range unsupported {
		if s.IsIDESupportedAction(act) {
			t.Errorf("Action ne devrait pas être supportée: %s", act)
		}
	}
}
