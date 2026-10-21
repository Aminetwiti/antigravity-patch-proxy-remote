# Troubleshooting Antigravity & ag-doctor

This document outlines common issues and their solutions for the Antigravity application, particularly focusing on the local MITM proxy used to inject custom models.

## Diagnostic Flowchart: Port 51074 (or $AG_PROXY_PORT) Unreachable

If `ag-doctor doctor` reports that the local proxy on port 51074 (or configured `$AG_PROXY_PORT`) is unreachable, follow this flow:

1. **Check the logs**:
   Run `ag-doctor logs -n 100` and look for lines starting with `[Proxy]`.
2. **If there are NO `[Proxy]` lines**:
   This means the proxy code is crashing or failing to start during the Language Server initialization.
   - **Fix**: Run a clean repack. Stop all Antigravity processes, run `npm run build` in the root, and execute `repack.ps1`. Then restart Antigravity.
3. **If `[Proxy] Server error: code=EACCES ... port=51074` appears in logs**:
   - Windows NAT / Hyper-V has reserved a dynamic port range overlapping port 51074 (`netsh interface ipv4 show excludedportrange protocol=tcp`).
   - **Fix**: Run `fix-port-51074.bat` as Administrator, or execute in an elevated PowerShell:
     ```powershell
     net stop winnat
     netsh int ipv4 set dynamicport tcp start=52000 num=13535
     net start winnat
     ```
     Then restart Antigravity.
4. **If `[Proxy] Server listening...` is present but port is still unreachable**:
   - The port might be bound to the wrong interface (e.g. WSL loopback vs Windows loopback).
   - Ensure you are running Antigravity natively in Windows, not via WSL.
5. **Emergency Fallback**:
   If the bundled proxy completely fails, you can run `ag-doctor proxy stub` to start a minimal Node HTTP stub on port 51074. This will satisfy the language server's patch checks while you troubleshoot the real proxy.

## Understanding MITM Check Statuses

The `ag-doctor` tool checks three aspects of the MITM proxy:
1. **CA Installed**: Is the Antigravity MITM CA trusted by your OS?
2. **Proxy Enabled**: Is the system HTTP/HTTPS proxy set to intercept traffic?
3. **Interception**: Can we successfully proxy an HTTPS request using the CA?

### Common States

- **CA not generated — interception unavailable**
  *Status:* Info
  *Meaning:* You haven't run the install step yet.
  *Fix:* Run `ag-doctor mitm install`.

- **CA installed · proxy OFF**
  *Status:* Warn
  *Meaning:* The certificate is trusted, but your system is not routing traffic through it.
  *Fix:* Run `ag-doctor mitm proxy-on`.

- **CA installed · proxy 127.0.0.1:51074 · interception FAILED**
  *Status:* Warn/Error
  *Meaning:* Traffic is being routed, but the proxy at port 51074 is either not running, or doesn't support the HTTPS CONNECT protocol required by the test.
  *Fix:* Ensure Antigravity is running. If you are using the fallback stub (`ag-doctor proxy stub`), interception will fail because it's just a stub.

- **System proxy is on port 443 but MITM proxy listens on 51074**
  *Status:* Error
  *Meaning:* Your system proxy is pointing to the wrong port. The Antigravity binary patch bypasses this, but other apps on your system will route through the misconfigured port.
  *Fix:*
  - If the configured proxy port is **dead** (interception test failed — the doctor's hint now says so), clear it: elevated `netsh winhttp reset proxy`, or `ag-doctor mitm proxy-off`. With the binary patch active, MITM is bypassed by design, so no system proxy is needed.
  - If you actually intend HTTPS interception, repoint instead: elevated `netsh winhttp set proxy proxy-server="127.0.0.1:51074"` (or use the `repair-all` script in the UI).

## Repair Scripts

If you encounter persistent permission issues (e.g. `Access is denied` or `0x80070005`) when setting the proxy or installing the CA, you can use the self-elevating repair scripts:
- Windows: Run `ag-doctor-ui/resources/repair-all.ps1`.
- Linux/macOS: Run `ag-doctor-ui/resources/repair-all.sh`.

## Google Account 403 VALIDATION_REQUIRED & Challenge Resolution Protocol

### Symptom
When sending requests or testing accounts in Antigravity or `ag-doctor`, a Google account returns `HTTP 403 Forbidden` with status `VALIDATION_REQUIRED` or an error mentioning `Verify your account at https://accounts.google.com/signin/continue?...`.

Attempts to authenticate via smartphone QR code fail with:
> *"Cette device a été utilisée pour trop de requêtes. Veuillez utiliser un autre appareil."* (Device rate limit / al_alert).

Direct browser logins to generic `accounts.google.com` may return `HTTP 400 Bad Request` or loop without clearing the token state.

### Root Cause
Google security algorithms flagged the account with a security challenge (`al_alert`), age verification requirement, or conflicting stale OAuth sessions. The account is **NOT suspended or banned under TOS**; it simply requires identity/age confirmation and clean native OAuth token issuance.

### The 4-Step Resolution Protocol

1. **Révocation de l'accès Antigravity existant**
   - Ouvrez : `https://myaccount.google.com/connections`
   - Connectez-vous avec le compte concerné.
   - Supprimez / révoquez les accès tiers pour **Antigravity** (ou Google Cloud Code / Jetski). Cela efface les sessions OAuth en conflit côté Google.

2. **Validation de l'âge et de l'identité du compte**
   - Ouvrez : `https://myaccount.google.com/age-verification`
   - Complétez la vérification demandée (par carte bancaire ou selfie vidéo).
   - Confirmez que le compte est débloqué et reconnu majeur.

3. **Reconnexion native via Antigravity 2.0 (Bypass de la limite smartphone)**
   - Ne scannez **pas** de QR code avec un smartphone déjà saturé de requêtes !
   - Utilisez l'authentification native sur votre PC :
     - Soit lancez l'IDE Antigravity 2.0 et connectez-vous directement via la fenêtre native de l'IDE.
     - Soit exécutez dans un terminal : `ag-doctor auth fix` ou `agy` (Option 1).
     - Soit cliquez sur le bouton de connexion native dans `ag-doctor-ui`.
   - Cette authentification native sur PC contourne l'erreur *"Cet appareil a été utilisé pour trop de requêtes"*.

4. **Synchronisation avec le Patch Proxy**
   - Ouvrez `ag-doctor-ui` ou rafraîchissez les quotas (`npm run doctor` / bouton *Actualiser tout*).
   - Le jeton d'accès est automatiquement mis à jour dans `custom_models.json`. Le compte passe immédiatement en `🟢 Prêt` avec 100% de ses quotas Gemini & Claude.

