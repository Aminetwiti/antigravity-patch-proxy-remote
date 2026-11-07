const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. Dirs
const transDir = path.resolve('src/proxy/translators');
const anthDir = path.join(transDir, 'providers', 'anthropic');
const openAiDir = path.join(transDir, 'providers', 'openai');
const gemDir = path.join(transDir, 'providers', 'gemini');
const openRDir = path.join(transDir, 'providers', 'openrouter');
const utilsDir = path.join(transDir, 'utils');

[anthDir, openAiDir, gemDir, openRDir, utilsDir].forEach(ensureDir);

console.log('Translators directories ensured.');
