# MITM on port 443: Cause #2 (mandatory)

> Formerly part of the consolidated `FIX_ERROR.md` troubleshooting document. For the primary diagnostic, see [install-errors.md](install-errors.md).

## 10. Le MITM sur 443 (Cause #2 — OBLIGATOIRE)

### 10.1 Pourquoi c'est obligatoire

Le proxy sur ${AG_PROXY_PORT:-51074} est en **HTTP plain** (pas HTTPS). Il ne peut pas
intercepter les appels HTTPS que le language server fait directement à
`daily-cloudcode-pa.googleapis.com` (que le `hosts` file redirige vers
`127.0.0.1`).

Le MITM (`scripts/mitm/mitm_443.js`) est un **terminateur TLS** qui :
1. Écoute sur `127.0.0.1:443` avec un certificat auto-signé.
2. Décrypte le trafic HTTPS entrant.
3. Forwarde la requête HTTP déchiffrée vers `http://127.0.0.1:${AG_PROXY_PORT:-51074}` (le proxy).
4. Récupère la réponse, la renvoie cryptée au client.

Le CA (`certs/ca-cert.pem`) doit être trusted dans le Windows cert store
**LocalMachine\Root** ET **CurrentUser\Root** pour que le language server
accepte le certificat.

### 10.2 Pourquoi il ne démarre pas automatiquement

Le patch (v2.2.x et antérieur) :
- Démarre automatiquement le proxy sur ${AG_PROXY_PORT:-51074} (via `proxy-runner.js` chargé
  par `dist/main.js`).
- **Ne démarre PAS le MITM sur 443** parce que :
  - Le MITM a besoin des droits **administrateur** (port 443 < 1024 réservé,
    installation du CA dans LocalMachine\Root).
  - Lancer un process admin depuis Electron sans UAC prompt est compliqué.
  - Google ne fournit pas ce mécanisme — c'est à l'utilisateur.

Conséquence pratique : **après chaque reboot ou après chaque mise à jour
d'Antigravity, il faut relancer manuellement le MITM**.

### 10.3 Lancement manuel

voir [mitm-procedure.md](mitm-procedure.md) pour la procédure complète étape par étape.

En une ligne (PowerShell **ADMINISTRATEUR**) :

```powershell
Start-Process -FilePath "powershell" -Verb RunAs -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-File",
  "<repo-root>\scripts\mitm\start_mitm_443.ps1"
)
```

### 10.4 Vérification

```powershell
Get-NetTCPConnection -LocalPort 443 -State Listen | Format-Table LocalAddress,LocalPort,OwningProcess
```

Attendu :

```
LocalAddress  LocalPort  OwningProcess
------------  ---------  -------------
127.0.0.1     443        <PID node.exe>   ← MITM actif
127.0.0.2     443        <PID svchost>    ← Windows service (sans rapport)
```

Si seul `127.0.0.2:443` apparaît (pas de `127.0.0.1`), le MITM n'est pas
démarré — relancer avec [mitm-procedure.md](mitm-procedure.md).

---

## 11. Quick-start :流程 complet après un update Antigravity

Quand Antigravity est mis à jour par Google (auto-update ou manuel), voici la
séquence **exacte** pour revenir à un état fonctionnel.

### 11.1 Pré-requis

- WSL2 fonctionnel
- Node.js ≥ 18 + le repo `antigravity-add-model-main` à jour
- Droits admin Windows (pour lancer le MITM)
- `certs/ca-cert.pem` présent dans le repo

### 11.2 Pipeline (copier-coller depuis WSL)

```bash
# ───────────────────────────────────────────────────────────────────
# Étape 1 — Stopper tout
# ───────────────────────────────────────────────────────────────────
powershell.exe -Command "Stop-Process -Name Antigravity,language_server -Force -ErrorAction SilentlyContinue"

# ───────────────────────────────────────────────────────────────────
# Étape 2 — Rebuild + patch chirurgical (Cause #1)
# ───────────────────────────────────────────────────────────────────
cd /mnt/c/Users/developer/Downloads/antigravity-add-model-main/antigravity-add-model-main
git pull                         # si repo versionné
npm install --no-save @electron/asar
npm run build                    # compile dist/

# Snapshot avant patch
TS=$(date +%Y%m%dT%H%M%S)
RES="/mnt/c/Users/developer/AppData/Local/Programs/Antigravity/resources"
cp "$RES/app.asar" "$RES/app.asar.pre-update-$TS.bak"

# Patch
NODE_PATH="$(pwd)/node_modules" node scripts/patch_2_2_1.js \
    "$RES/app.asar" "/tmp/ag-build-$TS" "/tmp/app.asar.fixed-$TS"

# Vérifier delta (~40 KB)
SIZE_BEFORE=$(stat -c %s "$RES/app.asar")
SIZE_AFTER=$(stat -c %s "/tmp/app.asar.fixed-$TS")
DELTA=$((SIZE_AFTER - SIZE_BEFORE))
echo "delta: $DELTA B"
[ $DELTA -lt 100000 ] && cp "/tmp/app.asar.fixed-$TS" "$RES/app.asar"

# ───────────────────────────────────────────────────────────────────
# Étape 3 — Lancer le MITM (Cause #2, depuis PowerShell ADMIN)
# ───────────────────────────────────────────────────────────────────
powershell.exe -Command "Start-Process -FilePath 'powershell' -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<repo-root>\scripts\mitm\start_mitm_443.ps1'"

# Attendre que le MITM démarre
sleep 5
powershell.exe -Command "Get-NetTCPConnection -LocalPort 443 -State Listen | Where-Object { \$_.LocalAddress -eq '127.0.0.1' } | Format-Table LocalAddress,LocalPort,OwningProcess"

# ───────────────────────────────────────────────────────────────────
# Étape 4 — Lancer Antigravity
# ───────────────────────────────────────────────────────────────────
powershell.exe -Command "Start-Process -FilePath '%LOCALAPPDATA%\\Programs\\Antigravity\Antigravity.exe'"

# Attendre la stabilisation
sleep 20

# ───────────────────────────────────────────────────────────────────
# Étape 5 — Vérifier
# ───────────────────────────────────────────────────────────────────
LOG="/mnt/c/Users/developer/AppData/Roaming/Antigravity/logs/main.log"
echo "=== ports ==="
powershell.exe -Command "Get-NetTCPConnection -LocalPort ${AG_PROXY_PORT:-51074},443 -State Listen | Where-Object { \$_.LocalAddress -match '127.0.0.1' } | Format-Table LocalAddress,LocalPort,OwningProcess,State"
echo "=== dernier log ==="
tail -10 "$LOG"
echo "=== modèles custom chargés ==="
grep "Custom model" "$LOG" | tail -5
echo "=== startProxy errors ==="
grep -c "startProxy failed" "$LOG"
```

Si `startProxy failed` est > 0 OU si aucun « Custom model » n'apparaît,
relancer `npm run build` puis ré-appliquer l'étape 2.

---
