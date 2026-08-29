/**
 * MITM (Man-in-the-middle) management: install/uninstall CA cert, set/clear
 * system HTTP(S) proxy, and verify HTTPS interception.
 *
 * Supports three platforms:
 *   - Windows: certutil + netsh
 *   - macOS:   security + networksetup
 *   - Linux:   update-ca-certificates + gsettings/env
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'crypto';
import { getPlatform } from './platform';
import { ensureCa, readCa, getCaCertPath, CA_NAME } from './cert';
import { probeWithProxy } from './probe';
import { isPortInUse } from './process';
import { runElevated } from './elevation';
import { DEFAULT_MITM_PORT } from './config';

const execFileAsync = promisify(execFile);

/**
 * Format an ElevatedResult as a user-friendly error string. We prefer the
 * captured stderr (where Windows certutil/netsh put the useful diagnostic)
 * and fall back to stdout / message in that order.
 */
function describe(r: { ok: boolean; message: string; stderr: string; stdout: string; code?: number; elevated?: boolean }): string {
  const detail = (r.stderr || r.stdout || r.message || '').trim();
  const text = detail.replace(/[.!?\s]+$/, '');
  
  // Add diagnostic context for common failures
  if (r.code === 1 && !text && r.elevated) {
    return 'UAC prompt was declined or the operation was cancelled';
  }
  if (r.code === 5) {
    return 'Access denied (requires Administrator privileges)';
  }
  if (!text) {
    return `Command failed with exit code ${r.code ?? 'unknown'}`;
  }
  
  return text;
}

/**
 * Well-known MITM forwarder port. The `mitm_443.js` forwarder binds port 443
 * and transparently forwards to {@link DEFAULT_MITM_PORT}. A system proxy set
 * to 443 is therefore functionally equivalent to one set to the configured MITM
 * port and must not be reported as a port mismatch.
 */
export const MITM_FORWARDER_PORTS = new Set<number>([DEFAULT_MITM_PORT, 443]);

export interface MitmStatus {
  caExists: boolean;
  caInstalled: boolean;
  caFingerprint: string | null;
  caCertPath: string | null;
  proxyEnabled: boolean;
  proxyHost: string | null;
  proxyPort: number | null;
  interceptionOk: boolean | null; // null = not tested
  interceptionError: string | null;
  platform: string;
  details: string[];
  // Nested structure expected by the Electron UI
  ca: {
    generated: boolean;
    path: string | null;
    fingerprint: string | null;
    installed: boolean;
    expiresAt: string | null;
    isExpired: boolean;
  };
  proxy: {
    host: string | null;
    port: number | null;
    redirected: boolean;
  };
  interception: {
    listening: boolean;
    reachable: boolean;
    /** True when the classic binary patch redirects traffic, so MITM interception is not required. */
    bypassed: boolean;
  };
}

/** Full status report for `ag-doctor mitm status`. */
export async function getMitmStatus(port = DEFAULT_MITM_PORT): Promise<MitmStatus> {
  const platform = getPlatform();
  const ca = readCa();
  const details: string[] = [];

  let caInstalled = false;
  if (ca) {
    try {
      caInstalled = await isCaInstalled(ca.fingerprint);
      details.push(`CA fingerprint: ${ca.fingerprint}`);
    } catch (e) {
      details.push(`CA install check failed: ${(e as Error).message}`);
    }
  } else {
    details.push('CA not generated yet — run `ag-doctor mitm install`');
  }

  let proxyEnabled = false;
  let proxyHost: string | null = null;
  let proxyPort: number | null = null;
  try {
    const proxy = await getSystemProxy();
    proxyEnabled = proxy.enabled;
    proxyHost = proxy.host;
    proxyPort = proxy.port;
    if (proxyEnabled) {
      details.push(`System proxy: ${proxy.host}:${proxy.port}`);
    } else {
      details.push('System proxy not set');
    }
  } catch (e) {
    details.push(`Proxy check failed: ${(e as Error).message}`);
  }

  let interceptionOk: boolean | null = null;
  let interceptionError: string | null = null;
  let proxyListening = false;
  
  // First, check if anything is listening on the proxy port
  if (proxyEnabled && proxyHost && proxyPort) {
    try {
      const { isPortInUse } = await import('./process');
      proxyListening = await isPortInUse(proxyPort, proxyHost);
    } catch (e) {
      // Ignore port check errors
    }
  }
  
  if (caInstalled && proxyEnabled) {
    try {
      const r = await probeWithProxy(
        `https://daily-cloudcode-pa.googleapis.com/v1internal:ping`,
        5000,
        `http://${proxyHost}:${proxyPort}`,
      );
      interceptionOk = r.ok;
      interceptionError = r.error ?? null;
      details.push(`Interception test: ${r.ok ? `OK (${r.latencyMs}ms)` : `FAILED — ${r.error}`}`);
    } catch (e) {
      interceptionOk = false;
      interceptionError = (e as Error).message;
    }
  }

  // When the classic binary patch is active, MITM interception is bypassed
  // by design (the language server talks to the local proxy directly). The
  // doctor's MITM check reflects this; surface it here too so mitm status
  // does not look like a failure when no MITM proxy is running.
  let binaryPatchBypass = false;
  try {
    const { getPatchStatus } = require('./binary-patch');
    binaryPatchBypass = getPatchStatus().applied;
  } catch {
    // ignore
  }
  if (binaryPatchBypass) {
    details.push('Interception bypassed ' + String.fromCharCode(8212) + ' binary patch active (MITM not required)');
  }

  let expiresAt: string | null = null;
  let isExpired = false;
  if (ca?.certPath && fs.existsSync(ca.certPath)) {
    try {
      const pem = fs.readFileSync(ca.certPath, 'utf8');
      const x509 = new crypto.X509Certificate(pem);
      expiresAt = x509.validTo;
      isExpired = new Date(expiresAt).getTime() < Date.now();
      if (isExpired) {
        details.push(`WARNING: CA Certificate expired on ${expiresAt}`);
        caInstalled = false; // Force re-install state if expired
      }
    } catch (e) {
      // Ignore X509 parsing errors
    }
  }

  return {
    caExists: !!ca,
    caInstalled,
    caFingerprint: ca?.fingerprint ?? null,
    caCertPath: ca?.certPath ?? null,
    proxyEnabled,
    proxyHost,
    proxyPort,
    interceptionOk,
    interceptionError,
    platform,
    details,
    // Nested structure expected by the Electron UI
    ca: {
      generated: !!ca,
      path: ca?.certPath ?? null,
      fingerprint: ca?.fingerprint ?? null,
      installed: caInstalled,
      expiresAt,
      isExpired,
    },
    proxy: {
      host: proxyHost,
      port: proxyPort,
      redirected: proxyEnabled,
    },
    interception: {
      // listening: check if something is actually listening on the proxy port
      listening: proxyListening,
      reachable: interceptionOk === true,
      bypassed: binaryPatchBypass,
    },
  };
}

/** Install the CA cert into the OS trust store. */
export async function installCaCert(): Promise<{ ok: boolean; message: string }> {
  const ca = ensureCa();
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const r = await runElevated('certutil', ['-addstore', '-f', 'ROOT', ca.certPath]);
      if (!r.ok) {
        const text = (r.stderr + ' ' + r.stdout).toLowerCase();
        if (text.includes('cannot find the file') || (text.includes('certutil') && text.includes('not found'))) {
          return { ok: false, message: 'Failed to install CA: certutil.exe not found in PATH' };
        }
        return { ok: false, message: `Failed to install CA: ${describe(r)}` };
      }
      return {
        ok: true,
        message: r.elevated
          ? `CA installed via UAC (fingerprint: ${ca.fingerprint})`
          : `CA installed (fingerprint: ${ca.fingerprint})`,
      };
    } else if (platform === 'darwin') {
      const r = await runElevated('security', [
        'add-trusted-cert',
        '-d',
        '-r', 'trustRoot',
        '-k', '/Library/Keychains/System.keychain',
        ca.certPath,
      ]);
      if (!r.ok) return { ok: false, message: `Failed to install CA: ${describe(r)}` };
    } else {
      const dest = getCaInstallDest();
      fs.copyFileSync(ca.certPath, dest);
      const r = await runElevated('update-ca-certificates', []);
      if (!r.ok) return { ok: false, message: `Failed to install CA: ${describe(r)}` };
    }
    return { ok: true, message: `CA installed (fingerprint: ${ca.fingerprint})` };
  } catch (e) {
    return { ok: false, message: `Failed to install CA: ${(e as Error).message}` };
  }
}

/** Remove the CA cert from the OS trust store. */
export async function uninstallCaCert(): Promise<{ ok: boolean; message: string }> {
  const ca = readCa();
  if (!ca) return { ok: true, message: 'No CA to remove' };
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const r = await runElevated('certutil', ['-delstore', 'ROOT', CA_NAME]);
      if (!r.ok) return { ok: false, message: `Failed to remove CA: ${describe(r)}` };
    } else if (platform === 'darwin') {
      const r = await runElevated('security', [
        'delete-certificate',
        '-c', CA_NAME,
        '/Library/Keychains/System.keychain',
      ]);
      if (!r.ok) return { ok: false, message: `Failed to remove CA: ${describe(r)}` };
    } else {
      const dest = getCaInstallDest();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      const r = await runElevated('update-ca-certificates', ['--fresh']);
      if (!r.ok) return { ok: false, message: `Failed to remove CA: ${describe(r)}` };
    }
    return { ok: true, message: 'CA removed' };
  } catch (e) {
    return { ok: false, message: `Failed to remove CA: ${(e as Error).message}` };
  }
}

function getCaInstallDest(): string {
  if (fs.existsSync('/usr/local/share/ca-certificates')) {
    return '/usr/local/share/ca-certificates/antigravity-mitm.crt';
  }
  if (fs.existsSync('/usr/share/ca-certificates')) {
    return '/usr/share/ca-certificates/antigravity-mitm.crt';
  }
  return '/usr/local/share/ca-certificates/antigravity-mitm.crt';
}

/** Set the system HTTP/HTTPS proxy to point at the local MITM proxy. */
export async function setSystemProxy(host = '127.0.0.1', port = DEFAULT_MITM_PORT): Promise<{ ok: boolean; message: string }> {
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const r = await runElevated('netsh', [
        'winhttp', 'set', 'proxy', `proxy-server=${host}:${port}`,
      ]);
      if (!r.ok) return { ok: false, message: `Failed to set proxy: ${describe(r)}` };
      const listening = await isPortInUse(port, host, 1500);
      if (!listening) {
        return {
          ok: false,
          message: `Proxy set to ${host}:${port}, but nothing is listening on that port. Start Antigravity or the local proxy first.`,
        };
      }
      return {
        ok: true,
        message: r.elevated
          ? `Proxy set to ${host}:${port} via UAC`
          : `Proxy set to ${host}:${port}`,
      };
    } else if (platform === 'darwin') {
      // Detect active network service (no elevation needed for `networksetup`
      // when the current user owns the network service).
      const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices']);
      const services = stdout.split('\n').filter((l) => l && !l.startsWith('An asterisk'));
      for (const svc of services) {
        await execFileAsync('networksetup', ['-setwebproxy', svc, host, String(port)]);
        await execFileAsync('networksetup', ['-setsecurewebproxy', svc, host, String(port)]);
        await execFileAsync('networksetup', ['-setwebproxystate', svc, 'on']);
        await execFileAsync('networksetup', ['-setsecurewebproxystate', svc, 'on']);
      }
    } else {
    // Linux: try gsettings for GNOME, fall back to env vars
    try {
      await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual']);
      await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', host]);
      await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(port)]);
      await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', host]);
      await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(port)]);
    } catch {
      process.env.http_proxy = `http://${host}:${port}`;
      process.env.https_proxy = `http://${host}:${port}`;
    }
    }
    return { ok: true, message: `Proxy set to ${host}:${port}` };
  } catch (e) {
    return { ok: false, message: `Failed to set proxy: ${(e as Error).message}` };
  }
}

/** Clear the system HTTP/HTTPS proxy. */
export async function clearSystemProxy(): Promise<{ ok: boolean; message: string }> {
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const r = await runElevated('netsh', ['winhttp', 'reset', 'proxy']);
      if (!r.ok) return { ok: false, message: `Failed to clear proxy: ${describe(r)}` };
      return {
        ok: true,
        message: r.elevated ? 'Proxy cleared via UAC' : 'Proxy cleared',
      };
    } else if (platform === 'darwin') {
      const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices']);
      const services = stdout.split('\n').filter((l) => l && !l.startsWith('An asterisk'));
      for (const svc of services) {
        await execFileAsync('networksetup', ['-setwebproxystate', svc, 'off']);
        await execFileAsync('networksetup', ['-setsecurewebproxystate', svc, 'off']);
      }
    } else {
      try {
        await execFileAsync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']);
      } catch {
        delete process.env.http_proxy;
        delete process.env.https_proxy;
      }
    }
    return { ok: true, message: 'Proxy cleared' };
  } catch (e) {
    return { ok: false, message: `Failed to clear proxy: ${(e as Error).message}` };
  }
}

/** Read the current system proxy (best-effort, platform-specific). */
export async function getSystemProxy(): Promise<{ enabled: boolean; host: string | null; port: number | null }> {
  const platform = getPlatform();
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('netsh', ['winhttp', 'show', 'proxy'], { windowsHide: true });
      // Match a host:port anywhere in the output. The label before the colon
      // is locale-dependent ("Proxy Server(s)" in English, "Serveur(s) proxy"
      // in French, etc.), so we only rely on the host:port pattern itself.
      // The address must contain a dot (e.g., 127.0.0.1) or be a hostname,
      // and have a port number after the colon.
      const m = stdout.match(/\b((?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9.-]+):(\d{2,5})\b/);
      if (m) {
        return { enabled: true, host: m[1], port: parseInt(m[2], 10) };
      }
      return { enabled: false, host: null, port: null };
    }
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('networksetup', ['-getwebproxy', 'Wi-Fi']);
      const host = stdout.match(/^Server:\s*(\S+)/m)?.[1] ?? null;
      const port = parseInt(stdout.match(/^Port:\s*(\d+)/m)?.[1] ?? '0', 10) || null;
      const enabled = stdout.includes('Enabled: Yes');
      return { enabled, host, port };
    }
    // Linux
    try {
      const { stdout } = await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy', 'mode']);
      const enabled = stdout.trim() === "'manual'";
      if (!enabled) return { enabled: false, host: null, port: null };
      const { stdout: host } = await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy.https', 'host']);
      const { stdout: port } = await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy.https', 'port']);
      return {
        enabled: true,
        host: host.trim().replace(/^'|'$/g, ''),
        port: parseInt(port.trim(), 10) || null,
      };
    } catch {
      return { enabled: false, host: null, port: null };
    }
  } catch {
    return { enabled: false, host: null, port: null };
  }
}

/** Check if a CA with the given fingerprint is installed in the OS trust store.
 *
 * On Windows, the check is two-tier:
 *   1. Try to find the exact thumbprint (fast path, matches the CLI's own CA).
 *   2. Fall back to searching for any cert whose Subject matches CA_NAME
 *      ("Antigravity MITM CA"). This handles CAs generated by other tools
 *      (e.g., the manual PowerShell forwarder) that share the Subject but
 *      have a different thumbprint.
 */
export async function isCaInstalled(fingerprint: string): Promise<boolean> {
  const platform = getPlatform();
  const caCertPath = getCaCertPath();
  try {
    if (platform === 'win32') {
      const thumbprint = fingerprint.replace(/:/g, '').toLowerCase();
      try {
        // Tier 1: exact thumbprint match
        const { stdout } = await execFileAsync(
          'cmd',
          ['/c', `certutil -verifystore ROOT ${thumbprint}`],
          { windowsHide: true },
        );
        if (stdout.includes(thumbprint.toUpperCase())) return true;
      } catch {
        // Tier 1 failed — fall through to Tier 2
      }
      // Tier 2: enumerate ROOT store via PowerShell and look for Subject Name.
      // certutil -store ROOT "<name>" is unreliable when called via cmd /c with
      // quoted arguments, so we use PowerShell's certificate drive instead.
      try {
        const psScript =
          `Get-ChildItem Cert:\\LocalMachine\\Root,Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue ` +
          `| Where-Object { $_.Subject -like '*${CA_NAME}*' } ` +
          `| Select-Object -ExpandProperty Thumbprint`;
        const { stdout } = await execFileAsync(
          'powershell',
          ['-NoProfile', '-Command', psScript],
          { windowsHide: true },
        );
        // If PowerShell returned any thumbprint, the CA is installed.
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    }
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('security', ['find-certificate', '-a', '-c', CA_NAME, '/Library/Keychains/System.keychain']);
      return stdout.includes(fingerprint.replace(/:/g, '').toUpperCase()) || stdout.length > 0;
    }
    // Linux
    const dest = getCaInstallDest();
    return fs.existsSync(dest);
  } catch {
    return false;
  }
}
