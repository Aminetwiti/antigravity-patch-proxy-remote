const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Google
const gDir = path.resolve('src/proxy/translators/providers/google');
ensureDir(gDir);
let gContent = fs.readFileSync('src/proxy/translators/google.ts', 'utf8');
gContent = gContent.replace("from '../../services/googleAuth'", "from '../../../../services/googleAuth'");
gContent = gContent.replace("from './types'", "from '../../types'");
gContent = gContent.replace("from './utils'", "from '../../utils'");

fs.writeFileSync(path.join(gDir, 'google.ts'), gContent, 'utf8');
fs.writeFileSync(path.join(gDir, 'index.ts'), `export * from './google';\n`, 'utf8');

// Ollama
const oDir = path.resolve('src/proxy/translators/providers/ollama');
ensureDir(oDir);
let oContent = fs.readFileSync('src/proxy/translators/ollama.ts', 'utf8');
oContent = oContent.replace("from './openai'", "from '../openai'");
oContent = oContent.replace("from './types'", "from '../../types'");
oContent = oContent.replace("from './utils'", "from '../../utils'");

fs.writeFileSync(path.join(oDir, 'ollama.ts'), oContent, 'utf8');
fs.writeFileSync(path.join(oDir, 'index.ts'), `export * from './ollama';\n`, 'utf8');

// Providers index.ts
fs.writeFileSync(path.resolve('src/proxy/translators/providers/index.ts'), `export * from './anthropic';
export * from './openai';
export * from './google';
export * from './ollama';
`, 'utf8');

console.log('Google and Ollama setup complete.');
