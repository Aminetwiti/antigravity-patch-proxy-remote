/**
 * Environment check — Node version, OS, arch, npm presence.
 * F-19: Validate Node >= 18. Warn on WSL2 (can't serve Windows loopback).
 * F-27: Detect RDP session (safeStorage may be unavailable).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import type { CheckResult } from '../types';
import { getNodeMajor, getSystemInfo } from '../core/platform';
import { DEFAULT_MITM_PORT, DEFAULT_BIND_HOST } from '../core/config';

/** Detect if running inside WSL2 (Linux process, Windows host). */
function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}

/** Detect Remote Desktop session on Windows. */
function isRdp(): boolean {
  if (process.platform !== 'win32') return false;
  const sessionName = process.env['SESSIONNAME'] ?? '';
  const clientName  = process.env['CLIENTNAME']  ?? '';
  return /^rdp/i.test(sessionName) || clientName.length > 0;
}

export function checkEnvironment(): CheckResult {
  const info = getSystemInfo();
  const nodeMajor = getNodeMajor();

  // F-19: hard fail on Node < 18 (structuredClone, Array.at, etc.)
  if (nodeMajor < 18) {
    return {
      id: 'env.node',
      title: 'Node.js version',
      status: 'error',
      message: `Node ${info.nodeVersion} found, but >= 18 is required`,
      details: 'Download the latest LTS from https://nodejs.org and reinstall.',
      fixable: false,
    };
  }

  let npmVersion = 'unknown';
  try {
    npmVersion = execSync('npm --version', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // npm not found
  }

  const supported = ['win32', 'darwin', 'linux'];
  if (!supported.includes(info.platform)) {
    return {
      id: 'env.platform',
      title: 'Operating system',
      status: 'error',
      message: `Unsupported platform: ${info.platform}`,
      fixable: false,
    };
  }

  // F-02: WSL2 warning — proxy-stub / Electron cannot serve Windows 127.0.0.1
  if (isWsl()) {
    return {
      id: 'env.wsl',
      title: 'Environment',
      status: 'warn',
      message: `Node ${info.nodeVersion}, npm ${npmVersion}, ${info.platform}/${info.arch} — WSL2 detected`,
      details: [
        'Running inside WSL2: proxy-stub.js and ag-doctor-ui (Electron) cannot serve',
        `Windows ${DEFAULT_BIND_HOST}:${DEFAULT_MITM_PORT}. The language_server.exe will still get ECONNREFUSED.`,
        'Fix: launch proxy-stub.js from a native Windows terminal (PowerShell / CMD),',
        'not from a WSL shell.',
      ].join('\n'),
      data: { ...info, wsl: true },
    };
  }

  // F-27: RDP session warning — safeStorage (DPAPI) may be unavailable
  const rdp = isRdp();
  const details = rdp
    ? 'RDP session detected — safeStorage (DPAPI) may be unavailable. API keys might be stored unencrypted. Connect locally and re-enter API keys if needed.'
    : undefined;

  return {
    id: 'env',
    title: 'Environment',
    status: rdp ? 'warn' : 'ok',
    message: `Node ${info.nodeVersion}, npm ${npmVersion}, ${info.platform}/${info.arch}${rdp ? ' — RDP session' : ''}`,
    details,
    data: { ...info, wsl: false, rdp },
  };
}
