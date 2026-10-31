/**
 * Dependency-free asar reader.
 *
 * Reads the asar container format without the @electron/asar package, which
 * requires Node >= 22 (its engines field) and therefore fails under the
 * doctor UI's CLI workers (Electron's embedded Node 18, spawned with
 * ELECTRON_RUN_AS_NODE=1). It is also immune to Electron's `fs` patch, which
 * resolves any path containing ".asar" as an archive path — that patch makes
 * plain fs.openSync(app.asar) fail with ENOENT, so we disable it via
 * process.noAsar for this process.
 *
 * Format (empirically verified against real asars):
 *   [4B pickle size][4B json size][4B pickle size][4B json size]
 *   [JSON header padded to 4B][file data]
 * The JSON header maps file paths to { offset, size } (asar v4 stores these
 * as strings) relative to the start of the file data region.
 */
import * as fs from 'fs';

// Disable Electron's fs-as-asar patch for this process at load time, so even
// plain fs.existsSync/statSync on the .asar path work (the doctor UI spawns
// CLI workers under Electron with ELECTRON_RUN_AS_NODE=1).
try {
  (process as unknown as { noAsar?: boolean }).noAsar = true;
} catch {
  // ignore
}

export interface AsarHeader {
  header: Record<string, unknown>;
  /** Absolute byte offset of the file data region. */
  dataStart: number;
  /** Size of the archive file in bytes. */
  fileSize: number;
}

function disableElectronAsarPatch(): void {
  try {
    (process as unknown as { noAsar?: boolean }).noAsar = true;
  } catch {
    // ignore
  }
}

/** Parse the asar pickle header; returns null when the file is not a valid asar. */
export function readAsarHeader(asarPath: string): AsarHeader | null {
  try {
    disableElectronAsarPatch();
    const fd = fs.openSync(asarPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const sizeBuf = Buffer.alloc(8);
      fs.readSync(fd, sizeBuf, 0, 8, 0);
      const jsonSize = sizeBuf.readUInt32LE(4);
      if (!Number.isFinite(jsonSize) || jsonSize <= 0 || jsonSize > 128 * 1024 * 1024) return null;
      const jsonBuf = Buffer.alloc(jsonSize);
      // Double pickle framing: [4B size][4B jsonSize] twice, so the JSON
      // header starts at byte 16. The size field includes trailing padding —
      // trim to the closing brace before parsing.
      fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
      const jsonText = jsonBuf.toString('utf-8');
      const jsonEnd = jsonText.lastIndexOf('}');
      if (jsonEnd < 0) return null;
      const header = JSON.parse(jsonText.slice(0, jsonEnd + 1)) as Record<string, unknown>;
      const dataStart = (16 + jsonEnd + 1 + 3) & ~3;
      return { header, dataStart, fileSize: stat.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function findEntry(node: unknown, parts: string[]): Record<string, unknown> | null {
  let cur = node as Record<string, unknown> | null;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>).files as Record<string, unknown> | null;
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[part] as Record<string, unknown> | null;
    if (!cur) return null;
  }
  return cur;
}

/** Read one file out of the asar by its in-archive path (e.g. "dist/main.js"). */
export function readAsarFile(asarPath: string, filePath: string): Buffer | null {
  const h = readAsarHeader(asarPath);
  if (!h) return null;
  const parts = filePath.split('/').filter((p) => p.length > 0 && p !== '.');
  const entry = findEntry(h.header, parts);
  if (!entry) return null;
  const offset = Number(entry.offset);
  const size = Number(entry.size);
  if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0 || offset < 0) return null;
  try {
    const fd = fs.openSync(asarPath, 'r');
    try {
      const buf = Buffer.alloc(size);
      const read = fs.readSync(fd, buf, 0, size, h.dataStart + offset);
      return read > 0 ? buf.subarray(0, read) : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** List all file paths in the archive (leading "/", same shape as @electron/asar listPackage). */
export function listAsarPaths(asarPath: string): string[] {
  const h = readAsarHeader(asarPath);
  if (!h) return [];
  const out: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return;
    const files = (node as Record<string, unknown>).files as Record<string, unknown> | undefined;
    if (!files || typeof files !== 'object') return;
    for (const [name, child] of Object.entries(files)) {
      const p = `${prefix}/${name}`;
      if (child && typeof child === 'object') {
        const files2 = (child as Record<string, unknown>).files;
        if (files2 && typeof files2 === 'object') {
          walk(child, p);
        } else {
          out.push(p);
        }
      }
    }
  };
  walk(h.header, '');
  return out;
}
