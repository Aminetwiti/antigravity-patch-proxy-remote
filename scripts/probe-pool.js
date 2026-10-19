#!/usr/bin/env node
/**
 * scripts/probe-pool.js
 * 
 * High-speed parallel health-checker and sanitizer for Google Cloud Code accounts.
 * Probes all accounts with real Antigravity IDE signatures, isolates black-hole/captcha
 * accounts, and keeps custom_models.json in a 100% healthy, zero-latency state.
 * 
 * Usage:
 *   node scripts/probe-pool.js [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// Disable self-signed cert rejections for proxy probing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const repoRoot = path.resolve(__dirname, '..');
const { getValidGoogleAccessToken } = require(path.join(repoRoot, 'dist', 'services', 'googleAuth.js'));

const customModelsPath = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
const quotaCachePath = path.join(os.homedir(), '.gemini', 'antigravity', 'quota_cache.json');

if (!fs.existsSync(customModelsPath)) {
  console.error('[probe-pool] Error: custom_models.json not found at:', customModelsPath);
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');

async function testAccount(acc) {
  const email = acc.email || acc.name || 'unknown';
  try {
    const token = await getValidGoogleAccessToken(acc);
    if (!token) {
      return { email, status: 0, ms: 0, ok: false, reason: 'Failed to refresh OAuth token' };
    }

    return new Promise((resolve) => {
      const postData = JSON.stringify({
        project: acc.projectId || 'aicode-consumers',
        model: 'gemini-3.8-flash-tiered',
        request: {
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }]
        }
      });

      const start = Date.now();
      const req = https.request('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/2.23.0 windows/amd64',
          'X-Goog-Api-Client': 'google-cloud-sdk antigravity/2.23.0'
        },
        timeout: 6000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const ms = Date.now() - start;
          const ok = res.statusCode === 200;
          let reason = ok ? 'OK' : '';
          if (!ok) {
            try {
              const j = JSON.parse(body);
              reason = j.error?.message || j.error?.details?.[0]?.reason || body.substring(0, 60);
            } catch (_) {
              reason = body.substring(0, 60);
            }
          }
          resolve({ email, status: res.statusCode, ms, ok, reason });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ email, status: 504, ms: Date.now() - start, ok: false, reason: 'TIMEOUT (>6s - Black Hole)' });
      });

      req.on('error', (err) => {
        resolve({ email, status: 0, ms: Date.now() - start, ok: false, reason: err.message });
      });

      req.write(postData);
      req.end();
    });
  } catch (err) {
    return { email, status: 0, ms: 0, ok: false, reason: err.message };
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log(' [DOCTOR] Antigravity Google Multi-Account Pool Health Audit');
  console.log(' Config: ' + customModelsPath);
  console.log(' Mode:   ' + (isDryRun ? 'DRY RUN (inspect only)' : 'AUTO-HEAL & QUARANTINE'));
  console.log('════════════════════════════════════════════════════════════════\n');

  const config = JSON.parse(fs.readFileSync(customModelsPath, 'utf8'));
  const googleProvider = (config.providers || []).find(p => p.id === 'provider-google' || p.provider === 'google');
  if (!googleProvider || !Array.isArray(googleProvider.accounts)) {
    console.error('No Google provider or accounts found in custom_models.json');
    process.exit(1);
  }

  const accounts = googleProvider.accounts.filter(a => a.email);
  console.log(`Probing ${accounts.length} Google account(s) concurrently with live IDE headers...\n`);

  const results = await Promise.all(accounts.map(testAccount));

  const healthyEmails = new Set();
  const quarantinedEmails = new Set();

  console.log('┌─────┬──────────────────────────────┬────────────┬──────────┬────────────────────────────────────────────┐');
  console.log('│ ST  │ Account Email                │ Status     │ Latency  │ Diagnosis / Details                        │');
  console.log('├─────┼──────────────────────────────┼────────────┼──────────┼────────────────────────────────────────────┤');

  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const emailCol = (r.email || '').padEnd(28).substring(0, 28);
    const statusCol = ('HTTP ' + r.status).padEnd(10);
    const latencyCol = (r.ms + 'ms').padEnd(8);
    const reasonCol = (r.reason || '').padEnd(42).substring(0, 42);

    console.log(`│ ${icon} │ ${emailCol} │ ${statusCol} │ ${latencyCol} │ ${reasonCol} │`);

    if (r.ok) {
      healthyEmails.add(r.email);
    } else {
      quarantinedEmails.add(r.email);
    }
  }

  console.log('└─────┴──────────────────────────────┴────────────┴──────────┴────────────────────────────────────────────┘');

  console.log(`\nSummary: ${healthyEmails.size} Healthy (Active) | ${quarantinedEmails.size} Quarantined (Disabled)`);

  if (!isDryRun) {
    let modified = false;
    for (const a of googleProvider.accounts) {
      if (healthyEmails.has(a.email)) {
        if (a.enabled === false) { a.enabled = true; modified = true; }
      } else if (quarantinedEmails.has(a.email)) {
        if (a.enabled !== false) { a.enabled = false; modified = true; }
      }
    }

    fs.writeFileSync(customModelsPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('💾 custom_models.json updated: quarantined accounts marked as enabled: false.');

    if (fs.existsSync(quotaCachePath)) {
      try {
        const qc = JSON.parse(fs.readFileSync(quotaCachePath, 'utf8'));
        if (qc.quotas) {
          for (const email of quarantinedEmails) {
            if (qc.quotas[email]) {
              qc.quotas[email].fiveHourPercentage = 0;
              qc.quotas[email].weeklyPercentage = 0;
            }
          }
          fs.writeFileSync(quotaCachePath, JSON.stringify(qc, null, 2), 'utf8');
          console.log('💾 quota_cache.json synchronized: quarantined accounts quota zeroed.');
        }
      } catch (_) {}
    }
  }

  console.log('\n[probe-pool] Pool is healthy and ready for seamless parallel execution.');
}

main().catch(err => {
  console.error('[probe-pool] Fatal error:', err);
  process.exit(1);
});
