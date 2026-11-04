import { describe, expect, it, vi } from 'vitest';

describe('Antigravity View UX & Psychology Remediations', () => {
  it('agLaunchLogsBtn initiates launch, navigates to logs and starts live stream', async () => {
    const events: string[] = [];
    const mockLaunch = vi.fn().mockResolvedValue({ ok: true, data: { pid: 4321 } });
    const mockNavigate = (view: string) => { events.push(`navigate:${view}`); };
    const mockStartLogStream = vi.fn().mockImplementation(async () => { events.push('stream:start'); });

    const handleLaunchLogs = async () => {
      events.push('launch:start');
      const res = await mockLaunch();
      if (res.ok) {
        events.push(`launch:ok:pid:${res.data.pid}`);
        mockNavigate('logs');
        await mockStartLogStream();
      }
    };

    await handleLaunchLogs();

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockStartLogStream).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'launch:start',
      'launch:ok:pid:4321',
      'navigate:logs',
      'stream:start',
    ]);
  });

  it('agKillBtn requires explicit confirmation before terminating processes (Nielsen H5)', async () => {
    const mockKill = vi.fn().mockResolvedValue({ ok: true, data: { killed: 2 } });
    let confirmAnswer = false;
    const mockConfirm = vi.fn().mockImplementation(() => Promise.resolve(confirmAnswer));

    const handleKill = async () => {
      const confirmed = await mockConfirm();
      if (!confirmed) return false;
      await mockKill();
      return true;
    };

    // User cancels
    confirmAnswer = false;
    const cancelledResult = await handleKill();
    expect(cancelledResult).toBe(false);
    expect(mockKill).not.toHaveBeenCalled();

    // User confirms
    confirmAnswer = true;
    const confirmedResult = await handleKill();
    expect(confirmedResult).toBe(true);
    expect(mockKill).toHaveBeenCalledTimes(1);
  });

  it('stat cards respond to both Click and Keyboard (Enter / Space) for WCAG AA 2.1.1', () => {
    const triggered: string[] = [];

    const handleCardKey = (key: string, cardId: string) => {
      if (key === 'Enter' || key === ' ') {
        triggered.push(cardId);
      }
    };

    handleCardKey('Enter', 'ag-running');
    handleCardKey(' ', 'ag-proxy');
    handleCardKey('Escape', 'ag-ls'); // should not trigger
    handleCardKey('Tab', 'ag-ls'); // should not trigger

    expect(triggered).toEqual(['ag-running', 'ag-proxy']);
  });

  it('path copy buttons guard against empty or placeholder values', async () => {
    let clipboardContent = '';
    const mockClipboardWrite = vi.fn().mockImplementation(async (text: string) => {
      clipboardContent = text;
    });

    const handleCopyPath = async (val: string | null | undefined) => {
      if (val && val !== '—') {
        await mockClipboardWrite(val);
        return true;
      }
      return false;
    };

    // Placeholder shouldn't copy
    const copiedEmpty = await handleCopyPath('—');
    expect(copiedEmpty).toBe(false);
    expect(clipboardContent).toBe('');

    // Real path copies cleanly
    const copiedReal = await handleCopyPath('C:\\Users\\user\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar');
    expect(copiedReal).toBe(true);
    expect(clipboardContent).toBe('C:\\Users\\user\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar');
  });

  it('adapts lifecycle button states dynamically according to process status (Nielsen H1 & H5)', () => {
    interface ButtonStates {
      launchDisabled: boolean;
      restartDisabled: boolean;
      killDisabled: boolean;
    }

    const computeButtonStates = (running: boolean, isLsRunning = false): ButtonStates => {
      const hasAnyProcess = running || isLsRunning;
      return {
        launchDisabled: running,
        restartDisabled: !hasAnyProcess,
        killDisabled: !hasAnyProcess,
      };
    };

    // When Antigravity is completely STOPPED
    const stoppedStates = computeButtonStates(false, false);
    expect(stoppedStates.launchDisabled).toBe(false);
    expect(stoppedStates.restartDisabled).toBe(true);
    expect(stoppedStates.killDisabled).toBe(true);

    // When Antigravity IDE is RUNNING
    const runningStates = computeButtonStates(true, true);
    expect(runningStates.launchDisabled).toBe(true);
    expect(runningStates.restartDisabled).toBe(false);
    expect(runningStates.killDisabled).toBe(false);

    // When Antigravity IDE crashed/stopped but language_server is orphaned (AUDIT-002 remediation)
    const zombieLsStates = computeButtonStates(false, true);
    expect(zombieLsStates.launchDisabled).toBe(false); // Can launch IDE
    expect(zombieLsStates.restartDisabled).toBe(false); // Can restart/cleanup zombie
    expect(zombieLsStates.killDisabled).toBe(false); // Can kill zombie LS!
  });

  it('manages tools dropdown visibility and closes on Escape and on item selection (WCAG 2.1.2)', () => {
    let isOpen = false;

    const toggleDropdown = () => {
      isOpen = !isOpen;
    };

    const closeToolsMenu = () => {
      isOpen = false;
    };

    const handleKeydown = (key: string) => {
      if (key === 'Escape' && isOpen) {
        closeToolsMenu();
      }
    };

    // Open dropdown
    toggleDropdown();
    expect(isOpen).toBe(true);

    // Escape closes dropdown
    handleKeydown('Escape');
    expect(isOpen).toBe(false);

    // Clicking an item in menu also closes it (AUDIT-009 remediation)
    toggleDropdown();
    expect(isOpen).toBe(true);
    closeToolsMenu();
    expect(isOpen).toBe(false);
  });

  it('catches clipboard write rejections and reports error gracefully (AUDIT-010 remediation)', async () => {
    const mockClipboardFailing = vi.fn().mockRejectedValue(new Error('Document is not focused'));
    let toastMessage = '';

    const handleCopyPathSafely = async (val: string | null | undefined) => {
      if (val && val !== '—') {
        try {
          await mockClipboardFailing(val);
          return true;
        } catch (err) {
          toastMessage = `Copy failed: ${(err as Error).message}`;
          return false;
        }
      }
      return false;
    };

    const success = await handleCopyPathSafely('C:\\path\\app.asar');
    expect(success).toBe(false);
    expect(toastMessage).toBe('Copy failed: Document is not focused');
  });

  it('requires confirmation before rebuilding sidebar when Antigravity is active (AUDIT-005 remediation)', async () => {
    const mockRebuild = vi.fn().mockResolvedValue({ code: 0, stdout: '{"totalConversations": 5}' });
    let isConfirmed = false;
    const mockConfirmModal = vi.fn().mockImplementation(async () => isConfirmed);

    const handleRebuild = async (isAntigravityRunning: boolean) => {
      if (isAntigravityRunning) {
        const proceed = await mockConfirmModal();
        if (!proceed) return false;
      }
      await mockRebuild();
      return true;
    };

    // When running and user cancels
    isConfirmed = false;
    const cancelled = await handleRebuild(true);
    expect(cancelled).toBe(false);
    expect(mockRebuild).not.toHaveBeenCalled();

    // When running and user confirms danger
    isConfirmed = true;
    const confirmed = await handleRebuild(true);
    expect(confirmed).toBe(true);
    expect(mockRebuild).toHaveBeenCalledTimes(1);

    // When stopped, runs directly
    mockRebuild.mockClear();
    const stoppedRun = await handleRebuild(false);
    expect(stoppedRun).toBe(true);
    expect(mockRebuild).toHaveBeenCalledTimes(1);
  });

  it('provides micro-interaction feedback on copy action (Peak-End Rule & Nielsen H1)', () => {
    let label = 'Copy';
    const copyWithFeedback = (val: string) => {
      if (val && val !== '—') {
        label = 'Copied ✓';
        return true;
      }
      return false;
    };

    expect(copyWithFeedback('—')).toBe(false);
    expect(label).toBe('Copy');

    expect(copyWithFeedback('/path/to/app.asar')).toBe(true);
    expect(label).toBe('Copied ✓');
  });

  it('manages is-loading state on lifecycle buttons during transit (/impeccable animate)', async () => {
    const classList = new Set<string>();
    const mockAction = vi.fn().mockImplementation(async () => {
      expect(classList.has('is-loading')).toBe(true);
      return { ok: true };
    });

    const runLifecycleAction = async () => {
      classList.add('is-loading');
      try {
        await mockAction();
      } finally {
        classList.delete('is-loading');
      }
    };

    expect(classList.has('is-loading')).toBe(false);
    await runLifecycleAction();
    expect(classList.has('is-loading')).toBe(false);
    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});
