/**
 * `ag-doctor logs [-f] [-n N] [--clear] [--clear-all] [--level L] [--stats]`
 *
 * Show, follow, filter, or manage log files.
 */
import fs from 'fs';
import path from 'path';
import type { CommandContext } from '../types';
import { getLsLogPath, getAntigravityDataDir } from '../core/paths';
import { error, info, ok, warn, c, header } from '../cli/output';

/** All known log sources and their paths. */
function getLogSources(): Record<string, string> {
  const dir = getAntigravityDataDir();
  return {
    language_server: getLsLogPath(),
    daemon: path.join(dir, 'daemon.log'),
    proxy: path.join(dir, 'serve.log'),
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

  if (!opts.follow) {
    const content = fs.readFileSync(targetPath, 'utf-8');
    let lines = content.split(/\r?\n/);
    if (level !== 'all') {
      lines = lines.filter(l => matchesLevel(l, level));
    }
    const tail = lines.slice(-lineCount).join('\n');
    console.log(tail);
    return 0;
  }

  // ── Follow mode ──
  let pos = fs.statSync(targetPath).size;
  console.log(`--- following ${targetPath} (Ctrl+C to stop) ---`);
  const tick = setInterval(() => {
    fs.stat(targetPath, (err, st) => {
      if (err) return;
      if (st.size > pos) {
        const chunk = fs.readFileSync(targetPath, { encoding: 'utf-8' }).slice(pos);
        if (level === 'all') {
          process.stdout.write(chunk);
        } else {
          const filtered = chunk.split(/\r?\n/).filter(l => matchesLevel(l, level)).join('\n');
          if (filtered.trim()) process.stdout.write(filtered + '\n');
        }
        pos = st.size;
      } else if (st.size < pos) {
        // File was truncated (rotation) — reset position
        pos = 0;
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
