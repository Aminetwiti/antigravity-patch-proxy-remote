const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('src/proxy/translators/anthropic.ts', 'utf8');
const lines = content.split('\n');

// Find where Gemini/Anthropic types end and request logic begins
// Lines 1 to 105 are interfaces
let typeEndIdx = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('export function mapGeminiToAnthropic') || lines[i].startsWith('function mapGeminiToolsToAnthropic')) {
    typeEndIdx = i;
    break;
  }
}

console.log('typeEndIdx:', typeEndIdx);

const typeLines = lines.slice(0, typeEndIdx);
const reqLines = lines.slice(typeEndIdx, 315);
const resLines = lines.slice(315);

const anthDir = path.resolve('src/proxy/translators/providers/anthropic');
if (!fs.existsSync(anthDir)) fs.mkdirSync(anthDir, { recursive: true });

const typesContent = typeLines.join('\n') + '\n';

const reqImports = `import { detectModelCapabilitiesByName } from '../../../services/modelCapabilities';
import {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTool,
  GeminiContent,
  GeminiGenerateContentRequest,
  GeminiPart,
  GeminiTool,
} from './types';

`;
const reqContent = reqImports + reqLines.join('\n') + '\n';

const resImports = `import { detectModelCapabilitiesByName } from '../../../services/modelCapabilities';
import { ModelTranslator } from '../../types';
import {
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStreamChunk,
  AnthropicUsage,
  GeminiCandidate,
  GeminiGenerateContentResponse,
  GeminiPart,
} from './types';
import { mapGeminiToAnthropic } from './request';

`;
const resContent = resImports + resLines.join('\n') + '\n';

const indexContent = `export * from './types';
export * from './request';
export * from './response';
`;

fs.writeFileSync(path.join(anthDir, 'types.ts'), typesContent, 'utf8');
fs.writeFileSync(path.join(anthDir, 'request.ts'), reqContent, 'utf8');
fs.writeFileSync(path.join(anthDir, 'response.ts'), resContent, 'utf8');
fs.writeFileSync(path.join(anthDir, 'index.ts'), indexContent, 'utf8');

console.log('Anthropic refactored:');
['types.ts', 'request.ts', 'response.ts', 'index.ts'].forEach(f => {
  const p = path.join(anthDir, f);
  console.log(f, fs.readFileSync(p, 'utf8').split('\n').length);
});
