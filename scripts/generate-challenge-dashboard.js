#!/usr/bin/env node
/**
 * scripts/generate-challenge-dashboard.js
 * 
 * Generates an interactive local HTML dashboard with direct unlock links
 * and one-click actions for all Google accounts flagged with 403 / VALIDATION_REQUIRED.
 * 
 * Usage:
 *   node scripts/generate-challenge-dashboard.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { runProbe } = require('./probe-pool');

async function main() {
  console.log('🔍 Analyse des comptes et génération du tableau de bord de déblocage...');
  const { results, healthyEmails } = await runProbe();

  const challenged = results.filter((r) => r.diagnosis.code === 'CHALLENGE_REQUIRED');
  const healthy = results.filter((r) => r.diagnosis.code === 'HEALTHY');
  const unlicensed = results.filter((r) => r.diagnosis.code === 'UNLICENSED');
  const tos = results.filter((r) => r.diagnosis.code === 'SUSPENDED_TOS');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity 2.0 - Centre de Déblocage des Comptes Google</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      font-size: 24px;
      margin: 0 0 8px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      padding: 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .stat-val {
      font-size: 28px;
      font-weight: bold;
      margin-top: 4px;
    }
    .stat-val.green { color: var(--success); }
    .stat-val.yellow { color: var(--warning); }
    .stat-val.red { color: var(--danger); }
    .stat-val.gray { color: var(--muted); }
    .guide-box {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .guide-box h3 { margin-top: 0; color: var(--accent); }
    .account-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: rgba(0, 0, 0, 0.2);
      font-weight: 600;
      color: var(--muted);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .btn {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary {
      background: #0284c7;
      color: white;
    }
    .btn-primary:hover { background: #0369a1; }
    .btn-secondary {
      background: #334155;
      color: #f8fafc;
      margin-left: 6px;
    }
    .btn-secondary:hover { background: #475569; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-warn { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🛡️ Antigravity 2.0 - Centre de Déblocage & Résilience</h1>
      <p style="color: var(--muted); margin: 0;">Résolution des blocages Google anti-abus, validation d'âge et défis de sécurité.</p>
    </header>

    <div class="stats">
      <div class="stat-card">
        <div style="color: var(--muted); font-size: 13px;">Comptes Opérationnels</div>
        <div class="stat-val green">${healthy.length}</div>
      </div>
      <div class="stat-card">
        <div style="color: var(--muted); font-size: 13px;">Validation Requise (403)</div>
        <div class="stat-val yellow">${challenged.length}</div>
      </div>
      <div class="stat-card">
        <div style="color: var(--muted); font-size: 13px;">Sans Licence / Preview</div>
        <div class="stat-val gray">${unlicensed.length}</div>
      </div>
      <div class="stat-card">
        <div style="color: var(--muted); font-size: 13px;">Suspendus TOS</div>
        <div class="stat-val red">${tos.length}</div>
      </div>
    </div>

    <div class="guide-box">
      <h3>💡 Protocole en 4 Étapes pour Débloquer vos Comptes (Bypass Limite Smartphone)</h3>
      <ol style="margin: 0; padding-left: 20px;">
        <li><strong>Révocation</strong> : Révoquez les autorisations Antigravity sur <a href="https://myaccount.google.com/connections" target="_blank" style="color: var(--accent);">Google Connexions</a>.</li>
        <li><strong>Validation de l'Âge</strong> : Si demandé, validez votre date de naissance sur <a href="https://myaccount.google.com/age-verification" target="_blank" style="color: var(--accent);">Google Age Verification</a>.</li>
        <li><strong>Déblocage Navigateur Direct</strong> : Cliquez sur <em>"Débloquer"</em> ci-dessous pour résoudre le Captcha/SMS directement sur PC (évite le message d'erreur de smartphone saturé).</li>
        <li><strong>Reconnexion Native Antigravity</strong> : Validez la modale native Antigravity 2.0 sur PC.</li>
      </ol>
    </div>

    <h2 style="font-size: 18px; margin: 20px 0 12px 0;">Comptes en Attente de Déblocage (${challenged.length})</h2>
    ${challenged.length === 0 ? '<p style="color: var(--success);">🎉 Aucun compte ne nécessite de déblocage interactif !</p>' : `
    <table class="account-table">
      <thead>
        <tr>
          <th>Compte</th>
          <th>Statut</th>
          <th>Actions Recommandées</th>
        </tr>
      </thead>
      <tbody>
        ${challenged.map((acc) => {
          const unlockUrl = acc.validationUrl || `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(acc.email)}&continue=https://gemini.google.com/`;
          return `
          <tr>
            <td><strong>${acc.email}</strong></td>
            <td><span class="badge badge-warn">VALIDATION_REQUIRED</span></td>
            <td>
              <a href="${unlockUrl}" target="_blank" class="btn btn-primary">🔓 Débloquer dans le Navigateur</a>
              <a href="https://myaccount.google.com/age-verification" target="_blank" class="btn btn-secondary">Âge</a>
              <a href="https://myaccount.google.com/connections" target="_blank" class="btn btn-secondary">Connexions</a>
            </td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    `}
  </div>
</body>
</html>`;

  const outPath = path.join(process.cwd(), 'challenges.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`\n✅ Tableau de bord généré avec succès : ${outPath}`);

  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${outPath}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${outPath}"`);
  } else {
    exec(`xdg-open "${outPath}"`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
