const fs = require('fs');

// Remove old files
['anthropic.ts', 'google.ts', 'ollama.ts', 'openai.ts', 'utils.ts'].forEach(f => {
  const p = 'src/proxy/translators/' + f;
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

// Update registry.ts
let reg = fs.readFileSync('src/proxy/registry.ts', 'utf8');
reg = reg.replace("import * as anthropicTranslator from './translators/anthropic';", "import * as anthropicTranslator from './translators/providers/anthropic';");
reg = reg.replace("import * as googleTranslator from './translators/google';", "import * as googleTranslator from './translators/providers/google';");
reg = reg.replace("import * as ollamaTranslator from './translators/ollama';", "import * as ollamaTranslator from './translators/providers/ollama';");
reg = reg.replace("import * as openaiTranslator from './translators/openai';", "import * as openaiTranslator from './translators/providers/openai';");
fs.writeFileSync('src/proxy/registry.ts', reg, 'utf8');

// Update tests
const updates = [
  ['src/__tests__/aiStudioProductionEndToEnd.test.ts', "from '../proxy/translators/google'", "from '../proxy/translators/providers/google'"],
  ['src/__tests__/anthropic.test.ts', "from '../proxy/translators/anthropic'", "from '../proxy/translators/providers/anthropic'"],
  ['src/__tests__/openai.test.ts', "from '../proxy/translators/openai'", "from '../proxy/translators/providers/openai'"],
  ['src/__tests__/realIntegrationWorkflows.test.ts', "from '../proxy/translators/anthropic'", "from '../proxy/translators/providers/anthropic'"],
  ['src/__tests__/realIntegrationWorkflows.test.ts', "from '../proxy/translators/openai'", "from '../proxy/translators/providers/openai'"]
];

updates.forEach(([file, target, rep]) => {
  let c = fs.readFileSync(file, 'utf8');
  c = c.replace(target, rep);
  fs.writeFileSync(file, c, 'utf8');
});

console.log('Updated imports and removed old files.');
