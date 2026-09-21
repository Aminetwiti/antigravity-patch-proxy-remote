/**
 * DNS resolution utilities for the Antigravity proxy.
 *
 * The local hosts file redirects *.googleapis.com to 127.0.0.1 so the Electron
 * app talks to this proxy. When the proxy forwards upstream, we must resolve
 * the real Google IP. This module bypasses the poisoned hosts file by querying
 * public DNS servers directly, with multiple fallbacks.
 */

import * as dns from 'dns';
import log from 'electron-log';
import { PUBLIC_DNS_SERVERS } from '../constants';

/** Timeout for a single DNS server query (ms). */
export const DNS_QUERY_TIMEOUT_MS = 5_000;

/** Timeout for the whole resolution attempt including fallbacks (ms). */
export const DNS_RESOLUTION_TIMEOUT_MS = 15_000;

/** Whether an IP address is a loopback address (127.0.0.0/8 or ::1). */
export function isLoopbackIp(ip: string): boolean {
  if (ip === '::1') return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts[0] === '127';
}

/** Whether an IP address is a private RFC1918 address. */
export function isPrivateIp(ip: string): boolean {
  if (ip === '::1') return true;
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b, c] = parts;
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Pick the best address from a list, preferring public Google IPs over loopback/private. */
export function pickBestAddress(addresses: string[]): string | undefined {
  const publicAddrs = addresses.filter((ip) => !isPrivateIp(ip) && !isLoopbackIp(ip));
  if (publicAddrs.length > 0) return publicAddrs[0];
  return addresses.find((ip) => !isLoopbackIp(ip));
}

/**
 * Resolve a hostname using a specific DNS server.
 * Returns the list of A records or rejects on error/timeout.
 */
export function resolveWithServer(hostname: string, server: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver();
    resolver.setServers([server]);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolver.cancel();
      reject(new Error(`DNS query to ${server} timed out for ${hostname}`));
    }, DNS_QUERY_TIMEOUT_MS);

    resolver.resolve4(hostname, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err || !addresses || addresses.length === 0) {
        reject(err || new Error(`No A records from ${server} for ${hostname}`));
        return;
      }
      resolve(addresses);
    });
  });
}

/**
 * Resolve using the system's default DNS resolver (c-ares / network DNS).
 * This bypasses the hosts file but may still return bad answers if the
 * network DNS itself is poisoned.
 */
export function resolveWithSystemDns(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`System DNS timed out for ${hostname}`));
    }, DNS_QUERY_TIMEOUT_MS);

    dns.resolve4(hostname, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err || !addresses || addresses.length === 0) {
        reject(err || new Error(`System DNS returned no addresses for ${hostname}`));
        return;
      }
      resolve(addresses);
    });
  });
}

/**
 * In-memory DNS cache – stores the last successfully resolved IP for each
 * hostname so we can reuse it immediately for 0ms resolution, and fall back
 * to it when all DNS servers are unreachable. Entries expire after DNS_CACHE_TTL_MS.
 */
const DNS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const dnsCache = new Map<string, { ip: string; ts: number }>();

export function clearDnsCache(): void {
  dnsCache.clear();
}

function cacheDnsResult(hostname: string, ip: string): void {
  dnsCache.set(hostname, { ip, ts: Date.now() });
}

function getFreshCachedDns(hostname: string): string | undefined {
  const entry = dnsCache.get(hostname);
  if (!entry) return undefined;
  if (Date.now() - entry.ts <= DNS_CACHE_TTL_MS) {
    return entry.ip;
  }
  return undefined;
}

function getCachedDns(hostname: string): string | undefined {
  const entry = dnsCache.get(hostname);
  if (!entry) return undefined;
  // Use cached entry even if stale – it's better than nothing when DNS is down.
  // The TTL is only used to log a warning.
  if (Date.now() - entry.ts > DNS_CACHE_TTL_MS) {
    log.warn(`[Proxy] Using stale DNS cache for ${hostname} (age: ${Math.round((Date.now() - entry.ts) / 1000)}s)`);
  }
  return entry.ip;
}

/**
 * Resolve a hostname to an IPv4 address.
 *
 * For googleapis.com hostnames, this bypasses the local hosts file by
 * querying public DNS servers in parallel, then falling back to the system
 * resolver, and finally to a safe cached/predefined Google IP if available.
 */
export async function resolveGoogleIp(hostname: string): Promise<string> {
  if (!hostname.endsWith('.googleapis.com')) {
    return new Promise((resolve, reject) => {
      dns.lookup(hostname, { family: 4 }, (err, address) => {
        if (err || !address) {
          reject(err || new Error(`Could not resolve ${hostname}`));
        } else {
          resolve(address);
        }
      });
    });
  }

  // 0. Fast path: check fresh in-memory DNS cache (0ms, avoids 70ms parallel DNS query)
  const freshIp = getFreshCachedDns(hostname);
  if (freshIp) {
    return freshIp;
  }

  const deadline = Date.now() + DNS_RESOLUTION_TIMEOUT_MS;

  const tStart = Date.now();
  // 1. Query public DNS servers in parallel; use the first good answer.
  const publicResults = await Promise.allSettled(
    PUBLIC_DNS_SERVERS.map((server) => resolveWithServer(hostname, server)),
  );
  log.info(`[Proxy] [dns-timing] public DNS parallel query took ${Date.now() - tStart}ms (${PUBLIC_DNS_SERVERS.length} servers)`);
  for (const result of publicResults) {
    if (result.status === 'fulfilled') {
      const ip = pickBestAddress(result.value);
      if (ip) {
        log.info(`[Proxy] resolveGoogleIp using public DNS ${ip} for ${hostname}`);
        cacheDnsResult(hostname, ip);
        return ip;
      }
    }
  }

  const publicErrors = publicResults
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));
  log.warn(
    `[Proxy] Public DNS failed for ${hostname}:`,
    publicErrors.join('; ') || 'no results',
  );

  // 2. Fallback to system DNS (still bypasses hosts file).
  try {
    const systemAddresses = await resolveWithSystemDns(hostname);
    const ip = pickBestAddress(systemAddresses);
    if (ip) {
      log.info(`[Proxy] resolveGoogleIp using system DNS ${ip} for ${hostname}`);
      cacheDnsResult(hostname, ip);
      return ip;
    }
    log.warn(`[Proxy] System DNS returned only loopback/private for ${hostname}:`, systemAddresses);
  } catch (err) {
    log.warn(`[Proxy] System DNS fallback failed for ${hostname}:`, (err as Error).message);
  }

  // 2.5. Try previously cached DNS result before hardcoded fallback.
  const cachedIp = getCachedDns(hostname);
  if (cachedIp) {
    log.info(`[Proxy] resolveGoogleIp using cached DNS ${cachedIp} for ${hostname}`);
    return cachedIp;
  }

  // 3. Last resort: use a cached/predefined fallback IP.
  const fallbackIp = await tryFallbackIp(hostname, deadline - Date.now());
  if (fallbackIp) {
    log.warn(`[Proxy] resolveGoogleIp using hardcoded fallback ${fallbackIp} for ${hostname}`);
    return fallbackIp;
  }

  throw new Error(`DNS resolution failed for ${hostname}`);
}

/**
 * Try a short, safe list of known Google anycast IPs. These are Google edge
 * IPs that serve *.googleapis.com and are very unlikely to move. This is a
 * last-resort fallback when all DNS servers are unreachable.
 */
const GOOGLE_FALLBACK_IPS: readonly string[] = [
  '142.250.80.46',
  '142.250.81.46',
  '142.250.185.78',
  '172.217.16.46',
  '216.58.212.46',
];

async function tryFallbackIp(hostname: string, remainingMs: number): Promise<string | undefined> {
  if (remainingMs <= 0) return undefined;
  // Simple heuristic: pick a deterministic IP based on hostname length so we
  // distribute load without adding state.
  const index = hostname.length % GOOGLE_FALLBACK_IPS.length;
  return GOOGLE_FALLBACK_IPS[index];
}
