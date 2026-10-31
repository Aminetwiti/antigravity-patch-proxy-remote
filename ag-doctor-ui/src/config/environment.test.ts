import { describe, it, expect } from 'vitest';
import { loadDoctorEnvironment } from '../config/environment';
import { DEFAULT_PROXY_PORT, DEFAULT_STUB_PORT, DEFAULT_DAEMON_PORT, DEFAULT_BIND_HOST } from '../constants';

describe('ag-doctor-ui Environment Config', () => {
  it('loads default values when environment variables are unset', () => {
    const env = loadDoctorEnvironment();
    expect(env.proxyPort).toBe(DEFAULT_PROXY_PORT);
    expect(env.stubPort).toBe(DEFAULT_STUB_PORT);
    expect(env.daemonPort).toBe(DEFAULT_DAEMON_PORT);
    expect(env.bindHost).toBe(DEFAULT_BIND_HOST);
  });

  it('correctly reads environment variables when set', () => {
    const oldPort = process.env.AG_PROXY_PORT;
    const oldHost = process.env.AG_BIND_HOST;
    try {
      process.env.AG_PROXY_PORT = '59999';
      process.env.AG_BIND_HOST = '0.0.0.0';
      const env = loadDoctorEnvironment();
      expect(env.proxyPort).toBe(59999);
      expect(env.bindHost).toBe('0.0.0.0');
      expect(env.proxyTarget).toBe('http://0.0.0.0:59999');
    } finally {
      process.env.AG_PROXY_PORT = oldPort;
      process.env.AG_BIND_HOST = oldHost;
    }
  });

  it('falls back to default on invalid port strings', () => {
    const oldPort = process.env.AG_PROXY_PORT;
    try {
      process.env.AG_PROXY_PORT = 'invalid';
      const env = loadDoctorEnvironment();
      expect(env.proxyPort).toBe(DEFAULT_PROXY_PORT);
    } finally {
      process.env.AG_PROXY_PORT = oldPort;
    }
  });
});
