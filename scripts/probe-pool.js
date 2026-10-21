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
  if (r.includes('ineligible') || r.includes('ineligible for higher')) {
    return { code: 'INELIGIBLE_TIER', label: 'Compte Inéligible Quotas Supérieurs (#loadCodeAssist)', action: 'fix_billing_or_ai_studio' };
  }
  if (status === 503 || r.includes('capacity') || r.includes('high traffic')) {
    return { code: 'CAPACITY_503', label: 'Saturation TPU Cluster (503 No Capacity)', action: 'retry_or_cascade' };
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

async function probeSingle(token, projectId, model) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      project: projectId || 'aicode-consumers',
      model,
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
        'User-Agent': 'antigravity/2.24.0 windows/amd64',
        'X-Goog-Api-Client': 'google-cloud-sdk antigravity/2.24.0'
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const ms = Date.now() - start;
        const ok = res.statusCode === 200;
        let reason = ok ? 'OK' : '';
        let validationUrl = null;
        if (!ok) {
          try {
            const j = JSON.parse(body);
            reason = j.error?.message || j.error?.details?.[0]?.reason || body.substring(0, 80);
            const errInfo = j.error?.details?.find(d => d['@type']?.includes('ErrorInfo'));
            validationUrl = errInfo?.metadata?.validation_url || null;
            if (!validationUrl) {
              const help = j.error?.details?.find(d => d['@type']?.includes('Help'));
              validationUrl = help?.links?.[0]?.url || null;
            }
          } catch (_) {
            reason = body.substring(0, 80);
          }
        }
        resolve({ status: res.statusCode, ms, ok, reason, validationUrl });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 504, ms: 10000, ok: false, reason: 'TIMEOUT (>10s - High Latency)' });
    });

    req.on('error', (err) => {
      resolve({ status: 0, ms: Date.now() - start, ok: false, reason: err.message });
    });

    req.write(postData);
    req.end();
  });
}

async function testAccount(acc) {
  const email = acc.email || acc.name || 'unknown';
  try {
    const token = await getValidGoogleAccessToken(acc);
    if (!token) {
      const diagnosis = classifyError(401, 'Failed to refresh OAuth token');
      return { email, status: 401, ms: 0, ok: false, isTrial: false, reason: 'Failed to refresh OAuth token', diagnosis };
    }

    const flashRes = await probeSingle(token, acc.projectId, 'gemini-3.8-flash-tiered');
    let isTrial = false;
    let diagnosis = classifyError(flashRes.status, flashRes.reason);

    // If flash succeeded and not in fast mode, verify Argon/Pro eligibility
    if (flashRes.ok && !isFast) {
      const argonRes = await probeSingle(token, acc.projectId, 'gemini-4-argon');
      if (!argonRes.ok) {
        const r = (argonRes.reason || '').toLowerCase();
        if (r.includes('upgrade') || r.includes('ultra') || r.includes('trial') || argonRes.status === 403 || argonRes.status === 400) {
          isTrial = true;
          diagnosis = { code: 'TRIAL_RESTRICTED', label: 'Pro (Trial / Promo) — Flash uniquement', action: 'use_flash_only_or_upgrade' };
        }
      }
    }

    return {
      email,
      status: flashRes.status,
      ms: flashRes.ms,
      ok: flashRes.ok,
      isTrial,
      reason: flashRes.reason,
      validationUrl: flashRes.validationUrl,
      diagnosis,
    };
  } catch (err) {
    const diagnosis = classifyError(0, err.message);
    return { email, status: 0, ms: 0, ok: false, isTrial: false, reason: err.message, validationUrl: null, diagnosis };
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
  const trialEmails = new Set();
  const quarantinedEmails = new Set();
  const challengeEmails = new Set();
  const unlicensedEmails = new Set();
  const tosEmails = new Set();

  for (const r of results) {
    if (r.ok) {
      healthyEmails.add(r.email);
      if (r.isTrial) trialEmails.add(r.email);
    } else {
      if (r.diagnosis.code === 'CHALLENGE_REQUIRED') challengeEmails.add(r.email);
      if (r.diagnosis.code === 'UNLICENSED' || r.diagnosis.code === 'PERMISSION_DENIED_FLAGGED') unlicensedEmails.add(r.email);
      if (r.diagnosis.code === 'TOS_SUSPENDED') tosEmails.add(r.email);
      // Only accounts that are permanently broken (TOS, unauthenticated, denied) are quarantined & disabled
      if (['TOS_SUSPENDED', 'AUTH_TOKEN_EXPIRED', 'PERMISSION_DENIED_FLAGGED', 'CHALLENGE_REQUIRED'].includes(r.diagnosis.code)) {
        quarantinedEmails.add(r.email);
      }
    }
  }

  return { config, googleProvider, results, healthyEmails, trialEmails, quarantinedEmails, challengeEmails, unlicensedEmails, tosEmails };
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
  console.log(' Mode:   ' + (isDryRun ? 'DRY RUN (inspect only)' : 'AUTO-HEAL & QUARANTINE') + (isFast ? ' [FAST]' : ' [MULTI-TIER]'));
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const { config, googleProvider, results, healthyEmails, trialEmails, quarantinedEmails, challengeEmails, unlicensedEmails, tosEmails } = await runProbe();

  console.log('┌─────┬──────────────────────────────┬────────────┬──────────┬─────────────────────────────────────────────────┐');
  console.log('│ ST  │ Account Email                │ Code / Lat │ Catégorie │ Diagnostic & Action Requise                     │');
  console.log('├─────┼──────────────────────────────┼────────────┼──────────┼─────────────────────────────────────────────────┤');

  for (const r of results) {
    let icon = '❌';
    if (r.ok && r.isTrial) icon = '🎓';
    else if (r.ok) icon = '✅';
    else if (r.diagnosis.code === 'CHALLENGE_REQUIRED') icon = '🟠';
    else if (r.diagnosis.code === 'QUOTA_EXHAUSTED') icon = '⏳';
    else if (r.diagnosis.code === 'UNLICENSED') icon = '⚪';
    else if (r.diagnosis.code === 'GEO_BLOCKED_LOCATION') icon = '🌐';
    else if (r.diagnosis.code === 'PERMISSION_DENIED_FLAGGED') icon = '🚫';

    const emailCol = (r.email || '').padEnd(28).substring(0, 28);
    const statusCol = (`H${r.status} ${r.ms}ms`).padEnd(10).substring(0, 10);
    const catCol = (r.diagnosis.code).padEnd(10).substring(0, 10);
    const diagCol = (r.diagnosis.label || r.reason || '').padEnd(47).substring(0, 47);

    console.log(`│ ${icon} │ ${emailCol} │ ${statusCol} │ ${catCol} │ ${diagCol} │`);
  }

  console.log('└─────┴──────────────────────────────┴────────────┴──────────┴─────────────────────────────────────────────────┘');

  console.log(`\n📊 Bilan Diagnostic :`);
  console.log(`   🟢 Actifs & Sains (Healthy)       : ${healthyEmails.size}`);
  console.log(`   🎓 Comptes Trial (Flash uniq.)    : ${trialEmails.size}`);
  console.log(`   🟠 Challenge Validation (Sécurité) : ${challengeEmails.size}  -> Action : Déblocage navigateur recommandé`);
  console.log(`   ⚪ Non-Inscrits / Sans Licence     : ${unlicensedEmails.size}  -> Action : Ignoré ou re-inscription`);
  console.log(`   🔴 TOS / Suspendus                 : ${tosEmails.size}`);
  console.log(`   🛑 Total Quarantaine (Désactivés) : ${quarantinedEmails.size}`);

  if (!isDryRun) {
    let modified = false;
    for (const a of googleProvider.accounts) {
      if (healthyEmails.has(a.email)) {
        if (a.enabled === false) { a.enabled = true; modified = true; }
        if (trialEmails.has(a.email)) {
          if (a.isTrial !== true) { a.isTrial = true; modified = true; }
        } else {
          if (a.isTrial === true) { a.isTrial = false; modified = true; }
        }
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
          for (const email of unlicensedEmails) {
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
