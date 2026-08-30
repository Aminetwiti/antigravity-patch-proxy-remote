import { describe, it, expect, beforeEach } from 'vitest';
import { loadEnvironmentConfig } from '../config/environment';

describe('loadEnvironmentConfig', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.AG_BIND_HOST;
    delete process.env.AG_PROXY_PORT;
    delete process.env.AG_DAEMON_PORT;
    delete process.env.AG_LS_HUB_PORT;
    delete process.env.AG_UPSTREAM_HOST;
    delete process.env.AG_LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.AG_DEBUG;
  });

  it('uses DEFAULT_BIND_HOST when AG_BIND_HOST is unset', () => {
    const cfg = loadEnvironmentConfig();
    expect(cfg.bindHost).toBe('127.0.0.1');
  });

  it('overrides bindHost when AG_BIND_HOST is set', () => {
    process.env.AG_BIND_HOST = '0.0.0.0';
    const cfg = loadEnvironmentConfig();
    expect(cfg.bindHost).toBe('0.0.0.0');
  });

  it('preserves other defaults when only AG_BIND_HOST is set', () => {
    process.env.AG_BIND_HOST = '192.168.1.1';
    const cfg = loadEnvironmentConfig();
    expect(cfg.proxyPort).toBe(51074);
    expect(cfg.daemonPort).toBe(8090);
    expect(cfg.lsHubPort).toBe(55256);
    expect(cfg.upstreamHost).toBe('daily-cloudcode-pa.googleapis.com');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.isDev).toBe(false);
  });

  it('parses numeric overrides from env', () => {
    process.env.AG_PROXY_PORT = '51074';
    process.env.AG_DAEMON_PORT = '18090';
    process.env.AG_LS_HUB_PORT = '155256';
    const cfg = loadEnvironmentConfig();
    expect(cfg.proxyPort).toBe(51074);
    expect(cfg.daemonPort).toBe(18090);
    expect(cfg.lsHubPort).toBe(155256);
  });

  it('detects dev mode via NODE_ENV or AG_DEBUG', () => {
    process.env.NODE_ENV = 'development';
    expect(loadEnvironmentConfig().isDev).toBe(true);

    delete process.env.NODE_ENV;
    process.env.AG_DEBUG = '1';
    expect(loadEnvironmentConfig().isDev).toBe(true);
  });
});
