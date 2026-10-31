import { describe, expect, it, vi } from 'vitest';
import { LogInspectorDrawer, detectRemediation } from './log-inspector';
import { ParsedLogEntry } from './log-viewer';

describe('LogInspector - Remediation detection', () => {
  it('detects 429 quota exhaustion remediation', () => {
    const entry: ParsedLogEntry = {
      raw: 'Account hit 429 ResourceExhausted',
      level: 'error',
      message: 'Account hit 429 ResourceExhausted',
      isNoise: false,
    };
    const remediation = detectRemediation(entry);
    expect(remediation).not.toBeNull();
    expect(remediation?.actionId).toBe('nav-google-accounts');
  });

  it('detects proxy connection refused on port 51074', () => {
    const entry: ParsedLogEntry = {
      raw: 'dial tcp 127.0.0.1:51074: connect: connection refused',
      level: 'error',
      message: 'dial tcp 127.0.0.1:51074: connect: connection refused',
      isNoise: false,
    };
    const remediation = detectRemediation(entry);
    expect(remediation).not.toBeNull();
    expect(remediation?.actionId).toBe('proxy-restart');
  });

  it('returns null for routine log entries', () => {
    const entry: ParsedLogEntry = {
      raw: 'Language server listening on port 50595',
      level: 'info',
      message: 'Language server listening on port 50595',
      isNoise: false,
    };
    expect(detectRemediation(entry)).toBeNull();
  });

  it('detects 400 invalid argument via explainError integration', () => {
    const entry: ParsedLogEntry = {
      raw: 'HTTP 400 ({"error":{"code":400,"message":"Request contains an invalid argument."}})',
      level: 'warn',
      message: 'HTTP 400 ({"error":{"code":400,"message":"Request contains an invalid argument."}})',
      isNoise: false,
    };
    const remediation = detectRemediation(entry);
    expect(remediation).not.toBeNull();
    expect(remediation?.actionId).toBe('inspect-payload');
    expect(remediation?.label).toContain('Inspect Request Payload');
  });

  it('detects 504 gateway timeout via explainError integration', () => {
    const entry: ParsedLogEntry = {
      raw: 'HTTP 504 Google API request timed out (Gateway Timeout)',
      level: 'error',
      message: 'HTTP 504 Google API request timed out (Gateway Timeout)',
      isNoise: false,
    };
    const remediation = detectRemediation(entry);
    expect(remediation).not.toBeNull();
    expect(remediation?.actionId).toBe('view-network');
    expect(remediation?.label).toContain('Check Network Host');
  });
});

describe('LogInspectorDrawer - Drawer component', () => {
  it('opens and populates container', () => {
    const classSet = new Set<string>();
    const mockContainer = {
      classList: {
        add: (cls: string) => classSet.add(cls),
        remove: (cls: string) => classSet.delete(cls),
        contains: (cls: string) => classSet.has(cls),
      },
      innerHTML: '',
      querySelector: () => null,
    } as unknown as HTMLElement;

    const drawer = new LogInspectorDrawer(mockContainer);

    const entry: ParsedLogEntry = {
      raw: 'Test raw log message',
      level: 'warn',
      time: '12:00:00',
      message: 'Test raw log message',
      isNoise: false,
      hasPayload: true,
      jsonPayload: { status: 'warn' },
    };

    drawer.open(entry);
    expect(drawer.isOpen()).toBe(true);
    expect(mockContainer.classList.contains('open')).toBe(true);
    expect(mockContainer.innerHTML).toContain('Test raw log message');
    expect(mockContainer.innerHTML).toContain('Detected Payload');

    drawer.close();
    expect(drawer.isOpen()).toBe(false);
  });

  it('handles Escape key to close and arrow navigation callbacks', () => {
    const classSet = new Set<string>();
    const mockContainer = {
      classList: {
        add: (cls: string) => classSet.add(cls),
        remove: (cls: string) => classSet.delete(cls),
        contains: (cls: string) => classSet.has(cls),
      },
      innerHTML: '',
      querySelector: () => null,
    } as unknown as HTMLElement;

    const onNav = vi.fn();
    const drawer = new LogInspectorDrawer(mockContainer, undefined, onNav);

    const entry: ParsedLogEntry = {
      raw: 'Log line for nav test',
      level: 'info',
      message: 'Log line for nav test',
      isNoise: false,
    };

    drawer.open(entry);
    expect(drawer.isOpen()).toBe(true);

    // Test Escape key using custom event or direct invocation
    const triggerKey = (key: string) => {
      if (typeof (drawer as any).handleKeyDown === 'function') {
        (drawer as any).handleKeyDown({ key, preventDefault: () => {} });
      } else if (typeof document !== 'undefined') {
        const evt = typeof KeyboardEvent !== 'undefined'
          ? new KeyboardEvent('keydown', { key })
          : { type: 'keydown', key, preventDefault: () => {} };
        (document as any).dispatchEvent(evt);
      }
    };

    triggerKey('Escape');
    expect(drawer.isOpen()).toBe(false);

    // Reopen and test arrow navigation
    drawer.open(entry);
    triggerKey('ArrowUp');
    expect(onNav).toHaveBeenCalledWith('prev');

    triggerKey('ArrowDown');
    expect(onNav).toHaveBeenCalledWith('next');

    drawer.close();
  });
});

