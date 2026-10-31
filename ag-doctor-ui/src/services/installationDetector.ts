import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface InstallationCandidate {
  path: string;
  version: 'v1.x' | 'v2.0+' | 'unknown';
  exists: boolean;
  size?: number;
  modified?: string;
  process?: { pid: number; name: string } | null;
  portInUse?: { port: number; by: string } | null;
  recommended?: boolean;
  reason?: string;
}

export interface DetectionResult {
  candidates: InstallationCandidate[];
  hasConflict: boolean;
  summary: string;
}

/**
 * Dynamically scans system drives and common directories for Antigravity installations.
 * Supports Windows, macOS, and Linux without hardcoding rigid C: drive paths.
 */
export function detectAntigravityInstallations(): DetectionResult {
  const candidates: InstallationCandidate[] = [];
  const isWin = process.platform === 'win32';

  const potentialPaths: Array<{ path: string; version: 'v1.x' | 'v2.0+' }> = [];

  if (isWin) {
    const systemDrive = process.env.SystemDrive || 'C:';
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || `${systemDrive}\\Program Files`;
    const programFilesX86 = process.env['ProgramFiles(x86)'] || `${systemDrive}\\Program Files (x86)`;

    // Check primary system locations
    potentialPaths.push(
      { path: path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'), version: 'v2.0+' },
      { path: path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'), version: 'v1.x' },
      { path: path.join(programFiles, 'Antigravity', 'Antigravity.exe'), version: 'v2.0+' },
      { path: path.join(programFiles, 'antigravity', 'Antigravity.exe'), version: 'v1.x' },
      { path: path.join(programFilesX86, 'Antigravity', 'Antigravity.exe'), version: 'v2.0+' }
    );

    // Also check secondary drives if available (e.g. D:, E:)
    ['D:', 'E:'].forEach((drive) => {
      potentialPaths.push(
        { path: `${drive}\\Programs\\Antigravity\\Antigravity.exe`, version: 'v2.0+' },
        { path: `${drive}\\Antigravity\\Antigravity.exe`, version: 'v2.0+' }
      );
    });
  } else if (process.platform === 'darwin') {
    potentialPaths.push(
      { path: '/Applications/Antigravity.app/Contents/MacOS/Antigravity', version: 'v2.0+' },
      { path: path.join(process.env.HOME || '', 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'), version: 'v2.0+' }
    );
  } else {
    potentialPaths.push(
      { path: '/opt/Antigravity/Antigravity', version: 'v2.0+' },
      { path: '/usr/local/bin/antigravity', version: 'v1.x' },
      { path: path.join(process.env.HOME || '', '.local', 'bin', 'antigravity'), version: 'v1.x' }
    );
  }

  for (const sp of potentialPaths) {
    try {
      if (!fs.existsSync(sp.path)) continue;
      const stat = fs.statSync(sp.path);
      candidates.push({
        path: sp.path,
        version: sp.version,
        exists: true,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // Ignore filesystem access errors
    }
  }

  // Identify active running process
  if (isWin) {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /FO CSV /NH', { encoding: 'utf-8', windowsHide: true });
      const lines = out.trim().split('\n').filter((l) => l.includes('Antigravity'));
      for (const line of lines) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m) {
          const pid = parseInt(m[2], 10);
          const cand = candidates.find((c) => c.path.toLowerCase().includes('antigravity\\antigravity.exe'));
          if (cand) cand.process = { pid, name: m[1] };
        }
      }
    } catch {
      // Best-effort process detection
    }
  }

  // Recommendation logic: prefer v2.0+ (uppercase)
  const v2 = candidates.find((c) => c.version === 'v2.0+');
  if (v2) {
    v2.recommended = true;
    v2.reason = 'Latest Antigravity 2.0+ (uppercase)';
  }
  const v1 = candidates.find((c) => c.version === 'v1.x');
  if (v1 && !v2) {
    v1.recommended = true;
    v1.reason = 'Only v1.x installation found';
  }

  return {
    candidates,
    hasConflict: candidates.length > 1,
    summary: candidates.length === 0
      ? 'No Antigravity installation detected'
      : candidates.length === 1
      ? `Single installation: ${candidates[0].version}`
      : `Multiple installations detected (${candidates.length}) — possible confusion source`,
  };
}
