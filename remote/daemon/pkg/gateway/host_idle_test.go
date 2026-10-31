//go:build !windows

package gateway

import (
	"testing"
	"time"
)

// Contrat du stub non-Windows : ne jamais signaler l'utilisateur actif, pour
// ne jamais supprimer une notification. La vraie implémentation Windows
// (GetLastInputInfo) n'est pas testable en unitaire — elle dépend de
// l'activité réelle de l'utilisateur ; vérification manuelle : taper au
// clavier pendant un stream doit faire apparaître hostActive=true.
func TestHostActiveSinceFalseOnStub(t *testing.T) {
	if hostActiveSince(time.Second) {
		t.Fatal("stub non-Windows : attendu false (ne jamais supprimer la notification)")
	}
}
