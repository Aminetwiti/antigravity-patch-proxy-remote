/**
 * view-diagnostic.ts — Diagnostic (Doctor) View Controller.
 * Manages system diagnostic execution, ANSI terminal output, JSON inspection, and DB remediation.
 */




const doctorTpl = document.createElement('template');

async function runDoctorView(): Promise<void> {
  const doctorOutput = $('#doctorOutput') as HTMLPreElement;
  setStatus('Running doctor…', 'busy');
  if (doctorOutput) doctorOutput.textContent = '$ ag-doctor doctor\n';

  const feedContainer = $('#doctorExecutionFeed') as HTMLElement | null;
  const FeedRendererClass = (window as any).ExecutionFeedRenderer;
  const feedRenderer = FeedRendererClass ? new FeedRendererClass() : null;

  if (feedContainer && feedRenderer) {
    feedContainer.innerHTML = feedRenderer.renderHtml({
      isStreaming: true,
      workingText: 'Running Antigravity diagnostic pipeline…',
      steps: [
        { id: 'step-1', type: 'command', verb: 'Ran', title: 'ag-doctor doctor', commandStr: 'ag-doctor doctor' },
      ],
    });
  }

  try {
    const result = await (window as any).ag.run(['doctor']);
    doctorTpl.innerHTML = ansiToHtml(result.stdout || result.stderr);
    if (doctorOutput) doctorOutput.replaceChildren(doctorTpl.content);

    if (feedContainer && feedRenderer) {
      const isSuccess = !result.stderr || result.stderr.length === 0;
      feedContainer.innerHTML = feedRenderer.renderHtml({
        isStreaming: false,
        isSummaryCollapsed: false,
        steps: [
          {
            id: 'step-1',
            type: 'command',
            verb: 'Ran',
            title: 'ag-doctor doctor',
            commandStr: 'ag-doctor doctor',
            outputStr: 'Execution finished successfully',
          },
          {
            id: 'step-2',
            type: isSuccess ? 'taskFinished' : 'command',
            verb: isSuccess ? 'Task finished' : 'Failed',
            title: isSuccess ? 'All system diagnostics completed' : 'Diagnostic completed with notices',
          },
        ],
      });
      feedRenderer.attachInteractiveListeners(feedContainer);
    }

    setStatus('Ready');
  } catch (e) {
    if (doctorOutput) doctorOutput.textContent = `Could not run doctor: ${(e as Error).message}`;

    if (feedContainer && feedRenderer) {
      feedContainer.innerHTML = feedRenderer.renderHtml({
        isStreaming: false,
        steps: [
          {
            id: 'step-1',
            type: 'command',
            verb: 'Failed',
            title: `Error: ${(e as Error).message}`,
          },
        ],
      });
    }

    setStatus('Error', 'err');
  }
}

async function loadDoctor(): Promise<void> {
  return runDoctorView();
}

async function handleRebuildSidebarAction(): Promise<void> {
  const btns = [
    $('#doctorRebuildSidebarBtn') as HTMLButtonElement | null,
    $('#agRebuildSidebarBtn') as HTMLButtonElement | null,
    $('#settingsRebuildSidebarBtn') as HTMLButtonElement | null,
  ].filter(Boolean) as HTMLButtonElement[];
  btns.forEach(b => { b.disabled = true; });
  setStatus('Rebuilding sidebar…', 'busy');
  try {
    const result = await (window as any).ag.run(['db:rebuild-sidebar', '--yes', '--json']);
    let parsed: any = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }

    if (parsed) {
      toast(`Sidebar rebuilt! ${parsed.totalConversations} conversations indexed across ${parsed.databasesUpdated} database(s)`, 'ok');
    } else {
      toast(result.stdout.trim() || 'Sidebar rebuilt successfully', 'ok');
    }
    const docOut = $('#doctorOutput');
    if (docOut) {
      docOut.textContent = result.stdout || result.stderr;
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Sidebar rebuild failed: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

async function handlePruneAction(): Promise<void> {
  const ok = await confirmModal(
    'Prune Database',
    'Are you sure you want to prune orphan conversation trajectories and vacuum the SQLite database? This permanently cleans invalid sessions.',
    { confirmLabel: 'Prune Database', danger: true }
  );
  if (!ok) return;

  const btns = [
    $('#doctorPruneBtn') as HTMLButtonElement | null,
    $('#settingsPruneDbBtn') as HTMLButtonElement | null,
  ].filter(Boolean) as HTMLButtonElement[];
  btns.forEach(b => { b.disabled = true; });
  setStatus('Pruning database…', 'busy');
  try {
    const result = await (window as any).ag.run(['db:prune', '--json']);
    let parsed: any = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }

    if (parsed) {
      if (parsed.orphanCount === 0) {
        toast('Database is clean: 0 orphan trajectories found.', 'info');
      } else {
        toast(`Pruned ${parsed.prunedCount} orphan trajectories! Reclaimed ${(parsed.bytesReclaimed / 1024).toFixed(1)} KB`, 'ok');
      }
    } else {
      toast(result.stdout.trim() || 'Database pruned successfully', 'ok');
    }
    const docOut = $('#doctorOutput');
    if (docOut) {
      docOut.textContent = result.stdout || result.stderr;
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Prune failed: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

function initDiagnosticView(): void {
  registerViewLoader('doctor', loadDoctor);

  $('#doctorRunBtn')?.addEventListener('click', () => void runDoctorView());
  $('#doctorPruneBtn')?.addEventListener('click', () => void handlePruneAction());
  $('#doctorRebuildSidebarBtn')?.addEventListener('click', () => void handleRebuildSidebarAction());
  $('#agRebuildSidebarBtn')?.addEventListener('click', () => void handleRebuildSidebarAction());

  $('#doctorJsonBtn')?.addEventListener('click', async () => {
    const doctorOutput = $('#doctorOutput') as HTMLPreElement;
    setStatus('Loading JSON…', 'busy');
    try {
      const result = await (window as any).ag.run(['doctor', '--json']);
      if (doctorOutput) doctorOutput.textContent = result.stdout || result.stderr;
      setStatus('Ready');
    } catch (e) {
      toast(`Could not load doctor JSON: ${(e as Error).message}`, 'err');
      setStatus('Error', 'err');
    }
  });
}
