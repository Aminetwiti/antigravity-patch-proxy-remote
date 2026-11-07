const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. UTILS
const utilsTypesDir = path.resolve('src/proxy/translators/utils/types');
const utilsToolsDir = path.resolve('src/proxy/translators/utils/tools');
ensureDir(utilsTypesDir);
ensureDir(utilsToolsDir);

const utilsContent = fs.readFileSync('src/proxy/translators/utils.ts', 'utf8');
const utilsLines = utilsContent.split('\n');

// Types: 1 to 57
const uTypes = utilsLines.slice(0, 57).join('\n') + '\n';
fs.writeFileSync(path.join(utilsTypesDir, 'types.ts'), uTypes, 'utf8');

// Mappings: 58 to 303
const uMappingsImports = `import { ToolCallArgs } from '../types/types';\n\n`;
const uMappings = uMappingsImports + utilsLines.slice(57, 303).join('\n') + '\n';
fs.writeFileSync(path.join(utilsTypesDir, 'mappings.ts'), uMappings, 'utf8');

// Types index.ts
fs.writeFileSync(path.join(utilsTypesDir, 'index.ts'), `export * from './types';\nexport * from './mappings';\n`, 'utf8');

// Normalizer: 304 to 488
const uNormImports = `import { TOOL_MAPPINGS } from '../types/mappings';\nimport { ToolCallArgs } from '../types/types';\n\n`;
const uNorm = uNormImports + utilsLines.slice(303, 488).join('\n') + '\n';
fs.writeFileSync(path.join(utilsToolsDir, 'normalizer.ts'), uNorm, 'utf8');

// NativeTranslator: 489 to 701
const uNatImports = `import * as path from 'path';\nimport { ToolCallArgs, TranslatedCallInfo, TranslatedToolCall, MatchResult, DirectoryItem, FileListResponse } from '../types/types';\nimport { normalizeToolArgs } from './normalizer';\n\n`;
const uNat = uNatImports + utilsLines.slice(488).join('\n') + '\n';
fs.writeFileSync(path.join(utilsToolsDir, 'nativeTranslator.ts'), uNat, 'utf8');

// Tools index.ts
fs.writeFileSync(path.join(utilsToolsDir, 'index.ts'), `export * from './normalizer';\nexport * from './nativeTranslator';\n`, 'utf8');

// Utils index.ts
fs.writeFileSync(path.resolve('src/proxy/translators/utils/index.ts'), `export * from './types';\nexport * from './tools';\n`, 'utf8');

console.log('Utils split complete. Files verified:');
[
  path.join(utilsTypesDir, 'types.ts'),
  path.join(utilsTypesDir, 'mappings.ts'),
  path.join(utilsTypesDir, 'index.ts'),
  path.join(utilsToolsDir, 'normalizer.ts'),
  path.join(utilsToolsDir, 'nativeTranslator.ts'),
  path.join(utilsToolsDir, 'index.ts'),
  path.resolve('src/proxy/translators/utils/index.ts'),
].forEach(f => console.log(f, fs.readFileSync(f, 'utf8').split('\n').length + ' lines'));
