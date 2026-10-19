#!/usr/bin/env node
/**
 * scripts/probe-pool.js
 * 
 * High-speed parallel health-checker, 403/TOS diagnostic and sanitizer for Google Cloud Code accounts.
 * Probes all accounts with real Antigravity IDE signatures, isolates black-hole/captcha
 * accounts, classifies failure types, and keeps custom_models.json in a 100% healthy state.
 * 
 * Usage:
 *   node scripts/probe-pool.js [--dry-run] [--json]
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
const isJsonOutput = process.argv.includes('--json');
const isFast = process.argv.includes('--fast');

function classifyError(status, reason) {
  const r = (reason || '').toLowerCase();
  if (status === 200) {
    return { code: 'HEALTHY', label: 'Opérationnel (200 OK)', action: 'none' };
  }
  if (status === 400 && (r.includes('location is not supported') || r.includes('failed_precondition') || r.includes('user location'))) {
    return { code: 'GEO_BLOCKED_LOCATION', label: 'Réseau / VPN Datacenter Non Supporté (Géo-bloqué)', action: 'disable_vpn_or_use_ai_studio' };
  }
  if (status === 403 && (r.includes('project has been denied access') || r.includes('project denied access') || r.includes('permission_denied'))) {
    return { code: 'PERMISSION_DENIED_FLAGGED', label: 'Projet Free-Tier sous Flag Anti-Abus Google (403)', action: 'upgrade_paid_tier_or_prepay' };
  }
  if (r.includes('upgrade to ai ultra') || r.includes('ai pro (trial)') || r.includes('trial plan') || r.includes('trial subscription')) {
    return { code: 'TRIAL_RESTRICTED', label: 'Compte Pro (Trial / Promo) — Flash uniquement', action: 'use_flash_only_or_upgrade' };
  }
  if (r.includes('verify your account') || r.includes('validation_required') || r.includes('challenge')) {
    return { code: 'CHALLENGE_REQUIRED', label: 'Validation Sécurité Requise (SMS/Captcha)', action: 'browser_verify' };
  }
  if (r.includes('terms of service') || r.includes('tos') || r.includes('suspended') || r.includes('disabled')) {
    return { code: 'TOS_SUSPENDED', label: 'Compte Suspendu / TOS', action: 'google_appeal' };
  }
  if (r.includes('license') || r.includes('#3501') || r.includes('unlicensed') || r.includes('whitelisted')) {
    return { code: 'UNLICENSED', label: 'Non-Inscrit Antigravity Preview (#3501)', action: 'reauth_or_wait' };
  }
  if (status === 429 || r.includes('resource_exhausted') || r.includes('quota')) {
    return { code: 'QUOTA_EXHAUSTED', label: 'Quota Épuisé (5h ou Hebdo)', action: 'wait_reset' };
  }
  if (status === 504 || r.includes('timeout') || r.includes('black hole')) {
    return { code: 'BLACK_HOLE_TIMEOUT', label: 'Black-Hole (Hanging Socket >6s)', action: 'check_network_or_quarantine' };
  }
  if (r.includes('refresh') || r.includes('token') || status === 401) {
    return { code: 'AUTH_TOKEN_EXPIRED', label: 'Session / Refresh Token Expiré', action: 'reauth' };
  }
  return { code: 'UNKNOWN_ERROR', label: `Erreur HTTP ${status}`, action: 'inspect' };
}

async function testAccount(acc) {
  const email = acc.email || acc.name || 'unknown';
  try {
    const token = await getValidGoogleAccessToken(acc);
    if (!token) {
      const diagnosis = classifyError(401, 'Failed to refresh OAuth token');
      return { email, status: 401, ms: 0, ok: false, reason: 'Failed to refresh OAuth token', diagnosis };
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
      const req = https.request('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/2.23.0 windows/amd64',
          'X-Goog-Api-Client': 'google-cloud-sdk antigravity/2.23.0'
        },
        timeout: 4000
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
              reason = j.error?.message || j.error?.details?.[0]?.reason || body.substring(0, 80);
            } catch (_) {
              reason = body.substring(0, 80);
            }
          }
          const diagnosis = classifyError(res.statusCode, reason);
          resolve({ email, status: res.statusCode, ms, ok, reason, diagnosis });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const reason = 'TIMEOUT (>4s - Black Hole)';
        const diagnosis = classifyError(504, reason);
        resolve({ email, status: 504, ms: Date.now() - start, ok: false, reason, diagnosis });
      });

      req.on('error', (err) => {
        const diagnosis = classifyError(0, err.message);
        resolve({ email, status: 0, ms: Date.now() - start, ok: false, reason: err.message, diagnosis });
      });

      req.write(postData);
      req.end();
    });
  } catch (err) {
    const diagnosis = classifyError(0, err.message);
    return { email, status: 0, ms: 0, ok: false, reason: err.message, diagnosis };
  }
}

async function runProbe() {
  const config = JSON.parse(fs.readFileSync(customModelsPath, 'utf8'));
  const googleProvider = (config.providers || []).find(p => p.id === 'provider-google' || p.provider === 'google');
  if (!googleProvider || !Array.isArray(googleProvider.accounts)) {
    throw new Error('No Google provider or accounts found in custom_models.json');
  }

  const accounts = googleProvider.accounts.filter(a => a.email);
  const results = await Promise.all(accounts.map(testAccount));

  const healthyEmails = new Set();
  const quarantinedEmails = new Set();
  const challengeEmails = new Set();
  const unlicensedEmails = new Set();
  const tosEmails = new Set();

  for (const r of results) {
    if (r.ok) {
      healthyEmails.add(r.email);
    } else {
      quarantinedEmails.add(r.email);
      if (r.diagnosis.code === 'CHALLENGE_REQUIRED') challengeEmails.add(r.email);
      if (r.diagnosis.code === 'UNLICENSED') unlicensedEmails.add(r.email);
      if (r.diagnosis.code === 'TOS_SUSPENDED') tosEmails.add(r.email);
    }
  }

  return { config, googleProvider, results, healthyEmails, quarantinedEmails, challengeEmails, unlicensedEmails, tosEmails };
}

async function main() {
  if (isJsonOutput) {
    const data = await runProbe();
    console.log(JSON.stringify(data.results, null, 2));
    return;
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(' [DOCTOR] Antigravity Google Multi-Account Diagnostic & Sanitizer');
  console.log(' Config: ' + customModelsPath);
  console.log(' Mode:   ' + (isDryRun ? 'DRY RUN (inspect only)' : 'AUTO-HEAL & QUARANTINE'));
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const { config, googleProvider, results, healthyEmails, quarantinedEmails, challengeEmails, unlicensedEmails, tosEmails } = await runProbe();

  console.log('┌─────┬──────────────────────────────┬────────────┬──────────┬─────────────────────────────────────────────────┐');
  console.log('│ ST  │ Account Email                │ Code / Lat │ Catégorie │ Diagnostic & Action Requise                     │');
  console.log('├─────┼──────────────────────────────┼────────────┼──────────┼─────────────────────────────────────────────────┤');

  for (const r of results) {
    let icon = '❌';
    if (r.ok) icon = '✅';
    else if (r.diagnosis.code === 'CHALLENGE_REQUIRED') icon = '🟠';
    else if (r.diagnosis.code === 'QUOTA_EXHAUSTED') icon = '⏳';
    else if (r.diagnosis.code === 'UNLICENSED') icon = '⚪';

    const emailCol = (r.email || '').padEnd(28).substring(0, 28);
    const statusCol = (`H${r.status} ${r.ms}ms`).padEnd(10).substring(0, 10);
    const catCol = (r.diagnosis.code).padEnd(10).substring(0, 10);
    const diagCol = (r.diagnosis.label || r.reason || '').padEnd(47).substring(0, 47);

    console.log(`│ ${icon} │ ${emailCol} │ ${statusCol} │ ${catCol} │ ${diagCol} │`);
  }

  console.log('└─────┴──────────────────────────────┴────────────┴──────────┴─────────────────────────────────────────────────┘');

  console.log(`\n📊 Bilan Diagnostic :`);
  console.log(`   🟢 Actifs & Sains (Healthy)       : ${healthyEmails.size}`);
  console.log(`   🟠 Challenge Validation (Sécurité) : ${challengeEmails.size}  -> Action : Déblocage navigateur recommandé`);
  console.log(`   ⚪ Non-Inscrits / Sans Licence     : ${unlicensedEmails.size}  -> Action : Ignoré ou re-inscription`);
  console.log(`   🔴 TOS / Suspendus                 : ${tosEmails.size}`);
  console.log(`   🛑 Total Quarantaine (Désactivés) : ${quarantinedEmails.size}`);

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
    console.log('\n💾 custom_models.json synchronisé : seuls les comptes sains restent actifs.');

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
        }
        if (Array.isArray(qc.unlicensedAccounts)) {
          const unSet = new Set(qc.unlicensedAccounts);
          for (const email of healthyEmails) {
            unSet.delete(email);
            unSet.delete(`google:${email}`);
            unSet.delete(`gemini-cli:${email}`);
          }
          for (const email of quarantinedEmails) {
            unSet.add(email);
            unSet.add(`google:${email}`);
          }
          qc.unlicensedAccounts = Array.from(unSet);
        }
        fs.writeFileSync(quotaCachePath, JSON.stringify(qc, null, 2), 'utf8');
        console.log('💾 quota_cache.json synchronisé : quotas et liste de quarantaine mis à jour.');
      } catch (_) {}
    }
  }

  if (challengeEmails.size > 0) {
    console.log('\n💡 Astuce : Pour débloquer les comptes nécessitant une vérification de sécurité :');
    console.log('   Exécutez : npm run doctor:fix-accounts');
  }

  console.log('\n[probe-pool] Diagnostic terminé.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[probe-pool] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { testAccount, runProbe, classifyError };
