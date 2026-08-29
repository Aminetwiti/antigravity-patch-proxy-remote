import {
  DEFAULT_PROXY_PORT,
  DEFAULT_STUB_PORT,
  DEFAULT_DAEMON_PORT,
  DEFAULT_BIND_HOST,
  DEFAULT_UPSTREAM_TARGET,
  WORKER_CMD_TIMEOUT_MS,
  PROXY_POLL_INTERVAL_MS,
} from '../constants';

export const PROXY_POLL_INTERVAL_MS_VALUE = PROXY_POLL_INTERVAL_MS || 1500;

export interface AppEnvironment {
  proxyPort: number;
  stubPort: number;
  daemonPort: number;
  daemonToken?: string;
  bindHost: string;
  proxyTarget: string;
  workerCmdTimeoutMs: number;
}

function parsePort(envVal: string | undefined, fallback: number): number {
  if (!envVal) return fallback;
  const parsed = parseInt(envVal, 10);
  return isNaN(parsed) || parsed <= 0 || parsed > 65535 ? fallback : parsed;
}

export function loadDoctorEnvironment(): AppEnvironment {
  const proxyPort = parsePort(process.env.AG_PROXY_PORT, DEFAULT_PROXY_PORT);
  const stubPort = parsePort(process.env.AG_STUB_PORT, DEFAULT_STUB_PORT);
  const daemonPort = parsePort(process.env.AG_DAEMON_PORT, DEFAULT_DAEMON_PORT);
  const daemonToken = process.env.AG_DAEMON_TOKEN;
  const bindHost = process.env.AG_BIND_HOST || DEFAULT_BIND_HOST;
  const proxyTarget = process.env.AG_PROXY_TARGET || `http://${bindHost}:${proxyPort}`;
  const workerCmdTimeoutMs = parsePort(process.env.AG_WORKER_TIMEOUT_MS, WORKER_CMD_TIMEOUT_MS);

  return {
    proxyPort,
    stubPort,
    daemonPort,
    bindHost,
    proxyTarget,
    workerCmdTimeoutMs,
  };
}

export const EnvironmentConfig = loadDoctorEnvironment();
