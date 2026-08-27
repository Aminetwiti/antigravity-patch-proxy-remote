import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMitmStatus, mockGetPatchStatus } = vi.hoisted(() => ({
  mockGetMitmStatus: vi.fn(),
  mockGetPatchStatus: vi.fn(),
}));

vi.mock('../core/config', () => ({ DEFAULT_MITM_PORT: 51074 }));
vi.mock('../core/mitm', () => ({
  getMitmStatus: mockGetMitmStatus,
  MITM_FORWARDER_PORTS: new Set([443]),
}));
vi.mock('../core/binary-patch', () => ({ getPatchStatus: mockGetPatchStatus }));

import { checkMitm } from './mitm';

function statusOverrides(partial: Record<string, unknown>) {
  return {
    caExists: true,
    caInstalled: true,
    proxyEnabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: 51999,
    interceptionOk: false,
    details: ['System proxy: 127.0.0.1:51999', 'Interception test: FAILED — connect ECONNREFUSED 127.0.0.1:51999'],
    ...partial,
  };
}

describe('checkMitm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPatchStatus.mockReturnValue({ applied: false });
    mockGetMitmStatus.mockReturnValue(statusOverrides({}));
  });

  it('reports bypass when the binary patch is active regardless of system proxy state', async () => {
    mockGetPatchStatus.mockReturnValue({ applied: true });

    const result = await checkMitm();

    expect(result.status).toBe('ok');
    expect(result.message).toContain('Interception bypassed');
  });

  it('recommends clearing a DEAD system proxy port instead of pointing it at the MITM port', async () => {
    const result = await checkMitm();
    const details = result.details ?? '';

    expect(result.status).toBe('error');
    expect(details).toContain('netsh winhttp reset proxy');
    // The repoint suggestion may still be listed, but only AFTER the clear —
    // clearing the dead port is the recommended action.
    const resetIdx = details.indexOf('netsh winhttp reset proxy');
    const setIdx = details.indexOf('netsh winhttp set proxy');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(resetIdx);
    expect(result.fixable).toContain('ag-doctor mitm proxy-off');
  });

  it('does not complain about a mismatched port that is actually serving interception', async () => {
    mockGetMitmStatus.mockReturnValue(statusOverrides({ interceptionOk: true }));

    const result = await checkMitm();

    // A working intercepting proxy on a non-MITM port passes via the
    // caInstalled+interceptionOk branch before the port-mismatch branch —
    // keep that precedence, it is deliberate.
    expect(result.status).toBe('ok');
    expect(result.details ?? '').not.toContain('netsh winhttp');
  });
});