/**
 * views/google-accounts-verification-modal.ts
 *
 * Responsabilité Unique (SRP) :
 * - Assistant interactif de résolution de challenge Antigravity (VALIDATION_REQUIRED, 403)
 * - Gestion du cycle de vie et des actions interactives du modal
 * - Template HTML délégué à verification-modal-template.ts
 */

declare function renderVerificationModalHtml(
  hasChallenge: boolean,
  activeLog: string,
  validationUrl: string,
  qrImageHtml: string
): string;

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

  const modalHtml = typeof renderVerificationModalHtml === 'function'
    ? renderVerificationModalHtml(hasChallenge, activeLog, validationUrl, qrImageHtml)
    : '';

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
