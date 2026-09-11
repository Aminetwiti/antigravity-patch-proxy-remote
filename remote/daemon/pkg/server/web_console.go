package server

import (
	"net/http"
)

// WebConsoleHTML contains the self-contained Single-Page Application for observing and controlling the agent.
const WebConsoleHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Remote Agent Cloud Console</title>
  <style>
    :root {
      --bg: #0b0d11;
      --surface-1: #11141a;
      --surface-2: #161b22;
      --surface-3: #1f2430;
      --surface-terminal: #090c10;
      --border: #262c38;
      --border-subtle: #1c212c;
      --border-hover: #3d4659;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --text-dim: #6e7681;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --accent-subtle: rgba(59, 130, 246, 0.12);
      --success: #10b981;
      --success-hover: #059669;
      --success-subtle: rgba(16, 185, 129, 0.12);
      --warning: #f59e0b;
      --warning-subtle: rgba(245, 158, 11, 0.12);
      --danger: #ef4444;
      --danger-hover: #dc2626;
      --danger-subtle: rgba(239, 68, 68, 0.12);
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* Accessibility utilities */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Header */
    header {
      background: var(--surface-1);
      border-bottom: 1px solid var(--border);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-shrink: 0;
    }
    .header-main {
      display: flex;
      align-items: center;
      gap: 20px;
      flex: 1;
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 15px;
      white-space: nowrap;
    }
    .brand-badge {
      background: var(--accent-subtle);
      color: var(--accent);
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .server-status {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 13px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--success-subtle);
      color: var(--success);
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 500;
      font-size: 12px;
      transition: all 0.2s;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

    /* Nav Tabs */
    .nav-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
    }
    .nav-tabs::-webkit-scrollbar { display: none; }
    .tab-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 7px 14px;
      border-radius: var(--radius-md);
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      white-space: nowrap;
      user-select: none;
    }
    .tab-btn:hover {
      color: var(--text);
      border-color: var(--border-hover);
      background: rgba(255, 255, 255, 0.03);
    }
    .tab-btn.active {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--accent);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    .tab-btn svg { flex-shrink: 0; }

    /* Layout */
    .app-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .terminal-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--surface-terminal);
      font-family: var(--font-mono);
      overflow: hidden;
    }
    .terminal-toolbar {
      padding: 10px 16px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .terminal-output {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #58a6ff;
      font-size: 13px;
      line-height: 1.5;
    }
    .terminal-input-bar {
      display: flex;
      align-items: center;
      background: var(--surface-2);
      border-top: 1px solid var(--border);
      padding: 8px 16px;
      gap: 8px;
      flex-shrink: 0;
    }
    .terminal-prompt { color: var(--accent); font-weight: bold; }
    .terminal-input {
      flex: 1;
      background: transparent;
      border: none;
      color: #f0f6fc;
      font-family: var(--font-mono);
      font-size: 13px;
      outline: none;
    }

    /* Buttons */
    .btn {
      background: var(--accent);
      color: white;
      border: 1px solid transparent;
      padding: 7px 14px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 36px;
      transition: background 0.15s, border-color 0.15s, transform 0.05s;
      user-select: none;
    }
    .btn:active { transform: scale(0.98); }
    .btn:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: var(--danger-hover); }
    .btn-success { background: var(--success); }
    .btn-success:hover { background: var(--success-hover); }
    .btn-secondary {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-secondary:hover {
      background: var(--surface-3);
      border-color: var(--border-hover);
    }
    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
      min-height: 30px;
      gap: 5px;
    }

    /* Badges */
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      display: inline-flex;
      align-items: center;
    }
    .badge-running { background: var(--accent-subtle); color: var(--accent); }
    .badge-waiting { background: var(--warning-subtle); color: var(--warning); }
    .badge-ready { background: var(--success-subtle); color: var(--success); }

    /* Headers & Subsections */
    .chat-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .tool-card {
      align-self: flex-start;
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .tool-header {
      background: var(--surface-3);
      padding: 10px 14px;
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--accent);
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .tool-body {
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #cbd5e1;
      background: var(--surface-terminal);
      max-height: 240px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    /* Modals */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
    }
    .modal {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      width: 440px;
      max-width: 100%;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      animation: modalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes modalIn {
      from { opacity: 0; transform: scale(0.96) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .modal h2 { margin-bottom: 6px; font-size: 17px; font-weight: 600; color: var(--text); }
    .modal p { color: var(--text-muted); font-size: 13px; margin-bottom: 18px; line-height: 1.4; }
    
    .form-group {
      margin-bottom: 14px;
    }
    .input-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .input-field {
      width: 100%;
      background: var(--surface-terminal);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text);
      padding: 9px 12px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-subtle);
    }
    .input-field::placeholder {
      color: var(--text-dim);
    }

    .hidden { display: none !important; }

    /* Accounts Grid */
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }
    .account-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .account-card:hover {
      border-color: var(--border-hover);
    }
    .account-card.active-card {
      border-color: var(--accent);
      background: linear-gradient(180deg, rgba(59, 130, 246, 0.05) 0%, var(--surface-2) 100%);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .quota-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 10px;
    }
    .quota-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
    }
    .progress-bar-bg {
      height: 8px;
      background: var(--surface-3);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .fill-high { background: var(--success); }
    .fill-med { background: var(--warning); }
    .fill-low { background: var(--danger); }

    /* Logs View */
    .log-stream {
      background: var(--surface-terminal);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .log-entry {
      display: flex;
      gap: 10px;
      padding: 3px 6px;
      border-radius: var(--radius-sm);
      line-height: 1.45;
    }
    .log-entry:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .log-time { color: var(--text-dim); white-space: nowrap; }
    .log-badge {
      font-size: 10px;
      font-weight: bold;
      padding: 1px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .lvl-INFO { background: var(--accent-subtle); color: #60a5fa; }
    .lvl-WARN { background: var(--warning-subtle); color: #fbbf24; }
    .lvl-ERROR { background: var(--danger-subtle); color: #f87171; }
    .lvl-DEBUG { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
    .log-msg { color: var(--text); flex: 1; word-break: break-all; }
    .log-fields { color: var(--text-dim); font-size: 11px; }

    /* Toasts */
    #toastContainer {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 9999;
      pointer-events: none;
    }
    .toast {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 16px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: auto;
      animation: toastIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      transition: opacity 0.2s, transform 0.2s;
    }
    .toast-success { border-color: var(--success); color: #a7f3d0; background: #064e3b; }
    .toast-error { border-color: var(--danger); color: #fecaca; background: #450a0a; }
    .toast-info { border-color: var(--accent); color: #bfdbfe; background: #172554; }
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Responsive */
    @media (max-width: 768px) {
      header {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
        padding: 12px 14px;
      }
      .header-main {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .brand {
        justify-content: space-between;
      }
      .server-status {
        justify-content: space-between;
        width: 100%;
      }
      .accounts-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <!-- Auth Modal -->
  <div id="authModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
    <div class="modal">
      <h2 id="authModalTitle">Authentification Serveur</h2>
      <p>Saisissez le jeton d'authentification pour accéder aux commandes du daemon distant.</p>
      <div class="form-group">
        <label for="authTokenInput" class="input-label">Jeton d'accès (Bearer Token)</label>
        <input type="password" id="authTokenInput" class="input-field" placeholder="ex: 11 ou votre jeton personnalisé" />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary" onclick="document.getElementById('authModal').classList.add('hidden')">Fermer</button>
        <button class="btn btn-success" onclick="saveAuthToken()">Se connecter</button>
      </div>
    </div>
  </div>

  <!-- Confirm Modal (Non-blocking replacement for window.confirm) -->
  <div id="confirmModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
    <div class="modal" style="width:400px;">
      <h2 id="confirmTitle">Confirmation</h2>
      <p id="confirmMsg"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-secondary" onclick="closeConfirmModal(false)">Annuler</button>
        <button id="confirmOkBtn" class="btn btn-danger" onclick="closeConfirmModal(true)">Confirmer</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Hub -->
  <div id="toastContainer" aria-live="polite"></div>

  <!-- MCP Register Modal -->
  <div id="mcpModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="mcpModalTitle">
    <div class="modal" style="width:480px;">
      <h2 id="mcpModalTitle">Enregistrer un Serveur MCP</h2>
      <p>Configurez un fournisseur d'outils Model Context Protocol via stdio ou processus local.</p>
      <div class="form-group">
        <label for="mcpNameInput" class="input-label">Identifiant / Nom du serveur</label>
        <input type="text" id="mcpNameInput" class="input-field" placeholder="ex: coolify, github, filesystem" />
      </div>
      <div class="form-group">
        <label for="mcpCmdInput" class="input-label">Commande exécutable</label>
        <input type="text" id="mcpCmdInput" class="input-field" placeholder="ex: node, python, npx" />
      </div>
      <div class="form-group">
        <label for="mcpArgsInput" class="input-label">Arguments (séparés par un espace)</label>
        <input type="text" id="mcpArgsInput" class="input-field" placeholder="ex: ./server.js --port 8080" />
      </div>
      <div class="form-group">
        <label for="mcpDescInput" class="input-label">Description (optionnelle)</label>
        <input type="text" id="mcpDescInput" class="input-field" placeholder="Description courte des capacités de l'outil" />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
        <button class="btn btn-secondary" onclick="closeMCPModal()">Annuler</button>
        <button class="btn btn-success" onclick="submitRegisterMCPServer()">Lancer le Serveur</button>
      </div>
    </div>
  </div>

  <!-- Add Account Modal -->
  <div id="accountModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="accModalTitle">
    <div class="modal" style="width:480px;">
      <h2 id="accModalTitle">Ajouter un Compte Google</h2>
      <p>Intégrez un compte Google avec son Refresh Token pour le pool dynamique et la rotation intelligente des quotas.</p>
      <div class="form-group">
        <label for="accEmailInput" class="input-label">Adresse email Google</label>
        <input type="email" id="accEmailInput" class="input-field" placeholder="ex: dev@gmail.com" />
      </div>
      <div class="form-group">
        <label for="accTokenInput" class="input-label">Google OAuth Refresh Token</label>
        <input type="password" id="accTokenInput" class="input-field" placeholder="1//0..." />
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
        <button class="btn btn-secondary" onclick="closeAddAccountModal()">Annuler</button>
        <button class="btn btn-success" onclick="submitAddAccount()">Ajouter au Pool</button>
      </div>
    </div>
  </div>

  <header>
    <div class="header-main">
      <div class="brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span>Antigravity</span>
        <span class="brand-badge">Cloud Runtime</span>
      </div>
      <nav class="nav-tabs" role="tablist" aria-label="Navigation des services">
        <button id="tabAccounts" class="tab-btn active" role="tab" aria-selected="true" aria-controls="accountsPane" onclick="switchTab('accounts')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Comptes</span>
        </button>
        <button id="tabAPIs" class="tab-btn" role="tab" aria-selected="false" aria-controls="apisPane" onclick="switchTab('apis')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
          <span>APIs & Moteurs</span>
        </button>
        <button id="tabLogs" class="tab-btn" role="tab" aria-selected="false" aria-controls="logsPane" onclick="switchTab('logs')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          <span>Logs Live</span>
        </button>
        <button id="tabTerminal" class="tab-btn" role="tab" aria-selected="false" aria-controls="terminalPane" onclick="switchTab('terminal')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          <span>Workspace Terminal</span>
        </button>
        <button id="tabGit" class="tab-btn" role="tab" aria-selected="false" aria-controls="gitPane" onclick="switchTab('git')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
          <span>Git Changes</span>
        </button>
        <button id="tabMCP" class="tab-btn" role="tab" aria-selected="false" aria-controls="mcpPane" onclick="switchTab('mcp')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          <span>Serveurs MCP</span>
        </button>
      </nav>
    </div>
    <div class="server-status">
      <div id="statusPill" class="status-pill" aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        <span id="statusText">Connexion...</span>
      </div>
      <span id="serverInfo" style="font-family:var(--font-mono);font-size:12px;">ag-agentd</span>
      <button class="btn btn-secondary btn-sm" onclick="promptAuthToken()" title="Configurer ou modifier le jeton d'authentification">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path></svg>
        <span>Jeton Auth</span>
      </button>
    </div>
  </header>

  <div class="app-container">

    <!-- Terminal Pane -->
    <div id="terminalPane" class="terminal-container hidden" role="tabpanel" aria-labelledby="tabTerminal">
      <div class="terminal-toolbar">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-weight:600;font-size:13px;color:var(--text);">WORKSPACE SHELL</span>
          <span id="termWsBadge" class="badge" style="background:var(--surface-3);color:var(--text-muted);">Default</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="restartTerminal()">Relancer Shell</button>
          <button class="btn btn-secondary btn-sm" onclick="clearTerminal()">Effacer</button>
        </div>
      </div>
      <div id="terminalOutput" class="terminal-output">Connecting to workspace terminal...\n</div>
      <div class="terminal-input-bar">
        <span class="terminal-prompt" aria-hidden="true">&gt;</span>
        <label for="terminalInput" class="sr-only">Commande shell</label>
        <input type="text" id="terminalInput" class="terminal-input" placeholder="Saisir une commande shell (ex: git status, npm test, ls -la)..." aria-label="Commande shell" onkeydown="handleTerminalKey(event)" />
      </div>
    </div>

    <!-- Git Changes View -->
    <div id="gitPane" class="terminal-container hidden" role="tabpanel" aria-labelledby="tabGit" style="background:var(--bg);">
      <div class="chat-header" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-weight:600;">Workspace Git Changes</span>
          <span id="gitBranchBadge" class="badge" style="background:var(--surface-3);color:var(--accent);">main</span>
          <span id="gitChangesBadge" class="badge" style="background:var(--surface-3);color:var(--text-muted);">0 modifications</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="loadGitDiff()">Rafraîchir Diff</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;padding:12px 20px;background:var(--surface-1);border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap;">
        <label for="gitCommitMsg" class="sr-only">Message de commit</label>
        <input type="text" id="gitCommitMsg" class="input-field" style="margin-bottom:0;flex:1;min-width:240px;" placeholder="Message de commit (ex: feat: add quota pool)..." aria-label="Message de commit" />
        <button class="btn btn-success" onclick="commitGitChanges()">Commit All Changes</button>
      </div>
      <div id="gitFilesList" style="padding:10px 20px;display:flex;flex-wrap:wrap;gap:8px;background:var(--surface-terminal);border-bottom:1px solid var(--border);"></div>
      <pre id="gitDiffOutput" class="terminal-output" style="flex:1;margin:0;font-size:12px;white-space:pre-wrap;"></pre>
    </div>

    <!-- MCP Servers View -->
    <div id="mcpPane" class="terminal-container hidden" role="tabpanel" aria-labelledby="tabMCP" style="background:var(--bg);padding:24px;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h2 style="font-size:18px;margin-bottom:4px;color:var(--text);">Model Context Protocol (MCP) Servers</h2>
          <p style="color:var(--text-muted);font-size:13px;">Fournisseurs d'outils externes dynamiquement intégrés au runtime de l'agent.</p>
        </div>
        <button class="btn btn-success" onclick="openMCPModal()">+ Enregistrer Serveur</button>
      </div>
      <div id="mcpServersGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;"></div>
    </div>

    <!-- Accounts Pool Management View -->
    <div id="accountsPane" class="terminal-container" role="tabpanel" aria-labelledby="tabAccounts" style="background:var(--bg);padding:24px;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:14px;">
        <div>
          <h2 style="font-size:20px;margin-bottom:6px;display:flex;align-items:center;gap:10px;color:var(--text);">
            <span>Pool de Comptes Google</span>
            <span id="accActiveBadge" class="badge badge-ready" style="font-size:12px;padding:3px 8px;">Actif: ...</span>
          </h2>
          <p style="color:var(--text-muted);font-size:13px;">Rotation intelligente et surveillance multi-comptes des quotas Gemini et Claude.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;background:var(--surface-2);padding:7px 12px;border-radius:var(--radius-md);border:1px solid var(--border);min-height:36px;user-select:none;">
            <input type="checkbox" id="autoRotateCheckbox" onchange="toggleAutoRotate(this.checked)" />
            <span>Auto-Rotation</span>
          </label>
          <button class="btn btn-secondary btn-sm" onclick="optimizeQuotas()" title="Sélectionne le compte avec le meilleur quota disponible">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            <span>Optimiser Quotas</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="rotateAccount()" title="Bascule vers le compte suivant">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            <span>Rotation</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="resetExhaustedAccounts()" title="Réinitialise les comptes dont le délai est expiré">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
            <span>Reset Épuisés</span>
          </button>
          <button class="btn btn-success btn-sm" onclick="openAddAccountModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Ajouter Compte</span>
          </button>
        </div>
      </div>
      <div id="accountsGrid" class="accounts-grid"></div>
    </div>

    <!-- API Providers & Model Configuration View -->
    <div id="apisPane" class="terminal-container hidden" role="tabpanel" aria-labelledby="tabAPIs" style="background:var(--bg);padding:24px;overflow-y:auto;">
      <div style="margin-bottom:20px;">
        <h2 style="font-size:20px;margin-bottom:6px;color:var(--text);">Configuration des APIs & Moteurs IA</h2>
        <p style="color:var(--text-muted);font-size:13px;">Basculez à chaud entre les fournisseurs LLM sans redémarrer le daemon.</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;">
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:16px;color:var(--text);">Paramètres du Moteur Actif</h3>
          
          <div class="form-group">
            <label for="apiProviderSelect" class="input-label">Fournisseur IA (Provider)</label>
            <select id="apiProviderSelect" class="input-field" onchange="onProviderSelectChange(this.value)">
              <option value="anthropic">Anthropic Claude (Direct API)</option>
              <option value="openai">OpenAI ChatGPT (Direct API)</option>
              <option value="proxy">Proxy Antigravity Local (Port 51074)</option>
              <option value="ollama">Ollama Local (Self-Hosted)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="apiModelInput" class="input-label">Nom du Modèle</label>
            <input type="text" id="apiModelInput" class="input-field" placeholder="ex: claude-3-7-sonnet-20250219, gpt-4o, gemini-2.5-pro" />
          </div>

          <div class="form-group">
            <label for="apiKeyInput" class="input-label">Clé d'API (laisser vide pour conserver)</label>
            <div style="position:relative;">
              <input type="password" id="apiKeyInput" class="input-field" placeholder="sk-ant-... ou sk-..." />
              <button type="button" onclick="togglePasswordVisibility('apiKeyInput')" style="position:absolute;right:10px;top:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;" aria-label="Afficher ou masquer la clé d'API">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="apiBaseURLInput" class="input-label">Base URL / Endpoint Personnalisé (Optionnel)</label>
            <input type="text" id="apiBaseURLInput" class="input-field" placeholder="ex: https://api.anthropic.com ou http://127.0.0.1:51074/v1" />
          </div>

          <div style="display:flex;gap:10px;margin-top:16px;">
            <button id="testApiBtn" class="btn btn-secondary" onclick="testAPIConfig()">Tester Connexion</button>
            <button class="btn btn-success" style="flex:1;" onclick="saveAPIConfig()">Enregistrer & Appliquer</button>
          </div>
          <div id="testApiResult" style="margin-top:14px;font-size:13px;" class="hidden"></div>
        </div>

        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;">
          <h3 style="font-size:15px;font-weight:600;margin-bottom:8px;color:var(--text);">Variables d'Environnement Détectées</h3>
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">État des clés configurées dans l'environnement du conteneur ou de l'hôte :</p>
          <div id="envKeysList" style="display:flex;flex-direction:column;gap:10px;font-family:var(--font-mono);font-size:13px;"></div>
        </div>
      </div>
    </div>

    <!-- Live Logs View -->
    <div id="logsPane" class="terminal-container hidden" role="tabpanel" aria-labelledby="tabLogs" style="background:var(--bg);display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:12px 20px;background:var(--surface-1);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex:1;max-width:500px;">
          <label for="logSearchInput" class="sr-only">Filtrer les logs</label>
          <input type="text" id="logSearchInput" class="input-field" style="margin-bottom:0;" placeholder="Filtrer les logs (message, niveau, session)..." aria-label="Filtrer les logs" oninput="filterLogsLocally()" />
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label for="logLevelSelect" class="sr-only">Niveau de sévérité</label>
          <select id="logLevelSelect" class="input-field" style="margin-bottom:0;width:120px;" aria-label="Niveau de sévérité" onchange="loadLogs()">
            <option value="">Tous Niveaux</option>
            <option value="INFO">INFO+</option>
            <option value="WARN">WARN+</option>
            <option value="ERROR">ERROR Seul</option>
            <option value="DEBUG">DEBUG</option>
          </select>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer;user-select:none;">
            <input type="checkbox" id="logAutoRefreshCheckbox" checked onchange="toggleLogAutoRefresh(this.checked)" />
            <span>Auto (2s)</span>
          </label>
          <button class="btn btn-secondary btn-sm" onclick="loadLogs()">Rafraîchir</button>
          <button class="btn btn-secondary btn-sm" onclick="exportLogs()">Exporter</button>
          <button class="btn btn-secondary btn-sm" onclick="clearLogsView()">Effacer</button>
        </div>
      </div>
      <div id="logsContainer" class="log-stream"></div>
    </div>
  </div>

  <script>
    let ws = null;
    let token = localStorage.getItem('ag_token') || '';
    let termWs = null;
    let logAutoInterval = null;
    let cachedLogEntries = [];
    let confirmCallback = null;

    // Check auth on startup
    window.addEventListener('DOMContentLoaded', function() {
      initApp();
    });

    // Global keyboard listener (Escape closes modals)
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(function(m) {
          m.classList.add('hidden');
        });
      }
    });

    // --- Toast Notification System ---
    function showToast(message, type, duration) {
      type = type || 'info';
      duration = duration || 3200;
      const container = document.getElementById('toastContainer');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.setAttribute('role', 'status');
      toast.innerText = message;
      container.appendChild(toast);
      setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(6px)';
        setTimeout(function() { toast.remove(); }, 220);
      }, duration);
    }

    // --- Confirmation Modal (Non-blocking) ---
    function showConfirm(title, message, okText, isDanger, onConfirm) {
      document.getElementById('confirmTitle').innerText = title || 'Confirmation';
      document.getElementById('confirmMsg').innerText = message || 'Êtes-vous certain ?';
      const okBtn = document.getElementById('confirmOkBtn');
      okBtn.innerText = okText || 'Confirmer';
      okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-success';
      confirmCallback = onConfirm;
      document.getElementById('confirmModal').classList.remove('hidden');
      okBtn.focus();
    }

    function closeConfirmModal(accepted) {
      document.getElementById('confirmModal').classList.add('hidden');
      if (accepted && typeof confirmCallback === 'function') {
        confirmCallback();
      }
      confirmCallback = null;
    }

    function initApp() {
      // Extract token from URL if provided
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      if (urlToken) {
        token = urlToken;
        localStorage.setItem('ag_token', token);
      }

      fetchHealth();
      connectWebSocket();
      loadAccounts();
    }

    function fetchHealth() {
      fetch('/health')
        .then(function(res) {
          if (res.ok) return res.json();
          throw new Error('health failed');
        })
        .then(function(data) {
          document.getElementById('serverInfo').innerText = (data.serverId || 'srv') + ' (' + (data.platform || 'linux') + ')';
        })
        .catch(function(err) {
          console.warn('Health check warning:', err);
        });
    }

    function promptAuthToken() {
      document.getElementById('authTokenInput').value = token || '';
      document.getElementById('authModal').classList.remove('hidden');
      setTimeout(function() { document.getElementById('authTokenInput').focus(); }, 50);
    }

    function saveAuthToken() {
      const input = document.getElementById('authTokenInput').value.trim();
      if (input) {
        token = input;
        localStorage.setItem('ag_token', token);
        document.getElementById('authModal').classList.add('hidden');
        connectWebSocket();
        loadAccounts();
        showToast('Jeton d\'authentification mis à jour', 'success');
      }
    }

    function connectWebSocket() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = proto + '//' + window.location.host + '/v2/ws?token=' + encodeURIComponent(token);

      ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        const pill = document.getElementById('statusPill');
        pill.style.color = 'var(--success)';
        pill.style.background = 'var(--success-subtle)';
        document.getElementById('statusText').innerText = 'En ligne';
        loadAccounts();
      };

      ws.onmessage = function(event) {
        try {
          const frame = JSON.parse(event.data);
          handleWebSocketMessage(frame);
        } catch (e) {
          console.error('Failed to parse frame:', e);
        }
      };

      ws.onclose = function(event) {
        const pill = document.getElementById('statusPill');
        pill.style.color = 'var(--danger)';
        pill.style.background = 'var(--danger-subtle)';
        document.getElementById('statusText').innerText = 'Déconnecté';
        if (event.code === 4401 || event.code === 1008) {
          document.getElementById('authModal').classList.remove('hidden');
        } else {
          setTimeout(connectWebSocket, 3000);
        }
      };
    }

    function handleWebSocketMessage(frame) {
      if (frame.type === 'quota_update' || frame.type === 'accounts_update') {
        loadAccounts();
      }
    }

    function apiFetch(url, options) {
      options = options || {};
      options.headers = options.headers || {};
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
      return fetch(url, options).then(function(res) {
        if (res.status === 401) {
          document.getElementById('authModal').classList.remove('hidden');
          throw new Error('Non autorisé (401)');
        }
        return res;
      });
    }

    function switchTab(tab) {
      const tabs = ['accounts', 'apis', 'logs', 'terminal', 'git', 'mcp'];
      tabs.forEach(function(t) {
        const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
        const pane = document.getElementById(t + 'Pane');
        const isActive = t === tab;
        if (btn) {
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
        if (pane) {
          pane.classList.toggle('hidden', !isActive);
        }
      });

      if (tab === 'terminal') {
        if (!termWs || termWs.readyState !== WebSocket.OPEN) {
          initTerminal();
        }
        setTimeout(function() {
          const inp = document.getElementById('terminalInput');
          if (inp) inp.focus();
        }, 100);
      } else if (tab === 'accounts') {
        loadAccounts();
      } else if (tab === 'apis') {
        loadAPIConfig();
      } else if (tab === 'logs') {
        loadLogs();
        if (document.getElementById('logAutoRefreshCheckbox').checked && !logAutoInterval) {
          toggleLogAutoRefresh(true);
        }
      } else if (tab === 'git') {
        loadGitDiff();
      } else if (tab === 'mcp') {
        loadMCPServers();
      }

      if (tab !== 'logs' && logAutoInterval) {
        clearInterval(logAutoInterval);
        logAutoInterval = null;
      }
    }

    // --- Accounts Management ---
    function loadAccounts() {
      apiFetch('/v2/accounts')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          document.getElementById('accActiveBadge').innerText = 'Actif: ' + (data.activeAccount || 'Aucun');
          document.getElementById('autoRotateCheckbox').checked = !!data.autoRotate;
          const grid = document.getElementById('accountsGrid');
          grid.innerHTML = '';
          (data.accounts || []).forEach(function(acc) {
            const card = document.createElement('div');
            card.className = 'account-card' + (acc.isActive ? ' active-card' : '');

            let quotasHtml = '';
            (acc.quotas || []).forEach(function(q) {
              const pct = q.percentage !== undefined ? q.percentage : 100;
              const fillClass = pct > 50 ? 'fill-high' : pct > 20 ? 'fill-med' : 'fill-low';
              quotasHtml += '<div class="quota-row">' +
                '<div class="quota-meta">' +
                  '<span>' + escapeHtml(q.displayName || q.name) + '</span>' +
                  '<span style="font-weight:600">' + pct + '%</span>' +
                '</div>' +
                '<div class="progress-bar-bg" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + escapeHtml(q.displayName || q.name) + ': ' + pct + '%">' +
                  '<div class="progress-bar-fill ' + fillClass + '" style="width:' + pct + '%"></div>' +
                '</div>' +
              '</div>';
            });
            if (!quotasHtml) {
              quotasHtml = '<div style="font-size:12px;color:var(--text-muted);margin:8px 0;">Aucun quota répertorié</div>';
            }

            const statusClass = acc.status === 'active' ? 'badge-ready' : acc.status === 'exhausted' ? 'badge-waiting' : 'badge-running';

            card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-weight:600;font-size:14px;word-break:break-all;">' + escapeHtml(acc.email) + '</span>' +
              '<span class="badge ' + statusClass + '">' + escapeHtml(acc.status) + '</span>' +
            '</div>' +
            '<div style="margin:6px 0;">' + quotasHtml + '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:auto;">' +
              (!acc.isActive ? '<button class="btn btn-secondary btn-sm" onclick="switchAccount(\'' + escapeHtml(acc.email) + '\')">Activer</button>' : '') +
              '<button class="btn btn-danger btn-sm" onclick="deleteAccount(\'' + escapeHtml(acc.email) + '\')">Supprimer</button>' +
            '</div>';

            grid.appendChild(card);
          });
        })
        .catch(function(err) { console.error('Failed to load accounts:', err); });
    }

    function switchAccount(email) {
      apiFetch('/v2/accounts/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        showToast('Compte activé : ' + email, 'success');
        loadAccounts();
      })
      .catch(function(err) { showToast('Échec de bascule : ' + err.message, 'error'); });
    }

    function toggleAutoRotate(enabled) {
      apiFetch('/v2/accounts/auto-rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        showToast('Auto-rotation ' + (enabled ? 'activée' : 'désactivée'), 'info');
        loadAccounts();
      })
      .catch(function(err) { showToast('Erreur mise à jour auto-rotate', 'error'); });
    }

    function rotateAccount() {
      apiFetch('/v2/accounts/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        showToast('Rotation de compte effectuée', 'success');
        loadAccounts();
      })
      .catch(function(err) { showToast('Échec rotation : ' + err.message, 'error'); });
    }

    function optimizeQuotas() {
      apiFetch('/v2/accounts/select-best', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-2.5-pro' })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        showToast('Compte optimisé sélectionné : ' + data.activeAccount, 'success');
        loadAccounts();
      })
      .catch(function(err) { showToast('Échec optimisation : ' + err.message, 'error'); });
    }

    function resetExhaustedAccounts() {
      apiFetch('/v2/accounts/reset', { method: 'POST' })
        .then(function(res) { return res.json(); })
        .then(function() {
          showToast('Comptes épuisés réinitialisés', 'success');
          loadAccounts();
        })
        .catch(function(err) { showToast('Reset échoué : ' + err.message, 'error'); });
    }

    function openAddAccountModal() {
      document.getElementById('accEmailInput').value = '';
      document.getElementById('accTokenInput').value = '';
      document.getElementById('accountModal').classList.remove('hidden');
      setTimeout(function() { document.getElementById('accEmailInput').focus(); }, 50);
    }

    function closeAddAccountModal() {
      document.getElementById('accountModal').classList.add('hidden');
    }

    function submitAddAccount() {
      const email = document.getElementById('accEmailInput').value.trim();
      const refreshToken = document.getElementById('accTokenInput').value.trim();
      if (!email) {
        showToast('Adresse email requise', 'error');
        return;
      }
      apiFetch('/v2/accounts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, refreshToken: refreshToken })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        closeAddAccountModal();
        showToast('Compte ajouté au pool avec succès', 'success');
        loadAccounts();
      })
      .catch(function(err) { showToast('Ajout échoué : ' + err.message, 'error'); });
    }

    function deleteAccount(email) {
      showConfirm(
        'Supprimer le compte ?',
        'Voulez-vous retirer définitivement le compte ' + email + ' du pool dynamique ?',
        'Supprimer',
        true,
        function() {
          apiFetch('/v2/accounts/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
          })
          .then(function(res) { return res.json(); })
          .then(function() {
            showToast('Compte retiré du pool', 'info');
            loadAccounts();
          })
          .catch(function(err) { showToast('Suppression échouée : ' + err.message, 'error'); });
        }
      );
    }

    // --- API Configuration ---
    function loadAPIConfig() {
      apiFetch('/v2/api-config')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          document.getElementById('apiProviderSelect').value = data.provider || 'proxy';
          document.getElementById('apiModelInput').value = data.model || '';
          document.getElementById('apiBaseURLInput').value = data.baseURL || '';

          const envList = document.getElementById('envKeysList');
          envList.innerHTML = '';
          const keys = data.keys || {};
          for (let k in keys) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.background = 'var(--surface-3)';
            row.style.padding = '8px 12px';
            row.style.borderRadius = 'var(--radius-md)';
            row.style.border = '1px solid var(--border-subtle)';
            row.innerHTML = '<span style="color:var(--accent);">' + escapeHtml(k) + '</span>' +
              '<span style="color:' + (keys[k] ? 'var(--success)' : 'var(--text-muted)') + ';">' + escapeHtml(keys[k] || '(non configuré)') + '</span>';
            envList.appendChild(row);
          }
        })
        .catch(function(err) { console.error('Failed to load API config:', err); });
    }

    function onProviderSelectChange(val) {
      const modelInput = document.getElementById('apiModelInput');
      const baseInput = document.getElementById('apiBaseURLInput');
      if (val === 'anthropic' && !modelInput.value) {
        modelInput.value = 'claude-3-7-sonnet-20250219';
        baseInput.value = 'https://api.anthropic.com';
      } else if (val === 'openai' && !modelInput.value) {
        modelInput.value = 'gpt-4o';
        baseInput.value = 'https://api.openai.com/v1';
      } else if (val === 'proxy') {
        baseInput.value = 'http://127.0.0.1:51074/v1';
      } else if (val === 'ollama') {
        baseInput.value = 'http://localhost:11434/v1';
      }
    }

    function saveAPIConfig() {
      const provider = document.getElementById('apiProviderSelect').value;
      const model = document.getElementById('apiModelInput').value.trim();
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const baseURL = document.getElementById('apiBaseURLInput').value.trim();

      apiFetch('/v2/api-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          model: model,
          apiKey: apiKey,
          baseURL: baseURL
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        showToast('Configuration enregistrée : ' + data.provider + ' (' + data.model + ')', 'success');
        document.getElementById('apiKeyInput').value = '';
        loadAPIConfig();
      })
      .catch(function(err) { showToast('Enregistrement échoué : ' + err.message, 'error'); });
    }

    function testAPIConfig() {
      const resultBox = document.getElementById('testApiResult');
      resultBox.classList.remove('hidden');
      resultBox.style.color = 'var(--text-muted)';
      resultBox.innerText = 'Test de connectivité en cours...';

      const provider = document.getElementById('apiProviderSelect').value;
      const model = document.getElementById('apiModelInput').value.trim();
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const baseURL = document.getElementById('apiBaseURLInput').value.trim();

      apiFetch('/v2/api-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          model: model,
          apiKey: apiKey,
          baseURL: baseURL
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          resultBox.style.color = 'var(--success)';
          resultBox.innerHTML = '✅ Connexion réussie (' + data.latencyMs + ' ms) : "' + escapeHtml(data.message) + '"';
          showToast('Connexion API réussie (' + data.latencyMs + ' ms)', 'success');
        } else {
          resultBox.style.color = 'var(--danger)';
          resultBox.innerHTML = '❌ Échec : ' + escapeHtml(data.error);
          showToast('Échec connexion API', 'error');
        }
      })
      .catch(function(err) {
        resultBox.style.color = 'var(--danger)';
        resultBox.innerHTML = '❌ Erreur réseau : ' + escapeHtml(err.message);
        showToast('Erreur réseau API', 'error');
      });
    }

    function togglePasswordVisibility(id) {
      const inp = document.getElementById(id);
      if (inp) {
        inp.type = inp.type === 'password' ? 'text' : 'password';
      }
    }

    // --- Live System Logs ---
    function loadLogs() {
      const level = document.getElementById('logLevelSelect').value;
      const search = document.getElementById('logSearchInput').value.trim();
      let url = '/v2/logs?limit=250';
      if (level) url += '&level=' + encodeURIComponent(level);
      if (search) url += '&search=' + encodeURIComponent(search);

      apiFetch(url)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          cachedLogEntries = data.entries || [];
          renderLogs(cachedLogEntries);
        })
        .catch(function(err) { console.error('Failed to load logs:', err); });
    }

    function renderLogs(entries) {
      const container = document.getElementById('logsContainer');
      const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
      container.innerHTML = '';

      if (!entries || entries.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);padding:14px;text-align:center;">Aucun log trouvé pour ces critères.</div>';
        return;
      }

      entries.forEach(function(e) {
        const row = document.createElement('div');
        row.className = 'log-entry';

        const timeStr = e.timestamp ? e.timestamp.replace('T', ' ').substring(0, 19) : '';
        const lvl = e.level || 'INFO';
        let fieldsStr = '';
        if (e.fields && Object.keys(e.fields).length > 0) {
          fieldsStr = ' <span class="log-fields">' + escapeHtml(JSON.stringify(e.fields)) + '</span>';
        }

        row.innerHTML = '<span class="log-time">' + escapeHtml(timeStr) + '</span>' +
          '<span class="log-badge lvl-' + lvl + '">' + lvl + '</span>' +
          '<span class="log-msg">' + escapeHtml(e.message) + fieldsStr + '</span>';

        container.appendChild(row);
      });

      if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }

    function filterLogsLocally() {
      const query = document.getElementById('logSearchInput').value.toLowerCase().trim();
      if (!query) {
        renderLogs(cachedLogEntries);
        return;
      }
      const filtered = cachedLogEntries.filter(function(e) {
        return (e.message && e.message.toLowerCase().includes(query)) ||
          (e.level && e.level.toLowerCase().includes(query)) ||
          (e.fields && JSON.stringify(e.fields).toLowerCase().includes(query));
      });
      renderLogs(filtered);
    }

    function toggleLogAutoRefresh(enabled) {
      if (logAutoInterval) {
        clearInterval(logAutoInterval);
        logAutoInterval = null;
      }
      if (enabled) {
        logAutoInterval = setInterval(loadLogs, 2000);
      }
    }

    function clearLogsView() {
      document.getElementById('logsContainer').innerHTML = '';
      cachedLogEntries = [];
      showToast('Vue des logs effacée', 'info');
    }

    function exportLogs() {
      const blob = new Blob([JSON.stringify(cachedLogEntries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'daemon_logs_' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exportation des logs téléchargée', 'success');
    }

    function loadGitDiff() {
      const output = document.getElementById('gitDiffOutput');
      const filesList = document.getElementById('gitFilesList');
      output.textContent = 'Chargement du diff Git du workspace...';
      filesList.innerHTML = '';

      fetch('/v2/workspaces/diff?token=' + encodeURIComponent(token || ''))
        .then(res => res.json())
        .then(data => {
          document.getElementById('gitBranchBadge').innerText = data.branch || 'HEAD';
          document.getElementById('gitChangesBadge').innerText = (data.totalChanges || 0) + ' modifications';

          filesList.innerHTML = '';
          if (data.files && data.files.length > 0) {
            data.files.forEach(f => {
              const span = document.createElement('span');
              span.className = 'badge';
              const color = f.status.includes('M') ? 'var(--warning)' : f.status.includes('A') || f.status.includes('?') ? 'var(--success)' : 'var(--danger)';
              span.style.background = 'rgba(255,255,255,0.05)';
              span.style.border = '1px solid ' + color;
              span.style.color = color;
              span.innerText = f.status + ' ' + f.path;
              filesList.appendChild(span);
            });
          } else {
            filesList.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Arbre de travail propre. Aucune modification.</span>';
          }

          if (data.unifiedDiff) {
            output.textContent = data.unifiedDiff;
          } else {
            output.textContent = 'Aucune modification (arbre propre)';
          }
        })
        .catch(err => {
          output.textContent = 'Échec du chargement du diff : ' + err.message;
        });
    }

    function commitGitChanges() {
      const input = document.getElementById('gitCommitMsg');
      const msg = input.value.trim();
      if (!msg) {
        showToast('Veuillez saisir un message de commit', 'error');
        return;
      }

      fetch('/v2/workspaces/commit?token=' + encodeURIComponent(token || ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, author: 'Web Console <console@antigravity>' })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          showToast('Erreur commit : ' + data.error, 'error');
        } else {
          input.value = '';
          showToast('Commit réussi : ' + (data.commitHash || '').substring(0, 7), 'success');
          loadGitDiff();
        }
      })
      .catch(err => showToast('Commit échoué : ' + err.message, 'error'));
    }

    function loadMCPServers() {
      const grid = document.getElementById('mcpServersGrid');
      grid.innerHTML = '<div style="color:var(--text-muted);">Chargement des serveurs MCP...</div>';

      fetch('/v2/mcp/servers?token=' + encodeURIComponent(token || ''))
        .then(res => res.json())
        .then(data => {
          grid.innerHTML = '';
          const servers = data.servers || [];
          if (servers.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:24px;">Aucun serveur MCP enregistré. Cliquez sur "+ Enregistrer Serveur" pour intégrer des outils.</div>';
            return;
          }
          servers.forEach(s => {
            const card = document.createElement('div');
            card.className = 'tool-card';
            card.style.width = '100%';
            let toolsBadges = '';
            if (s.tools && s.tools.length > 0) {
              toolsBadges = s.tools.map(t => '<span class="badge" style="background:var(--surface-3);color:var(--accent);font-size:11px;margin:2px;">' + escapeHtml(t) + '</span>').join(' ');
            } else {
              toolsBadges = '<span style="color:var(--text-muted);font-size:11px;">0 outils détectés</span>';
            }
            card.innerHTML =
              '<div class="tool-header" style="justify-content:space-between;align-items:center;">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                  '<span style="font-weight:600;color:var(--text);">' + escapeHtml(s.name) + '</span>' +
                  '<span class="badge badge-ready">' + escapeHtml(s.status || 'ready') + '</span>' +
                '</div>' +
                '<button class="btn btn-danger btn-sm" onclick="unregisterMCPServer(\'' + escapeHtml(s.name) + '\')">Arrêter</button>' +
              '</div>' +
              '<div class="tool-body" style="padding:14px;">' +
                '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">' + escapeHtml(s.description || 'Aucune description fournie') + '</div>' +
                '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">OUTILS DISPONIBLES (' + (s.toolCount || 0) + ') :</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + toolsBadges + '</div>' +
              '</div>';
            grid.appendChild(card);
          });
        })
        .catch(err => {
          grid.innerHTML = '<div style="color:var(--danger);">Échec du chargement des serveurs MCP : ' + err.message + '</div>';
        });
    }

    function openMCPModal() {
      document.getElementById('mcpModal').classList.remove('hidden');
      setTimeout(function() { document.getElementById('mcpNameInput').focus(); }, 50);
    }

    function closeMCPModal() {
      document.getElementById('mcpModal').classList.add('hidden');
    }

    function submitRegisterMCPServer() {
      const name = document.getElementById('mcpNameInput').value.trim();
      const cmd = document.getElementById('mcpCmdInput').value.trim();
      const rawArgs = document.getElementById('mcpArgsInput').value.trim();
      const desc = document.getElementById('mcpDescInput').value.trim();

      if (!name || !cmd) {
        showToast('Nom et commande requis pour le serveur MCP', 'error');
        return;
      }

      const args = rawArgs ? rawArgs.split(' ').filter(a => a.length > 0) : [];

      fetch('/v2/mcp/servers?token=' + encodeURIComponent(token || ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, command: cmd, args: args, description: desc })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          showToast('Échec d\'enregistrement : ' + data.error, 'error');
        } else {
          closeMCPModal();
          showToast('Serveur MCP lancé avec succès', 'success');
          loadMCPServers();
        }
      })
      .catch(err => showToast('Erreur lancement : ' + err.message, 'error'));
    }

    function unregisterMCPServer(name) {
      showConfirm(
        'Arrêter le serveur MCP ?',
        'Voulez-vous déréférencer et stopper le serveur MCP "' + name + '" ?',
        'Stopper',
        true,
        function() {
          fetch('/v2/mcp/servers?name=' + encodeURIComponent(name) + '&token=' + encodeURIComponent(token || ''), {
            method: 'DELETE'
          })
          .then(res => res.json())
          .then(() => {
            showToast('Serveur MCP arrêté', 'info');
            loadMCPServers();
          })
          .catch(err => showToast('Échec arrêt : ' + err.message, 'error'));
        }
      );
    }

    function appendTerminalOutput(text) {
      const output = document.getElementById('terminalOutput');
      output.textContent += text;
      // Cap at 200,000 chars to avoid memory leaks
      if (output.textContent.length > 200000) {
        output.textContent = output.textContent.substring(output.textContent.length - 150000);
      }
      output.scrollTop = output.scrollHeight;
    }

    function initTerminal() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = proto + '//' + location.host + '/v2/terminal?token=' + encodeURIComponent(token || '');
      appendTerminalOutput('\n[Système] Connexion au terminal distant...\n');

      termWs = new WebSocket(wsUrl);
      termWs.onopen = function() {
        appendTerminalOutput('[Système] Shell de workspace en ligne. Prêt.\n\n');
      };
      termWs.onmessage = function(e) {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'output') {
            appendTerminalOutput(msg.data);
          } else if (msg.type === 'exit') {
            appendTerminalOutput('\n[Système] Processus terminé (code ' + msg.code + ')\n');
          } else if (msg.type === 'error') {
            appendTerminalOutput('\n[Erreur Système] ' + msg.data + '\n');
          }
        } catch(err) {
          appendTerminalOutput(e.data);
        }
      };
      termWs.onclose = function() {
        appendTerminalOutput('\n[Système] Terminal déconnecté.\n');
      };
    }

    function restartTerminal() {
      if (termWs) {
        termWs.close();
        termWs = null;
      }
      document.getElementById('terminalOutput').textContent = '';
      initTerminal();
      showToast('Shell de workspace relancé', 'info');
    }

    function clearTerminal() {
      document.getElementById('terminalOutput').textContent = '';
    }

    function handleTerminalKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById('terminalInput');
        const cmd = input.value;
        input.value = '';
        if (termWs && termWs.readyState === WebSocket.OPEN) {
          termWs.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
        } else {
          appendTerminalOutput('[Système] Terminal non connecté. Cliquez sur Relancer Shell.\n');
        }
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>
`

// HandleWebConsole serves the single-page web console on GET / and GET /console.
func HandleWebConsole(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/console" && r.URL.Path != "/dashboard" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(WebConsoleHTML))
}
