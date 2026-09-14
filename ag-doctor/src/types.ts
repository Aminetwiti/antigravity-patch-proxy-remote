/**
 * Shared types for ag-doctor.
 */

export type Severity = 'ok' | 'warn' | 'error' | 'info';

export interface CheckResult {
  id: string;
  title: string;
  status: Severity;
  message: string;
  details?: string;
  fixable?: boolean | string;
  data?: unknown;
  source?: 'builtin' | 'plugin';
}

export interface CustomModel {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey?: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  timeout?: number;
  maxRetries?: number;
  enabled?: boolean;
  /** True when apiKey is stored in an encrypted/opaque format. */
  encrypted?: boolean;
  accountName?: string;
  accountEmail?: string;
  providerId?: string;
}

export interface CustomModelsFile {
  models: CustomModel[];
  /** Newer dual-format section managed by the doctor UI / language server. */
  providers?: Array<Record<string, any>>;
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  osRelease: string;
  homedir: string;
  username: string;
  cwd: string;
}

export interface PatchStatus {
  binaryPath: string | null;
  exists: boolean;
  applied: boolean;
  backupExists: boolean;
  originalUrl?: string;
  patchedUrl?: string;
  /**
   * Estimated size delta between the live binary and the candidate
   * patch (in bytes). Reported by `validateAsar()` when the live asar
   * is available; null otherwise. Positive when the candidate is larger.
   */
  deltaSizeBytes?: number | null;
}

export interface ConnectivityResult {
  url: string;
  ok: boolean;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
  /**
   * Coarse-grained classification of a failed probe:
   *   - `dns`     → host did not resolve (ENOTFOUND, EAI_AGAIN)
   *   - `refused` → connection refused (ECONNREFUSED, e.g. local proxy down)
   *   - `timeout` → hard deadline or socket timeout
   *   - `tls`     → TLS / certificate error
   *   - `reset`   → peer dropped the connection (ECONNRESET)
   *   - `other`   → anything else
   * Missing when `ok` is true (no error to classify) or when the probe
   * produced a non-2xx HTTP response (the host is reachable).
   */
  errorCategory?: 'dns' | 'refused' | 'timeout' | 'tls' | 'reset' | 'other';
  /** Response headers from the HTTP probe (for X-Proxy-Stub detection etc.) */
  headers?: Record<string, string>;
  /** First 512 chars of the response body (for diagnostics) */
  body?: string;
}

export interface CommandContext {
  json: boolean;
  verbose: boolean;
  yes: boolean;
  cwd: string;
  options: Record<string, string | boolean>;
}
