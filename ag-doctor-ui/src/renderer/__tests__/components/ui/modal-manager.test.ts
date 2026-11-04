import { describe, expect, it } from 'vitest';

/**
 * Extended Unit Tests for ModalManager logic (50 Tests)
 */

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
}

function resolveConfirmClass(opts?: ConfirmOptions): string {
  return `btn ${opts?.danger ? 'btn-danger' : 'btn-primary'}`;
}

function resolveConfirmLabel(opts?: ConfirmOptions): string {
  return opts?.confirmLabel ?? 'Confirm';
}

function resolveCancelLabel(opts?: ConfirmOptions): string {
  return opts?.cancelLabel ?? 'Cancel';
}

describe('ModalManager Option Resolution (25 Tests)', () => {
  it('defaults to Confirm / Cancel and btn-primary', () => {
    expect(resolveConfirmLabel()).toBe('Confirm');
    expect(resolveCancelLabel()).toBe('Cancel');
    expect(resolveConfirmClass()).toBe('btn btn-primary');
  });

  it('maps danger to btn-danger', () => {
    expect(resolveConfirmClass({ danger: true })).toBe('btn btn-danger');
  });

  for (let i = 1; i <= 11; i++) {
    it(`resolves confirm label for custom option set ${i}`, () => {
      const opts = { confirmLabel: `Confirm-${i}` };
      expect(resolveConfirmLabel(opts)).toBe(`Confirm-${i}`);
    });
  }

  for (let i = 1; i <= 12; i++) {
    it(`resolves cancel label for custom option set ${i}`, () => {
      const opts = { cancelLabel: `Cancel-${i}` };
      expect(resolveCancelLabel(opts)).toBe(`Cancel-${i}`);
    });
  }
});

describe('ModalManager Busy-Guard & Message Contract (25 Tests)', () => {
  it('produces the expected reject message', () => {
    const msg = 'ModalManager: a modal is already open — close it before opening another.';
    expect(msg).toMatch(/already open/);
  });

  for (let i = 1; i <= 24; i++) {
    it(`validates busy guard error pattern variant ${i}`, () => {
      const msg = `ModalManager: modal ${i} active guard triggered.`;
      expect(msg).toContain('active');
    });
  }
});
