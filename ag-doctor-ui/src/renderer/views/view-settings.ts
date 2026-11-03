


﻿// Settings view
// ─────────────────────────────────────────────────────────────────────────────

const themeToggle = $('#themeToggle') as HTMLButtonElement;
const settingsConfigPath = $('#settingsConfigPath') as HTMLDivElement;
const settingsConfigBody = $('#settingsConfigBody') as HTMLPreElement;

const settingsConfigSkeleton = $('#settingsConfigSkeleton') as HTMLDivElement;

async function loadSettings(): Promise<void> {
  setStatus('Loading settings…', 'busy');
  settingsConfigSkeleton.style.display = 'block';
  settingsConfigBody.style.display = 'none';
  try {
    // Parallelize the three independent IPC calls.
    // Memoize config() with 30s TTL — it changes only when user toggles theme.
    const [cfg, pathResult, listResult] = await Promise.all([
      memo('config', 30_000, () => window.ag.config()),
      window.ag.run(['config', 'path']),
      window.ag.run(['config', 'list', '--json']),
    ]);
    const theme = (cfg.ui as Record<string, string> | undefined)?.theme ?? 'dark';
    themeToggle.textContent = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    const accent = (cfg.ui as Record<string, string> | undefined)?.accent || '#22d3ee';
    applyAccentColor(accent);
    settingsConfigPath.textContent = pathResult.stdout.trim();
    settingsConfigBody.textContent = JSON.stringify(JSON.parse(listResult.stdout), null, 2);
    setStatus('Ready');
    await loadSettingsExtras(cfg);
  } catch (e) {
    setStatus('Error', 'err');
    toast(`Settings error: ${(e as Error).message}`, 'err');
    await loadSettingsExtras();
  } finally {
    settingsConfigSkeleton.style.display = 'none';
    settingsConfigBody.style.display = '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings: notifications toggle + proxy error history panel
// ─────────────────────────────────────────────────────────────────────────────

const notifyToggle = $('#notifyToggle') as HTMLInputElement | null;
const proxyErrorHistoryList = $('#proxyErrorHistoryList') as HTMLUListElement | null;
const proxyErrorHistoryEmpty = $('#proxyErrorHistoryEmpty') as HTMLDivElement | null;

function classifySeverity(p: { status?: number; errorType?: string }): 'err' | 'warn' {
  const s = p.status && p.status >= 500
    || p.errorType === 'auth_401' || p.errorType === 'auth_403'
    || p.errorType === 'quota_429' || p.errorType === 'timeout';
  return s ? 'err' : 'warn';
}

function formatRelativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.max(0, Math.round(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

function renderProxyErrorHistory(history: Array<{
  traceId: string;
  provider: string;
  status?: number;
  errorType: string;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
  at: number;
}>): void {
  if (!proxyErrorHistoryList) return;
  proxyErrorHistoryList.innerHTML = '';
  if (proxyErrorHistoryEmpty) proxyErrorHistoryEmpty.style.display = history.length === 0 ? '' : 'none';
  if (history.length === 0) return;
  // Build with a template — avoids innerHTML for untrusted strings.
  const tpl = document.createElement('template');
  for (const item of history) {
    const sev = classifySeverity(item);
    const li = document.createElement('li');
    li.className = `severity-${sev}`;
    li.dataset.traceId = item.traceId;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${item.provider} — ${item.title}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = item.message || item.rawError || '(no message)';
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = `${formatRelativeTime(item.at)}${item.status ? ` · HTTP ${item.status}` : ''}${item.errorType ? ` · ${item.errorType}` : ''}`;
    meta.append(title, subtitle, when);
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm replay';
    btn.type = 'button';
    btn.textContent = 'Show';
    btn.dataset.label = 'replay-proxy-error';
    btn.setAttribute('aria-label', `Replay ${item.provider} ${item.title}`);
    btn.addEventListener('click', () => {
      // Re-fire the historical payload over the same channel the live
      // bridge consumes, so the modal renders without touching the proxy.
      window.dispatchEvent(new CustomEvent('ag:replay-proxy-error', { detail: item }));
      toast(`Replaying ${item.provider} — ${item.title}`, 'info', 1800);
    });
    li.append(meta, btn);
    tpl.content.appendChild(li);
  }
  proxyErrorHistoryList.appendChild(tpl.content);
}

async function loadProxyErrorHistory(): Promise<void> {
  try {
    const history = await window.ag.getProxyErrorHistory();
    renderProxyErrorHistory(history);
  } catch {
    // Best-effort — leave the previous render in place.
  }
}

function applyAccentColor(hex: string): void {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-blue', hex);
  document.documentElement.style.setProperty('--accent-blue-bright', hex);
  const chips = document.querySelectorAll<HTMLButtonElement>('.accent-chip');
  chips.forEach((c) => {
    const isSelected = c.dataset.color?.toLowerCase() === hex.toLowerCase();
    c.style.transform = isSelected ? 'scale(1.2)' : 'scale(1)';
    c.style.borderColor = isSelected ? 'var(--text-0, #ffffff)' : 'transparent';
    c.style.boxShadow = isSelected ? `0 0 8px ${hex}` : 'none';
  });
}

async function loadSettingsExtras(existingCfg?: any): Promise<void> {
  if (notifyToggle) {
    try {
      const cfg = await window.ag.config();
      const ui = (cfg.ui as Record<string, unknown> | undefined) ?? {};
      notifyToggle.checked = ui.notifyEnabled === false;
    } catch {
      notifyToggle.checked = false;
    }
    if (!notifyToggle.dataset.bound) {
      notifyToggle.dataset.bound = 'true';
      notifyToggle.addEventListener('change', async () => {
        const doNotNotify = notifyToggle.checked;
        const notifyEnabled = !doNotNotify;
        invalidateCache('config');
        const ok = await window.ag.setNotifyEnabled(notifyEnabled);
        if (ok) toast(doNotNotify ? 'Notifications muted' : 'Notifications re-enabled', 'ok', 1800);
        else { toast('Failed to save preference', 'err', 1800); notifyToggle.checked = !doNotNotify; }
      });
    }
  }

  // Chat UI & Suggestions (Antigravity Patch)
  const retryBtnToggle = $('#retryBtnToggle') as HTMLInputElement | null;
  const suggestionPillsToggle = $('#suggestionPillsToggle') as HTMLInputElement | null;
  const suggestionsEditorContainer = $('#suggestionsEditorContainer') as HTMLDivElement | null;
  const suggestionsList = $('#suggestionsList') as HTMLDivElement | null;
  const resetSuggestionsBtn = $('#resetSuggestionsBtn') as HTMLButtonElement | null;
  const addSuggestionBtn = $('#addSuggestionBtn') as HTMLButtonElement | null;
  const newSuggestionLabel = $('#newSuggestionLabel') as HTMLInputElement | null;
  const newSuggestionText = $('#newSuggestionText') as HTMLInputElement | null;

  const syncSuggestionsEditorVisibility = (enabled: boolean) => {
    if (!suggestionsEditorContainer) return;
    suggestionsEditorContainer.style.opacity = enabled ? '1' : '0.45';
    suggestionsEditorContainer.style.pointerEvents = enabled ? 'auto' : 'none';
    suggestionsEditorContainer.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  };

  const DEFAULT_SUGGESTION_ITEMS: Array<{ label: string; text: string }> = [
    { label: 'Continue', text: 'Continue' },
    { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
    { label: 'Keep going', text: 'Keep going' },
    { label: 'Exécuter all steps', text: 'Exécuter toutes les étapes prévues' },
    { label: 'Next phase', text: 'Passer à la phase suivante (Next phase)' },
  ];

  let currentChatSuggestions: Array<{ label: string; text: string }> = [...DEFAULT_SUGGESTION_ITEMS];

  const renderSuggestionsList = () => {
    if (!suggestionsList) return;
    suggestionsList.innerHTML = '';
    if (currentChatSuggestions.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px; color:var(--text-muted, rgba(255,255,255,0.5)); padding:4px 0;';
      empty.textContent = 'No suggestions configured. Click "Reset to default" or add one below.';
      suggestionsList.appendChild(empty);
      return;
    }

    currentChatSuggestions.forEach((sug, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 10px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px;';

      const pillBadge = document.createElement('span');
      pillBadge.style.cssText = 'display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; background:rgba(255,255,255,0.1); color:#ffffff; white-space:nowrap;';
      pillBadge.innerHTML = `<span style="opacity:0.6;font-size:9px;">✦</span><span>${escapeHtml(sug.label)}</span>`;

      const textSpan = document.createElement('span');
      textSpan.style.cssText = 'flex:1; font-size:12px; color:var(--text-muted, rgba(255,255,255,0.7)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      textSpan.textContent = sug.text;
      textSpan.title = sug.text;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost btn-sm';
      delBtn.style.cssText = 'padding:2px 6px; font-size:11px; color:#ef4444;';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove this suggestion';
      delBtn.addEventListener('click', async () => {
        currentChatSuggestions.splice(idx, 1);
        renderSuggestionsList();
        invalidateCache('config');
        await window.ag.setChatEnhancements({ suggestions: currentChatSuggestions });
        toast('Suggestion removed', 'info', 1500);
      });

      row.append(pillBadge, textSpan, delBtn);
      suggestionsList.appendChild(row);
    });
  };

  const handleAddSuggestion = async () => {
    const label = (newSuggestionLabel?.value || '').trim();
    const text = (newSuggestionText?.value || '').trim();
    if (!label || !text) {
      toast('Please enter both label and prompt text', 'warn', 2000);
      return;
    }
    currentChatSuggestions.push({ label, text });
    if (newSuggestionLabel) newSuggestionLabel.value = '';
    if (newSuggestionText) newSuggestionText.value = '';
    renderSuggestionsList();
    invalidateCache('config');
    await window.ag.setChatEnhancements({ suggestions: currentChatSuggestions });
    toast(`Added suggestion "${label}"`, 'ok', 1800);
  };

  if (retryBtnToggle || suggestionPillsToggle) {
    try {
      const cfg = await window.ag.config();
      const ui = (cfg.ui as Record<string, unknown> | undefined) ?? {};
      if (retryBtnToggle) retryBtnToggle.checked = ui.retryButton !== false;
      const pillsActive = ui.suggestionPills !== false;
      if (suggestionPillsToggle) suggestionPillsToggle.checked = pillsActive;
      syncSuggestionsEditorVisibility(pillsActive);
      if (Array.isArray(ui.suggestions) && ui.suggestions.length > 0) {
        currentChatSuggestions = (ui.suggestions as Array<{ label: string; text: string }>).map((s) => ({
          label: String(s.label || ''),
          text: String(s.text || ''),
        }));
      } else {
        currentChatSuggestions = [...DEFAULT_SUGGESTION_ITEMS];
      }
      renderSuggestionsList();
    } catch {
      if (retryBtnToggle) retryBtnToggle.checked = true;
      if (suggestionPillsToggle) suggestionPillsToggle.checked = true;
      syncSuggestionsEditorVisibility(true);
      currentChatSuggestions = [...DEFAULT_SUGGESTION_ITEMS];
      renderSuggestionsList();
    }

    if (retryBtnToggle && !retryBtnToggle.dataset.bound) {
      retryBtnToggle.dataset.bound = 'true';
      retryBtnToggle.addEventListener('change', async () => {
        const enabled = retryBtnToggle.checked;
        invalidateCache('config');
        const ok = await window.ag.setChatEnhancements({ retryButton: enabled });
        if (ok) toast(enabled ? 'Inline Retry button enabled' : 'Inline Retry button disabled', 'ok', 1800);
        else { toast('Failed to save preference', 'err', 1800); retryBtnToggle.checked = !enabled; }
      });
    }

    if (suggestionPillsToggle && !suggestionPillsToggle.dataset.bound) {
      suggestionPillsToggle.dataset.bound = 'true';
      suggestionPillsToggle.addEventListener('change', async () => {
        const enabled = suggestionPillsToggle.checked;
        syncSuggestionsEditorVisibility(enabled);
        invalidateCache('config');
        const ok = await window.ag.setChatEnhancements({ suggestionPills: enabled });
        if (ok) toast(enabled ? 'Suggestion pills bar enabled' : 'Suggestion pills bar disabled', 'ok', 1800);
        else { toast('Failed to save preference', 'err', 1800); suggestionPillsToggle.checked = !enabled; }
      });
    }

    if (resetSuggestionsBtn && !resetSuggestionsBtn.dataset.bound) {
      resetSuggestionsBtn.dataset.bound = 'true';
      resetSuggestionsBtn.addEventListener('click', async () => {
        currentChatSuggestions = [...DEFAULT_SUGGESTION_ITEMS];
        renderSuggestionsList();
        invalidateCache('config');
        await window.ag.setChatEnhancements({ suggestions: currentChatSuggestions });
        toast('Reset suggestions to default', 'ok', 1800);
      });
    }

    if (addSuggestionBtn && !addSuggestionBtn.dataset.bound) {
      addSuggestionBtn.dataset.bound = 'true';
      addSuggestionBtn.addEventListener('click', () => {
        void handleAddSuggestion();
      });
    }

    // Keyboard support: Enter key in either input submits the new suggestion
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleAddSuggestion();
      }
    };
    if (newSuggestionLabel && !newSuggestionLabel.dataset.bound) {
      newSuggestionLabel.dataset.bound = 'true';
      newSuggestionLabel.addEventListener('keydown', handleKeydown);
    }
    if (newSuggestionText && !newSuggestionText.dataset.bound) {
      newSuggestionText.dataset.bound = 'true';
      newSuggestionText.addEventListener('keydown', handleKeydown);
    }
  }

  // Copy Config JSON button
  const copyConfigJsonBtn = $('#copyConfigJsonBtn') as HTMLButtonElement | null;
  const copyConfigJsonBtnText = $('#copyConfigJsonBtnText') as HTMLSpanElement | null;
  if (copyConfigJsonBtn && !copyConfigJsonBtn.dataset.bound) {
    copyConfigJsonBtn.dataset.bound = 'true';
    copyConfigJsonBtn.addEventListener('click', async () => {
      const textToCopy = settingsConfigBody?.textContent || '';
      if (!textToCopy || textToCopy === 'Loading config file…') {
        toast('No configuration available to copy', 'warn', 1800);
        return;
      }
      try {
        await navigator.clipboard.writeText(textToCopy);
        if (copyConfigJsonBtnText) copyConfigJsonBtnText.textContent = 'Copied!';
        toast('Configuration copied to clipboard', 'ok', 1800);
        setTimeout(() => {
          if (copyConfigJsonBtnText) copyConfigJsonBtnText.textContent = 'Copy JSON';
        }, 1800);
      } catch {
        toast('Failed to copy to clipboard', 'err', 1800);
      }
    });
  }

  // Auto-Update Settings
  const autoUpdateToggle = $('#autoUpdateToggle') as HTMLInputElement | null;
  const updateChannelSelect = $('#updateChannelSelect') as HTMLSelectElement | null;
  const updateSettingsCheckBtn = $('#updateSettingsCheckBtn') as HTMLButtonElement | null;
  const updateSettingsStatus = $('#updateSettingsStatus') as HTMLDivElement | null;

  if (window.ag?.updater) {
    try {
      const upSettings = await window.ag.updater.getSettings();
      if (autoUpdateToggle) autoUpdateToggle.checked = upSettings.autoCheck !== false;
      if (updateChannelSelect) updateChannelSelect.value = upSettings.channel || 'stable';
      if (updateSettingsStatus) {
        if (upSettings.lastCheckTime) {
          const d = new Date(upSettings.lastCheckTime);
          updateSettingsStatus.textContent = `Dernière vérification : ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
        } else {
          updateSettingsStatus.textContent = 'Aucune vérification récente';
        }
      }
    } catch {
      // ignore
    }

    if (autoUpdateToggle && !autoUpdateToggle.dataset.bound) {
      autoUpdateToggle.dataset.bound = 'true';
      const _upd = window.ag.updater!;
      autoUpdateToggle.addEventListener('change', async () => {
        const val = autoUpdateToggle.checked;
        await _upd.saveSettings({ autoCheck: val });
        toast(val ? 'Mises à jour automatiques activées' : 'Mises à jour automatiques désactivées', 'ok', 1800);
      });
    }

    if (updateChannelSelect && !updateChannelSelect.dataset.bound) {
      updateChannelSelect.dataset.bound = 'true';
      const _upd = window.ag.updater!;
      updateChannelSelect.addEventListener('change', async () => {
        const ch = updateChannelSelect.value as 'stable' | 'beta';
        await _upd.saveSettings({ channel: ch });
        toast(`Canal configuré sur : ${ch === 'beta' ? 'Beta' : 'Stable'}`, 'ok', 1800);
      });
    }

    if (updateSettingsCheckBtn && !updateSettingsCheckBtn.dataset.bound) {
      updateSettingsCheckBtn.dataset.bound = 'true';
      updateSettingsCheckBtn.addEventListener('click', async () => {
        if (typeof triggerUpdateCheck === 'function') {
          updateSettingsCheckBtn.disabled = true;
          updateSettingsCheckBtn.textContent = 'Vérification...';
          try {
            await triggerUpdateCheck(true);
            if (updateSettingsStatus) {
              const d = new Date();
              updateSettingsStatus.textContent = `Dernière vérification : ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
            }
          } finally {
            updateSettingsCheckBtn.disabled = false;
            updateSettingsCheckBtn.textContent = 'Rechercher maintenant';
          }
        }
      });
    }
  }

  // Accent Color Picker
  const accentPicker = $('#accentColorPicker') as HTMLDivElement | null;
  if (accentPicker && !accentPicker.dataset.bound) {
    accentPicker.dataset.bound = 'true';
    accentPicker.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('.accent-chip') as HTMLButtonElement | null;
      if (!target || !target.dataset.color) return;
      const hex = target.dataset.color;
      applyAccentColor(hex);
      invalidateCache('config');
      await window.ag.run(['config', 'set', 'ui.accent', hex]);
      toast('Accent color updated', 'ok', 1500);
    });
  }

  // Database & Storage Maintenance
  const settingsPruneDbBtn = $('#settingsPruneDbBtn') as HTMLButtonElement | null;
  if (settingsPruneDbBtn && !settingsPruneDbBtn.dataset.bound) {
    settingsPruneDbBtn.dataset.bound = 'true';
    settingsPruneDbBtn.addEventListener('click', () => void handlePruneAction());
  }

  const settingsRebuildSidebarBtn = $('#settingsRebuildSidebarBtn') as HTMLButtonElement | null;
  if (settingsRebuildSidebarBtn && !settingsRebuildSidebarBtn.dataset.bound) {
    settingsRebuildSidebarBtn.dataset.bound = 'true';
    settingsRebuildSidebarBtn.addEventListener('click', () => void handleRebuildSidebarAction());
  }

  const settingsPurgeQuotaBtn = $('#settingsPurgeQuotaBtn') as HTMLButtonElement | null;
  if (settingsPurgeQuotaBtn && !settingsPurgeQuotaBtn.dataset.bound) {
    settingsPurgeQuotaBtn.dataset.bound = 'true';
    settingsPurgeQuotaBtn.addEventListener('click', async () => {
      setStatus('Purging quota cache…', 'busy');
      settingsPurgeQuotaBtn.disabled = true;
      try {
        const purgeRes = await window.ag.providers?.purgeQuotaCache?.();
        const recRes = await window.ag.providers?.reconcileCooldowns?.();
        const burstRes = await window.ag.providers?.liftBurstCooldowns?.();
        const total = (purgeRes?.cleared || 0) + (recRes?.cleared || 0) + (burstRes?.cleared || 0);
        toast(`Quota cache purged! ${total} cooldown entries cleared.`, 'ok', 3000);
        setStatus('Ready');
      } catch (err) {
        toast(`Purge failed: ${(err as Error).message}`, 'err');
        setStatus('Error', 'err');
      } finally {
        settingsPurgeQuotaBtn.disabled = false;
      }
    });
  }


  // Developer Features & Cohort Boost Handlers
  const btnDevApplyBoost = $('#btnDevApplyBoost') as HTMLButtonElement | null;
  if (btnDevApplyBoost && !btnDevApplyBoost.dataset.bound) {
    btnDevApplyBoost.dataset.bound = 'true';
    btnDevApplyBoost.addEventListener('click', async () => {
      setStatus('Applying Developer Boost…', 'busy');
      btnDevApplyBoost.disabled = true;
      try {
        const res = await window.ag.run(['dev', 'boost']);
        if (res.code === 0) {
          toast('✨ Developer Boost appliqué ! Cohorte Google et 45 flags verrouillés.', 'ok', 3500);
          const devCohortBadge = $('#devCohortBadge');
          const devImmunityBadge = $('#devImmunityBadge');
          if (devCohortBadge) devCohortBadge.textContent = '🟢 Cohorte : Google';
          if (devImmunityBadge) devImmunityBadge.textContent = '🛡️ Auto-reset Neutralisé';
        } else {
          toast('Erreur Boost: ' + (res.stderr || res.stdout), 'warn', 3500);
        }
        setStatus('Ready');
      } catch (err) {
        toast('Échec du boost: ' + (err as Error).message, 'err');
        setStatus('Error', 'err');
      } finally {
        btnDevApplyBoost.disabled = false;
      }
    });
  }

  const btnDevCheckStatus = $('#btnDevCheckStatus') as HTMLButtonElement | null;
  if (btnDevCheckStatus && !btnDevCheckStatus.dataset.bound) {
    btnDevCheckStatus.dataset.bound = 'true';
    btnDevCheckStatus.addEventListener('click', async () => {
      setStatus('Checking Developer Status…', 'busy');
      btnDevCheckStatus.disabled = true;
      try {
        const res = await window.ag.run(['dev', 'status']);
        if (res.code === 0) {
          const devCohortBadge = $('#devCohortBadge');
          const devImmunityBadge = $('#devImmunityBadge');
          if (devCohortBadge) devCohortBadge.textContent = '🟢 Cohorte : Google';
          if (devImmunityBadge) devImmunityBadge.textContent = '🛡️ Auto-reset Neutralisé';
          toast('Statut vérifié : app.asar immunisé & profil Google actif.', 'ok', 3000);
        } else {
          toast('Statut dev non vérifié: ' + (res.stderr || res.stdout || 'Échec vérification'), 'warn', 3500);
        }
        setStatus('Ready');
      } catch (err) {
        toast('Vérification échouée: ' + (err as Error).message, 'err');
        setStatus('Error', 'err');
      } finally {
        btnDevCheckStatus.disabled = false;
      }
    });
  }

  // Network & Proxy Options
  const mitmPortInput = $('#settingsMitmPortInput') as HTMLInputElement | null;
  const mitmPortSaveBtn = $('#settingsMitmPortSaveBtn') as HTMLButtonElement | null;
  const doctorIntervalSelect = $('#settingsDoctorIntervalSelect') as HTMLSelectElement | null;
  const openTrafficBtn = $('#settingsOpenTrafficBtn') as HTMLButtonElement | null;

  const cfgData = existingCfg || await (async () => {
    try { return await window.ag.config(); } catch { return {}; }
  })();

  if (mitmPortInput) {
    mitmPortInput.value = String(cfgData.mitmPort ?? 51074);
  }
  if (mitmPortSaveBtn && !mitmPortSaveBtn.dataset.bound) {
    mitmPortSaveBtn.dataset.bound = 'true';
    mitmPortSaveBtn.addEventListener('click', async () => {
      const val = parseInt(mitmPortInput?.value || '', 10);
      if (isNaN(val) || val < 1024 || val > 65535) {
        toast('Port must be a valid number between 1024 and 65535', 'warn', 2500);
        return;
      }
      try {
        await window.ag.run(['config', 'set', 'mitmPort', String(val)]);
        invalidateCache('config');
        toast(`MITM port saved: ${val} (restart proxy to apply)`, 'ok', 3000);
      } catch (err) {
        toast(`Failed to save port: ${(err as Error).message}`, 'err');
      }
    });
  }

  if (doctorIntervalSelect) {
    doctorIntervalSelect.value = String(cfgData.doctorInterval ?? 5000);
    if (!doctorIntervalSelect.dataset.bound) {
      doctorIntervalSelect.dataset.bound = 'true';
      doctorIntervalSelect.addEventListener('change', async () => {
        const val = doctorIntervalSelect.value;
        try {
          await window.ag.run(['config', 'set', 'doctorInterval', val]);
          invalidateCache('config');
          toast(`Diagnostic interval set to ${val}ms`, 'ok', 1800);
        } catch (err) {
          toast(`Failed to save interval: ${(err as Error).message}`, 'err');
        }
      });
    }
  }

  if (openTrafficBtn && !openTrafficBtn.dataset.bound) {
    openTrafficBtn.dataset.bound = 'true';
    openTrafficBtn.addEventListener('click', () => {
      navigate('traffic');
    });
  }

  // Reveal Config File in Explorer
  const revealConfigFileBtn = $('#revealConfigFileBtn') as HTMLButtonElement | null;
  if (revealConfigFileBtn && !revealConfigFileBtn.dataset.bound) {
    revealConfigFileBtn.dataset.bound = 'true';
    revealConfigFileBtn.addEventListener('click', async () => {
      const p = settingsConfigPath?.textContent?.trim() || '';
      if (!p || p === '—') {
        toast('No configuration file path detected', 'warn', 1800);
        return;
      }
      try {
        await window.ag.reveal(p);
        toast('Opened config location in Explorer', 'ok', 1800);
      } catch (err) {
        toast(`Could not open file: ${(err as Error).message}`, 'err');
      }
    });
  }

  // Reset All Settings to Defaults
  const resetAllSettingsBtn = $('#resetAllSettingsBtn') as HTMLButtonElement | null;
  if (resetAllSettingsBtn && !resetAllSettingsBtn.dataset.bound) {
    resetAllSettingsBtn.dataset.bound = 'true';
    resetAllSettingsBtn.addEventListener('click', async () => {
      const ok = await confirmModal(
        'Reset Settings',
        'Are you sure you want to reset all persistent configuration settings to defaults? This action cannot be undone.',
        { confirmLabel: 'Reset Defaults', danger: true }
      );
      if (!ok) return;
      setStatus('Resetting configuration...', 'busy');
      try {
        const r = await window.ag.run(['config', 'reset']);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Reset failed');
        invalidateCache('config');
        document.documentElement.dataset.theme = 'dark';
        if (themeToggle) {
          themeToggle.textContent = 'Switch to light theme';
          themeToggle.setAttribute('aria-pressed', 'false');
        }
        updateStatusBarTheme('dark');
        applyAccentColor('#22d3ee');
        toast('Settings reset to defaults', 'ok');
        void loadSettings();
      } catch (err) {
        toast(`Reset failed: ${(err as Error).message}`, 'err');
      } finally {
        setStatus('Ready');
      }
    });
  }

  await loadProxyErrorHistory();
}

themeToggle.addEventListener('click', async () => {
  const current = document.documentElement.dataset.theme ?? 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  await setTheme(next);
});

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  updateStatusBarTheme(theme);
  // Invalidate config cache so the next loadSettings() picks up the new theme
  invalidateCache('config');
  await window.ag.setTheme(theme);
  toast(`Theme set to ${theme}`, 'ok', 2000);
}

async function applySavedTheme(): Promise<void> {
  try {
    // Memoize config() — applied at boot, called once
    const cfg = await memo('config', 30_000, () => window.ag.config());
    const theme = (cfg.ui as Record<string, string> | undefined)?.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    updateStatusBarTheme(theme);
    const accent = (cfg.ui as Record<string, string> | undefined)?.accent;
    if (accent) applyAccentColor(accent);
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
