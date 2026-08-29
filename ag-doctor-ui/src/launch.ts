/**
 * Electron launcher that filters known-harmless Chromium GPU initialization
 * warnings from stderr. These appear on some Windows setups even when all
 * GPU-disabling switches are set, because the GPU process initializes
 * before application-level code can suppress it.
 */
import { spawn, type SpawnOptions } from 'child_process';
import path from 'path';

const FILTERED_PATTERNS = [
  /gpu_channel_manager\.cc\(\d+\)/,
  /ContextResult::kFatalFailure/,
  /Failed to create GLES3 context/,
  /fallback to GLES2/,
  /Failed to create shared context for virtualization/,
] as const;

function shouldFilter(line: string): boolean {
  return FILTERED_PATTERNS.some((p) => p.test(line));
}

function resolveElectronBin(): string {
  // On Windows, npm creates .cmd shims that cmd.exe can execute directly.
  // The extensionless shim is a shell script and will ENOENT under spawn(shell:false).
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        path.join(process.cwd(), 'node_modules', '.bin', 'electron.cmd'),
        path.join(process.cwd(), 'node_modules', '.bin', 'electron.ps1'),
      ]
    : [
        path.join(process.cwd(), 'node_modules', '.bin', 'electron'),
      ];
  for (const candidate of candidates) {
    if (require('fs').existsSync(candidate)) {
      return candidate;
    }
  }
  return 'electron';
}

function launch(): void {
  const electronBin = resolveElectronBin();
  const args = ['.', '--disable-gpu'];

  const isWin = process.platform === 'win32';
  const opts: SpawnOptions = {
    stdio: ['inherit', 'inherit', 'pipe'],
    shell: isWin,
  };

  // When shell=true on Windows, pass the full command as a single string
  // so Node doesn't emit the DEP0190 deprecation warning.
  const child = isWin
    ? spawn(`"${electronBin}" ${args.map((a) => `"${a}"`).join(' ')}`, opts)
    : spawn(electronBin, args, opts);

  if (!child.stderr) {
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  let buffer = '';
  child.stderr.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line && !shouldFilter(line)) {
        process.stderr.write(line + '\n');
      }
    }
  });

  child.stderr.on('end', () => {
    if (buffer.trim() && !shouldFilter(buffer.trim())) {
      process.stderr.write(buffer + '\n');
    }
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    process.stderr.write(`Failed to start Electron: ${err.message}\n`);
    process.exit(1);
  });
}

launch();
