import { execSync } from 'child_process';
import net from 'net';

/**
 * LocalHarness discovery — validated against real processes found on this machine
 * (see remote/localharness.md): the binary is `language_server` and exposes:
 *   --csrf_token                    (cloud endpoint auth)
 *   --extension_server_csrf_token   (LOCAL RPC auth — the one ConnectRPC expects)
 *   --extension_server_port <base>  (ConnectRPC listens on base+1 .. base+20)
 *   --workspace_id                  (bound project)
 *   --subclient_type                (ide | hub)
 */
export interface LocalHarnessInfo {
  pid: number;
  processName: string;
  csrfToken: string;
  extensionCsrfToken: string;
  extensionServerPort: number;
  workspaceId: string;
  subclientType: string;
  connectRpcPort: number;
}

interface ProcEntry {
  pid: number;
  name: string;
  commandLine: string;
}

export function findLanguageServer(): ProcEntry | null {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress`;
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
        encoding: 'utf-8',
        maxBuffer: 4 * 1024 * 1024,
      }).trim();
      if (!out) return null;
      const parsed = JSON.parse(out);
      const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
      // L'instance qui expose le service RPC est le hub standalone
      // (--subclient_type hub). Les instances IDE répondent 404.
      const pick =
        list.find((p) => /--subclient_type hub/.test(p.CommandLine || '')) || list[0];
      return { pid: pick.ProcessId, name: pick.Name || '', commandLine: pick.CommandLine || '' };
    }
    const out = execSync(`ps aux | grep -i language_server | grep -v grep`, {
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
    const line = out.split('\n')[0];
    if (!line) return null;
    const fields = line.split(/\s+/);
    return { pid: parseInt(fields[1], 10), name: fields[0], commandLine: line };
  } catch {
    return null;
  }
}

function argValue(commandLine: string, name: string): string {
  const re = new RegExp(`--${name}(?:=|\\s+)([^\\s"]+)`);
  const m = commandLine.match(re);
  return m ? m[1] : '';
}

export function checkPort(port: number, host = process.env.AG_BIND_HOST || '127.0.0.1', timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/** Envoie un Heartbeat gRPC-Web (frame vide) — seul critère fiable. */
async function probeService(port: number, csrfToken: string): Promise<boolean> {
  const host = process.env.AG_BIND_HOST || '127.0.0.1';
  const url = `http://${host}:${port}/exa.language_server_pb.LanguageServerService/Heartbeat`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        Accept: 'application/grpc-web+proto,application/grpc-web-text',
        'x-codeium-csrf-token': csrfToken,
        'Connect-Protocol-Version': '1',
        'X-Grpc-Web': '1',
      },
      body: Buffer.alloc(5), // frame gRPC-Web vide
      signal: AbortSignal.timeout(3000),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/** Ports d'écoute du PID (netstat) — pour les hubs sans extension_server_port. */
function listeningPortsForPID(pid: number): number[] {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
    const ports: number[] = [];
    for (const line of out.split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length < 5 || f[4] !== String(pid) || !f[3].includes('LISTEN')) continue;
      const addr = f[1];
      const idx = addr.lastIndexOf(':');
      const port = parseInt(addr.slice(idx + 1), 10);
      if (!Number.isNaN(port) && port > 0) ports.push(port);
    }
    return ports;
  } catch {
    return [];
  }
}

export async function discoverLocalHarness(): Promise<LocalHarnessInfo | null> {
  // Allow manual overrides (e.g. when the process scan fails or IDE restarted).
  const envPort = process.env.AG_REMOTE_PORT;
  const envCsrf = process.env.AG_REMOTE_CSRF;
  const envWorkspace = process.env.AG_WORKSPACE;

  const proc = findLanguageServer();
  if (!proc && !envPort) {
    console.error('❌ language_server process not found. Is Antigravity IDE open?');
    console.error('   Tip: set AG_REMOTE_PORT / AG_REMOTE_CSRF to skip discovery.');
    return null;
  }

  const basePort = parseInt(argValue(proc?.commandLine || '', 'extension_server_port') || envPort || '', 10);
  const csrfToken = argValue(proc?.commandLine || '', 'csrf_token');
  const extensionCsrfToken =
    argValue(proc?.commandLine || '', 'extension_server_csrf_token') || envCsrf || csrfToken;

  // Prober chaque port candidat avec un vrai Heartbeat gRPC-Web
  // (seul critère fiable : le port doit exposer LanguageServerService).
  // - Avec extension_server_port : tester base+1..base+20
  // - Sans (hub standalone, port OS-assigné) : utiliser netstat sur le PID
  let candidates = basePort
    ? Array.from({ length: 20 }, (_, i) => basePort + i + 1)
    : proc
      ? listeningPortsForPID(proc.pid)
      : [];
  const token = extensionCsrfToken || csrfToken;
  let connectRpcPort = 0;
  for (const port of candidates) {
    if (await probeService(port, token)) {
      connectRpcPort = port;
      break;
    }
  }

  if (!connectRpcPort) {
    console.error('❌ No active ConnectRPC port found in extension_server_port+1..+20.');
    return null;
  }

  return {
    pid: proc?.pid || 0,
    processName: proc?.name || 'env-override',
    csrfToken,
    extensionCsrfToken,
    extensionServerPort: basePort,
    workspaceId: argValue(proc?.commandLine || '', 'workspace_id') || envWorkspace || '',
    subclientType: argValue(proc?.commandLine || '', 'subclient_type') || '',
    connectRpcPort,
  };
}

// Run directly: `npm run scan`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  discoverLocalHarness().then((info) => {
    if (info) {
      console.log('✅ LanguageServer Discovered:');
      console.log(`   PID:                  ${info.pid}`);
      console.log(`   Process:              ${info.processName}`);
      console.log(`   Subclient type:       ${info.subclientType || '(unknown)'}`);
      console.log(`   Workspace ID:         ${info.workspaceId || '(none)'}`);
      console.log(`   Extension port:       ${info.extensionServerPort}`);
      console.log(`   ConnectRPC port:      ${info.connectRpcPort}`);
      console.log(`   Extension CSRF:       ${info.extensionCsrfToken ? info.extensionCsrfToken.substring(0, 8) + '...' : 'NONE'}`);
    }
  });
}
