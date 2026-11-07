import log from 'electron-log';

export function sanitizeCloudCodeGenerationConfig(
  reqObj: Record<string, unknown>,
  targetModel: string,
): void {
  if (!reqObj || typeof reqObj !== 'object') return;
  sanitizeCloudCodeTools(reqObj);
  const genCfg = (reqObj.generationConfig || reqObj.generation_config) as Record<string, any> | undefined;
  if (genCfg && typeof genCfg === 'object') {
    const tc = genCfg.thinkingConfig || genCfg.thinking_config;
    if (tc && typeof tc === 'object') {
      const hasBudget = tc.thinkingBudget !== undefined && tc.thinkingBudget !== null;
      const budget = hasBudget ? (typeof tc.thinkingBudget === 'number' ? tc.thinkingBudget : parseInt(tc.thinkingBudget, 10)) : NaN;
      const hasLevel = Boolean(tc.thinkingLevel);

      if (!hasLevel && (isNaN(budget) || budget <= 0)) {
        delete genCfg.thinkingConfig;
        delete genCfg.thinking_config;
      } else if (targetModel.includes('gemini-3')) {
        // Gemini 3 / 3.8 strictly rejects payloads if both thinkingBudget and thinkingLevel are present (HTTP 400)
        delete tc.thinkingBudget;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingBudget;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingBudget;
        if (!tc.thinkingLevel) {
          if (budget >= 16000) tc.thinkingLevel = 'high';
          else if (budget >= 4000) tc.thinkingLevel = 'medium';
          else tc.thinkingLevel = 'low';
        }
        // Flash models only support low and medium thinking levels on Google Cloud Code PA
        // Requesting 'high' on Flash triggers upstream HTTP 429 RESOURCE_EXHAUSTED
        if (targetModel.includes('flash') && tc.thinkingLevel === 'high') {
          tc.thinkingLevel = 'medium';
        }
      } else if (targetModel.includes('gemini-2.5')) {
        // Gemini 2.5 uses thinkingBudget; remove thinkingLevel if present to avoid conflicts
        delete tc.thinkingLevel;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingLevel;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingLevel;
      } else if (targetModel.includes('claude')) {
        delete tc.thinkingLevel;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingLevel;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingLevel;
        if (budget < 1024) {
          tc.thinkingBudget = 1024;
        }
        if (typeof genCfg.maxOutputTokens === 'number' && genCfg.maxOutputTokens <= tc.thinkingBudget) {
          genCfg.maxOutputTokens = tc.thinkingBudget + 2048;
        }
        delete genCfg.temperature;
        delete genCfg.topP;
        delete genCfg.topK;
      }
    }
  }

  if (Array.isArray(reqObj.contents)) {
    // Strip bare thinking blocks with no text across all models (Vertex AI / Cloud Code rejects them with 400 INVALID_ARGUMENT)
    for (const item of reqObj.contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
      if (Array.isArray(item.parts)) {
        item.parts = item.parts.filter((p: any) => {
          if (!p || typeof p !== 'object') return false;
          if (p.functionCall || p.functionResponse) return true;
          if ((p.type === 'thinking' || p.thought === true || p.thought === 'true') && !p.text) {
            return false;
          }
          return true;
        });
      }
    }
    // For Claude models on Google Cloud Code / Vertex AI:
    // Anthropic validates that every thinking block's HMAC signature matches its exact thinking text.
    // When Antigravity IDE performs context summarization or account pooling, historical thinking blocks
    // have modified text or mismatched account signatures, causing HTTP 400 "Invalid signature in thinking block".
    // Stripping historical thinking blocks avoids this while allowing Claude to think on the current turn.
    let isClaude = targetModel.toLowerCase().includes('claude');
    if (!isClaude && !targetModel.toLowerCase().includes('gemini') && !targetModel.toLowerCase().includes('gpt')) {
      isClaude = reqObj.contents.some((c: any) => Array.isArray(c?.parts) && c.parts.some((p: any) => p?.type === 'thinking' || typeof p?.signature === 'string' || typeof p?.thoughtSignature === 'string' || typeof p?.thought_signature === 'string' || typeof p?.thinking === 'string'));
    }

    if (isClaude) {
      for (const item of reqObj.contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
        if (Array.isArray(item.parts)) {
          let removedThinkingBlocks = 0;
          item.parts = item.parts.filter((p: any) => {
            if (!p || typeof p !== 'object') return false;
            // Function calls and responses must NEVER be filtered out
            if (p.functionCall || p.functionResponse) return true;
            // Pure thinking blocks
            if (p.type === 'thinking' || p.thought === true || p.thought === 'true' || typeof p.thinking === 'string') {
              removedThinkingBlocks++;
              return false;
            }
            // Pure signature block without text
            if ((typeof p.signature === 'string' || typeof p.thoughtSignature === 'string' || typeof p.thought_signature === 'string') && !p.text) {
              removedThinkingBlocks++;
              return false;
            }
            return true;
          });

          // Ensure turn is never left completely empty
          if (item.parts.length === 0) {
            item.parts = [{ text: '.' }];
          }

          // Strip any residual thought signatures from remaining parts
          for (const p of item.parts) {
            if (p.thought_signature) delete p.thought_signature;
            if (p.thoughtSignature) delete p.thoughtSignature;
            if (p.signature) delete p.signature;
            if (p.thought) delete p.thought;
          }

          if (removedThinkingBlocks > 0) {
            log.debug(`[Proxy] Sanitized ${removedThinkingBlocks} historical thinking block(s) for Claude request to avoid invalid signature error`);
          }
        }
      }
    }

    normalizeConversationTurns(reqObj.contents);
  }
}

/**
 * Strips synthetic proxy warning and error cards from conversation history.
 * When the proxy aborts a request (e.g. on timeout), it sends a synthetic model turn
 * with a warning card. On subsequent retries, this card would pollute the history
 * and confuse Google's upstream models.
 */
export function stripSyntheticErrorTurns(contents: any[]): boolean {
  if (!Array.isArray(contents)) return false;
  let modified = false;

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    if (item?.role === 'model' && Array.isArray(item.parts)) {
      const originalLen = item.parts.length;
      item.parts = item.parts.filter((p: any) => {
        if (!p || typeof p !== 'object') return true;
        const text = p.text;
        if (typeof text !== 'string') return true;
        const isSyntheticError =
          text.includes('Model unavailable:') ||
          text.includes('coupure amont') ||
          text.includes('Suggested Actions:') ||
          text.includes('Le service Google Cloud Code a expiré') ||
          text.includes('All Google Cloud Code accounts are currently unavailable') ||
          text.includes('[Proxy] La connexion au modèle a été interrompue') ||
          text.includes('ag-system-error-marker') ||
          text.includes('comptes vérifiés') ||
          text.includes('ont été testés automatiquement en arrière-plan') ||
          text.includes('Quota exhausted — 5h cooldown') ||
          text.includes('[Previous step encountered a network timeout') ||
          (text.includes('rate_limit') && text.includes('configurés')) ||
          (text.includes('WARNING') && text.includes('Model unavailable'));
        return !isSyntheticError;
      });

      if (item.parts.length < originalLen) {
        modified = true;
      }

      if (item.parts.length === 0) {
        contents.splice(i, 1);
        i--;
        modified = true;
      }
    } else if (item?.role === 'user' && Array.isArray(item.parts)) {
      const originalLen = item.parts.length;
      item.parts = item.parts.filter((p: any) => {
        if (!p || typeof p !== 'object') return true;
        const text = p.text;
        if (typeof text !== 'string') return true;
        const isSyntheticUserNoise =
          text.includes('All your subagents and background tasks have been stopped due to server restart') ||
          (text.includes('API error') && text.includes('wsarecv: An existing connection was forcibly closed')) ||
          (text.includes('API error') && text.includes('request failed: Post')) ||
          text.includes('There was a network issue connecting to the server, please try again.');
        return !isSyntheticUserNoise;
      });

      if (item.parts.length < originalLen) {
        modified = true;
      }

      if (item.parts.length === 0) {
        contents.splice(i, 1);
        i--;
        modified = true;
      }
    }
  }

  return modified;
}

/**
 * Normalizes multi-turn conversation history for Google Cloud Code / Gemini:
 * 1. Purges previous synthetic proxy error and timeout warning cards.
 * 2. Ensures turns containing functionResponse have role: 'user' (Gemini requirement).
 * 3. Prunes only truly empty dummy turns from the end of the history.
 * 4. Merges consecutive turns with the same role to enforce strict turn alternation.
 * 5. If history ends on a model turn, closes it with a continuation user turn instead of popping it,
 *    preserving the model's tool calls and previous work to prevent infinite loops.
 * 6. Ensures history has at least one turn.
 */
export function normalizeConversationTurns(contents: any[]): boolean {
  if (!Array.isArray(contents) || contents.length === 0) return false;
  let modified = false;

  if (stripSyntheticErrorTurns(contents)) modified = true;

  // 1. Ensure turns containing functionResponse have role: 'user' (Gemini requirement)
  for (const item of contents) {
    if (item && Array.isArray(item.parts)) {
      const hasFnResponse = item.parts.some((p: any) => p && p.functionResponse);
      if (hasFnResponse && item.role !== 'user') {
        item.role = 'user';
        modified = true;
      }
    }
  }

  // 1b. Safety: Convert orphaned functionResponse parts to text if not preceded by a model functionCall
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    if (item && Array.isArray(item.parts)) {
      const prevTurn = i > 0 ? contents[i - 1] : null;
      const prevHasFunctionCall = prevTurn?.role === 'model' && Array.isArray(prevTurn.parts) &&
        prevTurn.parts.some((p: any) => p && p.functionCall);
      for (let j = 0; j < item.parts.length; j++) {
        const p = item.parts[j];
        if (p && p.functionResponse && !prevHasFunctionCall) {
          const respContent = p.functionResponse.response;
          const textVal = typeof respContent === 'string'
            ? respContent
            : (respContent?.output || JSON.stringify(respContent || ''));
          item.parts[j] = { text: `[Tool Output (${p.functionResponse.name || 'tool'})]: ${textVal}` };
          modified = true;
        }
      }
    }
  }

  // 2. Pop truly empty dummy turns from the end
  while (contents.length > 0) {
    const last = contents[contents.length - 1];
    const isEmpty =
      !last?.parts ||
      !Array.isArray(last.parts) ||
      last.parts.length === 0 ||
      last.parts.every(
        (p: any) =>
          (!p?.text || !p.text.trim() || p.text === '.') &&
          !p?.functionCall &&
          !p?.functionResponse &&
          !p?.thinking
      );
    if (isEmpty) {
      contents.pop();
      modified = true;
    } else {
      break;
    }
  }

  // 3. Merge consecutive turns with the same role to ensure strict alternation (user <-> model)
  for (let i = 1; i < contents.length; i++) {
    const prev = contents[i - 1];
    const curr = contents[i];
    if (prev?.role && curr?.role && prev.role === curr.role) {
      if (Array.isArray(prev.parts) && Array.isArray(curr.parts)) {
        for (const cp of curr.parts) {
          const cpTrim = typeof cp?.text === 'string' ? cp.text.trim() : null;
          const isRedundantContinue = cpTrim && (cpTrim === 'Continue' || cpTrim === 'Continue.' || cpTrim.includes('<USER_REQUEST>\nContinue\n</USER_REQUEST>')) &&
            prev.parts.some((pp: any) => typeof pp?.text === 'string' && (pp.text.trim() === 'Continue' || pp.text.trim() === 'Continue.' || pp.text.includes('<USER_REQUEST>\nContinue\n</USER_REQUEST>')));
          if (!isRedundantContinue) {
            prev.parts.push(cp);
          }
        }
      }
      contents.splice(i, 1);
      i--;
      modified = true;
    }
  }

  // 4. If history still ends on a model turn, close it with a continuation user turn instead of popping,
  // preventing history erasure and infinite agent loops.
  if (contents.length > 0 && contents[contents.length - 1]?.role === 'model') {
    contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    modified = true;
  }

  // 5. If contents is completely empty, ensure at least one user turn exists
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    modified = true;
  }

  return modified;
}

/**
 * Recursively cleans and flattens JSON schema in tool definitions so Google Cloud Code /
 * Code Assist's strict schema validator doesn't reject them with HTTP 400 Bad Request.
 * - Flattens `allOf`
 * - Simplifies `anyOf` / `oneOf`
 * - Normalizes `type: ["string", "null"]` to `type: "string"` with `(nullable)` hint
 * - Removes unsupported `nullable: true`
 * - Strips circular references
 */
export function cleanToolParametersJsonSchema(schema: any, visited = new Set<any>()): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (visited.has(schema)) {
    return { type: 'object', description: 'circular reference' };
  }
  visited.add(schema);

  if (Array.isArray(schema)) {
    return schema.map((item) => cleanToolParametersJsonSchema(item, visited));
  }

  let result: Record<string, any> = { ...schema };

  // 1. Flatten allOf
  if (Array.isArray(result.allOf)) {
    const mergedProps: Record<string, any> = {};
    const mergedRequired: string[] = [];
    for (const sub of result.allOf) {
      const cleaned = cleanToolParametersJsonSchema(sub, visited);
      if (cleaned && typeof cleaned === 'object') {
        if (cleaned.properties && typeof cleaned.properties === 'object') {
          Object.assign(mergedProps, cleaned.properties);
        }
        if (Array.isArray(cleaned.required)) {
          mergedRequired.push(...cleaned.required);
        }
      }
    }
    delete result.allOf;
    if (Object.keys(mergedProps).length > 0) {
      result.properties = { ...mergedProps, ...(result.properties || {}) };
    }
    if (mergedRequired.length > 0) {
      result.required = Array.from(new Set([...mergedRequired, ...(Array.isArray(result.required) ? result.required : [])]));
    }
  }

  // 2. Simplify anyOf / oneOf
  const unionKey = Array.isArray(result.anyOf) ? 'anyOf' : Array.isArray(result.oneOf) ? 'oneOf' : null;
  if (unionKey) {
    const list: any[] = result[unionKey];
    delete result[unionKey];
    // Find first non-null variant
    const nonNull = list.find((item) => item && (item.type !== 'null' && item.type !== null));
    if (nonNull && typeof nonNull === 'object') {
      const cleanedVariant = cleanToolParametersJsonSchema(nonNull, visited);
      result = { ...cleanedVariant, ...result };
    }
    const hasNull = list.some((item) => item?.type === 'null' || item === null);
    if (hasNull && result.description) {
      result.description = `${result.description} (nullable)`;
    }
  }

  // 3. Normalize array type e.g. ["string", "null"]
  if (Array.isArray(result.type)) {
    const nonNullType = result.type.find((t: any) => typeof t === 'string' && t.toLowerCase() !== 'null') || 'string';
    const isNullable = result.type.some((t: any) => typeof t === 'string' && t.toLowerCase() === 'null');
    result.type = nonNullType;
    if (isNullable) {
      result.description = result.description ? `${result.description} (nullable)` : '(nullable)';
    }
  }

  // 4. Remove unsupported nullable: true flag (Code Assist rejects this parameter)
  if (result.nullable === true) {
    delete result.nullable;
    result.description = result.description ? `${result.description} (nullable)` : '(nullable)';
  }

  // 5. Clean nested properties
  if (result.properties && typeof result.properties === 'object') {
    const cleanedProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(result.properties)) {
      cleanedProps[k] = cleanToolParametersJsonSchema(v, visited);
    }
    result.properties = cleanedProps;
  }

  // 6. Clean nested items
  if (result.items && typeof result.items === 'object') {
    result.items = cleanToolParametersJsonSchema(result.items, visited);
  }

  return result;
}

export function sanitizeCloudCodeTools(reqObj: Record<string, unknown>): void {
  if (!reqObj || typeof reqObj !== 'object') return;
  const tools = reqObj.tools;
  if (!Array.isArray(tools)) return;

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const decls = (tool as any).functionDeclarations;
    if (Array.isArray(decls)) {
      for (const decl of decls) {
        if (!decl || typeof decl !== 'object') continue;
        if (decl.parameters) {
          decl.parameters = cleanToolParametersJsonSchema(decl.parameters);
        }
        if (decl.parametersJsonSchema) {
          decl.parametersJsonSchema = cleanToolParametersJsonSchema(decl.parametersJsonSchema);
        }
      }
    }
  }
}

export const SYNTHETIC_TOOL_NAME = 'emit_answer';

export const SYNTHETIC_TOOL_DECLARATION = {
  name: SYNTHETIC_TOOL_NAME,
  description:
    'You MUST call this tool exactly once to output your final user-visible answer. ' +
    'Put the complete answer in the \'content\' argument. ' +
    'Do NOT output any text outside this tool call.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The complete final answer to output to the user.',
      },
    },
    required: ['content'],
  },
};

export const ANTI_TRUNCATION_INSTRUCTION =
  'Strict execution rule: You MUST call `emit_answer` to return your final answer in `content`. Do not output raw text outside this tool call.';

/**
 * Injects synthetic `emit_answer` tool and instructions into Cloud Code payload
 * to protect the output from upstream safety truncation filters.
 */
export function applyAntiTruncation(reqObj: Record<string, unknown>): boolean {
  if (!reqObj || typeof reqObj !== 'object') return false;

  // 1. Inject tool
  let tools = Array.isArray(reqObj.tools) ? (reqObj.tools as any[]) : [];
  const alreadyInjected = tools.some(
    (t) =>
      Array.isArray(t?.functionDeclarations) &&
      t.functionDeclarations.some((decl: any) => decl?.name === SYNTHETIC_TOOL_NAME),
  );
  if (!alreadyInjected) {
    tools.push({ functionDeclarations: [SYNTHETIC_TOOL_DECLARATION] });
    reqObj.tools = tools;
  }

  // 2. Ensure function calling mode is AUTO
  const toolConfig = (reqObj.toolConfig && typeof reqObj.toolConfig === 'object'
    ? reqObj.toolConfig
    : {}) as Record<string, any>;
  const funcConfig = (toolConfig.functionCallingConfig && typeof toolConfig.functionCallingConfig === 'object'
    ? toolConfig.functionCallingConfig
    : {}) as Record<string, any>;
  if (funcConfig.mode === 'NONE' || !funcConfig.mode) {
    funcConfig.mode = 'AUTO';
  }
  toolConfig.functionCallingConfig = funcConfig;
  reqObj.toolConfig = toolConfig;

  // 3. Inject system instruction
  const sysInst = (reqObj.systemInstruction && typeof reqObj.systemInstruction === 'object'
    ? reqObj.systemInstruction
    : {}) as Record<string, any>;
  const parts = Array.isArray(sysInst.parts) ? (sysInst.parts as any[]) : [];
  const hasInstruction = parts.some((p: any) => typeof p?.text === 'string' && p.text.includes(SYNTHETIC_TOOL_NAME));
  if (!hasInstruction) {
    parts.push({ text: ANTI_TRUNCATION_INSTRUCTION });
    sysInst.parts = parts;
    reqObj.systemInstruction = sysInst;
  }

  return true;
}

/**
 * Extracts synthetic tool response (`emit_answer`) back to standard text content if present.
 */
export function extractSyntheticToolContent(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const target = data.response ? data.response : data;
  const candidates = Array.isArray(target.candidates) ? target.candidates : [];
  for (const cand of candidates) {
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
    for (const p of parts) {
      if (p?.functionCall?.name === SYNTHETIC_TOOL_NAME) {
        const args = p.functionCall.args;
        if (args && typeof args.content === 'string') {
          return args.content;
        }
      }
    }
  }
  return null;
}



