/**
 * Platform / OS detection utilities.
 */
import os from 'os';
import type { SystemInfo } from '../types';

export type Platform = 'win32' | 'darwin' | 'linux';

export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  throw new Error(`Unsupported platform: ${p}`);
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function getSystemInfo(): SystemInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    osRelease: os.release(),
    homedir: os.homedir(),
    username: os.userInfo().username,
    cwd: process.cwd(),
  };
}

export function getNodeMajor(): number {
  const m = process.version.match(/^v(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Detect if we are running inside Windows Subsystem for Linux. */
export function isWsl(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const rel = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf-8') ||
                fs.readFileSync('/proc/version', 'utf-8');
    return /microsoft|wsl/i.test(rel);
  } catch {
    return false;
  }
}
