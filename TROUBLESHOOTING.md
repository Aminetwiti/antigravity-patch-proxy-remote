# Troubleshooting Antigravity & ag-doctor

This document outlines common issues and their solutions for the Antigravity application, particularly focusing on the local MITM proxy used to inject custom models.

## Diagnostic Flowchart: Port ${AG_PROXY_PORT:-51074} Unreachable

If `ag-doctor doctor` reports that the local proxy on port `${AG_PROXY_PORT:-51074}` is unreachable, follow this flow:

1. **Check the logs**:
   Run `ag-doctor logs -n 100` and look for lines starting with `[Proxy]`.
2. **If there are NO `[Proxy]` lines**:
   This means the proxy code is crashing or failing to start during the Language Server initialization.
   - **Fix**: Run a clean repack. Stop all Antigravity processes, run `npm run build` in the root, and execute `repack.ps1`. Then restart Antigravity.
3. **If `[Proxy] Server listening...` is present but port is still unreachable**:
   - The port might be bound to the wrong interface (e.g. WSL loopback vs Windows loopback).
   - Ensure you are running Antigravity natively in Windows, not via WSL.
4. **Emergency Fallback**:
   If the bundled proxy completely fails, you can run `ag-doctor proxy stub` to start a minimal Node HTTP stub on port ${AG_PROXY_PORT:-51074}. This will satisfy the language server's patch checks while you troubleshoot the real proxy.

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

- **CA installed · proxy 127.0.0.1:${AG_PROXY_PORT:-51074} · interception FAILED**
  *Status:* Warn/Error
  *Meaning:* Traffic is being routed, but the proxy at ${AG_PROXY_PORT:-51074} is either not running, or doesn't support the HTTPS CONNECT protocol required by the test.
  *Fix:* Ensure Antigravity is running. If you are using the fallback stub (`ag-doctor proxy stub`), interception will fail because it's just a stub.

- **System proxy is on port 443 but MITM proxy listens on ${AG_PROXY_PORT:-51074}**
  *Status:* Error
  *Meaning:* Your system proxy is pointing to the wrong port. The Antigravity binary patch bypasses this, but other apps on your system will route through the misconfigured port.
  *Fix:*
  - If the configured proxy port is **dead** (interception test failed — the doctor's hint now says so), clear it: elevated `netsh winhttp reset proxy`, or `ag-doctor mitm proxy-off`. With the binary patch active, MITM is bypassed by design, so no system proxy is needed.
  - If you actually intend HTTPS interception, repoint instead: elevated `netsh winhttp set proxy proxy-server="127.0.0.1:${AG_PROXY_PORT:-51074}"` (or use the `repair-all` script in the UI).

## Repair Scripts

If you encounter persistent permission issues (e.g. `Access is denied` or `0x80070005`) when setting the proxy or installing the CA, you can use the self-elevating repair scripts:
- Windows: Run `ag-doctor-ui/resources/repair-all.ps1`.
- Linux/macOS: Run `ag-doctor-ui/resources/repair-all.sh`.
