# MITM manual procedure + Lessons learned

> Formerly part of the consolidated `FIX_ERROR.md` troubleshooting document. For the primary diagnostic, see [install-errors.md](install-errors.md).

## 12. Procédure manuelle complète du MITM

### 12.1 Préparation unique (une seule fois)

1. **Ouvrir PowerShell en tant qu'administrateur** :
   - Clic droit sur le menu Démarrer → « Terminal (Admin) » ou « Windows PowerShell (Admin) ».

2. **Vérifier que le CA existe** :
   ```powershell
   Test-Path "<repo-root>\certs\ca-cert.pem"
   ```
   Si `False`, le générer :
   ```bash
   # Depuis WSL :
   cd /mnt/c/Users/developer/Downloads/antigravity-add-model-main/antigravity-add-model-main/certs
   openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca-cert.pem -days 3650 -subj "/CN=Antigravity MITM CA"
   ```

3. **Importer le CA dans le store Windows** :
   ```powershell
   Import-Certificate -FilePath "<repo-root>\certs\ca-cert.pem" -CertStoreLocation Cert:\LocalMachine\Root
   Import-Certificate -FilePath "<repo-root>\certs\ca-cert.pem" -CertStoreLocation Cert:\CurrentUser\Root
   ```

### 12.2 Lancement à chaque reboot / update Antigravity

Option A — Script PowerShell (le plus simple) :

```powershell
# PowerShell ADMIN
& "<repo-root>\scripts\mitm\start_mitm_443.ps1"
```

Le script :
- Réimporte le CA (idempotent)
- Lance `node scripts/mitm/mitm_443.js` en foreground
- Affiche les logs en temps réel dans la console
- `(Ctrl+C)` pour arrêter

Option B — Wrapper VBS (pour lancer sans ouvrir une console admin) :

Créer `C:/Users/developer\StartAntigravityMITM.vbs` :
```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""<repo-root>\scripts\mitm\start_mitm_443.ps1""", 1, False
Set WshShell = Nothing
```

Double-clic sur le VBS → UAC prompt → MITM démarre.

### 12.3 Troubleshooting MITM

| Symptôme | Cause probable | Fix |
|---|---|---|
| `EACCES` au lancement | Pas en admin | Relancer en admin |
| `EADDRINUSE` port 443 | Un autre process bind déjà 443 | `netstat -ano \| findstr :443` → tuer le process |
| MITM démarre mais LS continue d'échouer | CA non trusté | Réimporter [mitm-procedure.md#121-préparation-unique-une-seule fois](mitm-procedure.md) |
| MITM forward error vers ${AG_PROXY_PORT:-51074} | Proxy off | Démarrer Antigravity (qui lance le proxy) |
| Erreur TLS côté LS | CA fingerprint mismatch | Vérifier que `certs/ca-cert.pem` n'a pas été régénéré sans réimport |

### 12.4 Logs du MITM

Les logs vont dans la console où le script a été lancé. Pour logger dans un
fichier :

```powershell
& node "<repo-root>\scripts\mitm\mitm_443.js" *>&1 \| Tee-Object -FilePath "C:/Users/developer\AppData\Local\Temp\mitm-443.log"
```

---

## 13. Leçons apprises (version corrigée)

### 13.1 MITM sur 443 est OBLIGATOIRE, pas optionnel

**Erreur d'analyse initiale** : lors du diagnostic du 2026-07-11 14:00, j'ai
affirmé à tort que le MITM n'était pas requis. La vérité :

- ✅ Le proxy sur ${AG_PROXY_PORT:-51074} est démarré automatiquement par `proxy-runner.js`.
- ❌ Le MITM sur 443 doit être démarré **manuellement** par l'utilisateur.
- Sans MITM : `ECONNREFUSED 127.0.0.1:443` récurrent même si le proxy tourne.

**Règle** : avant de considérer le patch comme fonctionnel, vérifier que
`127.0.0.1:443` est LISTENING (cf. §10.4).

### 13.2 Toujours lire les logs applicatifs AVANT l'erreur réseau

L'erreur `127.0.0.1:443 refused` parle réseau mais la cause est dans
`main.log` :

```
[error] [PATCH] startProxy failed: Cannot find module '../cryptoStore'
```

→ Réflexe : `grep -i "error\|fail" main.log` avant de chercher côté
ports/firewall/réseau.

### 13.3 Diff `dist/` du repo vs `dist/` de l'asar déployé

```bash
npx -y @electron/asar list "$RES/app.asar" | sort > /tmp/asar.txt
ls "$REPO/dist/"*.js | xargs -n1 basename | sort > /tmp/dist.txt
comm -23 /tmp/dist.txt <(awk -F'/' '/^\/dist\/[a-zA-Z][^\/]*\.js$/ {print $3}' /tmp/asar.txt | sort)
```

Cette commande a révélé les 3 modules manquants.

### 13.4 L'overlay complet de `dist/` n'est PAS une option sûre

Un repack qui copie tout `dist/` :

- Remplace le `dist/main.js` patché par le `main.js` upstream (perd
  l'integration TLS bypass + `require('../proxy-runner')`).
- Emporte les `__mocks__/*` (mocks vitest) → Electron résout ces mocks
  comme s'ils étaient les vrais modules.
- Emporte les `*.test.js` → pollution de l'asar de production.

→ Toujours faire un overlay **chirurgical**.

### 13.5 Backup avant chaque opération destructive

Le pattern `app.asar.pre-<operation>-<ISO>.bak` a sauvé la mise plusieurs
fois. À garder : au minimum les 3 derniers backups.

### 13.6 Versioning sémantique d'Antigravity = breaking changes

| 2.0.x → 2.1.0 | pas de breaking change (proxy intact) |
| 2.1.0 → 2.2.x | **breaking** : proxy code supprimé du bundle officiel |
| 2.2.x → 2.3+ | à surveiller (le pattern de Google est de réduire la surface area) |

À chaque update, refaire le diagnostic de [install-errors.md#3-diagnostic-timeline-de-la-résolution](install-errors.md) avant d'appliquer le patch.

### 13.7 Distinguer « l'app démarre » de « l'app fonctionne »

Symptômes trompeurs :
- App lance + fenêtre s'ouvre ≠ App fonctionnelle
- Proxy répond 200 sur /v1internal:listExperiments ≠ Custom models utilisables
- MITM bind sur 127.0.0.2 ≠ MITM bind sur 127.0.0.1

**Réflexe** : faire le tour des checks de [mitm-443.md](mitm-443.md) étape 5 avant de
déclarer le fix fonctionnel.

