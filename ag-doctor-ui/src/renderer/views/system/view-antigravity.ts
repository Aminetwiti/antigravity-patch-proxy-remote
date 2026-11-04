

﻿// Antigravity Status view
// ─────────────────────────────────────────────────────────────────────────────

const agVersionValue = $('#agVersionValue') as HTMLDivElement;
const agRunningValue = $('#agRunningValue') as HTMLDivElement;
const agProxyValue = $('#agProxyValue') as HTMLDivElement;
const agLsValue = $('#agLsValue') as HTMLDivElement;

const agSourceBadge = $('#agSourceBadge') as HTMLSpanElement;
const agInstallPath = $('#agInstallPath') as HTMLDivElement;
const agAppAsar = $('#agAppAsar') as HTMLDivElement;
const agVersionRow = $('#agVersionRow') as HTMLDivElement;
const agChannelRow = $('#agChannelRow') as HTMLDivElement;

const agPidsBadge = $('#agPidsBadge') as HTMLSpanElement;
const agAgPids = $('#agAgPids') as HTMLDivElement;
const agLsPids = $('#agLsPids') as HTMLDivElement;

const agRefreshBtn = $('#agRefreshBtn') as HTMLButtonElement;
const agLaunchBtn = $('#agLaunchBtn') as HTMLButtonElement;
const agKillBtn = $('#agKillBtn') as HTMLButtonElement;
const agRestartBtn = $('#agRestartBtn') as HTMLButtonElement;
const agLaunchLogsBtn = $('#agLaunchLogsBtn') as HTMLButtonElement;

let agStartedAt: number | null = null;
let agUptimeTimer: number | null = null;

function setAgHero(status: 'ok' | 'warn' | 'err' | 'busy', label: string, meta: string): void {
  if (agRunningValue) {
    agRunningValue.textContent = label;
  }
}

function startUptimeTicker(): void {
  // UI changed, no longer showing uptime in real-time
}

function stopUptimeTicker(): void {
  // UI changed, no longer showing uptime in real-time
}

// Reusable template for paths — avoids creating a new <template> each render
const pathsTpl = document.createElement('template');


function renderPaths(paths: Array<[string, string]>): void {
  const html = paths
    .filter(([, v]) => v && v !== '—')
    .map(([label, value]) => `
      <div class="path-row">
        <div class="path-row-label">${escapeHtml(label)}</div>
        <div class="path-row-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div>
        <div class="path-row-actions">
          <button type="button" data-copy="${escapeHtml(value)}" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button type="button" data-reveal="${escapeHtml(value)}" title="Reveal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  pathsTpl.innerHTML = html;
}

// Event delegation for path actions
$('#agPaths')?.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const copyBtn = target.closest<HTMLElement>('[data-copy]');
  if (copyBtn) {
    await navigator.clipboard.writeText(copyBtn.dataset.copy ?? '');
    toast('Path copied', 'ok', 1500);
    return;
  }
  const revealBtn = target.closest<HTMLElement>('[data-reveal]');
  if (revealBtn) {
    await window.ag.reveal(revealBtn.dataset.reveal ?? '');
  }
});

$('#agCopyPathsBtn')?.addEventListener('click', async () => {
  const container = $('#agPaths');
  if (!container) return;
  const values = Array.from(container.querySelectorAll<HTMLElement>('.path-row-value'))
    .map((el) => el.textContent ?? '').join('\n');
  await navigator.clipboard.writeText(values);
  toast('All paths copied', 'ok', 2000);
});

function setAgLifecycleBusy(busy: boolean): void {
  if (agLaunchBtn) agLaunchBtn.disabled = busy;
  if (agLaunchLogsBtn) agLaunchLogsBtn.disabled = busy;
  if (agRestartBtn) agRestartBtn.disabled = busy;
  if (agKillBtn) agKillBtn.disabled = busy;
  if (agRefreshBtn) agRefreshBtn.disabled = busy;
}

agRefreshBtn.addEventListener('click', () => void loadAntigravityStatus());

agLaunchBtn.addEventListener('click', async () => {
  setAgLifecycleBusy(true);
  setAgHero('busy', 'Opening…', 'Launching Antigravity');
  try {
    const result = await window.ag.antigravityLaunch();
    if (!result.ok) throw new Error(result.error ?? 'Launch failed');
    const pid = result.data?.pid;
    setAgHero('ok', 'Running', `PID ${pid ?? '—'} · Launched`);
    startUptimeTicker();
    toast('Antigravity launched', 'ok', 2000);
    await loadAntigravityStatus();
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Launch failed: ${(e as Error).message}`, 'err');
  } finally {
    setAgLifecycleBusy(false);
  }
});

agKillBtn.addEventListener('click', async () => {
  setAgLifecycleBusy(true);
  setAgHero('busy', 'Closing…', 'Killing Antigravity process');
  try {
    const result = await window.ag.antigravityKill();
    if (!result.ok) throw new Error(result.error ?? 'Kill failed');
    setAgHero('warn', 'Stopped', `Killed ${result.data?.killed ?? 0} processes`);
    toast('Antigravity closed', 'ok', 2000);
    await loadAntigravityStatus();
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Close failed: ${(e as Error).message}`, 'err');
  } finally {
    setAgLifecycleBusy(false);
  }
});

agRestartBtn.addEventListener('click', async () => {
  setAgLifecycleBusy(true);
  setAgHero('busy', 'Restarting…', 'Killing and relaunching');
  try {
    const result = await window.ag.antigravityRestart();
    if (!result.ok) throw new Error(result.error ?? 'Restart failed');
    const pid = result.data?.pid;
    setAgHero('ok', 'Running', `PID ${pid ?? '—'} · Restarted`);
    startUptimeTicker();
    toast('Antigravity restarted', 'ok', 2000);
    await loadAntigravityStatus();
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Restart failed: ${(e as Error).message}`, 'err');
  } finally {
    setAgLifecycleBusy(false);
  }
});

const agResolveVerificationBtn = $('#agResolveVerificationBtn') as HTMLButtonElement | null;
agResolveVerificationBtn?.addEventListener('click', () => {
  void showAntigravityVerificationResolutionModal();
});

// Interactive stat card shortcuts
document.querySelector('[data-stat="ag-running"]')?.addEventListener('click', () => {
  if (agRunningValue?.textContent === 'Stopped') {
    agLaunchBtn?.click();
  } else {
    void loadAntigravityStatus();
  }
});

document.querySelector('[data-stat="ag-proxy"]')?.addEventListener('click', () => {
  navigate('mitm');
});

document.querySelector('[data-stat="ag-ls"]')?.addEventListener('click', () => {
  if (agLsValue?.textContent === 'Stopped') {
    agLaunchBtn?.click();
  } else {
    $('#agLsPids')?.scrollIntoView({ behavior: 'smooth' });
  }
});

async function loadAntigravityStatus(): Promise<void> {
  return guardLoad('agStatus', async () => {
    setStatus('Loading Antigravity status…', 'busy');
    setAgHero('busy', 'Checking…', 'Detecting installation');
    try {
      const [info, statusResult, versionResult, modelsResult] = await Promise.all([
        memo('info', 60_000, () => window.ag.info()),
        withTimeout(window.ag.antigravityStatus(), 10_000, 'antigravity status').catch((err: Error) => ({ ok: false, data: undefined, error: err.message })),
        withTimeout(window.ag.antigravityVersion(), 10_000, 'antigravity version').catch((err: Error) => ({ ok: false, data: undefined, error: err.message })),
        withTimeout(window.ag.run(['models', 'list', '--json']), 10_000, 'models list').catch(() => ({ stdout: '{"models":[]}', stderr: '', code: 0 })),
      ]);

      const status = statusResult.ok ? (statusResult.data as Record<string, unknown>) : null;
      const versionData = versionResult.ok ? versionResult.data : null;
      let modelsCount = 0;
      try {
        const modelsData = JSON.parse(modelsResult.stdout) as { models?: Array<{ name: string }> };
        if (modelsData && Array.isArray(modelsData.models)) {
          modelsCount = modelsData.models.length;
        }
      } catch {
        modelsCount = 0;
      }

      const installed = Boolean(status?.installed ?? status?.installDir);
      const running = Boolean(status?.running ?? status?.pid);
      const pid = status?.pid as number | undefined;
      const version = (versionData?.version as string | undefined) ?? (status?.version as string | undefined);
      const installDir = (status?.installDir as string | undefined) ?? '';

      // Hero card
      if (!installed) {
        setAgHero('err', 'Not installed', installDir || 'No installation found');
      } else if (running) {
        setAgHero('ok', 'Running', `PID ${pid ?? '—'} · ${version ?? 'unknown'}`);
        startUptimeTicker();
      } else {
        setAgHero('warn', 'Installed · Stopped', version ?? 'Not running');
      }

      // Stat cards with synchronized icon statuses
      if (agVersionValue) agVersionValue.textContent = version ?? '—';
      const versionIcon = document.querySelector('[data-stat="ag-version"] .stat-icon');
      if (versionIcon) versionIcon.className = installed ? 'stat-icon ok' : 'stat-icon err';

      const runningIcon = document.querySelector('[data-stat="ag-running"] .stat-icon');
      if (agRunningValue) {
        if (!installed) {
          agRunningValue.textContent = 'Not installed';
          if (runningIcon) runningIcon.className = 'stat-icon err';
        } else if (running) {
          agRunningValue.textContent = 'Running';
          if (runningIcon) runningIcon.className = 'stat-icon ok';
        } else {
          agRunningValue.textContent = 'Stopped';
          if (runningIcon) runningIcon.className = 'stat-icon warn';
        }
      }

      // Fill Installation Panel
      if (agInstallPath) agInstallPath.textContent = installDir || '—';
      if (agAppAsar) agAppAsar.textContent = (status?.appAsarPath as string | undefined) ?? '—';
      if (agVersionRow) agVersionRow.textContent = version ?? '—';
      if (agChannelRow) agChannelRow.textContent = (status?.channel as string | undefined) ?? '—';

      // Fill Running processes Panel
      let agPidCount = 0;
      if (agAgPids) {
        const pids = status?.agPids as number[] | undefined;
        agPidCount += pids?.length ?? (pid ? 1 : 0);
        agAgPids.textContent = pids && pids.length > 0 ? pids.join(', ') : (pid ? String(pid) : '—');
      }
      if (agLsPids) {
        const lsPids = status?.lsPids as number[] | undefined;
        agPidCount += lsPids?.length ?? 0;
        agLsPids.textContent = lsPids && lsPids.length > 0 ? lsPids.join(', ') : '—';
      }
      if (agPidsBadge) {
        agPidsBadge.textContent = `${agPidCount} PIDs`;
      }
      if (agSourceBadge) {
        agSourceBadge.textContent = installed ? 'Installed' : 'Missing';
      }

      const lsIcon = document.querySelector('[data-stat="ag-ls"] .stat-icon');
      if (agLsValue) {
        const lsPids = status?.lsPids as number[] | undefined;
        const isLsRunning = Boolean(lsPids && lsPids.length > 0);
        agLsValue.textContent = isLsRunning ? 'Running' : 'Stopped';
        if (lsIcon) lsIcon.className = isLsRunning ? 'stat-icon ok' : 'stat-icon warn';
      }

      const proxyIcon = document.querySelector('[data-stat="ag-proxy"] .stat-icon');
      try {
        const proxyResp = await window.ag.proxyStatus();
        const isProxyRunning = Boolean(proxyResp?.data?.running);
        if (agProxyValue) {
          agProxyValue.textContent = isProxyRunning ? 'Running' : 'Stopped';
        }
        if (proxyIcon) {
          proxyIcon.className = isProxyRunning ? 'stat-icon ok' : 'stat-icon warn';
        }
      } catch {
        if (agProxyValue) agProxyValue.textContent = 'Unknown';
        if (proxyIcon) proxyIcon.className = 'stat-icon err';
      }

      try {
        await loadAntigravityCpuOptStatus();
      } catch {}

      try {
        await loadAuthStatus();
      } catch {}

      setStatus('Ready');
    } catch (e) {
      setAgHero('err', 'Error', (e as Error).message);
      setStatus('Error', 'err');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity CPU Optimization Controls
// ─────────────────────────────────────────────────────────────────────────────

const agApplyCpuOptBtn = $('#agApplyCpuOptBtn') as HTMLButtonElement | null;
const agRevertCpuOptBtn = $('#agRevertCpuOptBtn') as HTMLButtonElement | null;

async function loadAntigravityCpuOptStatus(): Promise<void> {
  const badge = $('#agCpuOptBadge') as HTMLSpanElement | null;
  const statusEl = $('#agCpuOptStatus') as HTMLDivElement | null;
  const profilesEl = $('#agCpuOptProfiles') as HTMLDivElement | null;

  try {
    const res = await window.ag.antigravityCpuOptStatus?.();
    if (!res?.ok || !res.data) {
      if (badge) {
        badge.textContent = 'Unknown';
        badge.className = 'badge';
      }
      if (statusEl) statusEl.textContent = res?.error ?? 'Unable to check status';
      return;
    }

    const { isOptimized, profiles } = res.data;
    const existing = Array.isArray(profiles) ? profiles.filter((p: any) => p.exists) : [];
    const hasBackups = existing.some((p: any) => p.backupExists);

    if (badge) {
      badge.textContent = isOptimized ? 'Optimized' : 'Not optimized';
      badge.className = isOptimized ? 'badge badge-ok' : 'badge badge-warn';
    }

    if (statusEl) {
      statusEl.textContent = isOptimized
        ? 'Active · Heavy watchers excluded and LSP memory capped'
        : 'Inactive · Default unoptimized settings in place';
    }

    if (profilesEl) {
      if (existing.length === 0) {
        profilesEl.textContent = 'No settings.json profile detected';
      } else {
        profilesEl.textContent = existing.map((p: any) => {
          const name = p.path.includes('Antigravity IDE') ? 'Antigravity IDE' : 'Antigravity';
          return `${name}: ${p.optimized ? 'Optimized ✓' : 'Unoptimized ⚠'}`;
        }).join(' · ');
      }
    }

    if (agRevertCpuOptBtn) {
      agRevertCpuOptBtn.style.display = hasBackups ? 'inline-flex' : 'none';
    }

    if (agApplyCpuOptBtn) {
      agApplyCpuOptBtn.textContent = isOptimized ? 'Reapply CPU Optimization' : 'Apply CPU Optimization';
    }
  } catch (err) {
    if (badge) {
      badge.textContent = 'Error';
      badge.className = 'badge badge-err';
    }
    if (statusEl) statusEl.textContent = (err as Error).message;
  }
}

async function handleApplyCpuOpt(): Promise<void> {
  if (agApplyCpuOptBtn) agApplyCpuOptBtn.disabled = true;
  toast('Applying CPU optimizations…', 'info', 2000);
  try {
    const res = await window.ag.antigravityCpuOptApply?.();
    if (!res?.ok) throw new Error(res?.error ?? 'Failed');
    toast('CPU optimizations applied successfully!', 'ok', 3000);
    await loadAntigravityCpuOptStatus();
  } catch (e) {
    toast(`CPU optimization error: ${(e as Error).message}`, 'err', 4000);
  } finally {
    if (agApplyCpuOptBtn) agApplyCpuOptBtn.disabled = false;
  }
}

agApplyCpuOptBtn?.addEventListener('click', () => void handleApplyCpuOpt());

agRevertCpuOptBtn?.addEventListener('click', async () => {
  if (agRevertCpuOptBtn) agRevertCpuOptBtn.disabled = true;
  toast('Restoring backed up settings…', 'info', 2000);
  try {
    const res = await window.ag.antigravityCpuOptRevert?.();
    if (!res?.ok) throw new Error(res?.error ?? 'Restore failed');
    toast('Settings restored successfully', 'ok', 3000);
    await loadAntigravityCpuOptStatus();
  } catch (e) {
    toast(`Restore error: ${(e as Error).message}`, 'err', 4000);
  } finally {
    if (agRevertCpuOptBtn) agRevertCpuOptBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity Authentication & Eligibility (403 Fix) Controls
// ─────────────────────────────────────────────────────────────────────────────

const agAuthCheckBtn = $('#agAuthCheckBtn') as HTMLButtonElement | null;
const agAuthAgeCheckBtn = $('#agAuthAgeCheckBtn') as HTMLButtonElement | null;
const agAuthPurgeBtn = $('#agAuthPurgeBtn') as HTMLButtonElement | null;
const agAuthFixBtn = $('#agAuthFixBtn') as HTMLButtonElement | null;

async function loadAuthStatus(): Promise<void> {
  const badge = $('#agAuthBadge') as HTMLSpanElement | null;
  const credsEl = $('#agAuthCredentialsValue') as HTMLDivElement | null;
  const statusEl = $('#agAuthStatusValue') as HTMLDivElement | null;

  try {
    const res = await window.ag.run(['auth', 'status', '--json']);
    if (!res?.stdout) {
      if (badge) { badge.textContent = 'Unknown'; badge.className = 'badge'; }
      if (statusEl) statusEl.textContent = res?.stderr || 'Unknown status';
      return;
    }

    const data = JSON.parse(res.stdout) as {
      credentialsFound?: string[];
      hasEligibilityError?: boolean;
      lastErrorLine?: string;
    };

    const hasCreds = Array.isArray(data.credentialsFound) && data.credentialsFound.length > 0;
    const hasError = Boolean(data.hasEligibilityError);

    if (badge) {
      if (hasError) {
        badge.textContent = '403 / Ineligible';
        badge.className = 'badge badge-err';
      } else if (hasCreds) {
        badge.textContent = 'Connected (Keychain OK)';
        badge.className = 'badge badge-ok';
      } else {
        badge.textContent = 'No tokens';
        badge.className = 'badge';
      }
    }

    if (credsEl) {
      if (hasCreds) {
        credsEl.textContent = data.credentialsFound!.join(', ');
      } else {
        credsEl.textContent = 'No Antigravity credentials stored in OS keychain';
      }
    }

    if (statusEl) {
      if (hasError) {
        statusEl.innerHTML = `<span style="color:#f87171;">⚠️ 403 / Eligibility error detected: ${escapeHtml(data.lastErrorLine || 'Validation required')}</span>`;
      } else {
        statusEl.innerHTML = `<span style="color:#34d399;">✓ No 403 block detected in recent logs</span>`;
      }
    }
  } catch (err) {
    if (badge) { badge.textContent = 'Error'; badge.className = 'badge badge-err'; }
    if (statusEl) statusEl.textContent = (err as Error).message;
  }
}

agAuthCheckBtn?.addEventListener('click', async () => {
  toast('Refreshing auth status…', 'info', 1500);
  await loadAuthStatus();
  toast('Authentication status refreshed', 'ok', 2000);
});

agAuthAgeCheckBtn?.addEventListener('click', async () => {
  const url = 'https://myaccount.google.com/age-verification';
  if (window.ag?.openExternal) {
    await window.ag.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
  toast('Google age verification page opened in browser', 'ok', 3000);
});

agAuthPurgeBtn?.addEventListener('click', async () => {
  const isRunning = agRunningValue?.textContent === 'Running';
  const warningText = isRunning
    ? '⚠️ Antigravity is currently running. Purging credentials while the IDE is active may cause disconnection. It is recommended to close Antigravity first.\n\nContinue with purge?'
    : 'Remove Antigravity credentials from the Windows / OS keychain?\n(Custom models and proxy settings will not be affected).';

  const confirmed = await modals.confirm(
    'Clear OS Keychain',
    warningText,
    { confirmLabel: isRunning ? 'Clear Anyway' : 'Clear Keychain', danger: true }
  );
  if (!confirmed) return;

  toast('Purging credentials from keychain…', 'info', 2000);
  try {
    await window.ag.run(['auth', 'purge', '--yes', '--json']);
    toast('OS keychain cleared successfully', 'ok', 3000);
    await loadAuthStatus();
  } catch (e) {
    toast(`Keychain purge failed: ${(e as Error).message}`, 'err', 4000);
  }
});

agAuthFixBtn?.addEventListener('click', async () => {
  const confirmed = await modals.confirm(
    'Run Auth Repair (403 Fix)',
    'This action will:\n1. Terminate running Antigravity and language_server processes\n2. Purge stale tokens from the OS keychain\n3. Open the official Google account age verification page\n\nContinue?',
    { confirmLabel: 'Run Auth Repair' }
  );
  if (!confirmed) return;

  toast('Executing auth repair…', 'info', 3000);
  try {
    await window.ag.run(['auth', 'fix', '--yes', '--json']);
    toast('Auth repair completed! Complete verification in browser if prompted.', 'ok', 5000);
    await loadAuthStatus();
  } catch (e) {
    toast(`Auth repair error: ${(e as Error).message}`, 'err', 4000);
  }
});

// Backward compat alias
const loadInfo = loadAntigravityStatus;

// ─────────────────────────────────────────────────────────────────────────────
