/**
 * Persistent user configuration for ag-doctor.
 *
 * Stored as JSON in the Antigravity data dir:
 *   ~/.gemini/antigravity/config.json
 *
 * Schema (all fields optional — defaults are applied at read time):
 * {
 *   "mitmPort": <DEFAULT_MITM_PORT>,
 *   "logLines": 100,
 *   "doctorInterval": 5000,
 *   ...
 * }
 */
import fs from 'fs';
import path from 'path';
import { getAntigravityDataDir } from './paths';
import { getProfilePath } from './profile';

export const CONFIG_FILE = 'config.json';

/** Known patch version-range ids. Keep in sync with PATCH_REGISTRY in
 *  core/version-specific-patch.ts. The values here are the `versionRange`
 *  strings exposed to the UI; the underlying PatchDefinition lookup is done
 *  via findPatchForVersion() with min/max semver matching. */
export const KNOWN_PATCH_RANGES = [
  '2.0.1 - 2.1.x',
  '2.2.0 - 2.2.x',
  '2.3.0+',
  '2.6.0+',
] as const;
export type KnownPatchRange = (typeof KNOWN_PATCH_RANGES)[number];

export interface AgDoctorConfig {
  mitmPort: number;
  logLines: number;
  doctorInterval: number;
  ui: {
    theme: 'dark' | 'light';
    accent: string;
  };
  history: {
    maxRuns: number;
  };
  snapshot: {
    enabled: boolean;
    maxSnapshots: number;
  };
  patch: {
    /** When set, force this patch range instead of auto-detecting. */
    versionOverride: KnownPatchRange | null;
    /** Optional human note explaining why the override was set. */
    overrideReason: string | null;
    /** ISO timestamp of when the override was set. */
    overrideSetAt: string | null;
  };
}

export const DEFAULT_CONFIG: AgDoctorConfig = {
  mitmPort: 51074,
  logLines: 100,
  doctorInterval: 5000,
  ui: {
    theme: 'dark',
    accent: '#22d3ee',
  },
  history: {
    maxRuns: 50,
  },
  snapshot: {
    enabled: true,
    maxSnapshots: 10,
  },
  patch: {
    versionOverride: null,
    overrideReason: null,
    overrideSetAt: null,
  },
};

export const DEFAULT_MITM_PORT = DEFAULT_CONFIG.mitmPort;

/** Type guard for a string that is one of the known patch ranges. */
export function isKnownPatchRange(s: unknown): s is KnownPatchRange {
  return typeof s === 'string' && (KNOWN_PATCH_RANGES as readonly string[]).includes(s);
}

export function getConfigPath(): string {
  return getProfilePath('config');
}

/** Deep-merge a partial config onto defaults to ensure all keys exist. */
function mergeWithDefaults(partial: Partial<AgDoctorConfig> | null | undefined): AgDoctorConfig {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_CONFIG };
  const merged: AgDoctorConfig = {
    ...DEFAULT_CONFIG,
    ...partial,
    ui: { ...DEFAULT_CONFIG.ui, ...(partial.ui ?? {}) },
    history: { ...DEFAULT_CONFIG.history, ...(partial.history ?? {}) },
    snapshot: { ...DEFAULT_CONFIG.snapshot, ...(partial.snapshot ?? {}) },
    patch: {
      ...DEFAULT_CONFIG.patch,
      ...(partial.patch ?? {}),
    },
  };
  return merged;
}

/** Read the config from disk. Returns defaults if file is missing or invalid. */
export function loadConfig(): AgDoctorConfig {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist the config to disk. Creates parent dir if needed. */
export function saveConfig(cfg: AgDoctorConfig): void {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

/** Reset config to defaults on disk. Returns the new config. */
export function resetConfig(): AgDoctorConfig {
  saveConfig(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}

/**
 * Set a single dotted-path value (e.g. "ui.theme" or "mitmPort").
 * Returns the updated config.
 */
export function setConfigValue(path: string, value: string | number | boolean): AgDoctorConfig {
  const cfg = loadConfig();
  const segments = path.split('.');
  let cursor: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof cursor[seg] !== 'object' || cursor[seg] === null) cursor[seg] = {};
    cursor = cursor[seg] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  const fullPath = segments.join('.');

  if (fullPath === 'mitmPort' || fullPath === 'logLines' || fullPath === 'doctorInterval' || fullPath === 'snapshot.maxSnapshots' || fullPath === 'history.maxRuns') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Invalid number for ${path}: ${value}`);
    cursor[last] = n;
  } else if (fullPath === 'snapshot.enabled') {
    cursor[last] = Boolean(value) && value !== 'false' && value !== '0';
  } else if (fullPath === 'ui.theme') {
    if (value !== 'dark' && value !== 'light') throw new Error(`theme must be 'dark' or 'light'`);
    cursor[last] = value;
  } else if (fullPath === 'patch.versionOverride') {
    const s = String(value);
    if (s && !isKnownPatchRange(s)) throw new Error(`Invalid patch range "${s}". Known: ${KNOWN_PATCH_RANGES.join(', ')}`);
    cursor[last] = s || null;
  } else if (fullPath === 'patch.overrideReason' || fullPath === 'patch.overrideSetAt') {
    cursor[last] = String(value);
  } else {
    cursor[last] = String(value);
  }
  saveConfig(cfg);
  return cfg;
}

/** Get a single dotted-path value. Returns undefined if missing. */
export function getConfigValue(path: string): unknown {
  const cfg = loadConfig();
  const segments = path.split('.');
  let cursor: unknown = cfg;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/**
 * Set (or clear) a manual patch version override. When set, the patch
 * commands will use this range regardless of what `detectAntigravityVersion`
 * reports. Pass `null` (or empty string) to clear the override and fall back
 * to auto-detection.
 */
export function setPatchVersionOverride(
  range: KnownPatchRange | null | '',
  reason?: string,
): AgDoctorConfig {
  const cfg = loadConfig();
  const next: KnownPatchRange | null =
    range == null || range === '' ? null : isKnownPatchRange(range) ? range : null;
  if (range != null && range !== '' && !isKnownPatchRange(range)) {
    throw new Error(
      `Unknown patch range "${range}". Known: ${KNOWN_PATCH_RANGES.join(', ')}`,
    );
  }
  cfg.patch.versionOverride = next;
  cfg.patch.overrideReason = next ? (reason ?? cfg.patch.overrideReason ?? null) : null;
  cfg.patch.overrideSetAt = next ? new Date().toISOString() : null;
  saveConfig(cfg);
  return cfg;
}

/** Read the current patch version override (or null if not set). */
export function getPatchVersionOverride(): {
  range: KnownPatchRange | null;
  reason: string | null;
  setAt: string | null;
} {
  const cfg = loadConfig();
  return {
    range: cfg.patch?.versionOverride ?? null,
    reason: cfg.patch?.overrideReason ?? null,
    setAt: cfg.patch?.overrideSetAt ?? null,
  };
}
