/**
 * 12-Factor App compliant environment configuration loader.
 * Allows overriding all network ports, host bindings, and upstream targets via process.env.
 */

import { DEFAULT_PROXY_PORT, GOOGLE_HOSTS, DEFAULT_BIND_HOST } from '../constants';

export interface AppEnvironmentConfig {
  /** Local proxy listen port. Defaults to DEFAULT_PROXY_PORT (50999). */
  proxyPort: number;
  /** Remote daemon bridge listen port. Defaults to 8090. */
  daemonPort: number;
  /** Language Server Hub connectrpc port. Defaults to 55256. */
  lsHubPort: number;
  /** Host interface for local binding. Defaults to 127.0.0.1. */
  bindHost: string;
  /** Upstream Google Cloud Code target host. */
  upstreamHost: string;
  /** Log level: debug | info | warn | error. Defaults to info. */
  logLevel: string;
  /** Whether running in development/debug mode. */
  isDev: boolean;
}

export function loadEnvironmentConfig(): AppEnvironmentConfig {
  const env = process.env;

  return {
    proxyPort: env.AG_PROXY_PORT ? parseInt(env.AG_PROXY_PORT, 10) : DEFAULT_PROXY_PORT,
    daemonPort: env.AG_DAEMON_PORT ? parseInt(env.AG_DAEMON_PORT, 10) : 8090,
    lsHubPort: env.AG_LS_HUB_PORT ? parseInt(env.AG_LS_HUB_PORT, 10) : 55256,
    bindHost: env.AG_BIND_HOST || DEFAULT_BIND_HOST,
    upstreamHost: env.AG_UPSTREAM_HOST || GOOGLE_HOSTS.CLOUD_CODE,
    logLevel: env.AG_LOG_LEVEL || 'info',
    isDev: env.NODE_ENV === 'development' || !!env.AG_DEBUG,
  };
}

export const envConfig = loadEnvironmentConfig();
