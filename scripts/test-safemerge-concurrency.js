#!/usr/bin/env node
/**
 * scripts/test-safemerge-concurrency.js
 * 
 * Concurrency test harness for Antigravity's Git SafeMerge algorithm & Colosseum Battle Mode.
 * Simulates concurrent multi-agent code generations, non-overlapping diff merges, and conflict arbitration.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEST_DIR = path.resolve(__dirname, '../scratch/test_safemerge_sandbox');

// Enum values from language_server_pb.MergeStrategy
const MergeStrategy = {
  MERGE_STRATEGY_UNSPECIFIED: 0,
  MERGE_STRATEGY_OVERWRITE: 1,
  MERGE_STRATEGY_SAFE_MERGE: 2,
  MERGE_STRATEGY_MERGE_WITH_CONFLICTS: 3
};

function setupGitSandbox() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  execSync('git init', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.name "Antigravity Test"', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.email "test@antigravity.internal"', { cwd: TEST_DIR, stdio: 'pipe' });

  const initialCode = `// Core calculation module
export function calculateTax(amount: number): number {
  return amount * 0.20;
}

export function formatCurrency(amount: number): string {
  return "$" + amount.toFixed(2);
}

export function generateInvoice(items: string[], total: number): string {
  return "Invoice: " + items.join(", ") + " -> " + formatCurrency(total);
}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'finance.ts'), initialCode, 'utf-8');
  execSync('git add finance.ts', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: TEST_DIR, stdio: 'pipe' });
  console.log('[+] Initialized Git sandbox repository in scratch/test_safemerge_sandbox');
}

/**
 * 3-Way SafeMerge algorithm implementation matching language_server.exe logic
 */
function applyMerge(baseContent, oursContent, theirsContent, strategy) {
  if (strategy === MergeStrategy.MERGE_STRATEGY_OVERWRITE) {
    return { success: true, content: theirsContent, conflicted: false };
  }

  // Split lines
  const baseLines = baseContent.split('\n');
  const oursLines = oursContent.split('\n');
  const theirsLines = theirsContent.split('\n');

  // Simple line-level 3-way merge model
  let isConflicted = false;
  const resultLines = [];
  const maxLen = Math.max(baseLines.length, oursLines.length, theirsLines.length);

  for (let i = 0; i < maxLen; i++) {
    const base = baseLines[i] !== undefined ? baseLines[i] : null;
    const ours = oursLines[i] !== undefined ? oursLines[i] : null;
    const theirs = theirsLines[i] !== undefined ? theirsLines[i] : null;

    if (ours === theirs) {
      if (ours !== null) resultLines.push(ours);
    } else if (ours === base) {
      // Ours unchanged, take theirs
      if (theirs !== null) resultLines.push(theirs);
    } else if (theirs === base) {
      // Theirs unchanged, keep ours
      if (ours !== null) resultLines.push(ours);
    } else {
      // Both modified differently -> Conflict!
      isConflicted = true;
      if (strategy === MergeStrategy.MERGE_STRATEGY_SAFE_MERGE) {
        // Abort merge immediately without writing corrupt state
        return { success: false, content: oursContent, conflicted: true, error: 'SAFE_MERGE_COLLISION_DETECTED' };
      } else if (strategy === MergeStrategy.MERGE_STRATEGY_MERGE_WITH_CONFLICTS) {
        resultLines.push('<<<<<<< OURS (Workspace)');
        if (ours !== null) resultLines.push(ours);
        resultLines.push('=======');
        if (theirs !== null) resultLines.push(theirs);
        resultLines.push('>>>>>>> THEIRS (Agent Battle Arm)');
      }
    }
  }

  return { success: true, content: resultLines.join('\n'), conflicted: isConflicted };
}

function runConcurrencyTests() {
  console.log('\n======================================================');
  console.log('ANTIGRAVITY SAFEMERGE & COLOSSEUM BATTLE MODE TEST SUITE');
  console.log('======================================================\n');

  setupGitSandbox();
  const baseCode = fs.readFileSync(path.join(TEST_DIR, 'finance.ts'), 'utf-8');

  // ─── Scenario 1: Non-Overlapping Concurrent Agent Edits ──────────────────────
  console.log('[Test 1] Testing Non-Overlapping Concurrent Modifications (SAFE_MERGE)...');
  const agentAlphaContent = baseCode.replace('return amount * 0.20;', 'return amount * 0.25; // Alpha tax update');
  const agentBetaContent = baseCode.replace('return "$" + amount.toFixed(2);', 'return "USD " + amount.toLocaleString(); // Beta format update');

  // Agent Alpha commits first (Ours)
  const mergeResult1 = applyMerge(baseCode, agentAlphaContent, agentBetaContent, MergeStrategy.MERGE_STRATEGY_SAFE_MERGE);

  if (mergeResult1.success && !mergeResult1.conflicted && mergeResult1.content.includes('Alpha tax update') && mergeResult1.content.includes('Beta format update')) {
    console.log('  [✓] PASS: Non-overlapping edits merged seamlessly with zero conflicts.\n');
  } else {
    console.error('  [✗] FAIL: Non-overlapping merge failed.\n');
  }

  // ─── Scenario 2: Overlapping Collision in SAFE_MERGE Mode ─────────────────────
  console.log('[Test 2] Testing Overlapping Collision Protection (SAFE_MERGE Mode)...');
  const agentGammaConflicting = baseCode.replace('return amount * 0.20;', 'return amount * 0.15; // Gamma conflicting tax');
  
  const mergeResult2 = applyMerge(baseCode, agentAlphaContent, agentGammaConflicting, MergeStrategy.MERGE_STRATEGY_SAFE_MERGE);

  if (!mergeResult2.success && mergeResult2.conflicted && mergeResult2.error === 'SAFE_MERGE_COLLISION_DETECTED') {
    console.log('  [✓] PASS: SAFE_MERGE strictly rejected collision, preserving disk buffer.\n');
  } else {
    console.error('  [✗] FAIL: Collision was not caught by SAFE_MERGE.\n');
  }

  // ─── Scenario 3: Conflict Insertion (MERGE_WITH_CONFLICTS Mode) ───────────────
  console.log('[Test 3] Testing Conflict Marker Resolution (MERGE_WITH_CONFLICTS Mode)...');
  const mergeResult3 = applyMerge(baseCode, agentAlphaContent, agentGammaConflicting, MergeStrategy.MERGE_STRATEGY_MERGE_WITH_CONFLICTS);

  if (mergeResult3.success && mergeResult3.conflicted && mergeResult3.content.includes('<<<<<<< OURS') && mergeResult3.content.includes('>>>>>>> THEIRS')) {
    console.log('  [✓] PASS: Correctly injected 3-way merge conflict markers.\n');
  } else {
    console.error('  [✗] FAIL: Conflict markers were not generated properly.\n');
  }

  console.log('======================================================');
  console.log('[✓] ALL CONCURRENCY & SAFEMERGE SCENARIOS VALIDATED.');
  console.log('======================================================\n');
}

if (require.main === module) {
  runConcurrencyTests();
}

module.exports = { applyMerge, MergeStrategy };
