/**
 * view-mitm.ts — MITM Proxy View Controller.
 * Manages certificate authority generation, installation/export, system proxy redirection, and repair.
 */



const mitmTpl = document.createElement('template');

async function loadMitmStatus(): Promise<void> {
  const mitmStatusEl = $('#mitmStatus') as HTMLDivElement;
  return guardLoad('mitm', async () => {
    setStatus('Loading MITM status…', 'busy');
    showSkeleton(mitmStatusEl, 'cards', 3);
    try {
      const r = (await withTimeout(
        (window as any).ag.run(['mitm', 'status', '--json']),
        12_000,
        'mitm status',
      )) as any;
      const s = JSON.parse(r.stdout) as MitmStatus;

      const reqBanner = document.getElementById('mitmRequiredBanner') as HTMLDivElement | null;
      if (reqBanner) {
        const isBypassed = s.interception.bypassed;
        const isFullyFunctional = isBypassed || (s.interception.reachable && s.ca.installed && !s.ca.isExpired);
        reqBanner.style.display = isFullyFunctional ? 'none' : 'flex';
      }

      const proxyOnBtn = document.getElementById('mitmProxyOnBtn') as HTMLButtonElement | null;
      const proxyOffBtn = document.getElementById('mitmProxyOffBtn') as HTMLButtonElement | null;
      if (proxyOnBtn && proxyOffBtn) {
        if (s.proxy.redirected) {
          proxyOnBtn.style.display = 'none';
          proxyOffBtn.style.display = 'inline-flex';
          proxyOffBtn.className = 'btn btn-secondary';
        } else {
          proxyOnBtn.style.display = 'inline-flex';
          proxyOffBtn.style.display = 'none';
          proxyOnBtn.className = 'btn btn-primary';
        }
      }

      const caUninstallBtn = document.getElementById('mitmUninstallBtn') as HTMLButtonElement | null;
      const caInstallBtn = document.getElementById('mitmInstallBtn') as HTMLButtonElement | null;
      if (caUninstallBtn && caInstallBtn) {
        if (s.ca.installed) {
          caUninstallBtn.style.display = 'inline-flex';
          caInstallBtn.textContent = 'Reinstall CA';
          caInstallBtn.className = 'btn btn-ghost';
        } else {
          caUninstallBtn.style.display = 'none';
          caInstallBtn.textContent = 'Install CA certificate';
          caInstallBtn.className = 'btn btn-secondary';
        }
      }

      const caBanner = s.ca.installed && !s.ca.isExpired
        ? `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">CA certificate installed</div>
               <div class="patch-banner-text">Your system trusts the local MITM certificate.</div>
             </div>
           </div>`
        : (s.interception.bypassed
          ? `<div class="patch-banner info">
               <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
               <div class="patch-banner-body">
                 <div class="patch-banner-title">Certificat non requis (Patch binaire actif)</div>
                 <div class="patch-banner-text">Le patch binaire redirige directement le trafic sans nécessiter d'interception TLS locale.</div>
               </div>
             </div>`
          : `<div class="patch-banner warn">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">${s.ca.isExpired ? 'CA certificate expired' : 'CA certificate not installed'}</div>
               <div class="patch-banner-text">${s.ca.isExpired ? 'The certificate has expired. Run Repair all to regenerate it.' : 'Install the CA to avoid TLS errors in intercepted apps.'}</div>
             </div>
           </div>`);

      const proxyBanner = s.proxy.redirected
        ? `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">System proxy active</div>
               <div class="patch-banner-text">Traffic redirected to ${escapeHtml(s.proxy.host ?? 'localhost')}:${s.proxy.port ?? '—'}.</div>
             </div>
           </div>`
        : `<div class="patch-banner warn">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">System proxy inactive</div>
               <div class="patch-banner-text">Click <strong>Enable proxy</strong> above to start redirecting traffic.</div>
             </div>
           </div>`;

      const interceptionBanner = (s.interception.reachable || s.interception.bypassed)
        ? (s.interception.bypassed
          ? `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">Interception bypassed</div>
               <div class="patch-banner-text">The binary patch redirects Language Server directly to the local proxy — TLS MITM is not required.</div>
             </div>
           </div>`
          : `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">Interception reachable</div>
               <div class="patch-banner-text">The proxy is listening and responding to requests.</div>
             </div>
           </div>`)
        : `<div class="patch-banner err">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">Interception unreachable</div>
               <div class="patch-banner-text">The proxy does not appear to be listening. Try Repair all.</div>
             </div>
           </div>`;

      const pathHtml = s.ca.path
        ? `<div class="mono-path-box" title="${escapeHtml(s.ca.path)}">
             <span class="mono-path-text">${escapeHtml(s.ca.path)}</span>
             <button class="btn btn-ghost btn-xs" type="button" data-copy="${escapeHtml(s.ca.path)}" title="Copy certificate path">Copy</button>
           </div>`
        : `<span class="patch-row-value">—</span>`;

      const fpHtml = s.ca.fingerprint
        ? `<div class="mono-path-box" title="${escapeHtml(s.ca.fingerprint)}">
             <span class="mono-fp-text">${escapeHtml(s.ca.fingerprint)}</span>
             <button class="btn btn-ghost btn-xs" type="button" data-copy="${escapeHtml(s.ca.fingerprint)}" title="Copy fingerprint">Copy</button>
           </div>`
        : `<span class="patch-row-value">—</span>`;

      const connectivityLabel = s.interception.bypassed
        ? 'bypassed'
        : (s.interception.reachable ? 'ok' : 'failed');
      const connectivityClass = s.interception.bypassed
        ? 'ok'
        : (s.interception.reachable ? 'ok' : 'err');

      const caBadgeClass = s.ca.installed ? 'ok' : (s.interception.bypassed ? 'badge-muted' : 'warn');
      const caBadgeLabel = s.ca.installed ? 'installed' : (s.interception.bypassed ? 'optionnel' : 'not installed');

      mitmTpl.innerHTML = `
        <div class="mitm-grid">
          <div class="mitm-card">
            <div class="mitm-card-header"><h3>CA certificate</h3><span class="badge ${caBadgeClass}">${caBadgeLabel}</span></div>
            <div class="mitm-card-body">
              <div class="patch-row"><div class="patch-row-label">Generated</div><div class="patch-row-value ${s.ca.generated ? 'ok' : ''}">${s.ca.generated ? 'yes' : 'no'}</div></div>
              <div class="patch-row"><div class="patch-row-label">Expires</div><div class="patch-row-value ${s.ca.isExpired ? 'err' : ''}">${escapeHtml(s.ca.expiresAt ?? '—')}</div></div>
              <div class="patch-row patch-row-stacked"><div class="patch-row-label">Certificate Path</div>${pathHtml}</div>
              <div class="patch-row patch-row-stacked"><div class="patch-row-label">Fingerprint (SHA-256)</div>${fpHtml}</div>
            </div>
            ${caBanner}
          </div>
          <div class="mitm-card">
            <div class="mitm-card-header"><h3>System proxy</h3><span class="badge ${s.proxy.redirected ? 'ok' : 'warn'}">${s.proxy.redirected ? 'redirected' : 'off'}</span></div>
            <div class="mitm-card-body">
              <div class="patch-row"><div class="patch-row-label">Host</div><div class="patch-row-value">${escapeHtml(s.proxy.host ?? '—')}</div></div>
              <div class="patch-row"><div class="patch-row-label">Port</div><div class="patch-row-value">${s.proxy.port ?? '—'}</div></div>
            </div>
            ${proxyBanner}
          </div>
          <div class="mitm-card">
            <div class="mitm-card-header"><h3>Interception status</h3><span class="badge ${s.interception.bypassed ? 'ok' : s.interception.reachable ? 'ok' : 'err'}">${s.interception.bypassed ? 'bypassed' : s.interception.reachable ? 'reachable' : 'unreachable'}</span></div>
            <div class="mitm-card-body">
              <div class="patch-row"><div class="patch-row-label">Listening</div><div class="patch-row-value ${s.interception.listening ? 'ok' : ''}">${s.interception.listening ? 'yes' : 'no'}</div></div>
              <div class="patch-row"><div class="patch-row-label">Connectivity</div><div class="patch-row-value ${connectivityClass}">${connectivityLabel}</div></div>
            </div>
            ${interceptionBanner}
          </div>
        </div>
        ${(!s.interception.bypassed && (!s.ca.installed || !s.proxy.redirected || !s.interception.reachable)) ? `
        <div style="margin-top: 20px; text-align: center;">
          <button id="repair-all-btn" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-7.1 7.1a1 1 0 0 1-1.4 0l-2.8-2.8a1 1 0 0 1 0-1.4l7.1-7.1a6 6 0 0 1 9.36-7.94z"/></svg>
            Repair all (needs admin)
          </button>
        </div>
        ` : ''}`;
      mitmStatusEl.replaceChildren(mitmTpl.content);

      mitmStatusEl.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const val = btn.dataset.copy;
          if (!val) return;
          try {
            await navigator.clipboard.writeText(val);
            toast('Copied to clipboard', 'ok', 2000);
          } catch {
            toast('Failed to copy to clipboard', 'err', 2000);
          }
        });
      });

      const repairBtn = document.getElementById('repair-all-btn');
      if (repairBtn) {
        repairBtn.setAttribute('aria-label', 'Repair all MITM issues (requires administrator)');
        repairBtn.addEventListener('click', async () => {
          repairBtn.setAttribute('disabled', 'true');
          repairBtn.textContent = 'Repairing — approve the UAC prompt…';
          setStatus('Repairing MITM…', 'busy');
          try {
            const res = await (window as any).ag.repairRun();
            if (res.ok) {
              toast('Repair script completed successfully.', 'ok', 3000);
              const startResult = await (window as any).ag.proxyStart();
              if (startResult.ok) {
                toast('Proxy server started automatically.', 'ok', 3000);
              } else {
                toast(`Repair succeeded but proxy server failed to start: ${startResult.message}`, 'warn', 6000);
              }
            } else {
              toast(`Repair failed: ${res.error}`, 'err', 6000);
            }
          } catch (err) {
            toast(`Repair IPC error: ${(err as Error).message}`, 'err', 6000);
          } finally {
            void loadMitmStatus();
          }
        });
      }

      setStatus('Ready');
    } catch (e) {
      mitmStatusEl.innerHTML = `<div class="empty-state"><p>Could not load MITM status: ${escapeHtml((e as Error).message)}</p></div>`;
      setStatus('Error', 'err');
    } finally {
      hideSkeleton(mitmStatusEl);
    }
  });
}

async function mitmAction(args: string[], successMsg: string, refresh = true, preStatus?: string): Promise<void> {
  setStatus(preStatus ?? `${args.slice(1).join(' ')}…`, 'busy');
  try {
    const r = await (window as any).ag.run(args);
    if (r.code === 0) {
      toast(successMsg, 'ok', 5000);
      if (refresh) void loadMitmStatus();
    } else {
      const errorMsg = r.stderr || r.stdout || 'Unknown error';
      const operation = args.slice(1).join(' ');

      if (errorMsg.toLowerCase().includes('uac') || errorMsg.toLowerCase().includes('cancelled')) {
        toast(`${operation} failed: UAC prompt was declined. Click "Yes" when prompted.`, 'err', 8000);
      } else if (errorMsg.toLowerCase().includes('access denied') || r.code === 5) {
        toast(`${operation} failed: access denied. Try running as Administrator.`, 'err', 8000);
      } else if (errorMsg.toLowerCase().includes('not found')) {
        toast(`${operation} failed: required system tool not found. Check your PATH.`, 'err', 8000);
      } else {
        toast(`${operation} failed: ${errorMsg.substring(0, 150)}`, 'err', 8000);
      }

      setStatus('Error', 'err');
    }
  } catch (e) {
    const operation = args.slice(1).join(' ');
    toast(`${operation} error: ${(e as Error).message}`, 'err', 8000);
    setStatus('Error', 'err');
  }
}

async function maybeUacPreStatus(subcommand: string): Promise<string> {
  const info = await (window as any).ag.info();
  const platform: string = info?.platform ?? '';
  if (platform !== 'win32') return `${subcommand}…`;
  return `Waiting for UAC prompt — click "Yes" to allow ${subcommand}…`;
}

function initMitmView(): void {
  registerViewLoader('mitm', loadMitmStatus);

  $('#mitmInstallBtn')?.addEventListener('click', async () => {
    const pre = await maybeUacPreStatus('install CA certificate');
    void mitmAction(['mitm', 'install', '--yes'], 'CA certificate installed', true, pre);
  });

  $('#mitmUninstallBtn')?.addEventListener('click', async () => {
    const pre = await maybeUacPreStatus('uninstall CA certificate');
    void mitmAction(['mitm', 'uninstall', '--yes'], 'CA certificate uninstalled', true, pre);
  });

  $('#mitmProxyOnBtn')?.addEventListener('click', async () => {
    setStatus('Enabling proxy…', 'busy');
    try {
      const startResult = await (window as any).ag.proxyStart();
      if (!startResult.ok) {
        const decodeErr = (window as any).decodeError;
        const decoded = decodeErr ? decodeErr(startResult.message ?? '', '') : { matched: false };
        if (decoded.matched) {
          toast(`Failed to start proxy server — ${decoded.pattern}`, 'err', 8000);
          toast(decoded.hint, 'warn', 8000);
          runErrorAction(decoded.action);
        } else {
          toast(`Failed to start proxy server: ${startResult.message}`, 'err', 8000);
        }
        setStatus('Error', 'err');
        return;
      }

      toast(`Proxy server started (PID: ${startResult.pid})`, 'ok', 3000);
      const pre = await maybeUacPreStatus('enable proxy');
      setStatus(pre, 'busy');

      const r = await (window as any).ag.run(['mitm', 'proxy-on']);
      if (r.code === 0) {
        toast('Proxy enabled and running', 'ok', 5000);
        void loadMitmStatus();
      } else {
        const errorMsg = r.stderr || r.stdout || 'Unknown error';
        toast(`Failed to configure proxy: ${errorMsg}`, 'err', 8000);
        setStatus('Error', 'err');
        await (window as any).ag.proxyStop();
      }
    } catch (e) {
      toast(`Proxy enable error: ${(e as Error).message}`, 'err', 8000);
      setStatus('Error', 'err');
    }
  });

  $('#mitmProxyOffBtn')?.addEventListener('click', async () => {
    setStatus('Disabling proxy…', 'busy');
    try {
      const pre = await maybeUacPreStatus('disable proxy');
      setStatus(pre, 'busy');

      const r = await (window as any).ag.run(['mitm', 'proxy-off']);
      if (r.code === 0) {
        toast('Proxy disabled', 'ok', 3000);
      } else {
        const errorMsg = r.stderr || r.stdout || 'Unknown error';
        toast(`Proxy disable warning: ${errorMsg}`, 'warn', 5000);
      }

      const stopResult = await (window as any).ag.proxyStop();
      if (stopResult.ok) {
        toast('Proxy server stopped', 'ok', 3000);
      } else {
        toast(`Failed to stop proxy server: ${stopResult.message}`, 'warn', 5000);
      }

      void loadMitmStatus();
    } catch (e) {
      toast(`Proxy disable error: ${(e as Error).message}`, 'err', 8000);
      setStatus('Error', 'err');
    }
  });

  $('#mitmExportCaBtn')?.addEventListener('click', () => void mitmAction(['mitm', 'export-ca'], 'CA exported'));
}
