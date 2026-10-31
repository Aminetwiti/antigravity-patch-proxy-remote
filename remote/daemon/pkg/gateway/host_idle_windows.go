//go:build windows

package gateway

import (
	"syscall"
	"time"
	"unsafe"
)

// Détection d'activité clavier/souris du PC hôte via GetLastInputInfo.
// Utilisée par Étape 3 (notifications intelligentes) : si l'utilisateur est
// déjà actif sur le PC, on ne sonne pas le téléphone — il voit la boîte de
// dialogue d'approbation en face de lui.
//
// `ponytail:` — zéro dépendance : syscall direct sur user32/kernel32. Sur un
// OS non-Windows (dev, CI) les procédures échouent → r==0 → on renvoie false
// (« ne pas supprimer la notification »), le comportement par défaut sûr.
// Upgrade path si un jour on veut aussi le verrouillage d'écran : ajouter
// SystemParametersInfo(SPI_GETSCREENSAVERRUNNING) ici.

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procGetLastInput = user32.NewProc("GetLastInputInfo")
	procGetTickCount = kernel32.NewProc("GetTickCount")
)

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

// hostActiveSince indique si l'utilisateur a interagi avec le PC hôte dans
// les `within` dernières millisecondes. Le calcul en uint32 gère le wrap de
// GetTickCount (~49,7 jours) sans conditionnelle.
func hostActiveSince(within time.Duration) bool {
	var info lastInputInfo
	info.cbSize = uint32(unsafe.Sizeof(info))
	r, _, _ := procGetLastInput.Call(uintptr(unsafe.Pointer(&info)))
	if r == 0 {
		return false // API indisponible → ne pas supprimer la notification
	}
	tick, _, _ := procGetTickCount.Call()
	elapsed := uint32(tick) - info.dwTime
	return time.Duration(elapsed)*time.Millisecond <= within
}
