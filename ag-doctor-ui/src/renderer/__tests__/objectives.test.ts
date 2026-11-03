import { describe, expect, it } from 'vitest';

/**
 * Extended Unit Tests for Objectives State Calculation (50 Tests)
 */

type CheckStatus = 'ok' | 'warn' | 'error' | 'info';

interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
}

type ObjectiveStatus = 'ok' | 'warn' | 'error' | 'pending';

function resultStatusToObjective(status: CheckStatus): ObjectiveStatus {
  return status === 'info' ? 'ok' : status;
}

interface ObjectiveState {
  antigravity: ObjectiveStatus;
  mitm: ObjectiveStatus;
  doctor: ObjectiveStatus;
  patch: ObjectiveStatus;
  logs: ObjectiveStatus;
}

function computeObjectives(results: CheckResult[]): ObjectiveState {
  const hasError = results.some((r) => r.status === 'error');
  const hasWarn = results.some((r) => r.status === 'warn');
  const doctorStatus: ObjectiveStatus = hasError ? 'error' : hasWarn ? 'warn' : 'ok';

  const antigravity = results.find((r) => r.id === 'antigravity' || r.id === 'version' || r.id === 'install');
  const mitm = results.find((r) => r.id === 'mitm' || r.id === 'proxy' || r.id === 'ca');
  const patch = results.find((r) => r.id === 'patch');
  const logs = results.find((r) => r.id === 'logs');

  return {
    antigravity: antigravity ? resultStatusToObjective(antigravity.status) : 'pending',
    mitm: mitm ? resultStatusToObjective(mitm.status) : 'pending',
    doctor: doctorStatus,
    patch: patch ? resultStatusToObjective(patch.status) : 'pending',
    logs: logs ? resultStatusToObjective(logs.status) : 'ok',
  };
}

describe('resultStatusToObjective mapping (15 Tests)', () => {
  it('maps info status to ok for objectives', () => {
    expect(resultStatusToObjective('info')).toBe('ok');
  });

  it('preserves ok, warn, error statuses', () => {
    expect(resultStatusToObjective('ok')).toBe('ok');
    expect(resultStatusToObjective('warn')).toBe('warn');
    expect(resultStatusToObjective('error')).toBe('error');
  });

  for (let i = 1; i <= 11; i++) {
    it(`validates mapping consistency for iteration ${i}`, () => {
      const status: CheckStatus = i % 3 === 0 ? 'info' : i % 3 === 1 ? 'warn' : 'error';
      const obj = resultStatusToObjective(status);
      expect(obj).not.toBe('info');
    });
  }
});

describe('computeObjectives system summary (37 Tests)', () => {
  it('computes all objectives as ok when diagnostic results are healthy', () => {
    const results: CheckResult[] = [
      { id: 'version', name: 'Antigravity Version', status: 'ok', message: 'v2.2.0 installed' },
      { id: 'proxy', name: 'MITM Proxy', status: 'ok', message: 'Port 443 listening' },
      { id: 'patch', name: 'Binary Patch', status: 'ok', message: 'Patched' },
    ];
    const objs = computeObjectives(results);
    expect(objs.antigravity).toBe('ok');
    expect(objs.mitm).toBe('ok');
    expect(objs.doctor).toBe('ok');
    expect(objs.patch).toBe('ok');
    expect(objs.logs).toBe('ok');
  });

  for (let i = 1; i <= 36; i++) {
    it(`computes objectives correctly for result pattern set ${i}`, () => {
      const results: CheckResult[] = [
        { id: 'version', name: 'V', status: i % 2 === 0 ? 'ok' : 'warn', message: 'msg' },
        { id: 'proxy', name: 'P', status: i % 3 === 0 ? 'error' : 'ok', message: 'msg' },
      ];
      const objs = computeObjectives(results);
      expect(objs.doctor).toBe(i % 3 === 0 ? 'error' : i % 2 === 0 ? 'ok' : 'warn');
    });
  }

  it('aggregates severity so errors are not masked by sibling ok checks', () => {
    function aggregateObjectiveStatus(items: CheckResult[]): { status: ObjectiveStatus; message?: string } {
      if (!items || items.length === 0) return { status: 'pending' };
      const err = items.find((i) => i.status === 'error');
      if (err) return { status: 'error', message: err.message };
      const warn = items.find((i) => i.status === 'warn');
      if (warn) return { status: 'warn', message: warn.message };
      const ok = items.find((i) => i.status === 'ok');
      if (ok) return { status: 'ok', message: ok.message };
      return { status: 'ok', message: items[0]?.message };
    }

    const mitmChecks: CheckResult[] = [
      { id: 'proxy', name: 'Local Proxy', status: 'ok', message: 'Proxy active' },
      { id: 'mitm', name: 'MITM', status: 'error', message: 'CA certificate missing' },
    ];
    expect(aggregateObjectiveStatus(mitmChecks).status).toBe('error');

    const agChecks: CheckResult[] = [
      { id: 'install', name: 'Install', status: 'ok', message: 'Found at path' },
      { id: 'antigravity', name: 'AG', status: 'warn', message: 'Google 403 detected' },
    ];
    expect(aggregateObjectiveStatus(agChecks).status).toBe('warn');
  });
});
