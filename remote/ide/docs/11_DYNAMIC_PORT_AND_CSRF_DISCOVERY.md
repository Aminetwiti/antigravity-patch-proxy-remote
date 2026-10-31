# 11. Découverte Dynamique des Ports & Watchdog CSRF

> **Algorithme de Résolution Zéro-Port pour Antigravity IDE**

---

## 1. Problématique
Antigravity IDE n'écoute pas sur un port fixe (contrairement au Hub 55256 de la version 2.0). Chaque fenêtre lance son instance avec un port aléatoire dans la plage `50000-65535`.

---

## 2. Algorithme de Découverte Automatisé

```go
func FindActiveIdePorts() ([]int, string, error) {
    // 1. Lister les PIDs de language_server_windows_x64.exe
    pids, csrfToken, err := scanIdeProcesses()
    if err != nil || len(pids) == 0 {
        return nil, "", fmt.Errorf("aucune instance IDE trouvée")
    }

    // 2. Récupérer les ports TCP 'Listen' pour chaque PID
    var activePorts []int
    for _, pid := range pids {
        ports := getListeningPortsForPID(pid)
        for _, port := range ports {
            // 3. Tester le Heartbeat
            if probeHeartbeat(port, csrfToken) {
                activePorts = append(activePorts, port)
            }
        }
    }
    return activePorts, csrfToken, nil
}
```
