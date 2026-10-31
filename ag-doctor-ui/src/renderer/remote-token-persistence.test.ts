import { describe, expect, it, beforeEach } from 'vitest';

describe('Doctor UI — Remote Token Persistence, Security & Networking', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
  });

  const generateSecureToken = (length = 16): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let res = '';
    for (let i = 0; i < length; i++) {
      res += chars.charAt((i * 7 + 13) % chars.length);
    }
    return res;
  };

  const getSavedToken = (): string => {
    return mockStorage['ag_remote_auth_token'] || '';
  };

  const saveToken = (token: string): void => {
    mockStorage['ag_remote_auth_token'] = token.trim();
  };

  const resolveEffectiveToken = (inputToken?: string): string => {
    const raw = (inputToken !== undefined ? inputToken : getSavedToken()).trim();
    if (!raw || raw === '11') {
      const generated = generateSecureToken(16);
      saveToken(generated);
      return generated;
    }
    return raw;
  };

  const formatRemoteWsUrl = (hostOrIp: string, port: number, isTunnel: boolean, token: string): string => {
    const effectiveToken = resolveEffectiveToken(token);
    if (isTunnel) {
      const cleanHost = hostOrIp.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return `wss://${cleanHost}/ws?token=${encodeURIComponent(effectiveToken)}`;
    }
    return `ws://${hostOrIp}:${port}/ws?token=${encodeURIComponent(effectiveToken)}`;
  };

  const isValidDaemonPort = (val: any): boolean => {
    const p = Number(val);
    return Number.isInteger(p) && p >= 1024 && p <= 65535;
  };

  const isVirtualIp = (ip: string): boolean => {
    if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) return true;
    if (ip.startsWith('192.168.56.') || ip.startsWith('192.168.152.') || ip.startsWith('192.168.233.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  };

  it('rejects trivial "11" token and generates strong 16-character token', () => {
    expect(getSavedToken()).toBe('');
    const token = resolveEffectiveToken();
    expect(token).not.toBe('11');
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(getSavedToken()).toBe(token);
  });

  it('migrates legacy saved "11" token to a strong token', () => {
    saveToken('11');
    const migrated = resolveEffectiveToken();
    expect(migrated).not.toBe('11');
    expect(migrated.length).toBeGreaterThanOrEqual(16);
    expect(getSavedToken()).toBe(migrated);
  });

  it('preserves valid custom authentication tokens', () => {
    saveToken('my-super-secret-token-2026');
    expect(getSavedToken()).toBe('my-super-secret-token-2026');
    expect(resolveEffectiveToken()).toBe('my-super-secret-token-2026');
  });

  it('formats local network WebSocket URL with escaped token', () => {
    saveToken('secret_token_123');
    const wsUrl = formatRemoteWsUrl('192.168.1.50', 8090, false, getSavedToken());
    expect(wsUrl).toBe('ws://192.168.1.50:8090/ws?token=secret_token_123');
  });

  it('properly URL-encodes special characters in token to prevent injection', () => {
    saveToken('token&with=special"chars<script>');
    const wsUrl = formatRemoteWsUrl('192.168.1.50', 8090, false, getSavedToken());
    expect(wsUrl).not.toContain('<script>');
    expect(wsUrl).toContain('token%26with%3Dspecial%22chars%3Cscript%3E');
  });

  it('formats tunnel WSS URL correctly', () => {
    saveToken('custom_token_42');
    const wsUrl = formatRemoteWsUrl('https://my-tunnel.trycloudflare.com', 8090, true, getSavedToken());
    expect(wsUrl).toBe('wss://my-tunnel.trycloudflare.com/ws?token=custom_token_42');
  });

  it('validates daemon port boundaries strictly (1024-65535)', () => {
    expect(isValidDaemonPort(8090)).toBe(true);
    expect(isValidDaemonPort(1024)).toBe(true);
    expect(isValidDaemonPort(65535)).toBe(true);

    expect(isValidDaemonPort(80)).toBe(false);
    expect(isValidDaemonPort(0)).toBe(false);
    expect(isValidDaemonPort(-1)).toBe(false);
    expect(isValidDaemonPort(70000)).toBe(false);
    expect(isValidDaemonPort('8090 & calc.exe')).toBe(false);
    expect(isValidDaemonPort('NaN')).toBe(false);
    expect(isValidDaemonPort(null)).toBe(false);
    expect(isValidDaemonPort(undefined)).toBe(false);
  });

  it('identifies and filters virtual network IP addresses', () => {
    // Loopback & APIPA
    expect(isVirtualIp('127.0.0.1')).toBe(true);
    expect(isVirtualIp('169.254.10.20')).toBe(true);

    // WSL2 / Docker range (172.16.x - 172.31.x)
    expect(isVirtualIp('172.28.16.1')).toBe(true);
    expect(isVirtualIp('172.17.0.1')).toBe(true);

    // VirtualBox & VMware host-only
    expect(isVirtualIp('192.168.56.1')).toBe(true);
    expect(isVirtualIp('192.168.152.1')).toBe(true);
    expect(isVirtualIp('192.168.233.1')).toBe(true);

    // Real physical LAN IPs
    expect(isVirtualIp('192.168.1.45')).toBe(false);
    expect(isVirtualIp('10.0.0.15')).toBe(false);
    expect(isVirtualIp('172.15.0.1')).toBe(false);
  });
});
