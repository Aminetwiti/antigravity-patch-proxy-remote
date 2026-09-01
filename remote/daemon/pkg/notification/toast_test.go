package notification

import (
	"testing"
)

func TestSendNotificationNonBlocking(t *testing.T) {
	// SendNotification doit être non-bloquant et s'exécuter sans panique
	SendNotification("Test Antigravity", "Notification de test")
}
