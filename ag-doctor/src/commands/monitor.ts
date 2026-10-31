/**
 * `ag-doctor monitor` — live resource monitoring for Antigravity / language_server.
 *
 * Polls the language_server process every 2s and prints CPU/RAM/threads.
 * Press Ctrl+C to stop.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info } from '../cli/output';
import { findAntigravityProcesses, type ProcessInfo } from '../core/process';
import { loadConfig } from '../core/config';

const execFileAsync = promisify(execFile);

const USAGE = `ag-doctor monitor — live resource monitoring

Usage:
  ag-doctor monitor           Monitor Antigravity / language_server process
  ag-doctor monitor --pid N   Monitor a specific PID
  ag-doctor monitor --json    Output JSON lines

Press Ctrl+C to stop.
`;

interface Sample {
  timestamp: string;
  pid: number;
  cpuPercent: number;
  ramMb: number;
  threads: number;
}

export async function runMonitor(ctx: CommandContext): Promise<number> {
  const opts = ctx.options ?? {};
  const pidArg = Number(opts.pid);
  const json = Boolean(opts.json);
  const interval = Number(opts.interval) || 2000;

  if (opts.help || opts.h) {
    console.log(USAGE);
    return 0;
  }

  let target: ProcessInfo | null = null;
  if (Number.isFinite(pidArg)) {
    target = { pid: pidArg, command: `PID ${pidArg}` };
  } else {
    const procs = await findAntigravityProcesses();
    if (procs.length === 0) {
      const lsPid = await findLanguageServerPid();
      if (lsPid) {
        target = { pid: lsPid, command: 'language_server' };
      }
    } else {
      target = procs[0];
    }
  }

  if (!target) {
    error('No Antigravity or language_server process found. Use --pid to target a specific process.');
    return 1;
  }

  if (!json) header(`Monitor — ${target.command} (PID ${target.pid})`);
  if (!json) info(`Sampling every ${interval}ms — Ctrl+C to stop`);

  const history: Sample[] = [];

  return new Promise((resolve) => {
    const tick = async () => {
      const sample = await sampleProcess(target!.pid);
      if (!sample) {
        if (!json) error(`Process ${target!.pid} exited`);
        else console.log(JSON.stringify({ event: 'exit', pid: target!.pid }));
        resolve(0);
        return;
      }
      history.push(sample);
      if (history.length > 60) history.shift();
      if (json) {
        console.log(JSON.stringify(sample));
      } else {
        printSample(sample);
        printSparkline(history.map((s) => s.ramMb), 'RAM MB');
      }
    };

    tick();
    const handle = setInterval(() => {
      tick().catch((e) => {
        if (!json) error(`Sample failed: ${(e as Error).message}`);
      });
    }, interval);

    process.on('SIGINT', () => {
      clearInterval(handle);
      if (!json) info('Stopped');
      resolve(0);
    });
    process.on('SIGTERM', () => {
      clearInterval(handle);
      resolve(0);
    });
  });
}

async function findLanguageServerPid(): Promise<number | null> {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq language_server.exe', '/FO', 'CSV', '/NH']);
      const m = stdout.match(/^"language_server\.exe","(\d+)"/m);
      return m ? parseInt(m[1], 10) : null;
    }
    const { stdout } = await execFileAsync('pgrep', ['-f', 'language_server']);
    const pid = parseInt(stdout.trim().split('\n')[0], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function sampleProcess(pid: number): Promise<Sample | null> {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('wmic', [
        'process',
        'where',
        `ProcessId=${pid}`,
        'get',
        'WorkingSetSize,ThreadCount,PercentProcessorTime',
        '/value',
      ]);
      const ramBytes = parseInt(matchOne(stdout, /WorkingSetSize=(\d+)/) || '0', 10);
      const threads = parseInt(matchOne(stdout, /ThreadCount=(\d+)/) || '0', 10);
      const cpu = parseFloat(matchOne(stdout, /PercentProcessorTime=(\d+(?:\.\d+)?)/) || '0');
      return { timestamp: new Date().toISOString(), pid, cpuPercent: cpu, ramMb: Math.round(ramBytes / 1024 / 1024), threads };
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=,rss=,nlwp=']);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 3) return null;
    return {
      timestamp: new Date().toISOString(),
      pid,
      cpuPercent: parseFloat(parts[0]),
      ramMb: Math.round(parseInt(parts[1], 10) / 1024),
      threads: parseInt(parts[2], 10),
    };
  } catch {
    return null;
  }
}

function matchOne(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function printSample(s: Sample): void {
  const cpu = s.cpuPercent.toFixed(1);
  const ram = s.ramMb;
  const threads = s.threads;
  console.log(`  ${c.gray(s.timestamp)}  CPU ${c.cyan(`${cpu}%`)}  RAM ${c.cyan(`${ram} MB`)}  Threads ${c.cyan(threads)}`);
}

function printSparkline(values: number[], label: string): void {
  if (values.length === 0) return;
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values, 1);
  const line = values.map((v) => blocks[Math.min(blocks.length - 1, Math.floor((v / max) * (blocks.length - 1)))]).join('');
  console.log(`  ${c.gray(label)} ${line} ${c.gray(`max ${max}`)}`);
}
