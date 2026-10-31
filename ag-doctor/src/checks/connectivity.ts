/**
 * Connectivity check â€” pings each configured provider endpoint.
 *
 * Three-tier classification per endpoint:
 *   - `ok`        (2xx)        â†’ healthy
 *   - `reachable` (any HTTP status code returned, including 4xx/5xx) â†’ server is up,
 *                             but the path/auth/config may be wrong. Surfaced as a
 *                             `warn` so users notice; does NOT trigger recovery.
 *   - `down`      (timeout, DNS failure, TCP refused, TLS error) â†’ server is down
 *                             or network blocks us. Triggers recovery.
 *
 * Improvements over the previous version:
 *   - Normalises the probe URL via `buildModelsUrl()` so we hit /v1/models
 *     instead of the chat-completions or root URL (which often returns 404
 *     even when the upstream is healthy).
 *   - Splits "host up but KO" from "host unreachable" so recovery only fires
 *     on real outages, not on misconfigured paths/auth.
 *   - Reports latency and status code for each probe.
 */
import type { CheckResult } from '../types';
import { loadCustomModels } from '../core/custom-models';
import { probe } from '../core/probe';
import { buildModelsUrl } from '../commands/models/fetch';

/** Classify a raw probe outcome into one of three buckets. */
function classify(result: { ok: boolean; statusCode?: number; error?: string }): 'ok' | 'reachable' | 'down' {
  if (!result.ok) return 'down';
  if (typeof result.statusCode === 'number' && result.statusCode >= 200 && result.statusCode < 300) {
    return 'ok';
  }
  // 3xx/4xx/5xx with ok=true means we got an HTTP response — host is alive
  return 'reachable';
}

/** Whether the doctor can actually authenticate against this endpoint.
 *  ag-doctor is a plain Node CLI and cannot use Electron's safeStorage, so
 *  `enc:` API keys are opaque blobs it cannot send. A non-2xx response from
 *  such an endpoint is therefore *unverifiable* rather than a real failure. */
function isKeyUsable(model: { apiKey?: string } | undefined): boolean {
  const k = model?.apiKey;
  return !!k && !String(k).startsWith('enc:');
}

export async function checkConnectivity(): Promise<CheckResult> {
  const file = loadCustomModels();
  if (file.models.length === 0) {
    return {
      id: 'connectivity',
      title: 'Provider connectivity',
      status: 'info',
      message: 'No models configured, nothing to probe',
    };
  }

  // Dedupe URLs, but probe each normalized /v1/models endpoint so we
  // don't flag a perfectly healthy API just because its root returns 404.
  // When multiple models share the same URL, prefer one with a plaintext key.
  const urlToModel = new Map<string, (typeof file.models)[number]>();
  for (const m of file.models) {
    if (!m.apiUrl) continue;
    if (!urlToModel.has(m.apiUrl)) {
      urlToModel.set(m.apiUrl, m);
    } else if (m.apiKey && !m.apiKey.startsWith('enc:') && urlToModel.get(m.apiUrl)?.apiKey?.startsWith('enc:')) {
      urlToModel.set(m.apiUrl, m);
    }
  }
  const urls = Array.from(urlToModel.keys());
  const raw = await Promise.all(urls.map(async (u) => {
    const target = buildModelsUrl(u);
    const model = urlToModel.get(u);
    // Some providers take >5s to respond to an unauthenticated /v1/models
    // probe (they answer 401 once the request reaches the auth layer). A
    // single 15s timeout with one retry prevents slow-but-alive hosts from
    // being mislabelled as "down" (false outage alarms). The retry is
    // limited to timeouts — deterministic failures (DNS, refused, TLS,
    // HTTP status) are not retried, keeping the check fast.
    let result = await probe(target, 15000, { provider: model?.provider, apiKey: model?.apiKey });
    if (!result.ok && result.errorCategory === 'timeout') {
      result = await probe(target, 15000, { provider: model?.provider, apiKey: model?.apiKey });
    }
    return {
      source: u,
      target,
      keyUsable: isKeyUsable(model),
      result,
    };
  }));

  let okCount = 0;
  let reachableCount = 0; // host up, path/auth may be wrong (key was usable)
  let unknownCount = 0; // non-2xx but key was encrypted — cannot verify from CLI
  let downCount = 0;
  for (const { result, keyUsable } of raw) {
    const c = classify(result);
    if (c === 'ok') okCount++;
    else if (c === 'down') downCount++;
    else if (keyUsable) reachableCount++; // genuine 4xx/5xx => real misconfig
    else unknownCount++; // 4xx/5xx with an encrypted key => unverifiable
  }

  const total = raw.length;
  const anyDown = downCount > 0;
  const renderLines = raw
    .map(({ source, target, result, keyUsable }) => {
      const c = classify(result);
      // A non-2xx result on an endpoint whose key we can't use is "unknown",
      // not a failure — the CLI simply can't authenticate against it.
      const bucket: 'ok' | 'reachable' | 'unknown' | 'down' =
        c === 'ok' ? 'ok' : c === 'down' ? 'down' : keyUsable ? 'reachable' : 'unknown';
      const icon = bucket === 'ok' ? 'âœ”' : bucket === 'reachable' ? 'âš ' : bucket === 'unknown' ? 'â§ ' : 'âœ–';
      const label = bucket === 'ok' ? 'ok' : bucket === 'reachable' ? 'up' : bucket === 'unknown' ? 'enc' : 'down';
      const code = result.statusCode ?? '???';
      const ms = result.latencyMs != null ? `${result.latencyMs}ms` : '?';
      const same = source === target ? '' : `  (probed ${target})`;
      return `  ${icon} ${label.padEnd(4)} ${code} ${ms.padEnd(6)} ${source}${same}`;
    })
    .join('\n');

  // Only treat REAL outages as errors. 4xx/5xx with reachable=true is a warn
  // (config issue), not an outage.
  if (anyDown) {
    return {
      id: 'connectivity',
      title: 'Provider connectivity',
      status: 'error',
      message: `${downCount}/${total} endpoint(s) unreachable`,
      details:
        renderLines +
        '\n\nTips:\n' +
        '  - 401/404 with "up" status means the host is alive but the path or API key is wrong.\n' +
        '  - Verify the URL ends with /v1/chat/completions (or /v1/models) and the API key is valid.',
      data: { results: raw },
    };
  }
  if (reachableCount > 0) {
    const offending = raw.find((r) => classify(r.result) === 'reachable' && r.keyUsable);
    const code = offending?.result.statusCode ?? '4xx/5xx';
    return {
      id: 'connectivity',
      title: 'Provider connectivity',
      status: 'warn',
      message: `${okCount}/${total} OK, ${reachableCount}/${total} reachable but returned ${code}`,
      details:
        renderLines +
        '\n\nThese endpoints responded but with a non-2xx status using a plaintext API key.\n' +
        'Likely causes: missing/invalid API key, wrong model name, or trailing path mismatch.',
      data: { results: raw },
    };
  }
  if (unknownCount > 0) {
    // Hosts responded, but every non-2xx came from an endpoint whose API key
    // is encrypted and cannot be verified by this CLI. The app itself can
    // decrypt the keys, so this is informational rather than a fault.
    return {
      id: 'connectivity',
      title: 'Provider connectivity',
      status: 'info',
      message: `${okCount}/${total} OK · ${unknownCount}/${total} key(s) encrypted — cannot verify from CLI`,
      details:
        renderLines +
        '\n\nSome endpoints returned a non-2xx status, but their API keys are encrypted\n' +
        '(safeStorage) and ag-doctor (a plain Node CLI) cannot decrypt them to authenticate.\n' +
        'Open Antigravity to confirm live connectivity — the running app can decrypt the keys.',
      data: { results: raw },
    };
  }
  return {
    id: 'connectivity',
    title: 'Provider connectivity',
    status: 'ok',
    message: `All ${okCount}/${total} endpoints healthy`,
    details: renderLines,
    data: { results: raw },
  };
}
