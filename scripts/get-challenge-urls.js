#!/usr/bin/env node
/**
 * scripts/get-challenge-urls.js
 * 
 * Fetches real-time validation challenge URLs for all accounts returning 403 VALIDATION_REQUIRED
 * and generates a clean, clickable HTML file to unlock them directly in your browser without QR codes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const repoRoot = path.resolve(__dirname, '..');
const { getValidGoogleAccessToken } = require(path.join(repoRoot, 'dist', 'services', 'googleAuth.js'));
const customModelsPath = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');

if (!fs.existsSync(customModelsPath)) {
  console.error('Error: custom_models.json not found');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(customModelsPath, 'utf8'));
const googleProvider = (raw.providers || []).find(p => p.id === 'provider-google' || p.provider === 'google');
const accounts = googleProvider?.accounts || [];

function probeAccountForUrl(acc) {
  return new Promise(async (resolve) => {
    try {
      const token = await getValidGoogleAccessToken(acc).catch(() => null);
      if (!token) {
        return resolve({ email: acc.email, status: 'NO_TOKEN', url: null });
      }

      const postData = JSON.stringify({
        project: acc.projectId || 'aicode-consumers',
        model: 'gemini-3.8-flash-tiered',
        request: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }
      });

      const req = https.request('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/2.24.0 windows/amd64',
          'X-Goog-Api-Client': 'google-cloud-sdk antigravity/2.24.0'
        },
        timeout: 9000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            return resolve({ email: acc.email, status: 'HEALTHY_200', url: null });
          }
          try {
            const j = JSON.parse(body);
            const errInfo = j.error?.details?.find(d => d['@type']?.includes('ErrorInfo'));
            const url = errInfo?.metadata?.validation_url || null;
            resolve({
              email: acc.email,
              status: errInfo?.reason || `HTTP_${res.statusCode}`,
              url
            });
          } catch (_) {
            resolve({ email: acc.email, status: `HTTP_${res.statusCode}`, url: null });
          }
        });
      });

      req.on('error', err => resolve({ email: acc.email, status: 'ERROR', error: err.message, url: null }));
      req.on('timeout', () => { req.destroy(); resolve({ email: acc.email, status: 'TIMEOUT', url: null }); });
      req.write(postData);
      req.end();
    } catch (e) {
      resolve({ email: acc.email, status: 'EXCEPTION', error: e.message, url: null });
    }
  });
}

(async () => {
  console.log('Extracting live validation links for accounts needing challenge...');
  const challengeList = [
    'amine.twiti33@gmail.com', 'amine.twiti38@gmail.com', 'amine.twiti40@gmail.com', 'amine.twiti39@gmail.com', 'nessrisakla@gmail.com',
    'ambenammar2000@gmail.com', 'amine.twiti19@gmail.com', 'benamaaramine87@gmail.com', 'amine.twiti35@gmail.com', 'amine.twiti36@gmail.com',
    'amine.twiti45@gmail.com', 'amine.twiti42@gmail.com', 'amine.twiti41@gmail.com', 'amine.twiti46@gmail.com', 'amine.twiti47@gmail.com', 'benn31109@gmail.com'
  ];

  const results = [];
  for (const email of challengeList) {
    const acc = accounts.find(a => a.email === email);
    if (!acc) continue;
    process.stdout.write(`Checking ${email}... `);
    const res = await probeAccountForUrl(acc);
    console.log(res.status + (res.url ? ' (URL found)' : ''));
    results.push(res);
  }

  // Generate HTML
  const htmlPath = path.join(repoRoot, 'challenges.html');
  const itemsHtml = results.map((r, i) => {
    if (r.url) {
      return `
        <div style="background:#1e1e2e; border:1px solid #45475a; border-radius:8px; padding:16px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:#cdd6f4; font-size:15px;">#${i + 1} — ${r.email}</strong>
            <span style="background:#fab387; color:#11111b; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:12px;">VALIDATION_REQUIRED</span>
          </div>
          <p style="color:#a6adc8; margin:8px 0; font-size:13px;">Ouvrez ce lien dans le profil Chrome connecté à ce compte pour valider l'accès sans QR Code :</p>
          <a href="${r.url}" target="_blank" style="display:inline-block; background:#89b4fa; color:#11111b; text-decoration:none; padding:8px 14px; border-radius:6px; font-weight:600; font-size:13px;">🔗 Débloquer ce compte dans le navigateur</a>
        </div>
      `;
    } else {
      return `
        <div style="background:#181825; border:1px solid #313244; border-radius:8px; padding:12px; margin-bottom:12px; color:#6c7086;">
          <strong>#${i + 1} — ${r.email}</strong> : Statut <em>${r.status}</em> (Pas d'URL de challenge active)
        </div>
      `;
    }
  }).join('\n');

  const fullHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Déblocage Comptes Google Antigravity</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#11111b; color:#cdd6f4; max-width:800px; margin:40px auto; padding:0 20px; line-height:1.5; }
    h1 { color:#89b4fa; border-bottom:1px solid #313244; padding-bottom:12px; }
    .tips { background:#181825; border-left:4px solid #a6e3a1; padding:12px 16px; margin-bottom:24px; border-radius:4px; font-size:14px; }
  </style>
</head>
<body>
  <h1>🔓 Liens Directs de Déblocage des Comptes (Challenge 403)</h1>
  <div class="tips">
    <strong>💡 Astuce anti-saturation :</strong>
    <ul>
      <li>Ouvrez chaque lien dans une fenêtre ou profil de navigateur où le compte Google correspondant est connecté.</li>
      <li>Si Google vous demande de confirmer votre identité, utilisez vos <strong>codes de secours à 8 chiffres</strong> ou votre <strong>Google Authenticator</strong> pour ne pas saturer votre numéro de téléphone.</li>
    </ul>
  </div>
  ${itemsHtml}
</body>
</html>`;

  fs.writeFileSync(htmlPath, fullHtml, 'utf8');
  console.log('\n✅ Fichier HTML généré avec succès :', htmlPath);
})();
