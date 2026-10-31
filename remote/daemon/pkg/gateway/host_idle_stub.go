//go:build !windows

package gateway

import "time"

// hostActiveSince — stub non-Windows : le PC hôte est un poste de travail
// Windows (le daemon s'y exécute), donc sur les autres OS on ne supprime
// jamais la notification (comportement sûr par défaut).
func hostActiveSince(time.Duration) bool { return false }
