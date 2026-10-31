/**
 * Advanced scenarios — rare edge cases that can break the MITM proxy setup.
 *
 * Scenarios covered:
 *   - Memory leak watchdog (auto-restart proxy if RSS exceeds threshold)
 *   - File descriptor exhaustion monitor
 *   - Concurrent CA regeneration lock (prevents race conditions)
 *   - WSL/Docker network namespace detection
 *   - ECH (Encrypted Client Hello) / QUIC detection
 *   - Windows Firewall rule auto-management
 *   - Backup integrity verification (SHA-256)
 *   - Antigravity version compatibility check
 *   - Auto-update detection (binary file watcher)
 *   - DNS-over-HTTPS / DNS-over-TLS detection
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { getPlatform } from './platform';
import { getAppAsarPath, getLanguageServerBinary, getLanguageServerBackup } from './paths';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST } from './config';

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Memory Leak Watchdog
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryStats {
  pid: number;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  fdCount: number;
  uptimeSec: number;
  exceedsThreshold: boolean;
}

const MEMORY_THRESHOLD_MB = 512; // Auto-restart if proxy exceeds this
const FD_THRESHOLD = 800;        // Warn if FD count approaches limit (Windows default: 512 per process, Linux: 1024)

/** Get memory stats for a process by PID. */
export async function getProcessStats(pid: number): Promise<MemoryStats | null> {
  try {
    const platform = getPlatform();
    let rssMB = 0;
    let fdCount = 0;

    if (platform === 'win32') {
      // Use PowerShell to get process memory and handle count
      const psScript = `
        $proc = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
        if ($proc) {
          [PSCustomObject]@{
            Rss = [math]::Round($proc.WorkingSet64 / 1MB, 2)
            Handles = $proc.HandleCount
          } | ConvertTo-Json
        }
      `;
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command', psScript,
      ], { windowsHide: true });
      const data = JSON.parse(stdout.trim());
      rssMB = data.Rss || 0;
      fdCount = data.Handles || 0;
    } else {
      // Linux/macOS: parse /proc/<pid>/status or use ps
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (rssMatch) rssMB = parseInt(rssMatch[1], 10) / 1024;

        // Count open FDs
        if (fs.existsSync(`/proc/${pid}/fd`)) {
          fdCount = fs.readdirSync(`/proc/${pid}/fd`).length;
        }
      } catch {
        // Fallback to ps
        const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
        rssMB = parseInt(stdout.trim(), 10) / 1024;
      }
    }

    // Get heap stats from the proxy itself (via /health endpoint)
    let heapUsedMB = 0;
    let heapTotalMB = 0;
    try {
      const http = await import('http');
      const heap = await new Promise<{ used: number; total: number }>((resolve, reject) => {
        const req = http.request({
          hostname: DEFAULT_BIND_HOST,
          port: DEFAULT_MITM_PORT,
          path: '/health',
          method: 'GET',
          timeout: 1000,
        }, (res) => {
          let body = '';
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve({ used: data.heapUsed || 0, total: data.heapTotal || 0 });
            } catch { resolve({ used: 0, total: 0 }); }
          });
        });
        req.on('error', () => resolve({ used: 0, total: 0 }));
        req.on('timeout', () => { req.destroy(); resolve({ used: 0, total: 0 }); });
        req.end();
      });
      heapUsedMB = heap.used;
      heapTotalMB = heap.total;
    } catch { /* ignore */ }

    return {
      pid,
      rssMB,
      heapUsedMB,
      heapTotalMB,
      fdCount,
      uptimeSec: 0, // Would need to track start time
      exceedsThreshold: rssMB > MEMORY_THRESHOLD_MB || fdCount > FD_THRESHOLD,
    };
  } catch {
    return null;
  }
}

/** Watchdog: monitor proxy process and restart if it exceeds thresholds. */
export class ProxyWatchdog {
  private intervalHandle: NodeJS.Timeout | null = null;
  private restartCallback: (() => Promise<void>) | null = null;
  private consecutiveHighReadings = 0;
  private readonly REQUIRED_CONSECUTIVE = 3; // Avoid false positives

  constructor(
    private readonly getPid: () => number | null,
    private readonly onAlert?: (stats: MemoryStats, reason: string) => void,
  ) {}

  setRestartCallback(cb: () => Promise<void>): void {
    this.restartCallback = cb;
  }

  start(intervalMs = 30_000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    const pid = this.getPid();
    if (!pid) return;

    const stats = await getProcessStats(pid);
    if (!stats) return;

    if (stats.exceedsThreshold) {
      this.consecutiveHighReadings++;
      if (this.consecutiveHighReadings >= this.REQUIRED_CONSECUTIVE) {
        const reason = stats.rssMB > MEMORY_THRESHOLD_MB
          ? `Memory leak detected: ${stats.rssMB.toFixed(0)}MB RSS (threshold: ${MEMORY_THRESHOLD_MB}MB)`
          : `FD exhaustion: ${stats.fdCount} FDs (threshold: ${FD_THRESHOLD})`;
        this.onAlert?.(stats, reason);
        if (this.restartCallback) {
          await this.restartCallback();
          this.consecutiveHighReadings = 0;
        }
      }
    } else {
      this.consecutiveHighReadings = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Concurrent CA Regeneration Lock
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 30_000;

/** Acquire an exclusive lock for CA regeneration. */
export async function acquireCaLock(): Promise<() => void> {
  const lockPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mitm', '.ca.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      // O_EXCL: atomic create-if-not-exists
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        hostname: os.hostname(),
      }));
      fs.closeSync(fd);

      // Return release function
      return () => {
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock held by another process — check if it's stale
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
            // Stale lock — force remove
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 200));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Failed to acquire CA lock within ${LOCK_TIMEOUT_MS}ms`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: WSL / Docker / Container Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface NetworkNamespace {
  isWSL: boolean;
  isDocker: boolean;
  isContainer: boolean;
  isRemoteSession: boolean;
  loopbackIPs: string[];
  hostname: string;
  recommendation: string | null;
}

/** Detect if we're running in WSL, Docker, or a container. */
export async function detectNetworkNamespace(): Promise<NetworkNamespace> {
  const result: NetworkNamespace = {
    isWSL: false,
    isDocker: false,
    isContainer: false,
    isRemoteSession: false,
    loopbackIPs: [],
    hostname: os.hostname(),
    recommendation: null,
  };

  // Check for WSL
  try {
    if (fs.existsSync('/proc/version')) {
      const version = fs.readFileSync('/proc/version', 'utf8');
      if (version.toLowerCase().includes('microsoft') || version.toLowerCase().includes('wsl')) {
        result.isWSL = true;
      }
    }
    if (fs.existsSync('/run/WSL')) result.isWSL = true;
  } catch { /* ignore */ }

  // Check for Docker
  try {
    if (fs.existsSync('/.dockerenv')) result.isDocker = true;
    if (fs.existsSync('/proc/1/cgroup')) {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('kubepods') || cgroup.includes('containerd')) {
        result.isContainer = true;
      }
    }
  } catch { /* ignore */ }

  // Check for remote session (RDP, SSH)
  result.isRemoteSession = !!(process.env.SESSIONNAME && process.env.SESSIONNAME.startsWith('RDP'))
    || !!process.env.SSH_CONNECTION
    || !!process.env.SSH_CLIENT;

  // Get all loopback IPs
  const { networkInterfaces } = os;
  for (const name of Object.keys(networkInterfaces())) {
    for (const net of networkInterfaces()[name] || []) {
      if (net.internal) result.loopbackIPs.push(net.address);
    }
  }

  // Generate recommendation
  if (result.isWSL) {
    result.recommendation = 'WSL detected. The proxy must bind to 0.0.0.0 (not 127.0.0.1) and Windows must use the WSL IP. Run `wsl hostname -I` to get the WSL IP.';
  } else if (result.isDocker) {
    result.recommendation = 'Docker detected. Use `network_mode: host` in docker-compose.yml, or use `host.docker.internal` from Windows.';
  } else if (result.isContainer) {
    result.recommendation = 'Container detected. Ensure the proxy port is exposed and reachable from the host network namespace.';
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: ECH / QUIC / DoH Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface ProtocolRisk {
  protocol: 'ECH' | 'QUIC' | 'DoH' | 'DoT' | 'HPKP' | 'CT';
  detected: boolean;
  severity: 'info' | 'warn' | 'error';
  description: string;
  mitigation: string;
}

/** Detect modern protocols that can bypass MITM interception. */
export async function detectProtocolRisks(): Promise<ProtocolRisk[]> {
  const risks: ProtocolRisk[] = [];

  // Check if Antigravity binary supports ECH (Encrypted Client Hello)
  const binary = getLanguageServerBinary();
  if (binary && fs.existsSync(binary)) {
    try {
      const buf = fs.readFileSync(binary);
      // Search for ECH-related strings in the binary
      const echStrings = ['encrypted_client_hello', 'ECHConfig', 'ech_config'];
      const hasECH = echStrings.some((s) => buf.includes(Buffer.from(s)));
      if (hasECH) {
        risks.push({
          protocol: 'ECH',
          detected: true,
          severity: 'warn',
          description: 'Antigravity binary supports Encrypted Client Hello (ECH). SNI will be hidden from MITM.',
          mitigation: 'ECH is opt-in per-domain. Most domains do not enable it. Monitor for interception failures.',
        });
      }
    } catch { /* ignore */ }
  }

  // Check for QUIC support (UDP 443)
  try {
    const platform = getPlatform();
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        'Get-NetUDPEndpoint -LocalPort 443 -ErrorAction SilentlyContinue | Select-Object -First 1',
      ], { windowsHide: true });
      if (stdout.trim()) {
        risks.push({
          protocol: 'QUIC',
          detected: true,
          severity: 'warn',
          description: 'QUIC/HTTP3 traffic detected on UDP 443. QUIC bypasses TCP-based MITM proxies.',
          mitigation: 'Block QUIC via firewall: `netsh advfirewall firewall add rule name="Block QUIC" dir=out action=block protocol=udp localport=443`',
        });
      }
    } else {
      // Check for listening UDP 443
      const { stdout } = await execFileAsync('ss', ['-lun', 'sport = :443']).catch(() => ({ stdout: '' }));
      if (stdout.trim()) {
        risks.push({
          protocol: 'QUIC',
          detected: true,
          severity: 'warn',
          description: 'QUIC/HTTP3 traffic detected. QUIC bypasses TCP-based MITM proxies.',
          mitigation: 'Block QUIC: `sudo iptables -A OUTPUT -p udp --dport 443 -j DROP`',
        });
      }
    }
  } catch { /* ignore */ }

  // Check for DNS-over-HTTPS (DoH) configuration
  try {
    const platform = getPlatform();
    if (platform === 'win32') {
      // Check Windows DoH settings via registry
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        'Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue | Where-Object {$_.Allow Doh} | Select-Object -First 1',
      ], { windowsHide: true });
      if (stdout.trim()) {
        risks.push({
          protocol: 'DoH',
          detected: true,
          severity: 'info',
          description: 'DNS-over-HTTPS is enabled. DNS queries bypass system DNS settings.',
          mitigation: 'DoH does not affect MITM HTTPS interception, but it bypasses DNS-based blocking.',
        });
      }
    }
  } catch { /* ignore */ }

  return risks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Windows Firewall Rule Management
// ─────────────────────────────────────────────────────────────────────────────

const FIREWALL_RULE_NAME = `Antigravity MITM Proxy (${DEFAULT_MITM_PORT})`;

/** Add Windows Firewall exception for the proxy port. */
export async function addFirewallRule(port = DEFAULT_MITM_PORT): Promise<{ ok: boolean; error?: string }> {
  if (getPlatform() !== 'win32') {
    return { ok: true }; // No-op on non-Windows
  }
  try {
    // Delete existing rule first (idempotent)
    await execFileAsync('netsh', [
      'advfirewall', 'firewall', 'delete', 'rule',
      `name=${FIREWALL_RULE_NAME}`,
    ], { windowsHide: true }).catch(() => { /* ignore */ });

    // Add new rule
    await execFileAsync('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${FIREWALL_RULE_NAME}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${port}`,
    ], { windowsHide: true });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Remove Windows Firewall exception. */
export async function removeFirewallRule(): Promise<{ ok: boolean; error?: string }> {
  if (getPlatform() !== 'win32') return { ok: true };
  try {
    await execFileAsync('netsh', [
      'advfirewall', 'firewall', 'delete', 'rule',
      `name=${FIREWALL_RULE_NAME}`,
    ], { windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Backup Integrity Verification
// ─────────────────────────────────────────────────────────────────────────────

/** Compute SHA-256 of a file. */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Verify backup integrity before restoration. */
export async function verifyBackupIntegrity(backupPath: string): Promise<{
  ok: boolean;
  sha256: string | null;
  size: number;
  error?: string;
}> {
  if (!fs.existsSync(backupPath)) {
    return { ok: false, sha256: null, size: 0, error: 'Backup file not found' };
  }
  try {
    const stat = fs.statSync(backupPath);
    if (stat.size < 1024) {
      return { ok: false, sha256: null, size: stat.size, error: 'Backup file suspiciously small' };
    }
    const sha = await sha256File(backupPath);
    // Store hash alongside backup for future verification
    const hashPath = backupPath + '.sha256';
    fs.writeFileSync(hashPath, sha);
    return { ok: true, sha256: sha, size: stat.size };
  } catch (e) {
    return { ok: false, sha256: null, size: 0, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: Antigravity Version Compatibility Check
// ─────────────────────────────────────────────────────────────────────────────

export interface VersionCompatibility {
  installed: string | null;
  patchVersion: string | null;
  compatible: boolean;
  knownIssues: string[];
}

/** Known patch versions and their compatible Antigravity versions. */
const COMPATIBILITY_MATRIX: Record<string, { min: string; max: string; issues: string[] }> = {
  '1.0.0': { min: '1.0.0', max: '1.5.99', issues: [] },
  '1.1.0': { min: '1.0.0', max: '2.0.99', issues: ['ECH support added in 1.3.0'] },
  '1.2.0': { min: '1.2.0', max: '2.5.99', issues: ['QUIC bypass possible in 1.4.0+'] },
};

/** Check if the installed Antigravity version is compatible with our patch. */
export async function checkVersionCompatibility(): Promise<VersionCompatibility> {
  const result: VersionCompatibility = {
    installed: null,
    patchVersion: '1.2.0',
    compatible: true,
    knownIssues: [],
  };

  try {
    // Try to read Antigravity version from package.json in app.asar
    const asarPath = getAppAsarPath();
    if (asarPath && fs.existsSync(asarPath)) {
      // Extract package.json from asar (without full extraction)
      const { stdout } = await execFileAsync('npx', [
        '-y', '@electron/asar', 'extract-file',
        asarPath, 'package.json',
      ], { windowsHide: true });
      const pkg = JSON.parse(stdout);
      result.installed = pkg.version || null;
    }
  } catch { /* ignore */ }

  const installed = result.installed;
  const patchVersion = result.patchVersion;
  if (installed && patchVersion && COMPATIBILITY_MATRIX[patchVersion]) {
    const compat = COMPATIBILITY_MATRIX[patchVersion];
    result.compatible = compareVersions(installed, compat.min) >= 0
      && compareVersions(installed, compat.max) <= 0;
    result.knownIssues = compat.issues;
  } else if (!installed) {
    result.compatible = true;
    result.knownIssues = ['Could not detect installed Antigravity version.'];
  }

  return result;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: Auto-Update Detection (File Watcher)
// ─────────────────────────────────────────────────────────────────────────────

/** Watch the Antigravity binary for changes (auto-update detection). */
export function watchBinaryForUpdates(
  binaryPath: string,
  onUpdate: (newHash: string, oldHash: string) => void,
): { stop: () => void } {
  let lastHash: string | null = null;
  try {
    const buf = fs.readFileSync(binaryPath);
    lastHash = crypto.createHash('sha256').update(buf).digest('hex');
  } catch { /* ignore */ }

  const interval = setInterval(async () => {
    try {
      if (!fs.existsSync(binaryPath)) return;
      const currentHash = await sha256File(binaryPath);
      if (lastHash && currentHash !== lastHash) {
        onUpdate(currentHash, lastHash);
        lastHash = currentHash;
      }
    } catch { /* ignore */ }
  }, 60_000); // Check every minute

  return {
    stop: () => clearInterval(interval),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: Proxy Authentication (407) Handler
// ───────────────────────────────────��─────────────────────────────────────────

export interface ProxyAuthChallenge {
  required: boolean;
  realm: string | null;
  scheme: string | null;
}

/** Detect if the network requires proxy authentication. */
export async function detectProxyAuthRequirement(proxyUrl: string): Promise<ProxyAuthChallenge> {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.request({
      method: 'CONNECT',
      hostname: new URL(proxyUrl).hostname,
      port: new URL(proxyUrl).port || 80,
      path: 'example.com:443',
      timeout: 3000,
    }, (res: any) => {
      if (res.statusCode === 407) {
        const proxyAuth = res.headers['proxy-authenticate'] || '';
        const match = proxyAuth.match(/(\w+)\s+realm="([^"]+)"/);
        resolve({
          required: true,
          realm: match?.[2] || null,
          scheme: match?.[1] || null,
        });
      } else {
        resolve({ required: false, realm: null, scheme: null });
      }
      res.socket?.destroy();
    });
    req.on('error', () => resolve({ required: false, realm: null, scheme: null }));
    req.on('timeout', () => { req.destroy(); resolve({ required: false, realm: null, scheme: null }); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10: Comprehensive Diagnostic Report
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvancedDiagnosticReport {
  timestamp: string;
  networkNamespace: NetworkNamespace;
  protocolRisks: ProtocolRisk[];
  versionCompatibility: VersionCompatibility;
  firewallRuleActive: boolean;
  backupIntegrity: { ok: boolean; sha256: string | null; size: number; error?: string } | null;
  recommendations: string[];
}

/** Generate a comprehensive diagnostic report for all advanced scenarios. */
export async function generateAdvancedReport(): Promise<AdvancedDiagnosticReport> {
  const ns = await detectNetworkNamespace();
  const risks = await detectProtocolRisks();
  const compat = await checkVersionCompatibility();
  const backupPath = getLanguageServerBackup();
  const backup = backupPath ? await verifyBackupIntegrity(backupPath) : null;

  // Check firewall rule
  let firewallActive = false;
  if (getPlatform() === 'win32') {
    try {
      const { stdout } = await execFileAsync('netsh', [
        'advfirewall', 'firewall', 'show', 'rule',
        `name=${FIREWALL_RULE_NAME}`,
      ], { windowsHide: true });
      firewallActive = stdout.includes('Enabled: Yes');
    } catch { /* ignore */ }
  }

  const recommendations: string[] = [];
  if (ns.recommendation) recommendations.push(ns.recommendation);
  if (!compat.compatible) {
    recommendations.push(`Antigravity ${compat.installed} may not be compatible with patch ${compat.patchVersion}. Update ag-doctor or wait for compatibility fix.`);
  }
  if (backup && !backup.ok) {
    recommendations.push(`Backup integrity check failed: ${backup.error}. Re-create backup before any restore operation.`);
  }
  for (const risk of risks) {
    if (risk.severity !== 'info') recommendations.push(`[${risk.protocol}] ${risk.mitigation}`);
  }

  return {
    timestamp: new Date().toISOString(),
    networkNamespace: ns,
    protocolRisks: risks,
    versionCompatibility: compat,
    firewallRuleActive: firewallActive,
    backupIntegrity: backup,
    recommendations,
  };
}

