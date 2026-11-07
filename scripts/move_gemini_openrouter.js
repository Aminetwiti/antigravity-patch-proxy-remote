const fs = require('fs');
const path = require('path');

// Gemini
const gemDir = path.resolve('src/proxy/translators/providers/gemini');
let gemContent = fs.readFileSync('src/proxy/translators/gemini.ts', 'utf8');
// Fix relative imports: from '../services' to '../../../services', etc.
gemContent = gemContent.replace(/from '\.\.\/services\//g, "from '../../../services/");
gemContent = gemContent.replace(/from '\.\/types'/g, "from '../../types'");
gemContent = gemContent.replace(/from '\.\/utils'/g, "from '../../utils'");

fs.writeFileSync(path.join(gemDir, 'gemini.ts'), gemContent, 'utf8');
fs.writeFileSync(path.join(gemDir, 'index.ts'), `export * from './gemini';\n`, 'utf8');

// OpenRouter
const openRDir = path.resolve('src/proxy/translators/providers/openrouter');
let openRContent = fs.readFileSync('src/proxy/translators/openrouter.ts', 'utf8');
openRContent = openRContent.replace(/from '\.\/openai'/g, "from '../openai'");
openRContent = openRContent.replace(/from '\.\/types'/g, "from '../../types'");

fs.writeFileSync(path.join(openRDir, 'openrouter.ts'), openRContent, 'utf8');
fs.writeFileSync(path.join(openRDir, 'index.ts'), `export * from './openrouter';\n`, 'utf8');

console.log('Gemini and OpenRouter moved.');
