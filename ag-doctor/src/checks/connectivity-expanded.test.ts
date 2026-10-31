import { describe, expect, it } from 'vitest';

/**
 * Diagnostic check result formatting, HTTP status classification, and connectivity probe logic test suite.
 */

type CheckSeverity = 'ok' | 'warn' | 'error';

interface ProbeResult {
  id: string;
  name: string;
  status: CheckSeverity;
  statusCode?: number;
  latencyMs?: number;
  message: string;
  remediation?: string;
}

function classifyHttpStatus(statusCode: number): { severity: CheckSeverity; label: string } {
  if (statusCode >= 200 && statusCode < 300) return { severity: 'ok', label: 'HTTP OK' };
  if (statusCode === 401 || statusCode === 403) return { severity: 'warn', label: 'HTTP Auth Error' };
  if (statusCode === 429) return { severity: 'warn', label: 'HTTP Rate Limited' };
  if (statusCode >= 500) return { severity: 'error', label: 'HTTP Server Error' };
  return { severity: 'error', label: `HTTP ${statusCode}` };
}

function formatProbeOutput(result: ProbeResult): string {
  const icon = result.status === 'ok' ? '✓' : result.status === 'warn' ? '⚠' : '✗';
  const statusStr = result.statusCode ? ` [${result.statusCode}]` : '';
  const latStr = typeof result.latencyMs === 'number' ? ` (${result.latencyMs}ms)` : '';
  return `${icon} ${result.name}${statusStr}: ${result.message}${latStr}`;
}

function evaluateConnectivity(results: ProbeResult[]): { total: number; passed: number; warnings: number; failures: number; healthy: boolean } {
  const total = results.length;
  const passed = results.filter((r) => r.status === 'ok').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  const failures = results.filter((r) => r.status === 'error').length;
  return {
    total,
    passed,
    warnings,
    failures,
    healthy: failures === 0,
  };
}

describe('Connectivity Probe Classification & Formatting (25 tests)', () => {
  it('classifies 200 OK as ok', () => {
    const res = classifyHttpStatus(200);
    expect(res.severity).toBe('ok');
    expect(res.label).toBe('HTTP OK');
  });

  it('classifies 201 Created as ok', () => {
    expect(classifyHttpStatus(201).severity).toBe('ok');
  });

  it('classifies 204 No Content as ok', () => {
    expect(classifyHttpStatus(204).severity).toBe('ok');
  });

  it('classifies 401 Unauthorized as warn', () => {
    const res = classifyHttpStatus(401);
    expect(res.severity).toBe('warn');
    expect(res.label).toBe('HTTP Auth Error');
  });

  it('classifies 403 Forbidden as warn', () => {
    const res = classifyHttpStatus(403);
    expect(res.severity).toBe('warn');
    expect(res.label).toBe('HTTP Auth Error');
  });

  it('classifies 429 Too Many Requests as warn', () => {
    const res = classifyHttpStatus(429);
    expect(res.severity).toBe('warn');
    expect(res.label).toBe('HTTP Rate Limited');
  });

  it('classifies 500 Internal Server Error as error', () => {
    const res = classifyHttpStatus(500);
    expect(res.severity).toBe('error');
    expect(res.label).toBe('HTTP Server Error');
  });

  it('classifies 502 Bad Gateway as error', () => {
    expect(classifyHttpStatus(502).severity).toBe('error');
  });

  it('classifies 503 Service Unavailable as error', () => {
    expect(classifyHttpStatus(503).severity).toBe('error');
  });

  it('classifies 504 Gateway Timeout as error', () => {
    expect(classifyHttpStatus(504).severity).toBe('error');
  });

  it('classifies 404 Not Found as error', () => {
    const res = classifyHttpStatus(404);
    expect(res.severity).toBe('error');
    expect(res.label).toBe('HTTP 404');
  });

  it('formats healthy probe result with checkmark icon', () => {
    const out = formatProbeOutput({
      id: 'mitm-check',
      name: 'MITM 443 Port Probe',
      status: 'ok',
      statusCode: 200,
      latencyMs: 12,
      message: 'Listening & responding',
    });
    expect(out).toBe('✓ MITM 443 Port Probe [200]: Listening & responding (12ms)');
  });

  it('formats warning probe result with warning icon', () => {
    const out = formatProbeOutput({
      id: 'auth-check',
      name: 'API Key Check',
      status: 'warn',
      statusCode: 401,
      latencyMs: 150,
      message: 'Unauthorized API key',
    });
    expect(out).toBe('⚠ API Key Check [401]: Unauthorized API key (150ms)');
  });

  it('formats failure probe result with error icon', () => {
    const out = formatProbeOutput({
      id: 'conn-check',
      name: 'Local Proxy Connection',
      status: 'error',
      message: 'Connection refused',
    });
    expect(out).toBe('✗ Local Proxy Connection: Connection refused');
  });

  it('evaluates all healthy probes as healthy: true', () => {
    const summary = evaluateConnectivity([
      { id: '1', name: 'Probe 1', status: 'ok', message: 'ok' },
      { id: '2', name: 'Probe 2', status: 'ok', message: 'ok' },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.failures).toBe(0);
    expect(summary.healthy).toBe(true);
  });

  it('evaluates probes with warnings as healthy: true if failures === 0', () => {
    const summary = evaluateConnectivity([
      { id: '1', name: 'Probe 1', status: 'ok', message: 'ok' },
      { id: '2', name: 'Probe 2', status: 'warn', message: 'warn' },
    ]);
    expect(summary.passed).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.failures).toBe(0);
    expect(summary.healthy).toBe(true);
  });

  it('evaluates probes with 1 error as healthy: false', () => {
    const summary = evaluateConnectivity([
      { id: '1', name: 'Probe 1', status: 'ok', message: 'ok' },
      { id: '2', name: 'Probe 2', status: 'error', message: 'err' },
    ]);
    expect(summary.passed).toBe(1);
    expect(summary.failures).toBe(1);
    expect(summary.healthy).toBe(false);
  });

  it('evaluates empty probe list as healthy: true', () => {
    const summary = evaluateConnectivity([]);
    expect(summary.total).toBe(0);
    expect(summary.healthy).toBe(true);
  });

  it('omits latency string when latencyMs is undefined', () => {
    const out = formatProbeOutput({ id: '1', name: 'Check', status: 'ok', message: 'Done' });
    expect(out).not.toContain('ms');
  });

  it('omits status code string when statusCode is undefined', () => {
    const out = formatProbeOutput({ id: '1', name: 'Check', status: 'ok', message: 'Done' });
    expect(out).not.toContain('[');
  });

  it('includes both status code and latency when provided', () => {
    const out = formatProbeOutput({ id: '1', name: 'Check', status: 'ok', statusCode: 200, latencyMs: 5, message: 'Done' });
    expect(out).toContain('[200]');
    expect(out).toContain('(5ms)');
  });

  it('counts warnings accurately', () => {
    const summary = evaluateConnectivity([
      { id: '1', name: 'P1', status: 'warn', message: 'w' },
      { id: '2', name: 'P2', status: 'warn', message: 'w' },
      { id: '3', name: 'P3', status: 'ok', message: 'ok' },
    ]);
    expect(summary.warnings).toBe(2);
    expect(summary.passed).toBe(1);
  });

  it('counts failures accurately', () => {
    const summary = evaluateConnectivity([
      { id: '1', name: 'P1', status: 'error', message: 'e' },
      { id: '2', name: 'P2', status: 'error', message: 'e' },
      { id: '3', name: 'P3', status: 'error', message: 'e' },
    ]);
    expect(summary.failures).toBe(3);
    expect(summary.passed).toBe(0);
  });

  it('retains remediation instruction field when provided', () => {
    const probe: ProbeResult = {
      id: '1',
      name: 'Cert',
      status: 'warn',
      message: 'Not trusted',
      remediation: 'Run cert install',
    };
    expect(probe.remediation).toBe('Run cert install');
  });

  it('correctly handles 0ms latency in formatting', () => {
    const out = formatProbeOutput({ id: '1', name: 'Localhost', status: 'ok', latencyMs: 0, message: 'Instant' });
    expect(out).toContain('(0ms)');
  });
});
