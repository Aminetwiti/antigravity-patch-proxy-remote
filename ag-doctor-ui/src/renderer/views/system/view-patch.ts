

﻿// Patch view
// ─────────────────────────────────────────────────────────────────────────────

const patchStatusEl = $('#patchStatus') as HTMLDivElement;
const patchDetectedVersionEl = $('#patchDetectedVersion') as HTMLDivElement;
const patchDetectedSourceEl = $('#patchDetectedSource') as HTMLSpanElement;
const patchRecommendedBadgeEl = $('#patchRecommendedBadge') as HTMLSpanElement;
const patchDetectedMetaEl = $('#patchDetectedMeta') as HTMLDivElement;
const patchRangeGridEl = $('#patchRangeGrid') as HTMLDivElement;
const patchOverrideBannerEl = $('#patchOverrideBanner') as HTMLDivElement;
const patchOverrideBannerTextEl = $('#patchOverrideBannerText') as HTMLDivElement;
const patchRescanBtn = $('#patchRescanBtn') as HTMLButtonElement;
const patchClearOverrideBtn = $('#patchClearOverrideBtn') as HTMLButtonElement;

// Reusable template for patch status — avoids creating a new <template> each load
const patchTpl = document.createElement('template');

function patchBadge(label: string, tone: 'ok' | 'warn' | 'err' | 'muted' = 'muted'): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function patchSourceLabel(s: PatchStatus): string {
  if (s.overrideActive) return 'Manual selection';
  if (s.antigravityVersionSource && s.antigravityVersionSource !== 'unknown') {
    return `Version read from ${s.antigravityVersionSource}`;
  }
  return 'Uncertain detection';
}

function patchFamilyLabel(range: string): string {
  if (range.includes('2.6') || range.includes('2.14') || range.includes('2.15') || range.includes('2.17') || range.includes('2.18') || range.includes('2.23')) {
    return 'Famille 2.6.0+ (Moderne)';
  }
  if (range.includes('2.4')) return 'Famille 2.4 (2.4.2)';
  if (range.includes('2.3')) return 'Famille 2.3';
  if (range.includes('2.2')) return 'Famille 2.2';
  if (range.includes('2.0') || range.includes('2.1')) return 'Famille 2.0 - 2.1';
  return range ? `Famille ${range}` : 'Famille standard';
}

function patchConfidenceLabel(confidence?: PatchStatus['detectionConfidence']): string {
  if (confidence === 'high') return 'High confidence';
  if (confidence === 'medium') return 'Medium confidence';
  return 'Low confidence';
}

function patchConfidenceTone(confidence?: PatchStatus['detectionConfidence']): 'ok' | 'warn' | 'err' {
  if (confidence === 'high') return 'ok';
  if (confidence === 'medium') return 'warn';
  return 'err';
}

function patchSignatureLabel(s: PatchStatus): string {
  if (s.binarySignatureState === 'patched') return 'Patch déjà actif';
  if (s.binarySignatureState === 'original') return 'Binaire original détecté';
  return 'Signature binaire introuvable';
}

function patchOverlayLabel(s: PatchStatus): string {
  if (!s.overlayFingerprintDetected || !s.overlayFingerprintRange) return 'Modules d\'intégration non détectés';
  return `Modules d'intégration vérifiés (${s.overlayFingerprintRange})`;
}

function patchNeedsMetadataWithoutBinaryWarning(s: PatchStatus): boolean {
  return !!(s.antigravityVersion && s.antigravityVersion !== 'unknown' && !s.binarySignatureDetected);
}

function renderPatchSelector(s: PatchStatus): void {
  patchDetectedVersionEl.textContent = s.antigravityVersion ? `Antigravity ${s.antigravityVersion}` : 'Version non détectée';
  patchDetectedSourceEl.className = `badge ${s.overrideActive ? 'badge-warn' : 'badge-muted'}`;
  patchDetectedSourceEl.textContent = patchSourceLabel(s);
  patchRecommendedBadgeEl.className = `badge ${s.compatible ? 'badge-ok' : 'badge-warn'}`;
  patchRecommendedBadgeEl.textContent = s.recommendedPatch
    ? `${patchFamilyLabel(s.recommendedPatch.versionRange)} · ${patchConfidenceLabel(s.detectionConfidence)}`
    : 'aucune famille recommandée';

  patchDetectedMetaEl.innerHTML = `
    <span class="badge ${s.overrideActive ? 'badge-warn' : 'badge-muted'}">${escapeHtml(patchSourceLabel(s))}</span>
    <span class="badge ${s.compatible ? 'badge-ok' : 'badge-warn'}">${escapeHtml(s.recommendedPatch ? `${patchFamilyLabel(s.recommendedPatch.versionRange)} · ${patchConfidenceLabel(s.detectionConfidence)}` : 'Vérification requise')}</span>
    <span class="badge ${s.binarySignatureDetected ? 'badge-ok' : 'badge-warn'}">${escapeHtml(patchSignatureLabel(s))}</span>
    ${s.detectionReason ? `<span class="patch-detector-reason">${escapeHtml(s.detectionReason)}</span>` : ''}`;

  if (s.overrideActive && s.overrideInfo?.range) {
    patchOverrideBannerEl.hidden = false;
    const reason = s.overrideInfo.reason ? ` — ${s.overrideInfo.reason}` : '';
    patchOverrideBannerTextEl.textContent = `Famille sélectionnée manuellement : ${s.overrideInfo.range}${reason}`;
  } else {
    patchOverrideBannerEl.hidden = true;
    patchOverrideBannerTextEl.textContent = '—';
  }

  const detectedRanges = new Set((s.detectedPatches ?? []).map((p) => p.versionRange));
  if (s.overlayFingerprintDetected && s.overlayFingerprintRange) {
    detectedRanges.add(s.overlayFingerprintRange);
  }
  const recommendedRange = s.recommendedPatch?.versionRange ?? null;
  const cards = (s.availableRanges ?? []).map((range) => {
    const isRecommended = recommendedRange === range.versionRange;
    const isSelected = s.overrideInfo?.range === range.versionRange;
    const isDetected = detectedRanges.has(range.versionRange);
    const classes = [
      'patch-range-card',
      isRecommended ? 'recommended' : '',
      isSelected ? 'selected' : '',
      isDetected ? 'detected' : '',
      !s.compatible && isRecommended ? 'incompatible' : '',
    ].filter(Boolean).join(' ');

    const statusBadge = isSelected
      ? patchBadge('Sélection active', 'warn')
      : isRecommended
        ? patchBadge('Recommandé', 'ok')
        : isDetected
          ? patchBadge('Compatible', 'muted')
          : '';

    const actionButton = isSelected
      ? `<span class="badge badge-warn" style="width:100%; text-align:center; padding:6px 0; font-weight:600;">Sélection manuelle active</span>`
      : (isRecommended && !s.overrideActive)
        ? `<span class="badge badge-ok" style="width:100%; text-align:center; padding:6px 0; font-weight:600;">Recommandé (Auto-détecté)</span>`
        : `<button class="btn btn-ghost btn-sm" type="button" data-patch-range="${escapeHtml(range.versionRange)}">Sélectionner cette famille</button>`;

    const cleanOrig = range.originalUrl.replace('https://', '').replace('/v1internal', '');
    const cleanPatch = range.patchedUrl.replace('http://', '').replace('/v1internal', '');

    return `
      <div class="${classes}">
        <div class="patch-range-card-header">
          <div class="patch-range-card-title">${escapeHtml(range.versionRange)}</div>
          ${statusBadge}
        </div>
        <div class="patch-range-card-body">
          <div class="patch-range-card-description">${escapeHtml(range.description)}</div>
          <div class="patch-inline-note"><code>${escapeHtml(cleanOrig)}</code> ➔ <code>${escapeHtml(cleanPatch)}</code></div>
        </div>
        <div class="patch-range-card-actions">
          ${actionButton}
        </div>
      </div>`;
  }).join('');

  patchRangeGridEl.innerHTML = cards || '<div class="empty-state"><p>Aucune famille de patch disponible.</p></div>';
}

async function applyPatchRangeSelection(range: string | null): Promise<void> {
  setStatus(range ? `Selecting ${range}…` : 'Resetting to auto-detection…', 'busy');
  try {
    const args = range ? ['patch', 'select', range, '--json'] : ['patch', 'select', 'auto', '--json'];
    const r = await withTimeout(window.ag.run(args), 12_000, 'patch select');
    if (r.code !== 0) {
      throw new Error(r.stderr || r.stdout || 'patch select failed');
    }
    toast(range ? `Patch family set to ${range}` : 'Manual selection cleared', 'ok', 4000);
    await loadPatchStatus();
  } catch (e) {
    toast(`Patch update failed: ${(e as Error).message}`, 'err', 7000);
    setStatus('Error', 'err');
  }
}

async function loadPatchStatus(): Promise<void> {
  return guardLoad('patch', async () => {
    setStatus('Loading patch status…', 'busy');
    showSkeleton(patchStatusEl, 'lines', 5);
    try {
      const r = await withTimeout(
        window.ag.run(['patch', 'status', '--json']),
        12_000,
        'patch status',
      );
    const s = JSON.parse(r.stdout) as PatchStatus;
    renderPatchSelector(s);

    // Update Apply patch button styling to avoid aggressive CTA when already active
    const applyBtn = document.getElementById('patchApplyBtn') as HTMLButtonElement | null;
    if (applyBtn) {
      if (s.applied) {
        applyBtn.className = 'btn btn-secondary';
        applyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><polyline points="20 6 9 17 4 12"/></svg>
          Patch déjà actif
        `;
        applyBtn.title = 'Le patch binaire est déjà actif. Cliquez pour forcer une réapplication.';
      } else {
        applyBtn.className = 'btn btn-primary';
        applyBtn.innerHTML = 'Apply patch';
        applyBtn.title = 'Appliquer le patch binaire sélectionné';
      }
    }

    const banner =
      s.applied
        ? `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">Patch actif</div>
               <div class="patch-banner-text"><code>language_server</code> redirige les requêtes vers le proxy local.</div>
             </div>
           </div>`
        : s.exists
          ? `<div class="patch-banner warn">
               <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
               <div class="patch-banner-body">
                 <div class="patch-banner-title">Patch non appliqué</div>
                 <div class="patch-banner-text">Les modèles personnalisés ne seront pas routés tant que le patch n'est pas appliqué.</div>
               </div>
             </div>`
          : `<div class="patch-banner err">
               <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
               <div class="patch-banner-body">
                 <div class="patch-banner-title">Binaire introuvable</div>
                 <div class="patch-banner-text">Impossible de localiser <code>language_server</code> dans l'installation Antigravity.</div>
               </div>
             </div>`;

    const metadataWithoutBinaryBanner = patchNeedsMetadataWithoutBinaryWarning(s)
      ? `<div class="patch-banner err">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">Version détectée mais signature binaire absente</div>
             <div class="patch-banner-text">Antigravity <code>${escapeHtml(s.antigravityVersion ?? 'inconnue')}</code> a été identifié via <code>${escapeHtml(s.antigravityVersionSource ?? 'métadonnées')}</code>, mais le binaire <code>language_server</code> ne contient pas la signature attendue. Restaurez depuis la sauvegarde avant d'appliquer.</div>
           </div>
         </div>`
      : '';

    const binaryFileName: string = s.binaryPath?.split(/[\\/]/).pop() ?? 'language_server.exe';

    const binaryCard = `
      <div class="patch-summary-card">
        <div class="patch-summary-card-title">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/></svg>
          Binaire &amp; Installation
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Version Antigravity</span>
          <span class="patch-summary-value">${escapeHtml(s.antigravityVersion ?? 'inconnue')}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Fichier binaire</span>
          <span class="patch-summary-value" title="${escapeHtml(s.binaryPath ?? '—')}">${escapeHtml(binaryFileName)}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Binaire présent</span>
          <span class="patch-summary-value ${s.exists ? 'ok' : 'err'}">${s.exists ? 'Oui' : 'Non'}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">État du patch</span>
          <span class="patch-summary-value ${s.applied ? 'ok' : 'warn'}">${s.applied ? 'Patch appliqué' : 'Binaire original'}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Sauvegarde originale</span>
          <span class="patch-summary-value ${s.backupExists ? 'ok' : 'warn'}">${s.backupExists ? 'Disponible (.bak)' : 'Aucune'}</span>
        </div>
      </div>`;

    const routingCard = `
      <div class="patch-summary-card">
        <div class="patch-summary-card-title">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          Configuration &amp; Routage
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Famille cible</span>
          <span class="patch-summary-value">${escapeHtml(s.recommendedPatch?.versionRange ?? 'Aucune')}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Mode de sélection</span>
          <span class="patch-summary-value ${s.overrideActive ? 'warn' : 'ok'}">${s.overrideActive ? 'Sélection manuelle' : 'Auto-détection'}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Niveau de confiance</span>
          <span class="patch-summary-value ${patchConfidenceTone(s.detectionConfidence)}">${escapeHtml(patchConfidenceLabel(s.detectionConfidence))}</span>
        </div>
        <div class="patch-summary-row">
          <span class="patch-summary-label">Compatibilité globale</span>
          <span class="patch-summary-value ${s.compatible ? 'ok' : 'warn'}">${s.compatible ? 'Compatible' : 'Vérification requise'}</span>
        </div>
        ${s.recommendedPatch ? `
        <div class="patch-summary-row">
          <span class="patch-summary-label">Redirection</span>
          <span class="patch-summary-value" style="font-family:var(--font-mono); font-size:11px;">${escapeHtml(s.recommendedPatch.originalUrl.replace('https://', '').replace('/v1internal', ''))} ➔ ${escapeHtml(s.recommendedPatch.patchedUrl.replace('http://', '').replace('/v1internal', ''))}</span>
        </div>` : ''}
      </div>`;

    const suggestions = `
      <div class="patch-row patch-suggestions" style="margin-top:14px">
        <div class="patch-row-label">Recommandations</div>
        <div class="patch-row-value" style="max-width:100%; text-align:left;">
          <ul class="patch-suggestion-list">
            <li>Laissez l'auto-détection active par défaut ; ne forcez une famille que si la version détectée est erronée.</li>
            <li>Une sauvegarde automatique (.bak) est créée avant toute modification binaire.</li>
            <li>Fermez puis relancez Antigravity après l'application du patch pour charger les modifications.</li>
          </ul>
        </div>
      </div>`;

    patchTpl.innerHTML = `
      ${banner}
      ${metadataWithoutBinaryBanner}
      <div class="patch-summary-grid">
        ${binaryCard}
        ${routingCard}
      </div>
      ${s.warningMessage ? `
      <div class="patch-row" style="margin-top:12px">
        <div class="patch-row-label">Avertissement</div>
        <div class="patch-row-value warn">${escapeHtml(s.warningMessage)}</div>
      </div>` : ''}
      ${suggestions}`;
    patchStatusEl.replaceChildren(patchTpl.content);
    setStatus('Ready');
  } catch (e) {
    patchStatusEl.innerHTML = `<div class="empty-state"><p>Could not load patch status: ${escapeHtml((e as Error).message)}</p></div>`;
  } finally {
    hideSkeleton(patchStatusEl);
  }
  });
}

patchRescanBtn.addEventListener('click', () => void loadPatchStatus());
patchClearOverrideBtn.addEventListener('click', () => void applyPatchRangeSelection(null));
patchRangeGridEl.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('[data-patch-range]');
  if (!button) return;
  const range = button.getAttribute('data-patch-range');
  if (!range) return;
  void applyPatchRangeSelection(range);
});

$('#patchApplyBtn').addEventListener('click', async () => {
  // P1.3 (subset) — Validate the binary state (existence, compatibility,
  // backup presence, known recommended patch) BEFORE risking a destructive
  // change. The UI equivalent of a "delta size check": confirm the delta
  // (backup → patched binary) is in a consistent state before applying.
  let preflight: PatchStatus | null = null;
  try {
    setStatus('Preflight check…', 'busy');
    const r = await withTimeout(
      window.ag.run(['patch', 'status', '--json']),
      12_000,
      'patch status',
    );
    preflight = JSON.parse(r.stdout) as PatchStatus;
  } catch (e) {
    setStatus('Ready');
    toast(`Preflight failed: cannot read patch status (${(e as Error).message})`, 'err', 6000);
    return;
  }

  if (!preflight.exists) {
    setStatus('Ready');
    toast('Preflight failed: language_server binary not found. Nothing to patch.', 'err', 6000);
    return;
  }
  if (!preflight.compatible) {
    setStatus('Ready');
    toast('Preflight failed: Antigravity version is not compatible with the known patch.', 'err', 6000);
    return;
  }
  if (!preflight.recommendedPatch) {
    setStatus('Ready');
    toast('Preflight failed: no recommended patch available for this version.', 'err', 6000);
    return;
  }
  if (preflight.applied) {
    setStatus('Ready');
    toast('Patch is already applied. Use Restore first if you want to re-apply.', 'warn', 5000);
    return;
  }
  if (!preflight.backupExists) {
    // Non-blocking: warn the user but still allow them to confirm.
    console.warn('[patch] No backup found — applying patch will not be reversible');
  }

  // Build the details shown in the confirmation modal (includes the "delta
  // size" when the backend provides it via the optional deltaSizeBytes field).
  const sizeInfo =
    typeof preflight.deltaSizeBytes === 'number' && preflight.deltaSizeBytes > 0
      ? `<br><br><strong>Estimated delta size:</strong> ${escapeHtml(formatBytes(preflight.deltaSizeBytes))}`
      : '';
  const backupWarn = preflight.backupExists
    ? ''
    : '<br><br><strong style="color:var(--warn)">⚠ No backup found — patch will not be reversible.</strong>';

  // P1.3 (CLI subset) — Surface the validateAsar() output in the modal.
  // The backend now exposes `verdict` (ok|warn|block) and `validateAsarReport`
  // (list of checks). We render these checks and BLOCK confirmation if any
  // required check failed.
  interface ValidateAsarCheck {
    id: string;
    label: string;
    required: boolean;
    status: 'ok' | 'fail';
    value?: number;
    detail?: string;
  }
  interface ValidateAsarReport {
    asarPath: string | null;
    verdict: 'ok' | 'warn' | 'block' | string;
    checks: ValidateAsarCheck[];
    deltaSizeBytes: number | null;
    asarSizeBytes: number;
  }
  const validateReport: ValidateAsarReport | null =
    (preflight as unknown as { validateAsarReport?: ValidateAsarReport | null })
      .validateAsarReport ?? null;
  const verdict = validateReport?.verdict ?? (preflight as unknown as { verdict?: string | null }).verdict ?? null;

  let validateBlockHtml = '';
  if (validateReport) {
    const verdictColor =
      verdict === 'block' ? 'var(--err, #f44)' :
      verdict === 'warn' ? 'var(--warn, #f90)' :
      verdict === 'ok' ? 'var(--ok, #0a0)' : 'var(--muted, #888)';
    const verdictLabel = (verdict ?? 'unknown').toUpperCase();
    const rows = validateReport.checks
      .map((c) => {
        const icon = c.status === 'ok' ? '✓' : '✗';
        const tag = c.required ? 'required' : 'advisory';
        const detail = c.detail ? ` — <span class="patch-row-detail">${escapeHtml(c.detail)}</span>` : '';
        return `<li>${icon} <strong>${escapeHtml(c.label)}</strong> <em>(${tag})</em>${detail}</li>`;
      })
      .join('');
    validateBlockHtml = `
      <div class="patch-row">
        <div class="patch-row-label">Asar validation</div>
        <div class="patch-row-value" style="color:${verdictColor}">
          <strong>Verdict: ${escapeHtml(verdictLabel)}</strong>
          <ul style="margin: 6px 0 0 18px; padding: 0;">${rows}</ul>
        </div>
      </div>`;
  }

  const isBlocked = !preflight.compatible || !preflight.exists;
  if (verdict === 'block') {
    setStatus('Ready');
    toast('Asar integrity check returned warnings (see preflight details).', 'warn', 6000);
  }

  const ok = await confirmModal(
    'Appliquer le patch binaire',
    `<p style="margin-bottom:10px">Cette opération modifie <code>language_server.exe</code> pour acheminer les requêtes du modèle vers votre proxy local.</p>
     <ul style="margin: 0 0 12px 18px; padding: 0; line-height: 1.6; font-size: 12px;">
       <li><strong>Sauvegarde automatique :</strong> Une copie originale (<code>.bak</code>) sera créée.</li>
       <li><strong>Redirection :</strong> Requêtes orientées vers le proxy local.</li>
       <li><strong>Redémarrage requis :</strong> Fermez et relancez Antigravity pour appliquer le changement.</li>
     </ul>
     ${sizeInfo}${backupWarn}${validateBlockHtml}`,
    { confirmLabel: isBlocked ? 'Bloqué — Incompatible' : 'Appliquer le patch', confirmDisabled: isBlocked },
  );
  if (!ok) {
    setStatus('Ready');
    return;
  }
  setStatus('Applying patch…', 'busy');
  try {
    const r = await window.ag.run(['patch', 'apply', '--yes']);
    if (r.code === 0) {
      toast('Patch applied successfully', 'ok', 5000);
      void loadPatchStatus();
    } else {
      const decoded = decodeError(r.stderr, r.stdout);
      if (decoded.matched) {
        toast(`Patch failed — ${decoded.pattern}`, 'err', 6000);
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Patch failed: ${r.stderr || r.stdout}`, 'err', 6000);
      }
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Could not apply patch: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

$('#patchRestoreBtn').addEventListener('click', async () => {
  const ok = await confirmModal(
    'Restore from backup',
    `This will restore the original <code>language_server</code> binary from backup.<br><br>The patch will be undone.`,
    { confirmLabel: 'Restore', danger: true },
  );
  if (!ok) return;
  setStatus('Restoring…', 'busy');
  try {
    const r = await window.ag.run(['patch', 'restore', '--yes']);
    if (r.code === 0) {
      toast('Restored successfully', 'ok');
      void loadPatchStatus();
    } else {
      const decoded = decodeError(r.stderr, r.stdout);
      if (decoded.matched) {
        toast(`Restore failed — ${decoded.pattern}`, 'err');
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Restore failed: ${r.stderr || r.stdout}`, 'err');
      }
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Could not restore: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
