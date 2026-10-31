package gateway

import (
	"encoding/json"
	"testing"
)

// TestStepIndexMinusOneUnmarshal â€” le mobile envoie stepIndex -1 quand la
// corrÃ©lation trajectory_id/step_index est absente ; le JSON ne doit pas
// rejeter la connexion (int64), et le handler refuse l'approbation.
func TestStepIndexMinusOneUnmarshal(t *testing.T) {
	var m IncomingMessage
	if err := json.Unmarshal([]byte(`{"type":"submit_approval","stepIndex":-1}`), &m); err != nil {
		t.Fatalf("stepIndex -1 rejected: %v", err)
	}
	if m.StepIndex != -1 {
		t.Fatalf("stepIndex expected -1, got %d", m.StepIndex)
	}
}
