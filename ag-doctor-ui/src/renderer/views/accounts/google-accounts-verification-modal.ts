/**
 * views/google-accounts-verification-modal.ts
 *
 * Responsabilité Unique (SRP) :
 * - Assistant interactif de résolution de challenge Antigravity (VALIDATION_REQUIRED, 403)
 * - Affichage du QR code pour validation mobile native
 * - Révocation, vérification d'âge et purge du trousseau OS
 */

async function showAntigravityVerificationResolutionModal(initialData?: VerificationDetectionData): Promise<void> {
  let detection = initialData;
  if (!detection && window.ag?.verification?.detect) {
    try {
      detection = await window.ag.verification.detect();
    } catch (err: any) {
      detection = { found: false, error: err?.message || String(err) };
    }
  }

  const hasChallenge = Boolean(detection?.found || detection?.hasChallenge || detection?.validationUrl);
  const validationUrl = detection?.validationUrl || '';
  const logPath = detection?.logFile || detection?.activeLogFile || 'ls-main.log';
  const activeLog = (logPath ? logPath.split(/[\\/]/).pop() : 'ls-main.log') || 'ls-main.log';
  const qrDataUrl = detection?.qrCodeDataUrl || detection?.qrDataUrl;
  const qrImageHtml = qrDataUrl
    ? `<div class="agv-qr-wrapper">
        <div class="agv-qr-box">
          <img src="${qrDataUrl}" alt="QR Code de Vérification" />
        </div>
        <div class="agv-qr-caption">
          Scannez avec votre smartphone (Appareil Android / iPhone de confiance)
        </div>
      </div>`
    : '';

  const modalHtml = `
    <div class="agv-card">
      <!-- Header Banner -->
      <div class="agv-header">
        <div class="agv-icon-badge">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M12 8v4"/><path d="M12 16h.01"/>
          </svg>
        </div>
        <h2 class="agv-title">
          Assistant de Résolution · Vérification Antigravity
        </h2>
        <div class="agv-subtitle">
          <span class="agv-status-indicator ${hasChallenge ? 'detected' : 'clean'}"></span>
          <span>${hasChallenge ? 'Défi VALIDATION_REQUIRED (HTTP 403) Détecté dans les logs LS' : 'Scanner de Logs Antigravity & Résolution de Captcha'}</span>
        </div>
      </div>

      <!-- Detection Status Banner -->
      <div class="agv-section-box ${hasChallenge ? 'challenge-detected' : ''}">
        <div class="agv-section-header">
          <span class="agv-section-title ${hasChallenge ? 'amber' : 'muted'}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            ${hasChallenge ? 'DÉFI INTERACTIF EXTRAIT DEPUIS LES LOGS' : 'AUCUN DÉFI ACTIF DANS LES LOGS RÉCENTS'}
          </span>
          <span class="agv-source-file">
            Source : ${escapeHtml(activeLog)}
          </span>
        </div>

        ${hasChallenge ? `
          <div class="agv-url-display" id="agvDetectedUrlDisplay">
            ${escapeHtml(validationUrl)}
          </div>
          <div class="agv-btn-grid">
            <button type="button" class="agv-btn-primary" id="agvOpenBrowserBtn">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Ouvrir dans le Navigateur</span>
            </button>
            <button type="button" class="agv-btn-secondary" id="agvCopyUrlBtn">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span id="agvCopyUrlLabel">Copier le Lien</span>
            </button>
          </div>
          ${qrImageHtml}
        ` : `
          <p style="margin: 0 0 10px 0; font-size: 12px; color: var(--text-1, #e4e4e7); line-height: 1.45;">
            L'IDE Antigravity n'a pas encore enregistré d'erreur <code>VALIDATION_REQUIRED</code> dans ses logs récents. Si l'IDE affiche un blocage, faites une requête de prompt dans l'IDE pour forcer l'événement ou collez l'URL Google manuellement ci-dessous.
          </p>
          <div style="display: flex; gap: 8px; margin-bottom: 6px;">
            <input type="text" class="agv-input" id="agvManualUrlInput" placeholder="https://accounts.google.com/signin/challenge/..." />
            <button type="button" class="agv-btn-secondary" id="agvOpenManualBtn" style="padding: 8px 14px; font-size: 12px; white-space: nowrap;">Ouvrir</button>
          </div>
          <button type="button" class="agv-btn-secondary" id="agvRescanBtn" style="width: 100%; margin-top: 6px; padding: 8px 12px; font-size: 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span id="agvRescanLabel">Scanner à nouveau les logs Antigravity</span>
          </button>
        `}
      </div>

      <!-- Critical Anti-Lockout Warnings (Forum AI Discourse Insights) -->
      <div class="agv-section-box warning-anti-lockout">
        <div class="agv-section-title red" style="margin-bottom: 6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ATTENTION : PIÈGE SMS &amp; ERREUR "USED TOO MANY TIMES"
        </div>
        <div class="agv-warning-text">
          <p>
            <strong style="color: #fca5a5;">1. Piège Numéros Courts US (244444 / 96831) :</strong> Si la page Google vous demande d'envoyer un code par SMS vers ces numéros, <strong>n'insistez pas</strong> avec un opérateur mobile hors USA. Chaque échec compte comme une tentative et verrouille irréversiblement votre numéro avec l'erreur : <em>"The device you used to scan the QR code was used too many times for verification"</em>.
          </p>
          <p>
            <strong style="color: var(--accent-blue-bright, #38bdf8);">2. Méthode Recommandée :</strong> Sur la page Google, cliquez systématiquement sur <strong>"Essayer une autre méthode" (Try another way)</strong> et choisissez <strong>"Notification Google" (Google Prompt sur smartphone)</strong> ou l'application <strong>Google Authenticator</strong>.
          </p>
          <p>
            <strong style="color: #fbbf24;">3. VPN &amp; Proxies :</strong> Désactivez tout VPN actif pendant la validation web afin d'éviter le déclenchement immédiat de protections antibot supplémentaires.
          </p>
        </div>
      </div>

      <!-- Remediation & Reset Actions -->
      <div class="agv-section-box actions-panel">
        <div class="agv-section-title muted" style="margin-bottom: 8px;">
          ACTIONS DE DÉBLOCAGE LOCAL (ONBOARDING &amp; PROCESSUS)
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <button type="button" class="agv-btn-secondary" id="agvAgeVerifyBtn" style="font-size: 11.5px; padding: 9px 12px; border-color: #38bdf8; color: #38bdf8;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span id="agvAgeVerifyLabel">Vérif. Âge Google (Selfie)</span>
          </button>
          <button type="button" class="agv-btn-secondary" id="agvPurgeCredsBtn" style="font-size: 11.5px; padding: 9px 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
            <span id="agvPurgeCredsLabel">Purger Trousseau OS</span>
          </button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button type="button" class="agv-btn-danger" id="agvResetOnboardingBtn">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span id="agvResetOnboardingLabel">Purger Cache Onboarding</span>
          </button>
          <button type="button" class="agv-btn-secondary" id="agvRestartIdeBtn" style="font-size: 11.5px; padding: 9px 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span id="agvRestartIdeLabel">Relancer Antigravity</span>
          </button>
        </div>
        <div id="agvFeedback" class="agv-feedback"></div>
      </div>
    </div>
  `;

  void modals.confirm('Assistant de Résolution Antigravity', modalHtml, {
    confirmLabel: 'Fermer',
    hideCancel: true,
    onMount: (handle: any) => {
      const modalEl = handle.bodyEl.closest('.modal') as HTMLElement | null;
      if (modalEl) {
        modalEl.classList.add('modal-lg');
        modalEl.style.maxWidth = '620px';
        modalEl.style.maxHeight = '88vh';
        modalEl.style.display = 'flex';
        modalEl.style.flexDirection = 'column';
        modalEl.style.margin = 'auto';
      }
      if (handle.bodyEl) {
        handle.bodyEl.style.overflowY = 'auto';
        handle.bodyEl.style.maxHeight = 'calc(88vh - 120px)';
        handle.bodyEl.style.padding = '16px 20px';
      }
      handle.confirmBtn.style.width = '100%';
      handle.confirmBtn.style.padding = '10px 18px';
      handle.confirmBtn.style.fontSize = '13.5px';
      handle.confirmBtn.style.fontWeight = '600';
      handle.confirmBtn.style.borderRadius = '7px';
      handle.confirmBtn.style.background = '#2563eb';

      // Open in browser
      const openBrowserBtn = handle.bodyEl.querySelector('#agvOpenBrowserBtn');
      openBrowserBtn?.addEventListener('click', async () => {
        if (validationUrl) {
          if (window.ag?.verification?.openUrl) {
            await window.ag.verification.openUrl(validationUrl);
          } else if (window.ag?.openExternal) {
            await window.ag.openExternal(validationUrl);
          } else {
            window.open(validationUrl, '_blank');
          }
        }
      });

      // Copy validation URL
      const copyUrlBtn = handle.bodyEl.querySelector('#agvCopyUrlBtn');
      const copyUrlLabel = handle.bodyEl.querySelector('#agvCopyUrlLabel');
      copyUrlBtn?.addEventListener('click', async () => {
        if (validationUrl) {
          try {
            await navigator.clipboard.writeText(validationUrl);
            if (copyUrlLabel) copyUrlLabel.textContent = '✓ Copié !';
            toast('URL de validation copiée dans le presse-papier !', 'ok');
            setTimeout(() => {
              if (copyUrlLabel) copyUrlLabel.textContent = 'Copier le Lien';
            }, 2000);
          } catch {
            toast('Impossible de copier le lien', 'err');
          }
        }
      });

      // Open manual URL
      const openManualBtn = handle.bodyEl.querySelector('#agvOpenManualBtn');
      const manualInput = handle.bodyEl.querySelector('#agvManualUrlInput') as HTMLInputElement | null;
      openManualBtn?.addEventListener('click', async () => {
        const val = manualInput?.value.trim();
        if (!val) {
          toast('Veuillez entrer une URL valide', 'warn');
          return;
        }
        if (window.ag?.verification?.openUrl) {
          await window.ag.verification.openUrl(val);
        } else if (window.ag?.openExternal) {
          await window.ag.openExternal(val);
        } else {
          window.open(val, '_blank');
        }
      });

      // Re-scan logs with inline loading state
      const rescanBtn = handle.bodyEl.querySelector('#agvRescanBtn') as HTMLButtonElement | null;
      const rescanLabel = handle.bodyEl.querySelector('#agvRescanLabel');
      rescanBtn?.addEventListener('click', async () => {
        if (rescanBtn) rescanBtn.disabled = true;
        if (rescanLabel) rescanLabel.textContent = 'Analyse des logs en cours...';
        toast('Re-scan des logs en cours...', 'info');
        try {
          if (window.ag?.verification?.detect) {
            const fresh = await window.ag.verification.detect();
            if (fresh.found && fresh.validationUrl) {
              toast('Nouveau défi détecté !', 'ok');
              void showAntigravityVerificationResolutionModal(fresh);
            } else {
              toast('Aucun défi actif trouvé dans les logs récents', 'warn');
            }
          }
        } finally {
          if (rescanBtn) rescanBtn.disabled = false;
          if (rescanLabel) rescanLabel.textContent = 'Scanner à nouveau les logs Antigravity';
        }
      });

      // Reset Onboarding
      const resetBtn = handle.bodyEl.querySelector('#agvResetOnboardingBtn') as HTMLButtonElement | null;
      const resetLabel = handle.bodyEl.querySelector('#agvResetOnboardingLabel');
      const feedbackEl = handle.bodyEl.querySelector('#agvFeedback') as HTMLElement | null;
      resetBtn?.addEventListener('click', async () => {
        if (resetBtn) resetBtn.disabled = true;
        if (resetLabel) resetLabel.textContent = 'Purge en cours...';
        try {
          if (window.ag?.verification?.resetOnboarding) {
            const res = await window.ag.verification.resetOnboarding();
            if (res.success) {
              if (feedbackEl) {
                feedbackEl.style.display = 'block';
                feedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
                feedbackEl.style.border = '1px solid rgba(16, 185, 129, 0.35)';
                feedbackEl.style.color = '#34d399';
                feedbackEl.innerHTML = `✅ ${escapeHtml(res.message || 'Cache réinitialisé et session remise à zéro.')}`;
              }
              toast('Onboarding Antigravity purgé avec succès !', 'ok');
            } else {
              throw new Error(res.error || 'Échec de la purge');
            }
          }
        } catch (e: any) {
          if (feedbackEl) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = 'rgba(239, 68, 68, 0.15)';
            feedbackEl.style.border = '1px solid rgba(239, 68, 68, 0.35)';
            feedbackEl.style.color = '#fca5a5';
            feedbackEl.innerHTML = `⚠️ Erreur : ${escapeHtml(e?.message || String(e))}`;
          }
          toast(`Erreur purge : ${e?.message}`, 'err');
        } finally {
          if (resetBtn) resetBtn.disabled = false;
          if (resetLabel) resetLabel.textContent = 'Purger Cache Onboarding';
        }
      });

      // Restart Antigravity
      const restartBtn = handle.bodyEl.querySelector('#agvRestartIdeBtn') as HTMLButtonElement | null;
      const restartLabel = handle.bodyEl.querySelector('#agvRestartIdeLabel');
      restartBtn?.addEventListener('click', async () => {
        if (restartBtn) restartBtn.disabled = true;
        if (restartLabel) restartLabel.textContent = 'Relance en cours...';
        try {
          const res = await window.ag.antigravityRestart();
          if (res.ok) {
            toast('Antigravity relancé avec succès !', 'ok');
          } else {
            throw new Error(res.error || 'Échec du redémarrage');
          }
        } catch (e: any) {
          toast(`Erreur redémarrage : ${e?.message}`, 'err');
        } finally {
          if (restartBtn) restartBtn.disabled = false;
          if (restartLabel) restartLabel.textContent = 'Relancer Antigravity';
        }
      });

      // Google Age Verification (Selfie)
      const ageVerifyBtn = handle.bodyEl.querySelector('#agvAgeVerifyBtn') as HTMLButtonElement | null;
      ageVerifyBtn?.addEventListener('click', async () => {
        const url = 'https://myaccount.google.com/age-verification';
        if (window.ag?.openExternal) {
          await window.ag.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
        toast('Page de vérification d\'âge Google ouverte dans le navigateur', 'ok', 3000);
      });

      // Purge Credentials from OS
      const purgeCredsBtn = handle.bodyEl.querySelector('#agvPurgeCredsBtn') as HTMLButtonElement | null;
      purgeCredsBtn?.addEventListener('click', async () => {
        toast('Purge des credentials en cours…', 'info', 2000);
        try {
          await window.ag.run(['auth', 'purge', '--yes', '--json']);
          toast('Trousseau OS purgé avec succès !', 'ok', 3000);
          if (feedbackEl) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
            feedbackEl.style.border = '1px solid rgba(16, 185, 129, 0.35)';
            feedbackEl.style.color = '#34d399';
            feedbackEl.innerHTML = `✅ Trousseau OS purgé. Relancez maintenant la connexion dans Antigravity.`;
          }
        } catch (e: any) {
          toast(`Erreur purge trousseau : ${e?.message}`, 'err');
        }
      });
    }
  });
}

if (typeof window !== 'undefined') {
  (window as any).showAntigravityVerificationResolutionModal = showAntigravityVerificationResolutionModal;
}

export { showAntigravityVerificationResolutionModal };
