#!/usr/bin/env node
/**
 * ag-doctor — entry point shim.
 *
 * Two modes:
 *  - Normal: spawns the compiled entry from dist/ (one-shot CLI).
 *  - Worker (--worker): runs in-process, reads JSON commands from stdin
 *    (newline-delimited) and writes JSON results to stdout. This avoids the
 *    double-spawn cost when the Electron UI calls the CLI repeatedly.
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const isWorker = process.argv.includes('--worker');

if (isWorker) {
  // ─── Worker mode ────────────────────────────────────────────────────────
  const entry = path.join(__dirname, '..', 'dist', 'index.js');
  let cli;
  try {
    cli = require(entry);
  } catch (err) {
    process.stderr.write(`ag-doctor worker: failed to load ${entry}: ${err.message}\n`);
    process.exit(1);
  }

  const runFn =
    typeof cli.run === 'function'
      ? cli.run
      : typeof cli.default === 'function'
        ? cli.default
        : typeof cli.main === 'function'
          ? cli.main
          : null;

  if (!runFn) {
    process.stderr.write('ag-doctor worker: CLI does not expose a callable entry\n');
    process.exit(1);
  }

  let buffer = '';
  let busy = false;
  let queue = [];

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      queue.push(line);
      drain();
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(1));

  function drain() {
    if (busy) return;
    const line = queue.shift();
    if (!line) return;
    busy = true;
    handleCommand(line).finally(() => {
      busy = false;
      // Process next queued command immediately
      if (queue.length) setImmediate(drain);
    });
  }

  async function handleCommand(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      payload = { args: line.split(/\s+/).filter(Boolean) };
    }
    const args = Array.isArray(payload.args) ? payload.args : [];

    let outBuf = '';
    let errBuf = '';
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = function (chunk, enc, cb) {
      outBuf += typeof chunk === 'string' ? chunk : chunk.toString();
      if (typeof enc === 'function') enc();
      else if (typeof cb === 'function') cb();
      return true;
    };
    process.stderr.write = function (chunk, enc, cb) {
      errBuf += typeof chunk === 'string' ? chunk : chunk.toString();
      if (typeof enc === 'function') enc();
      else if (typeof cb === 'function') cb();
      return true;
    };

    try {
      const code = await Promise.resolve(runFn(args));
      const result = {
        code: typeof code === 'number' ? code : 0,
        stdout: outBuf,
        stderr: errBuf,
      };
      origStdoutWrite(JSON.stringify(result) + '\n');
    } catch (e) {
      const result = {
        code: -1,
        stdout: outBuf,
        stderr: errBuf + String(e && e.message ? e.message : e),
      };
      origStdoutWrite(JSON.stringify(result) + '\n');
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    }
  }
} else {
  // ─── One-shot mode ──────────────────────────────────────────────────────
  const entry = path.join(__dirname, '..', 'dist', 'index.js');
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('ag-doctor: failed to start:', err.message);
    process.exit(1);
  });
}
