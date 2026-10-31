#!/usr/bin/env node
/**
 * scripts/fix-accounts.js
 * 
 * Interactive Assistant to Diagnose, Unlock and Restore Google Accounts flagged
 * with 403 Challenges (SMS/Captcha), TOS, or Black-Hole statuses.
 * 
 * Usage:
 *   node scripts/fix-accounts.js [--check-only]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const { runProbe } = require('./probe-pool');

const isCheckOnly = process.argv.includes('--check-only');

function openBrowser(url) {
  if (process.platform === 'win32') {
    // Escape ampersands and special characters for Windows cmd start
    exec(`cmd /c start "" "${url.replace(/&/g, '^&')}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function getGoogleUnlockUrl(acc) {
  if (typeof acc === 'object' && acc && acc.validationUrl) {
    return acc.validationUrl;
  }
  const email = typeof acc === 'object' && acc ? acc.email : acc;
  // Direct Google login pre-fill URL that lands directly on the verification/security page
  return `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(email)}&continue=https://gemini.google.com/`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(' 🩺 [ASSISTANT] Déblocage & Résolution des Comptes Google Antigravity');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('Analyse en direct de l\'état de vos comptes Google...\n');

  const { results, challengeEmails, unlicensedEmails, tosEmails, healthyEmails } = await runProbe();

  const actionableAccounts = results.filter(r => r.diagnosis.code === 'CHALLENGE_REQUIRED');

  console.log(`\nÉtat du Pool :`);
  console.log(`  🟢 ${healthyEmails.size} comptes opérationnels`);
  console.log(`  🟠 ${actionableAccounts.length} comptes demandent une validation de sécurité (Challenge / SMS / Captcha)`);
  if (unlicensedEmails.size > 0) console.log(`  ⚪ ${unlicensedEmails.size} comptes sans licence Antigravity Preview`);
  if (tosEmails.size > 0) console.log(`  🔴 ${tosEmails.size} comptes suspendus TOS`);

  if (actionableAccounts.length === 0) {
    console.log('\n🎉 Aucun compte ne nécessite de déblocage manuel ! Tous vos comptes configurés sont sains.');
    return;
  }

  console.log('\nComptes bloqués nécessitant votre validation sur le navigateur :');
  actionableAccounts.forEach((acc, idx) => {
    console.log(`  [${idx + 1}] ${acc.email} (${acc.diagnosis.label})`);
  });

  if (isCheckOnly) {
    console.log('\nMode --check-only terminé.');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const promptUser = () => {
    console.log('\nQue souhaitez-vous faire ?');
    console.log('  [Numéro]  Débloquer ce compte spécifique avec le protocole 4 étapes (ex: 1)');
    console.log('  [P]       Afficher le protocole complet en 4 étapes (Bypass limite smartphone)');
    console.log('  [C]       Ouvrir la gestion des connexions Google (Révoquer accès Antigravity)');
    console.log('  [V]       Ouvrir la validation d\'âge Google (myaccount.google.com/age-verification)');
    console.log('  [O]       Pré-valider l\'onboarding Antigravity 2.0 (app_storage.json)');
    console.log('  [F]       Renouveler l\'empreinte matérielle (Anti-Syndication Google Machine ID)');
    console.log('  [A]       Ouvrir les 3 premiers comptes bloqués dans le navigateur');
    console.log('  [R]       Re-tester tous les comptes pour vérifier les déblocages');
    console.log('  [Q]       Quitter\n');

    rl.question('Votre choix > ', async (answer) => {
      const choice = answer.trim().toUpperCase();

      if (choice === 'Q') {
        rl.close();
        return;
      }

      if (choice === 'O') {
        const appData = process.env.APPDATA || (process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : path.join(os.homedir(), '.config'));
        const storagePath = path.join(appData, 'Antigravity', 'app_storage.json');
        try {
          if (!fs.existsSync(path.dirname(storagePath))) fs.mkdirSync(path.dirname(storagePath), { recursive: true });
          let data = fs.existsSync(storagePath) ? JSON.parse(fs.readFileSync(storagePath, 'utf8')) : {};
          const primary = (accounts.find(a => !a.disabled && a.email) || accounts[0])?.email || 'user@google.com';
          data['jetski.onboarding.lastLoginUsername'] = primary;
          data['jetski.onboarding.lastLoginIsGcpTos'] = 'false';
          data['ide-install-wizard-shown'] = true;
          fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf8');
          console.log(`\n✅ Onboarding pré-validé avec succès pour ${primary} dans ${storagePath}`);
        } catch (e) {
          console.error('\n❌ Échec pré-validation onboarding:', e.message);
        }
        promptUser();
        return;
      }

      if (choice === 'F') {
        try {
          const { randomizeAllDevices } = require(path.join(repoRoot, 'ag-doctor', 'dist', 'core', 'device-fingerprint.js'));
          const res = randomizeAllDevices();
          if (res.success) {
            console.log('\n✅ Empreinte matérielle renouvelée avec succès !');
            console.log(`   Nouveau Machine ID : ${res.profile.machineId.substring(0, 16)}...`);
            console.log(`   Fichiers mis à jour : ${res.updatedFiles.length}`);
          } else {
            console.warn('\n⚠️ Aucun fichier de télémétrie trouvé à renouveler.');
          }
        } catch (e) {
          console.error('\n❌ Échec renouvellement empreinte :', e.message);
        }
        promptUser();
        return;
      }

      if (choice === 'P') {
        console.log('\n═══════════════════════════════════════════════════════════════════════════════');
        console.log(' 📋 PROTOCOLE DE DÉBLOCAGE 4 ÉTAPES (VALIDATION_REQUIRED)');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log('1. Révocation des autorisations :');
        console.log('   Ouvrez https://myaccount.google.com/connections et supprimez Antigravity.');
        console.log('2. Validation de l\'âge / identité :');
        console.log('   Ouvrez https://myaccount.google.com/age-verification et validez le compte.');
        console.log('3. Reconnexion native Antigravity 2.0 (Bypass limite smartphone) :');
        console.log('   Ne scannez PAS de QR code sur un smartphone saturé de requêtes !');
        console.log('   Connectez-vous nativement sur PC via l\'IDE Antigravity 2.0 ou "ag-doctor auth fix".');
        console.log('4. Synchronisation Patch :');
        console.log('   Le compte est synchronisé automatiquement dans custom_models.json (100% quota).\n');
        promptUser();
        return;
      }

      if (choice === 'C') {
        console.log('\nOuverture de https://myaccount.google.com/connections ...');
        openBrowser('https://myaccount.google.com/connections');
        promptUser();
        return;
      }

      if (choice === 'V') {
        console.log('\nOuverture de https://myaccount.google.com/age-verification ...');
        openBrowser('https://myaccount.google.com/age-verification');
        promptUser();
        return;
      }

      if (choice === 'R') {
        console.log('\nRe-vérification du pool...');
        const recheck = await runProbe();
        const stillBlocked = recheck.results.filter(r => r.diagnosis.code === 'CHALLENGE_REQUIRED');
        console.log(`\nRésultat : ${recheck.healthyEmails.size} sains, ${stillBlocked.length} toujours en attente.`);
        promptUser();
        return;
      }

      if (choice === 'A') {
        const batch = actionableAccounts.slice(0, 3);
        console.log(`\nOuverture du navigateur pour ${batch.length} compte(s)...`);
        batch.forEach(acc => {
          console.log(` -> Ouverture : ${acc.email}`);
          openBrowser(getGoogleUnlockUrl(acc));
        });
        console.log('\nUne fois validé sur Google, tapez [R] pour re-tester.');
        promptUser();
        return;
      }

      const num = parseInt(choice, 10);
      if (!isNaN(num) && num >= 1 && num <= actionableAccounts.length) {
        const target = actionableAccounts[num - 1];
        console.log(`\n══════════════════════════════════════════════════════════════`);
        console.log(` Déblocage du compte : ${target.email}`);
        console.log(`══════════════════════════════════════════════════════════════`);
        console.log(`Étape 1 : Révocation des autorisations sur https://myaccount.google.com/connections`);
        console.log(`Étape 2 : Validation d'âge sur https://myaccount.google.com/age-verification`);
        console.log(`Étape 3 : Reconnexion native via Antigravity 2.0 sur PC (évite rate limit smartphone)`);
        console.log(`Étape 4 : Tapez [R] pour valider la synchronisation\n`);
        openBrowser('https://myaccount.google.com/connections');
        openBrowser('https://myaccount.google.com/age-verification');
        promptUser();
        return;
      }

      console.log('Choix non reconnu.');
      promptUser();
    });
  };

  promptUser();
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { getGoogleUnlockUrl };

