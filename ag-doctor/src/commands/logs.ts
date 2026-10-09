/**
 * `ag-doctor logs [-f] [-n N] [--clear] [--clear-all] [--level L] [--stats]`
 *
 * Show, follow, filter, or manage log files.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import { getLsLogPath, getMainLogPath, getProxyLogPath, getAntigravityDataDir } from '../core/paths';
import { error, info, ok, warn, c, header } from '../cli/output';

/** All known log sources and their paths. */
function getLogSources(): Record<string, string> {
  const dir = getAntigravityDataDir();
  return {
    language_server: getLsLogPath(),
    main: getMainLogPath(),
    electron: getMainLogPath(),
    'ag-doctor': getMainLogPath(),
    proxy: getProxyLogPath(),
    serve: path.join(dir, 'serve.log'),
    daemon: path.join(dir, 'daemon.log'),
    'proxy-err': path.join(dir, 'serve.err.log'),
    recovery: path.join(dir, 'recovery.log'),
  };
}

function resolveLogPath(source: string): string {
  const sources = getLogSources();
  return sources[source] ?? sources['language_server'];
}

/** Pretty-print file size for humans. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Filter lines by log level (looks for [ERROR], [WARN], etc. or level keywords). */
function matchesLevel(line: string, level: string): boolean {
  const upper = level.toUpperCase();
  if (upper === 'ALL') return true;

  // Handle Google glog prefix: "ERROR: logging before google.Init: [IWEF]MMDD..."
  const glogMatch = line.match(/^ERROR: logging before google\.Init:\s*([IWEF])/);
  if (glogMatch) {
    const glogSeverity = glogMatch[1];
    switch (upper) {
      case 'ERROR':
        return glogSeverity === 'E' || glogSeverity === 'F';
      case 'WARN':
        return glogSeverity === 'W' || glogSeverity === 'E' || glogSeverity === 'F';
      case 'INFO':
        return glogSeverity === 'I' || glogSeverity === 'W' || glogSeverity === 'E' || glogSeverity === 'F';
      default:
        return true;
    }
  }

  // Match explicit level tags: [ERROR], [WARN], [INFO], [DEBUG]
  // Also match daemon format: ok=0 warn=1 error=1
  switch (upper) {
    case 'ERROR':
      return /\[ERROR\]/i.test(line) || /error[=:]\s*[1-9]/i.test(line) || /FAIL/i.test(line) || /✖|✗/.test(line);
    case 'WARN':
      return matchesLevel(line, 'error') || /\[WARN\]/i.test(line) || /warn[=:]\s*[1-9]/i.test(line) || /⚠/.test(line);
    case 'INFO':
      return matchesLevel(line, 'warn') || /\[INFO\]/i.test(line) || /iteration=/i.test(line);
    default:
      return true;
  }
}

export interface LogsOptions {
  follow?: boolean;
  lines?: number;
  source?: string;
  clear?: boolean;
  clearAll?: boolean;
  level?: string;
  stats?: boolean;
  raw?: boolean;
}

/**
 * Filter out noisy internal logs (remote daemon, remote control, remote VPS, migrations)
 * and format original Antigravity logs with clear visual indicators and remarks.
 */
export function simplifyLogLine(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;

  // Skip orphan repeat markers (×2, ×3, etc.) and already-simplified lines passed through
  if (/^[×x]\d+/.test(line)) return null;
  if (/^\[i\]\s+Log:/i.test(line)) return null;
  if (/^---\s+following\s+.*(Ctrl\+C to stop)\s+---/i.test(line)) return null;

  // Skip lines that are already formatted by simplifyLogLine (passed through a second time)
  if (/^[🚀✔✖⚠🔑📡📚🌐👤📁🔄ℹ️][^\n]*\[(?:DÉMARRAGE|PRÊT|ERREUR|AVERT|AUTH|REQUÊTE|SESSIONS|RÉSEAU|COMPTE|PROJET|FALLBACK|PROXY|SESSION|INFO|VERSION|ROTATION)\]/u.test(line)) return null;

  // 1. Suppress decorative dividers, banners, empty boxes, and routine CLI messages
  if (/^[=\-_*#]{3,}$/.test(line)) return null;
  if (/^(?:Local|LS Logs|Electron Logs):\s+/i.test(line)) return null;
  if (/^\(Use\s+`?Antigravity\s+--trace-warnings/i.test(line)) return null;
  if (/^Power save blocker started/i.test(line)) return null;
  if (/^\[IDE Wizard\]/i.test(line)) return null;
  if (/^(?:l|nternal):streamGenerateContent\?alt=sse/i.test(line)) return null;
  if (/^waiting for response headers after/i.test(line)) return null;
  if (/^(?:p|e)rsisted state: budget=/i.test(line)) return null;
  if (/^(?:Starting app|Host bridge server listening)/i.test(line)) return null;
  if (/^(?:efresh failed with status 500|"error":\s*"internal_failure")/i.test(line)) return null;
  if (/json changed on disk\. Invalidating model caches/i.test(line)) return null;
  if (/^(?:ng auto update checks|\d+\.\d+ is not available \(latest version)/i.test(line)) return null;

  // 2. Suppress remote daemon, remote control, and remote VPS logs
  if (
    /\[RemoteControl\]/i.test(line) ||
    /\[CDP Discovery\]/i.test(line) ||
    /remote\s*vps/i.test(line) ||
    /remote-daemon/i.test(line) ||
    /daemon\.go/i.test(line) ||
    /agent\s*runtime/i.test(line) ||
    /remote agent/i.test(line) ||
    /fastpush pin gate/i.test(line) ||
    /Staying disconnected: Remote Control/i.test(line) ||
    /Subscription callback triggered/i.test(line) ||
    /RemoteControlEnabled/i.test(line) ||
    /Resolved proxyServerURL/i.test(line)
  ) {
    return null;
  }

  // 3. Suppress internal Go/migration startup noise & routine background bookkeeping
  if (
    /Migration \[MIGRATION_ID_/i.test(line) ||
    /failed to get cs path/i.test(line) ||
    /Continuous pprof profiling/i.test(line) ||
    /Projects migration already started/i.test(line) ||
    /Retroactive projects migration/i.test(line) ||
    /Using bundled agy-node/i.test(line) ||
    /Setting GOMAXPROCS/i.test(line) ||
    /attempt to listen on host localhost/i.test(line) ||
    /Serving UI bundle from embedded assets/i.test(line) ||
    /TLS handshake error/i.test(line) ||
    /SetEnableBusinessLogin/i.test(line) ||
    /UpdateEndpointURL skipping update/i.test(line) ||
    /\[AuthProvider\] SetProjectID called with projectID: ""/i.test(line) ||
    /\[AuthProvider\] SetLocation called with location: ""/i.test(line) ||
    /\[AuthProvider\] SetUserTier called with userTier: "", tierDisplayName: ""/i.test(line) ||
    /summary store: starting background reconciliation/i.test(line) ||
    /Creating trajectory store manager/i.test(line) ||
    /failed to load external trajectory.*cannot find the file specified/i.test(line) ||
    /unexpected status CORTEX_STEP_STATUS_CANCELED/i.test(line) ||
    /serializer encountered non-tool step/i.test(line) ||
    /request would have ended on a model turn/i.test(line) ||
    /AutoUpdater/i.test(line) ||
    /Checking for update/i.test(line) ||
    /Update for version.*is not available/i.test(line) ||
    /Up to date/i.test(line) ||
    /State refresh took/i.test(line)
  ) {
    return null;
  }

  // 4. Parse Google glog prefix or Electron log prefix:
  const glogMatch = line.match(/^(?:ERROR:\s+logging\s+before\s+google\.Init:\s*)?([IWEF])\d{4}\s+[\d:.]+\s+\d+\s+([^\]]+)\]\s*(.*)$/);
  const electronMatch = line.match(/^\[?\d{4}-\d{2}-\d{2}[T\s][\d:.]+Z?\]?\s+\[(info|warn|error|debug|verbose)\]\s*(.*)$/i);

  let severity = 'I';
  let location = '';
  let msg = line;

  if (glogMatch) {
    severity = glogMatch[1];
    location = glogMatch[2]; // e.g. "server.go:1584"
    msg = glogMatch[3].trim();
  } else if (electronMatch) {
    const lvl = electronMatch[1].toLowerCase();
    if (lvl === 'error') severity = 'E';
    else if (lvl === 'warn') severity = 'W';
    msg = electronMatch[2].trim();
  } else {
    const truncMatch = line.match(/^\d{1,4}\s+[\d:.]+\]\s+\[(?:info|warn|error)\]\s*(.*)/i);
    if (truncMatch) msg = truncMatch[1].trim();
  }

  // Strip any leaked or nested date/time/level fragments from msg
  msg = msg
    .replace(/^\[?\d{2,4}[-/]\d{2}[-/]\d{2}[T\s][\d:.]+Z?\]?\s*(?:\[(?:info|warn|error|debug|verbose)\])?\s*/i, '')
    .replace(/^\d{1,4}\s+[\d:.]+\]\s*(?:\[(?:info|warn|error|debug|verbose)\])?\s*/i, '')
    .replace(/^\[(?:info|warn|error|debug|verbose)\]\s*/i, '')
    .trim();

  if (!msg) return null;

  // Double check message content after stripping
  if (
    /\[RemoteControl\]/i.test(msg) ||
    /\[CDP Discovery\]/i.test(msg) ||
    /Migration \[/i.test(msg) ||
    /failed to load external trajectory/i.test(msg) ||
    /summary store: starting background reconciliation/i.test(msg) ||
    /SetEnableBusinessLogin/i.test(msg) ||
    /UpdateEndpointURL/i.test(msg) ||
    /SetProjectID called with projectID: ""/i.test(msg) ||
    /SetLocation called with location: ""/i.test(msg) ||
    /SetUserTier called with userTier: "", tierDisplayName: ""/i.test(msg) ||
    /Setting GOMAXPROCS/i.test(msg) ||
    /Continuous pprof profiling/i.test(msg) ||
    /Projects migration already started/i.test(msg) ||
    /Retroactive projects migration/i.test(msg) ||
    /Using bundled agy-node/i.test(msg) ||
    /attempt to listen on host localhost/i.test(msg) ||
    /Serving UI bundle from embedded assets/i.test(msg) ||
    /Creating trajectory store manager/i.test(msg) ||
    /failed to get cs path/i.test(msg) ||
    /fastpush pin gate/i.test(msg) ||
    /Monitor agy_tool_safety/i.test(msg) ||
    /runner\.go:\d+\]\s*Monitor/i.test(msg) ||
    /unsupported_tool:\s*replace_file_content/i.test(msg) ||
    /Monitor severe_internal_risks_agy/i.test(msg) ||
    /LLM Monitor severe_internal_risks_agy/i.test(msg) ||
    /LLM_MONITOR_LLM_CALL_FAILED/i.test(msg) ||
    /AutoUpdater/i.test(msg) ||
    /Checking for update/i.test(msg) ||
    /Update for version.*is not available/i.test(msg) ||
    /Up to date/i.test(msg) ||
    /SEND_USER_CASCADE_MESSAGE_LATENCY/i.test(msg) ||
    /\[Sonar\]/i.test(msg) ||
    /externalMonitorConfigManager/i.test(msg) ||
    /CORTEX_MEMORY_TRIGGER_UNSPECIFIED/i.test(msg) ||
    /Invalid rule trigger: CORTEX_MEMORY_TRIGGER/i.test(msg) ||
    /\[IPC\] remote:set-state/i.test(msg) ||
    /Cancel during force stop of conversation/i.test(msg) ||
    /executor is not currently running/i.test(msg) ||
    /latency_breakdown\.go/i.test(msg) ||
    /llm_monitor\.go/i.test(msg) ||
    /rules\.go.*Invalid rule trigger/i.test(msg) ||
    /runner\.go/i.test(msg) ||
    /cascade_manager\.go/i.test(msg) ||
    /errorreport\.go/i.test(msg) ||
    /State refresh took/i.test(msg)
  ) {
    return null;
  }

  // 5. Dedicated Proxy Message Formatter
  if (/\[Proxy\]/i.test(msg)) {
    const pContent = msg.replace(/^.*?\[Proxy\]\s*/i, '').trim();
    if (!pContent) return null;

    if (/Cooldown Verification \/ Wake-up/i.test(pContent)) {
      return `${c.green('🟢 [COOLDOWN]')}  ${pContent.replace(/^🟢\s*/, '')}`;
    }
    if (/All remaining accounts in pool are in cooldown/i.test(pContent)) {
      return `${c.red('✖ [PROXY]')}      ${pContent}`;
    }
    if (/^⚠️|^HTTP\s*(?:429|500|502|503|504)|received HTTP|cooldown to prevent stalling|failed upstream/i.test(pContent)) {
      return `${c.yellow('⚠ [PROXY]')}      ${pContent.replace(/^⚠️\s*/, '')}`;
    }
    if (/^🔄|^Fast-skipping candidate|^Skipping fallback model/i.test(pContent)) {
      return `${c.yellow('🔄 [ROTATION]')}  ${pContent.replace(/^🔄\s*/, '')}`;
    }
    if (/^Cross-model fallback to (\S+)/i.test(pContent)) {
      const mMatch = pContent.match(/fallback to (\S+)/i);
      return `${c.yellow('🔄 [FALLBACK]')}  Bascule automatique vers ${mMatch ? mMatch[1] : 'modèle de secours'}`;
    }
    if (/Server listening on http:\/\/([^:]+):(\d+)/i.test(pContent)) {
      const pMatch = pContent.match(/http:\/\/([^:]+):(\d+)/i);
      return `${c.green('🌐 [PROXY]')}     Proxy local en écoute sur le port ${pMatch ? pMatch[2] : '51074'}`;
    }
    if (/Intercepting (\S+)/i.test(pContent)) {
      const apiMatch = pContent.match(/Intercepting (\S+)/i);
      return `${c.blue('📡 [PROXY]')}     Interception de ${apiMatch ? apiMatch[1] : 'requête'}`;
    }
    return `${c.cyan('📡 [PROXY]')}     ${pContent}`;
  }

  // 6. Dedicated GoogleAuth Message Formatter
  if (/\[GoogleAuth\]/i.test(msg)) {
    const authContent = msg.replace(/^.*?\[GoogleAuth\]\s*/i, '').trim();
    if (!authContent) return null;
    return `${c.yellow('🔑 [AUTH]')}      ${authContent}`;
  }

  // 7. Stale session handling
  if (/trajectory .* not found in any store/i.test(msg)) {
    const uuid = msg.match(/trajectory\s+([0-9a-f-]{36})/i)?.[1]?.slice(0, 8) || '?';
    return `${c.yellow('⚠ [SESSION]')}    Session introuvable (${uuid}…) — relance Antigravity ou exécute ag-doctor db:prune`;
  }
  if (/StreamAgentStateUpdates.*failed to ensure trajectory/i.test(msg)) return null;
  if (/error during input detection model call.*context canceled/i.test(msg)) return null;

  // 8. General Errors & Warnings
  if (severity === 'E' || severity === 'F' || /context deadline exceeded/i.test(msg)) {
    if (/context deadline exceeded/i.test(msg)) {
      return `${c.red('✖ [ERREUR]')}    ${c.bold(msg)} ${c.yellow('— Délai d\'attente dépassé (timeout proxy/amont)')}`;
    }
    return `${c.red('✖ [ERREUR]')}    ${msg}${location ? c.gray(` (${location})`) : ''}`;
  }

  if (severity === 'W') {
    return `${c.yellow('⚠ [AVERT]')}      ${msg}${location ? c.gray(` (${location})`) : ''}`;
  }

  // 9. Standard Lifecycle & Network messages
  if (/Starting language server process/i.test(msg)) {
    const pidMatch = msg.match(/pid\s+(\d+)/i);
    const pid = pidMatch ? ` (PID ${pidMatch[1]})` : '';
    return `${c.green('🚀 [DÉMARRAGE]')} Language Server en cours de lancement${pid}`;
  }
  if (/Language server listening on random port at (\d+) for (HTTPS|HTTP)/i.test(msg)) {
    const netMatch = msg.match(/at (\d+) for (HTTPS|HTTP)/i);
    if (netMatch) {
      return `${c.cyan('🌐 [RÉSEAU]')}    Port d'écoute ${netMatch[2]} : ${netMatch[1]}`;
    }
    return `${c.cyan('🌐 [RÉSEAU]')}    ${msg}`;
  }
  if (/Language server version:\s*(\S+)/i.test(msg)) {
    const ver = msg.match(/version:\s*(\S+)/i)?.[1] || '';
    return `${c.cyan('ℹ️  [VERSION]')}   Language Server v${ver}`;
  }
  if (/initialized server successfully in\s*([\d.]+\w*)/i.test(msg)) {
    const duration = msg.match(/in\s*([\d.]+\w*)/i)?.[1] || '';
    return `${c.green('✔ [PRÊT]')}       Language Server prêt et initialisé (${duration})`;
  }
  if (/Auth succeeded/i.test(msg)) {
    return `${c.green('✔ [AUTH]')}       Authentification Google Cloud Code réussie`;
  }
  if (/URL:\s*(http\S+)/i.test(msg)) {
    const urlMatch = msg.match(/URL:\s*(http\S+)/i);
    const url = urlMatch ? urlMatch[1] : msg;
    const endpoint = url.split('/').pop() || url;
    return `${c.blue('📡 [REQUÊTE]')}   Antigravity -> Proxy : ${endpoint}`;
  }
  if (/summary store: reconciliation complete,\s*synced\s*(\d+)\s*records/i.test(msg)) {
    const count = msg.match(/synced\s*(\d+)/i)?.[1] || '';
    return `${c.gray('📚 [SESSIONS]')}  ${count} conversations synchronisées`;
  }
  if (/\[Summaries\]\s*reconcile checked/i.test(msg)) {
    return `${c.gray('📚 [SESSIONS]')}  Vérification de l'intégrité des conversations terminée`;
  }
  if (/\[AuthProvider\]\s*SetUserTier.*userTier:\s*"([^"]+)"/i.test(msg)) {
    const tier = msg.match(/userTier:\s*"([^"]+)"/)?.[1];
    return `${c.green('👤 [COMPTE]')}    Niveau utilisateur activé : ${tier}`;
  }
  if (/\[AuthProvider\]\s*SetProjectID.*projectID:\s*"([^"]+)"/i.test(msg)) {
    const pid = msg.match(/projectID:\s*"([^"]+)"/)?.[1];
    return `${c.cyan('📁 [PROJET]')}    Projet GCP : ${pid}`;
  }
  if (/Request\s*->\s*(http\S+)/i.test(msg)) {
    const urlMatch = msg.match(/Request\s*->\s*(http\S+)/i);
    const url = urlMatch ? urlMatch[1] : msg;
    const endpoint = url.split('/').pop() || url;
    return `${c.blue('📡 [REQUÊTE]')}   Antigravity -> Proxy : ${endpoint}`;
  }

  return `${c.gray('ℹ️  [INFO]')}      ${msg}`;
}

export async function runLogs(ctx: CommandContext, opts: LogsOptions): Promise<number> {
  // ── Stats mode: show all log files with sizes ──
  if (opts.stats) {
    const sources = getLogSources();
    if (!ctx.json) header('Log files');
    const rows: Array<{ source: string; path: string; size: number; lines: number; exists: boolean }> = [];

    for (const [name, fp] of Object.entries(sources)) {
      if (!fs.existsSync(fp)) {
        rows.push({ source: name, path: fp, size: 0, lines: 0, exists: false });
        continue;
      }
      const stat = fs.statSync(fp);
      const lineCount = fs.readFileSync(fp, 'utf-8').split(/\r?\n/).filter(Boolean).length;
      rows.push({ source: name, path: fp, size: stat.size, lines: lineCount, exists: true });
    }

    if (ctx.json) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }

    let totalSize = 0;
    for (const r of rows) {
      const icon = !r.exists ? c.gray('○') : r.size === 0 ? c.green('○') : c.cyan('●');
      const size = r.exists ? humanSize(r.size) : '—';
      const lines = r.exists ? `${r.lines} lines` : '';
      console.log(`  ${icon} ${c.bold(r.source.padEnd(18))} ${size.padEnd(10)} ${c.gray(lines)}`);
      totalSize += r.size;
    }
    console.log('');
    info(`Total: ${humanSize(totalSize)} across ${rows.filter(r => r.exists).length} file(s)`);
    return 0;
  }

  // ── Clear-all mode: wipe every log file ──
  if (opts.clearAll) {
    const sources = getLogSources();
    let cleared = 0;
    for (const [name, fp] of Object.entries(sources)) {
      if (fs.existsSync(fp)) {
        fs.writeFileSync(fp, '', 'utf-8');
        cleared++;
      }
      // Also clear rotated .1 files
      if (fs.existsSync(fp + '.1')) {
        fs.unlinkSync(fp + '.1');
      }
    }
    ok(`Cleared ${cleared} log file(s)`);
    return 0;
  }

  // ── Single source mode ──
  const source = opts.source || 'language_server';
  const targetPath = resolveLogPath(source);

  if (!fs.existsSync(targetPath)) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, '', 'utf-8');
    } catch {
      error(`Log file not found and could not be created: ${targetPath}`);
      return 1;
    }
  }

  // ── Clear mode ──
  if (opts.clear) {
    fs.writeFileSync(targetPath, '', 'utf-8');
    // Also clear rotated .1 file if present
    if (fs.existsSync(targetPath + '.1')) fs.unlinkSync(targetPath + '.1');
    ok(`Cleared: ${targetPath}`);
    return 0;
  }

  info(`Log: ${targetPath}`);
  const lineCount = opts.lines ?? 50;
  const level = opts.level || 'all';

  const collapseLines = (inputLines: string[]): string[] => {
    const out: string[] = [];
    const normLine = (s: string) =>
      s
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]?/g, '')
        .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '')
        .trim();
    let lastNorm = '';
    let repeatCount = 1;
    for (const l of inputLines) {
      if (!l) continue;
      const n = normLine(l);
      if (out.length > 0 && n === lastNorm) {
        repeatCount++;
      } else {
        if (repeatCount > 1 && out.length > 0) {
          out[out.length - 1] += c.gray(` (×${repeatCount})`);
        }
        out.push(l);
        lastNorm = n;
        repeatCount = 1;
      }
    }
    if (repeatCount > 1 && out.length > 0) {
      out[out.length - 1] += c.gray(` (×${repeatCount})`);
    }
    return out;
  };

  if (!opts.follow) {
    const content = fs.readFileSync(targetPath, 'utf-8');
    let lines = content.split(/\r?\n/);
    if (level !== 'all') {
      lines = lines.filter(l => matchesLevel(l, level));
    }
    if (!opts.raw) {
      lines = lines.map(simplifyLogLine).filter((l): l is string => Boolean(l));
    }
    lines = collapseLines(lines);
    const tail = lines.slice(-lineCount).join('\n');
    console.log(tail);
    return 0;
  }

  // ── Follow mode ──
  let pos = fs.statSync(targetPath).size;
  let remainder = '';
  console.log(`--- following ${targetPath} (Ctrl+C to stop) ---`);
  const tick = setInterval(() => {
    fs.stat(targetPath, (err, st) => {
      if (err) return;
      if (st.size > pos) {
        let fd: number | null = null;
        try {
          fd = fs.openSync(targetPath, 'r');
          const bytesToRead = st.size - pos;
          const buffer = Buffer.alloc(bytesToRead);
          fs.readSync(fd, buffer, 0, bytesToRead, pos);
          pos = st.size;

          const rawChunk = remainder + buffer.toString('utf-8');
          const lastNewline = rawChunk.lastIndexOf('\n');
          if (lastNewline === -1) {
            remainder = rawChunk;
            return;
          }
          remainder = rawChunk.slice(lastNewline + 1);
          const completeChunk = rawChunk.slice(0, lastNewline);

          let chunkLines = completeChunk.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (level !== 'all') {
            chunkLines = chunkLines.filter(l => matchesLevel(l, level));
          }
          const processed = opts.raw
            ? chunkLines
            : chunkLines.map(simplifyLogLine).filter((l): l is string => Boolean(l));
          const collapsed = collapseLines(processed);
          if (collapsed.length > 0) {
            console.log(collapsed.join('\n'));
          }
        } catch {
          // ignore transient read lock
        } finally {
          if (fd !== null) {
            try { fs.closeSync(fd); } catch {}
          }
        }
      } else if (st.size < pos) {
        // File was truncated (rotation) — reset position
        pos = 0;
        remainder = '';
      }
    });
  }, 500);
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      clearInterval(tick);
      resolve();
    });
  });
  return 0;
}
