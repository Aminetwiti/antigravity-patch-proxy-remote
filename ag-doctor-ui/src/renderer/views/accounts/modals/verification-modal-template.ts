/**
 * verification-modal-template.ts — HTML template generator for Antigravity Verification Modal.
 * Extracted from google-accounts-verification-modal.ts for Single Responsibility (SRP).
 */

function renderVerificationModalHtml(
  hasChallenge: boolean,
  activeLog: string,
  validationUrl: string,
  qrImageHtml: string
): string {
  return `
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
}
