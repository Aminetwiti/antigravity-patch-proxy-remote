#!/usr/bin/env node
// scripts/diag/debug-model-names.cjs
const asar = require('@electron/asar');

const ASAR = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar';
const src = asar.extractFile(ASAR, 'dist\\proxy\\modelLoader.js').toString('utf8');

// Find the deterministicId generation
const lines = src.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('deterministicId') || lines[i].includes('MODEL_PLACEHOLDER_M')) {
    console.log(`L${i+1}: ${lines[i].trim()}`);
  }
}

console.log('\n=== Simulating with the test data ===');
const sample = {
  providers: [
    { id: 'provider-1784822009886-1', provider: 'custom', enabled: true, apiKey: 'k', apiUrl: 'u', encrypted: true, models: [{ id: 'kr/claude-sonnet-4.5', displayName: 'kr/claude-sonnet-4.5', enabled: true }] },
    { id: 'provider-1784822009887-2', provider: 'openai', enabled: true, apiKey: 'k', apiUrl: 'u', encrypted: true, models: [{ id: 'MiniMax-M2.7', displayName: 'MiniMax-M2.7', enabled: true }] },
  ],
};

for (const p of sample.providers) {
  for (const m of p.models) {
    const deterministicId = `models/MODEL_PLACEHOLDER_M${p.provider}_${m.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`  ${m.id.padEnd(25)} -> name: "${deterministicId}" (starts with models/: ${deterministicId.startsWith('models/')})`);
  }
}
