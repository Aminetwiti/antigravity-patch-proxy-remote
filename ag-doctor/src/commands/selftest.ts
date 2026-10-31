/**
 * `ag-doctor selftest` — verify the CLI itself.
 *
 * Tests: paths writable, network OK, CA generation, LS log readable, JSON valid.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import type { CommandContext } from '../types';
import { c, header, ok, warn, error, info } from '../cli/output';
import { getAntigravityDataDir, getLsLogPath, findAntigravityInstallDir } from '../core/paths';
import { ensureCa } from '../core/cert';

const USAGE = `ag-doctor selftest — verify the CLI itself

Usage:
  ag-doctor selftest          Run all self-tests
  ag-doctor selftest --json   Output JSON
`;

interface SelfTestResult {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export async function runSelftest(ctx: CommandContext): Promise<number> {
  if (ctx.options?.help || ctx.options?.h) {
    console.log(USAGE);
    return 0;
  }

  if (!ctx.json) header('Self-test');

  const tests: SelfTestResult[] = [];
  tests.push(await runTest('data-dir-writable', testDataDirWritable));
  tests.push(await runTest('network-https', testNetworkHttps));
  tests.push(await runTest('ca-generation', testCaGeneration));
  tests.push(await runTest('ls-log-readable', testLsLogReadable));
  tests.push(await runTest('json-roundtrip', testJsonRoundtrip));

  const passed = tests.filter((t) => t.passed).length;
  const failed = tests.filter((t) => !t.passed).length;

  if (ctx.json) {
    console.log(JSON.stringify({ passed, failed, tests }, null, 2));
    return failed > 0 ? 2 : 0;
  }

  console.log('');
  for (const t of tests) {
    if (t.passed) ok(`${t.name} — ${t.message} (${t.durationMs}ms)`);
    else error(`${t.name} — ${t.message}`);
  }
  console.log('');
  if (failed === 0) ok('All self-tests passed');
  else error(`${failed} self-test(s) failed`);
  return failed > 0 ? 2 : 0;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<SelfTestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, message: 'OK', durationMs: Date.now() - start };
  } catch (e) {
    return { name, passed: false, message: (e as Error).message, durationMs: Date.now() - start };
  }
}

async function testDataDirWritable(): Promise<void> {
  const dir = getAntigravityDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.selftest-${Date.now()}`);
  fs.writeFileSync(probe, 'ok', 'utf-8');
  fs.rmSync(probe, { force: true });
}

async function testNetworkHttps(): Promise<void> {
  await httpsGet('https://1.1.1.1');
}

function httpsGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function testCaGeneration(): Promise<void> {
  const ca = ensureCa();
  if (!fs.existsSync(ca.certPath)) throw new Error('CA cert was not created');
}

async function testLsLogReadable(): Promise<void> {
  const p = getLsLogPath();
  if (!fs.existsSync(p)) {
    // Not an error if Antigravity has never run.
    return;
  }
  fs.accessSync(p, fs.constants.R_OK);
}

async function testJsonRoundtrip(): Promise<void> {
  const obj = { a: 1, b: 'test', c: [true, null] };
  const str = JSON.stringify(obj);
  const back = JSON.parse(str);
  if (JSON.stringify(back) !== str) throw new Error('JSON roundtrip mismatch');
}
