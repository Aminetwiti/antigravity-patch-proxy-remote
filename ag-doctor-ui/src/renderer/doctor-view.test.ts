import { describe, expect, it, vi } from 'vitest';

describe('Diagnostic View UX & Psychology Architecture', () => {
  it('preserves separate buffers for Console ANSI output and JSON inspector', () => {
    let doctorCurrentViewMode: 'console' | 'json' = 'console';
    let doctorTerminalHtml = '<span class="t-ok">✓ All checks passed</span>';
    let doctorJsonText = '{\n  "ok": true\n}';

    const getRenderedContent = (mode: 'console' | 'json') => {
      return mode === 'console' ? doctorTerminalHtml : doctorJsonText;
    };

    expect(getRenderedContent('console')).toContain('All checks passed');
    expect(getRenderedContent('json')).toContain('"ok": true');

    // Switch mode to JSON
    doctorCurrentViewMode = 'json';
    expect(getRenderedContent(doctorCurrentViewMode)).toBe(doctorJsonText);

    // Terminal buffer is untouched
    expect(doctorTerminalHtml).toContain('All checks passed');

    // Switch back to Console
    doctorCurrentViewMode = 'console';
    expect(getRenderedContent(doctorCurrentViewMode)).toBe(doctorTerminalHtml);
  });

  it('formats raw JSON output cleanly for the JSON inspector tab', () => {
    const rawCliJson = '{"status":"ok","count":4}';
    const parsed = JSON.parse(rawCliJson);
    const formatted = JSON.stringify(parsed, null, 2);

    expect(formatted).toBe('{\n  "status": "ok",\n  "count": 4\n}');
  });

  it('routes sidebarRunBtn to doctor view and triggers doctor view runner', () => {
    const events: string[] = [];

    const navigate = (view: string) => {
      events.push(`navigate:${view}`);
    };
    const runDoctorView = () => {
      events.push('runDoctorView');
    };

    const handleSidebarRunClick = () => {
      navigate('doctor');
      runDoctorView();
    };

    handleSidebarRunClick();
    expect(events).toEqual(['navigate:doctor', 'runDoctorView']);
  });

  it('triggers auto-load on first navigation to doctor when not previously run', () => {
    let doctorLastRunTimestamp: string | null = null;
    let didRun = false;

    const loadDoctorViewIfNeeded = () => {
      if (!doctorLastRunTimestamp) {
        didRun = true;
        doctorLastRunTimestamp = '12:00:00';
      }
    };

    // First visit: should trigger
    loadDoctorViewIfNeeded();
    expect(didRun).toBe(true);
    expect(doctorLastRunTimestamp).toBe('12:00:00');

    // Subsequent visit: should not re-trigger
    didRun = false;
    loadDoctorViewIfNeeded();
    expect(didRun).toBe(false);
  });

  it('prevents accidental database pruning with confirmation check', () => {
    const mockConfirm = vi.fn();

    const handlePruneWithConfirm = (confirmFn: (msg: string) => boolean) => {
      const ok = confirmFn('Are you sure you want to prune orphan trajectories?');
      if (!ok) return 'aborted';
      return 'executed';
    };

    mockConfirm.mockReturnValue(false);
    expect(handlePruneWithConfirm(mockConfirm)).toBe('aborted');

    mockConfirm.mockReturnValue(true);
    expect(handlePruneWithConfirm(mockConfirm)).toBe('executed');
  });

  it('ensures database maintenance does not destroy diagnostic terminal state', () => {
    let diagnosticBuffer = 'ANTIGRAVITY DIAGNOSTIC REPORT: HEALTHY';
    const lastRunBadge = '21:00:00';

    const handlePruneWithoutOverwritingTerminal = (pruneResult: { prunedCount: number }) => {
      // Diagnostic buffer must remain intact
      return {
        toastMessage: `Pruned ${pruneResult.prunedCount} orphan trajectories!`,
        terminalContent: diagnosticBuffer,
        lastRun: lastRunBadge,
      };
    };

    const result = handlePruneWithoutOverwritingTerminal({ prunedCount: 3 });
    expect(result.terminalContent).toBe(diagnosticBuffer);
    expect(result.lastRun).toBe('21:00:00');
    expect(result.toastMessage).toContain('Pruned 3');
  });
  it('formats CheckResult list into semantic ANSI HTML for console display', () => {
    interface TestCheckResult {
      id: string;
      title: string;
      status: 'ok' | 'warn' | 'error';
      message: string;
      details?: string;
    }

    const formatCheckResultsToHtml = (results: TestCheckResult[]): string => {
      const lines: string[] = [];
      for (const r of results) {
        const badgeClass = r.status === 'ok' ? 't-ok' : r.status === 'warn' ? 't-warn' : 't-err';
        const tag = r.status === 'ok' ? '[OK   ]' : r.status === 'warn' ? '[WARN ]' : '[ERR  ]';
        let line = `<span class="${badgeClass}">${tag}</span> <span class="t-bold">${r.title}:</span> ${r.message}`;
        if (r.details) {
          line += `\n       <span class="t-dim">${r.details}</span>`;
        }
        lines.push(line);
      }
      return lines.join('\n');
    };

    const mockResults: TestCheckResult[] = [
      { id: 'env', title: 'Environment', status: 'ok', message: 'Node v22' },
      { id: 'connectivity', title: 'Provider connectivity', status: 'warn', message: 'HTTP 404', details: 'Endpoint not reachable' },
      { id: 'proxy', title: 'Local proxy', status: 'error', message: 'Connection refused' },
    ];

    const html = formatCheckResultsToHtml(mockResults);
    expect(html).toContain('<span class="t-ok">[OK   ]</span> <span class="t-bold">Environment:</span> Node v22');
    expect(html).toContain('<span class="t-warn">[WARN ]</span> <span class="t-bold">Provider connectivity:</span> HTTP 404');
    expect(html).toContain('<span class="t-err">[ERR  ]</span> <span class="t-bold">Local proxy:</span> Connection refused');
    expect(html).toContain('Endpoint not reachable');
  });

  it('synchronizes diagnostic results into dashboard stats and objectives', () => {
    interface TestResult {
      id: string;
      status: 'ok' | 'warn' | 'error';
      data?: any;
    }

    const updateStats = (results: TestResult[]) => {
      return {
        ok: results.filter(r => r.status === 'ok').length,
        warn: results.filter(r => r.status === 'warn').length,
        err: results.filter(r => r.status === 'error').length,
        models: results.find(r => r.id === 'models')?.data?.count || 0,
      };
    };

    const results: TestResult[] = [
      { id: 'env', status: 'ok' },
      { id: 'proxy', status: 'ok' },
      { id: 'connectivity', status: 'warn' },
      { id: 'models', status: 'ok', data: { count: 3 } },
    ];

    const stats = updateStats(results);
    expect(stats.ok).toBe(3);
    expect(stats.warn).toBe(1);
    expect(stats.err).toBe(0);
    expect(stats.models).toBe(3);
  });

  it('supports Loss Aversion via Undo buffer on clear', () => {
    let currentTerminal = '<span class="t-ok">Results</span>';
    let currentJson = '{"status":"ok"}';
    let currentTimestamp: string | null = '14:30:00';
    let undoBuffer: { terminal: string; json: string; timestamp: string | null } | null = null;

    const handleClear = () => {
      if (currentTerminal || currentJson) {
        undoBuffer = { terminal: currentTerminal, json: currentJson, timestamp: currentTimestamp };
      }
      currentTerminal = '';
      currentJson = '';
      currentTimestamp = null;
    };

    const handleUndo = () => {
      if (undoBuffer) {
        currentTerminal = undoBuffer.terminal;
        currentJson = undoBuffer.json;
        currentTimestamp = undoBuffer.timestamp;
      }
    };

    handleClear();
    expect(currentTerminal).toBe('');
    expect(undoBuffer).not.toBeNull();
    expect(undoBuffer?.terminal).toContain('Results');

    handleUndo();
    expect(currentTerminal).toContain('Results');
    expect(currentTimestamp).toBe('14:30:00');
  });

  it('formats screen reader accessible status announcement avoiding pre element flooding', () => {
    const makeAnnouncement = (ok: number, warn: number, err: number): string => {
      return `Diagnostic terminé : ${ok} réussis, ${warn} avertissements, ${err} erreurs.`;
    };

    const announcement = makeAnnouncement(8, 1, 0);
    expect(announcement).toBe('Diagnostic terminé : 8 réussis, 1 avertissements, 0 erreurs.');
  });

  it('prevents double invocation on sidebarRunBtn click', () => {
    let doctorLastRunTimestamp: string | null = null;
    let runCalls = 0;

    const navigate = (view: string) => {
      if (view === 'doctor' && !doctorLastRunTimestamp) {
        runCalls++;
        doctorLastRunTimestamp = '10:00:00';
      }
    };

    const handleSidebarRunClick = () => {
      const needsInitialRun = !doctorLastRunTimestamp;
      navigate('doctor');
      if (!needsInitialRun) {
        runCalls++;
      }
    };

    // First click: triggered once via navigate
    handleSidebarRunClick();
    expect(runCalls).toBe(1);

    // Second click: triggered once via explicit call
    handleSidebarRunClick();
    expect(runCalls).toBe(2);
  });

  it('throws on non-zero exit code during database maintenance actions', async () => {
    const mockAgRunFail = vi.fn().mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'SQLite database is locked by another process',
    });

    const runPruneSafe = async (runner: typeof mockAgRunFail) => {
      const result = await runner(['db:prune', '--json']);
      if (result.code !== 0) {
        throw new Error(result.stderr?.trim() || `Command failed with code ${result.code}`);
      }
      return 'ok';
    };

    await expect(runPruneSafe(mockAgRunFail)).rejects.toThrow('SQLite database is locked');
  });

  it('detects unparsed or empty diagnostic output avoiding false success in feed', () => {
    const computeFeedSuccess = (results: any[], errCount: number) => {
      return results.length > 0 && errCount === 0;
    };

    // Standard valid zero-error run
    expect(computeFeedSuccess([{ id: 'check1', status: 'ok' }], 0)).toBe(true);

    // Failed parse: empty array despite 0 registered errors
    expect(computeFeedSuccess([], 0)).toBe(false);

    // Run with errors
    expect(computeFeedSuccess([{ id: 'check1', status: 'error' }], 1)).toBe(false);
  });
});
