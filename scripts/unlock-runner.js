#!/usr/bin/env node
'use strict';

const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const { getValidGoogleAccessToken } = require(path.join(repoRoot, 'dist', 'services', 'googleAuth.js'));
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const cm = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json'), 'utf8'));
const accounts = cm.providers[0].accounts;

const challengeEmails = [
  'amine.twiti19@gmail.com', 'benamaaramine87@gmail.com', 'ambenammar2000@gmail.com',
  'amine.twiti33@gmail.com', 'amine.twiti35@gmail.com', 'amine.twiti36@gmail.com',
  'amine.twiti45@gmail.com', 'amine.twiti42@gmail.com', 'amine.twiti41@gmail.com',
  'amine.twiti40@gmail.com', 'amine.twiti39@gmail.com', 'amine.twiti38@gmail.com',
  'amine.twiti46@gmail.com', 'amine.twiti47@gmail.com', 'nessrisakla@gmail.com',
  'benn31109@gmail.com'
];

async function getValUrl(email) {
  const acc = accounts.find(a => a.email === email);
  if (!acc) return null;
  const token = await getValidGoogleAccessToken(acc).catch(() => null);
  if (!token) return null;

  return new Promise(resolve => {
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
      timeout: 8000
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let valUrl = null;
        try {
          const j = JSON.parse(body);
          const errInfo = j.error?.details?.find(d => d['@type']?.includes('ErrorInfo'));
          valUrl = errInfo?.metadata?.validation_url || null;
        } catch (_) {}
        resolve({ email, status: res.statusCode, valUrl });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const escaped = url.replace(/&/g, '^&');
    exec(`cmd /c start "" "${escaped}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

(async () => {
  const results = [];
  for (const email of challengeEmails) {
    const res = await getValUrl(email);
    if (res && res.valUrl) {
      results.push(res);
    }
  }

  // Save urls to json for reference
  fs.writeFileSync(path.join(repoRoot, 'challenge_urls.json'), JSON.stringify(results, null, 2), 'utf8');

  console.log(`Fetched ${results.length} active validation URLs.`);
  
  // Open the first 3 in browser automatically
  const batch = results.slice(0, 3);
  for (const item of batch) {
    console.log(`Opening browser for ${item.email}...`);
    openBrowser(item.valUrl);
  }
})();
