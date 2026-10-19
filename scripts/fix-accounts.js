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

function getGoogleUnlockUrl(email) {
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
    console.log('  [Numéro]  Ouvrir le navigateur pour débloquer ce compte spécifique (ex: 1)');
    console.log('  [A]       Ouvrir les 3 premiers comptes bloqués dans le navigateur');
    console.log('  [R]       Re-tester tous les comptes pour vérifier les déblocages');
    console.log('  [Q]       Quitter\n');

    rl.question('Votre choix > ', async (answer) => {
      const choice = answer.trim().toUpperCase();

      if (choice === 'Q') {
        rl.close();
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
          openBrowser(getGoogleUnlockUrl(acc.email));
        });
        console.log('\nUne fois validé sur Google, tapez [R] pour re-tester.');
        promptUser();
        return;
      }

      const num = parseInt(choice, 10);
      if (!isNaN(num) && num >= 1 && num <= actionableAccounts.length) {
        const target = actionableAccounts[num - 1];
        console.log(`\nOuverture de la session Google pour : ${target.email}`);
        openBrowser(getGoogleUnlockUrl(target.email));
        console.log('Validez l\'invite Google (SMS, confirmation de sécurité ou Captcha), puis tapez [R].');
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

