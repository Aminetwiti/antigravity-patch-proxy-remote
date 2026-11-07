const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('src/proxy/translators/openai.ts', 'utf8');
const lines = content.split('\n');

const typeLines = lines.slice(0, 140);
const reqLines = lines.slice(140, 312);
const resLines = lines.slice(312);

const openAiDir = path.resolve('src/proxy/translators/providers/openai');
if (!fs.existsSync(openAiDir)) fs.mkdirSync(openAiDir, { recursive: true });

const typesContent = typeLines.join('\n') + '\n';

const reqImports = `import {
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIRequestBody,
  OpenAITool,
  OpenAIToolCall,
  GeminiContent,
  GeminiPart,
  GeminiRequestBody,
  GeminiTool,
} from './types';
import { detectModelCapabilitiesByName } from '../../../services/modelCapabilities';
import { normalizeToolArgs, fixParamTypes } from '../../utils';

`;
const reqContent = reqImports + reqLines.join('\n') + '\n' + `export { mapGeminiToolsToOpenAI };\n`;

const resImports = `import {
  OpenAIChoice,
  OpenAIMessage,
  OpenAIResponse,
  OpenAIStreamChunk,
  OpenAIToolCall,
  OpenAIUsage,
  GeminiCandidate,
  GeminiGenerateContentResponse,
  GeminiPart,
  DSMLParsedResult,
} from './types';
import { mapGeminiToOpenAI } from './request';
import { ModelTranslator } from '../../types';
import { detectModelCapabilitiesByName } from '../../../services/modelCapabilities';
import { translateToolCallToNative } from '../../utils';

`;
// In resLines, remove the trailing 'export { mapGeminiToolsToOpenAI };' if present
const filteredResLines = resLines.filter(l => !l.includes('export { mapGeminiToolsToOpenAI };'));
const resContent = resImports + filteredResLines.join('\n') + '\n';

const indexContent = `export * from './types';
export * from './request';
export * from './response';
`;

fs.writeFileSync(path.join(openAiDir, 'types.ts'), typesContent, 'utf8');
fs.writeFileSync(path.join(openAiDir, 'request.ts'), reqContent, 'utf8');
fs.writeFileSync(path.join(openAiDir, 'response.ts'), resContent, 'utf8');
fs.writeFileSync(path.join(openAiDir, 'index.ts'), indexContent, 'utf8');

console.log('OpenAI refactored:');
['types.ts', 'request.ts', 'response.ts', 'index.ts'].forEach(f => {
  const p = path.join(openAiDir, f);
  console.log(f, fs.readFileSync(p, 'utf8').split('\n').length);
});
