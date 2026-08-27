/**
 * MITM check — reports CA installation, system proxy, and HTTPS interception status.
 * Added to the `doctor` command output.
 *
 * Special handling: if the system proxy is set but on the wrong port
 * (e.g. 443 instead of the configured MITM port), we report it as an explicit error with a
 * remediation hint, since this is the most common cause of
 * `ERR_HTTP_HEADERS_SENT` in the bundled proxy.
 */
import type { CheckResult } from '../types';
import { getMitmStatus, MITM_FORWARDER_PORTS } from '../core/mitm';
import { DEFAULT_MITM_PORT } from '../core/config';
import { getPatchStatus } from '../core/binary-patch';

export async function checkMitm(): Promise<CheckResult> {
  try {
    const s = await getMitmStatus();
    const parts: string[] = [];
    parts.push(s.caInstalled ? 'CA installed' : 'CA NOT installed');
    parts.push(s.proxyEnabled ? `proxy ${s.proxyHost}:${s.proxyPort}` : 'proxy OFF');
    if (s.interceptionOk !== null) {
      parts.push(s.interceptionOk ? 'interception OK' : 'interception FAILED');
    }
    const message = parts.join(' · ');
    const details = s.details.join('\n');

    // Detect the most common misconfiguration: proxy is set but on the wrong
    // port. This causes language_server to crash with ERR_HTTP_HEADERS_SENT
    // because nothing is listening on that port. The dedicated MITM forwarder
    // (port 443 → DEFAULT_MITM_PORT) is a valid configuration, so accept it.
    const portMismatch =
      s.proxyEnabled &&
      s.proxyPort !== null &&
      !MITM_FORWARDER_PORTS.has(s.proxyPort);

    // Check if the binary patch is active
    const patch = getPatchStatus();
    const isPatched = patch.applied;

    // Severity logic
    //
    // When the binary patch is active, Antigravity connects directly to the
    // local proxy on DEFAULT_MITM_PORT and does NOT rely on OS-level HTTPS
    // interception. The system proxy (and its port) is therefore bypassed, so
    // the interception test result is irrelevant — report the system as healthy
    // regardless of whether the test passed, failed, or was never run. This
    // must be checked first so a spurious "interception FAILED" (the proxy on
    // DEFAULT_MITM_PORT is a plain HTTP translator and does not speak CONNECT/TLS) never
    // produces a false warning.
    if (isPatched) {
      const portNote = portMismatch
        ? `\n\nNote: Antigravity is binary-patched to connect directly to the local proxy on ${DEFAULT_MITM_PORT}.\n` +
          `The system proxy on port ${s.proxyPort} is bypassed, so Antigravity works perfectly.\n` +
          `Other system apps might fail if they try to use port ${s.proxyPort}.\n` +
          `If you want to clear it, run an elevated PowerShell and execute:\n` +
          `  netsh winhttp reset proxy`
        : `\n\nNote: Antigravity is binary-patched to connect directly to the local proxy on ${DEFAULT_MITM_PORT}, ` +
          `so OS-level HTTPS interception is not required.`;
      return {
        id: 'mitm',
        title: 'MITM (HTTPS interception)',
        status: 'ok',
        message: `Interception bypassed (binary patch active) — Antigravity works perfectly`,
        details: details + portNote,
        fixable: false,
        data: s,
      };
    }
    if (s.caInstalled && s.proxyEnabled && s.interceptionOk === true) {
      return {
        id: 'mitm',
        title: 'MITM (HTTPS interception)',
        status: 'ok',
        message,
        details,
        data: s,
      };
    }
    if (!s.caExists) {
      return {
        id: 'mitm',
        title: 'MITM (HTTPS interception)',
        status: 'info',
        message: 'CA not generated — interception unavailable',
        details,
        fixable: 'run `ag-doctor mitm install` to enable interception',
        data: s,
      };
    }
    if (portMismatch) {
      // The system proxy points at a port that is NOT the MITM port. If the
      // interception test failed (nothing listening there), pointing it at the
      // MITM port would route ALL WinHTTP system traffic (Windows Update etc.)
      // through the local proxy — the safe fix is to clear it, which is also
      // the correct end-state for binary-patched setups (MITM is bypassed).
      const proxyIsDead = s.interceptionOk === false;
      const hint = proxyIsDead
        ? `\n\nThe configured proxy port is NOT listening (interception test failed), so the\n` +
          `system proxy is dead weight. With the binary patch, MITM is not required — clear it:\n` +
          `  netsh winhttp reset proxy\n` +
          `(or run: ag-doctor mitm proxy-off)\n` +
          `Point it at the MITM port only if you actually intend HTTPS interception:\n` +
          `  netsh winhttp set proxy proxy-server="127.0.0.1:${DEFAULT_MITM_PORT}"`
        : `\n\nFix: run an elevated PowerShell and execute:\n` +
          `  netsh winhttp set proxy proxy-server="127.0.0.1:${DEFAULT_MITM_PORT}"`;
      return {
        id: 'mitm',
        title: 'MITM (HTTPS interception)',
        status: 'error',
        message: `System proxy is on port ${s.proxyPort} but MITM proxy listens on ${DEFAULT_MITM_PORT}`,
        details: details + hint,
        fixable: proxyIsDead ? 'run `ag-doctor mitm proxy-off` to clear the dead system proxy' : false,
        data: s,
      };
    }
    return {
      id: 'mitm',
      title: 'MITM (HTTPS interception)',
      status: 'warn',
      message,
      details,
      fixable: !s.caInstalled ? 'run `ag-doctor mitm install`' : (!s.proxyEnabled ? 'run `ag-doctor mitm proxy-on`' : false),
      data: s,
    };
  } catch (e) {
    return {
      id: 'mitm',
      title: 'MITM (HTTPS interception)',
      status: 'error',
      message: `Check failed: ${(e as Error).message}`,
    };
  }
}
