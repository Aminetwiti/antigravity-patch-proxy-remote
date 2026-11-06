/**
 * views/dashboard-objectives.ts
 *
 * Responsabilité Unique (SRP) :
 * - Gestion du panneau d'objectifs de santé du système (Health List & Stat Cards)
 * - Exécution des diagnostics Antigravity (runDoctor)
 * - Actions de réparation et auto-heal (runRepair, runFixAll, runStartStub, handleRepair)
 * - Mise à jour réactive des badges et compteurs
 */

const healthList = $('#healthList') as HTMLDivElement;
const statOk = $('#statOk') as HTMLDivElement;
const statWarn = $('#statWarn') as HTMLDivElement;
const statErr = $('#statErr') as HTMLDivElement;
const statModels = $('#statModels') as HTMLDivElement;
const lastRunBadge = $('#lastRunBadge') as HTMLSpanElement;

let lastResults: CheckResult[] = [];
let healthFilter: 'all' | 'ok' | 'warn' | 'error' = 'all';

function renderFilteredHealthList(): void {
  const badge = $('#healthFilterBadge') as HTMLElement | null;
  const filtered = healthFilter === 'all'
    ? lastResults
    : lastResults.filter((r) => r.status === healthFilter);

  if (badge) {
    if (healthFilter === 'all') {
      badge.style.display = 'none';
      badge.textContent = '';
    } else {
      badge.style.display = 'inline-flex';
      const label = healthFilter === 'warn' ? 'Warnings only' : healthFilter === 'error' ? 'Issues only' : 'Healthy only';
      badge.textContent = `${label} (${filtered.length}) · Click to show all`;
    }
  }

  $$('.stat-card').forEach((card) => {
    const statType = card.getAttribute('data-stat');
    if (statType === healthFilter) {
      card.classList.add('active-filter');
    } else {
      card.classList.remove('active-filter');
    }
  });

  renderHealthList(filtered);
}

// Event delegation: bind once for expand toggles (avoids N listeners per item)
healthList?.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('.health-expand') as HTMLButtonElement | null;
  if (target) {
    const item = target.closest('.health-item');
    const isExpanded = item?.classList.toggle('expanded') ?? false;
    target.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    target.textContent = isExpanded ? 'Hide details' : 'Show details';
  }
});

// Reusable template for health list — avoids creating a new <template> each render
const healthTpl = document.createElement('template');

function renderHealthList(results: CheckResult[]): void {
  if (!healthList) return;
  if (results.length === 0) {
    const isFiltered = healthFilter !== 'all' && lastResults.length > 0;
    healthList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <p>${isFiltered ? 'No items matching the selected filter.' : 'Click <strong>Run doctor</strong> to scan Antigravity, MITM, patches, and models.'}</p>
      </div>`;
    return;
  }
  // Build via DocumentFragment: parse once, insert once (no double innerHTML parse)
  const html = results
    .map((r, i) => {
      const icon = iconForStatus(r.status);
      const detailsHtml = r.details
        ? `<div class="health-details">${escapeHtml(r.details)}</div><button class="health-expand" type="button" aria-expanded="false">Show details</button>`
        : '';
      return `
        <div class="health-item" style="animation-delay:${i * 40}ms" data-id="${r.id}">
          <div class="health-icon ${r.status}">${icon}</div>
          <div class="health-body">
            <div class="health-title">${escapeHtml(r.title)}</div>
            <div class="health-message">${escapeHtml(r.message)}</div>
            ${detailsHtml}
          </div>
        </div>`;
    })
    .join('');
  healthTpl.innerHTML = html;
  healthList.replaceChildren(healthTpl.content);
}

function updateStats(results: CheckResult[]): void {
  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const err = results.filter((r) => r.status === 'error').length;
  const modelsCheck = results.find((r) => r.id === 'models');
  const modelsCount =
    modelsCheck?.data && typeof modelsCheck.data === 'object' && 'count' in modelsCheck.data
      ? (modelsCheck.data as { count: number }).count
      : 0;

  if (statOk) statOk.textContent = String(ok);
  if (statWarn) statWarn.textContent = String(warn);
  if (statErr) statErr.textContent = String(err);
  if (statModels) statModels.textContent = String(modelsCount);
  if (lastRunBadge) lastRunBadge.textContent = new Date().toLocaleTimeString();
}

async function runDoctor(): Promise<void> {
  setStatus('Running doctor…', 'busy');
  $('#runDoctorBtn')?.setAttribute('disabled', 'true');
  $('#refreshBtn')?.setAttribute('disabled', 'true');
  $('#sidebarRunBtn')?.setAttribute('disabled', 'true');
  $('#heroRunBtn')?.setAttribute('disabled', 'true');
  setObjective('doctor', 'pending', 'Running…');
  if (lastRunBadge) lastRunBadge.textContent = 'Running...';

  try {
    const result = await window.ag.run(['doctor', '--json']);
    if (result.code !== 0 && !result.stdout) {
      throw new Error(result.stderr || `Exited with code ${result.code}`);
    }
    const stdout = (result.stdout || '').trim();
    const jsonStart = stdout.indexOf('[');
    const jsonEnd = stdout.lastIndexOf(']');
    const rawJson = (jsonStart >= 0 && jsonEnd > jsonStart)
      ? stdout.slice(jsonStart, jsonEnd + 1)
      : stdout;
    const results = JSON.parse(rawJson) as CheckResult[];
    lastResults = results;
    healthFilter = 'all';
    updateStats(results);
    updateObjectives(results);
    renderFilteredHealthList();

    // Show "Resolve verification" button only when a VALIDATION_REQUIRED issue is detected
    const hasValidation = results.some((r) => r.id === 'validation' || r.message?.includes('VALIDATION_REQUIRED'));
    const resolveBtn = $('#dashboardResolveVerificationBtn');
    if (resolveBtn) resolveBtn.style.display = hasValidation ? '' : 'none';

    setStatus('Ready', 'ready');
  } catch (e) {
    toast(`Doctor failed: ${(e as Error).message}. Check the Logs tab for full output.`, 'err', 5000);
    setStatus('Error', 'err');
    setObjective('doctor', 'error', 'Doctor failed');
    void window.ag.trayStatus('err');
    if (lastRunBadge) lastRunBadge.textContent = 'Failed';
  } finally {
    $('#runDoctorBtn')?.removeAttribute('disabled');
    $('#refreshBtn')?.removeAttribute('disabled');
    $('#sidebarRunBtn')?.removeAttribute('disabled');
    $('#heroRunBtn')?.removeAttribute('disabled');
  }
}

function resultStatusToObjective(status: CheckResult['status']): 'ok' | 'warn' | 'error' | 'pending' {
  return status === 'info' ? 'ok' : status;
}

function updateObjectives(results: CheckResult[]): void {
  const hasError = results.some((r) => r.status === 'error');
  const hasWarn = results.some((r) => r.status === 'warn');
  setObjective('doctor', hasError ? 'error' : hasWarn ? 'warn' : 'ok', hasError ? 'Issues detected' : hasWarn ? 'Warnings found' : 'Doctor OK');

  const antigravity = results.find((r) => r.id === 'antigravity' || r.id === 'version' || r.id === 'install');
  setObjective('antigravity', antigravity ? resultStatusToObjective(antigravity.status) : 'pending', antigravity?.message);

  const mitm = results.find((r) => r.id === 'mitm' || r.id === 'proxy' || r.id === 'ca');
  setObjective('mitm', mitm ? resultStatusToObjective(mitm.status) : 'pending', mitm?.message);

  const patch = results.find((r) => r.id === 'patch');
  setObjective('patch', patch ? resultStatusToObjective(patch.status) : 'pending', patch?.message);

  const logs = results.find((r) => r.id === 'logs');
  setObjective('logs', logs ? resultStatusToObjective(logs.status) : 'ok', logs?.message ?? 'Logs available');
}

$('#runDoctorBtn')?.addEventListener('click', () => void runDoctor());
$('#heroRunBtn')?.addEventListener('click', () => void runDoctor());
$('#emptyStateRunDoctorBtn')?.addEventListener('click', () => void runDoctor());
$('#refreshBtn')?.addEventListener('click', () => void runDoctor());
$('#repairBtn')?.addEventListener('click', () => void handleRepair());

// Fix All: full auto-repair with admin elevation (UAC prompt will appear)
$('#fixAllBtn')?.addEventListener('click', () => void runFixAll());

// Start Stub: emergency proxy stub (no admin needed)
$('#startStubBtn')?.addEventListener('click', () => void runStartStub());

// Stat-card click-to-filter: clicking a KPI card filters the health list by that status
const statFilterMap: Record<string, 'ok' | 'warn' | 'error'> = { ok: 'ok', warn: 'warn', err: 'error' };
$$('.stat-card[data-stat]').forEach((card) => {
  card.addEventListener('click', () => {
    const stat = card.getAttribute('data-stat') ?? '';
    const mapped = statFilterMap[stat];
    if (!mapped || lastResults.length === 0) return;
    healthFilter = healthFilter === mapped ? 'all' : mapped;
    renderFilteredHealthList();
  });
});

// Clear filter when badge is clicked
$('#healthFilterBadge')?.addEventListener('click', () => {
  healthFilter = 'all';
  renderFilteredHealthList();
});

async function runRepair(): Promise<void> {
  const ok = await confirmModal(
    'Apply diagnostic repair?',
    'Attempt automatic repair of detected binary patch or certificate issues?',
    { confirmLabel: 'Run repair', danger: true },
  );
  if (!ok) return;
  setStatus('Repairing…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', 'repair', '--yes']);
    if (r.code === 0) {
      toast('Repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Patch repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}

async function runFixAll(): Promise<void> {
  const ok = await confirmModal(
    'Run full auto-repair?',
    'This will launch <code>ag-doctor repair --yes --auto-elevate</code> with admin elevation (UAC). ' +
    'All repair actions will run: patch, proxy, CA certificate.',
    { confirmLabel: 'Run full repair', danger: true },
  );
  if (!ok) return;
  setStatus('Full repair — admin elevation…', 'busy');
  $('#fixAllBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.repairRun();
    if (r?.ok) {
      toast('Full repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Full repair completed');
    } else {
      toast(`Full repair failed: ${r?.error ?? 'unknown'}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Full repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Full repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#fixAllBtn')?.removeAttribute('disabled');
  }
}

async function runStartStub(): Promise<void> {
  setStatus('Starting proxy stub…', 'busy');
  $('#startStubBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.proxyStartStub();
    if (r?.ok) {
      toast(`Proxy stub started (pid=${r.pid ?? '?'}) on port ${r.port}`, 'ok', 5000);
      setObjective('proxy', 'ok', `Proxy stub active on ${r.port}`);
    } else {
      toast(`Proxy stub failed: ${r?.error ?? 'unknown'}`, 'err', 6000);
      setObjective('proxy', 'error', 'Proxy stub failed');
    }
  } catch (e) {
    toast(`Proxy stub error: ${(e as Error).message}`, 'err');
  } finally {
    $('#startStubBtn')?.removeAttribute('disabled');
    setStatus('Ready', 'ready');
  }
}

function setObjective(key: ObjectiveKey, state: 'pending' | 'ok' | 'warn' | 'error', detail?: string): void {
  const el = document.getElementById(`obj-${key}`);
  if (!el) return;

  const iconDiv = el.querySelector('.objective-icon');
  if (iconDiv) {
    iconDiv.className = `objective-icon ${state}`;
    iconDiv.innerHTML = iconForObjective(state);
  }

  const statusDiv = el.querySelector('.objective-status');
  if (statusDiv) {
    statusDiv.textContent = detail || (state === 'pending' ? 'Pending' : state === 'ok' ? 'OK' : state === 'warn' ? 'Warning' : 'Error');
    if (detail) statusDiv.setAttribute('title', detail);
  }
}

async function handleRepair(): Promise<void> {
  setStatus('Repairing patch…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', '--repair']);
    if (r.code === 0) {
      toast('Repair complete', 'ok');
      setObjective('patch', 'ok', 'Repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
    setObjective('patch', 'error', 'Repair failed');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}
