/**
 * Anthropic provider translator.
 * Handles Gemini ↔ Anthropic request/response mapping and streaming SSE events.
 */
import * as path from 'path';

import log from 'electron-log';
import {
  fixParamTypes,
  translateToolCallToNative,
  formatTranslatedResponse,
  normalizeToolArgs,
  ToolCallArgs,
} from './utils';
import {
  modelToolCallIds,
  activeStreamContexts,
  translatedToolCalls,
  stateTimestamps,
  touchStateTimestamp,
  getSessionModelKey,
  StreamContext,
} from '../shared';
import { detectModelCapabilitiesByName } from '../modelUtils';

import type {
  GeminiTool,
  GeminiFunctionDeclaration,
  GeminiParameters,
  GeminiContent,
  GeminiPart,
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiRequestBody,
} from '../types';

// ─── Types ────────────────────────────────────────────────────────────────

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  signature?: string;
  content?: string | AnthropicContentBlock[];
  source?: {
    type: 'base64' | 'url';
    media_type: string;
    data: string;
  };
}

type AnthropicMessageRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: AnthropicMessageRole;
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  tools?: AnthropicTool[];
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
  type?: string;
  message?: { id: string };
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
}

interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
    role: string;
  };
  finishReason: string;
  index: number;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

// ─── REQUEST: Gemini → Anthropic ──────────────────────────────────────────

function mapGeminiToolsToAnthropic(geminiTools: GeminiTool[]): AnthropicTool[] {
  if (!geminiTools || !Array.isArray(geminiTools)) return [];
  const anthropicTools: AnthropicTool[] = [];
  for (const toolGroup of geminiTools) {
    if (toolGroup.functionDeclarations && Array.isArray(toolGroup.functionDeclarations)) {
      for (const func of toolGroup.functionDeclarations) {
        const params = func.parameters
          ? (JSON.parse(JSON.stringify(func.parameters)) as Record<string, unknown>)
          : { type: 'OBJECT', properties: {} };
        if (params.type && typeof params.type === 'string') {
          (params as Record<string, string>).type = (params.type as string).toLowerCase();
        }
        if (params.properties) {
          fixParamTypes(params.properties as Record<string, unknown>);
        }
        anthropicTools.push({
          name: func.name,
          description: func.description || '',
          input_schema: params,
        });
      }
    }
  }
  return anthropicTools;
}

function generateSyntheticToolId(): string {
  return 'toolu_vrtx_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

export function mapGeminiToAnthropic(geminiBody: GeminiRequestBody, modelName: string): AnthropicRequestBody {
  const messages: AnthropicMessage[] = [];
  let system: string | undefined = undefined;
  const pendingToolCallsByName = new Map<string, string[]>();

  if (geminiBody.systemInstruction && geminiBody.systemInstruction.parts) {
    system = geminiBody.systemInstruction.parts.map((p) => p.text || '').join('');
  }

  if (geminiBody.contents) {
    for (const item of geminiBody.contents) {
      if (item.parts) {
        const hasFunctionCall = item.parts.some((p) => p.functionCall);
        const hasFunctionResponse = item.parts.some((p) => p.functionResponse);

        if (hasFunctionCall && item.role === 'model') {
          const contentBlocks: AnthropicContentBlock[] = [];
          for (const p of item.parts) {
            if (p.thought === true || (p as any).type === 'thinking') {
              contentBlocks.push({
                type: 'thinking',
                thinking: p.text || (p as any).thinking || '',
                signature: (p as any).thought_signature || (p as any).thoughtSignature || (p as any).signature || '',
              });
            } else if (p.text) {
              const textVal = p.text.trim().length === 0 ? '.' : p.text;
              contentBlocks.push({ type: 'text', text: textVal });
            }
            if (p.functionCall) {
              const callId = p.functionCall.id || generateSyntheticToolId();
              let originalName = p.functionCall.name;
              let originalArgs = p.functionCall.args;
              if (originalName) {
                if (!pendingToolCallsByName.has(originalName)) {
                  pendingToolCallsByName.set(originalName, []);
                }
                pendingToolCallsByName.get(originalName)!.push(callId);
              }
              const translatedInfo = translatedToolCalls.get(callId);
              if (translatedInfo) {
                originalName = translatedInfo.originalName;
                originalArgs = { CommandLine: translatedInfo.cmd, Cwd: translatedInfo.cwd };
              }
              contentBlocks.push({
                type: 'tool_use',
                id: callId,
                name: originalName,
                input:
                  typeof originalArgs === 'string'
                    ? (JSON.parse(originalArgs) as Record<string, unknown>)
                    : (originalArgs as Record<string, unknown>),
              });
            }
          }
          messages.push({ role: 'assistant', content: contentBlocks });
        } else if (hasFunctionResponse) {
          const contentBlocks: AnthropicContentBlock[] = [];
          for (const p of item.parts) {
            if (p.functionResponse) {
              const funcName = p.functionResponse.name || '';
              const pendingList = pendingToolCallsByName.get(funcName);
              const pairedId = pendingList && pendingList.length > 0 ? pendingList.shift() : undefined;
              const modelKey = getSessionModelKey(modelName, (geminiBody as any)?.sessionId || (geminiBody as any)?.conversationId);
              const modelTCIds = modelToolCallIds.get(modelKey) || modelToolCallIds.get(modelName) || {};
              const toolCallId = p.functionResponse.id || pairedId || modelTCIds[funcName] || 'call_' + funcName;
              const responseData = p.functionResponse.response;
              let contentStr = '';
              const translatedInfo = translatedToolCalls.get(toolCallId);
              if (translatedInfo) {
                contentStr = formatTranslatedResponse(translatedInfo, responseData);
              } else {
                contentStr = typeof responseData === 'string' ? responseData : JSON.stringify(responseData || {});
              }
              contentBlocks.push({
                type: 'tool_result',
                tool_use_id: toolCallId,
                content: contentStr,
              });
            }
          }
          messages.push({ role: 'user', content: contentBlocks });
        } else {
          const roleStr = item.role === 'model' ? 'assistant' : item.role || 'user';
          let content: string | AnthropicContentBlock[] = '';
          if (item.parts) {
            const partsContent: AnthropicContentBlock[] = [];
            for (const p of item.parts) {
              if (p.thought === true || (p as any).type === 'thinking') {
                partsContent.push({
                  type: 'thinking',
                  thinking: p.text || (p as any).thinking || '',
                  signature: (p as any).thought_signature || (p as any).thoughtSignature || (p as any).signature || '',
                });
              } else if (p.text !== undefined && p.text !== null) {
                const textVal = p.text.trim().length === 0 ? '.' : p.text;
                partsContent.push({ type: 'text', text: textVal });
              }
              else if ((p as any).fileData) { const fd = (p as any).fileData; if (fd.mimeType?.startsWith('image/')) { partsContent.push({ type: 'image', source: { type: 'url', media_type: fd.mimeType, data: fd.fileUri } }); } else { try { const url = new URL(fd.fileUri); if (url.protocol === 'file:') { const fs = require('fs'); partsContent.push({ type: 'text', text: `[File:\n${fs.readFileSync(url.pathname.replace(/^\//, '').replace(/\//g, path.sep), 'utf-8')}\n]` }); } else { partsContent.push({ type: 'text', text: `[File: ${fd.fileUri} (${fd.mimeType})]` }); } } catch { partsContent.push({ type: 'text', text: `[File: ${fd.fileUri} (${fd.mimeType})]` }); } } }
              else if ((p as any).inlineData) { const id = (p as any).inlineData; if (id.mimeType?.startsWith('image/')) { partsContent.push({ type: 'image', source: { type: 'base64', media_type: id.mimeType, data: id.data } }); } else if (id.mimeType === 'application/pdf') { partsContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: id.data } } as any); } else { partsContent.push({ type: 'text', text: `[${id.mimeType}: ${id.data}]` }); } }
            }
            // Preserve legacy behavior: a single plain-text part stays a string.
            if (partsContent.length === 0) {
              content = '.';
            } else if (partsContent.length === 1 && partsContent[0].type === 'text') {
              const txt = partsContent[0].text;
              content = typeof txt === 'string' && txt.trim().length === 0 ? '.' : txt;
            } else {
              content = partsContent;
            }
          }
          if (roleStr === 'system') {
            system = (system || '') + '\n' + (Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text || '' : '')).join('\n') : content);
          } else {
            messages.push({ role: roleStr as AnthropicMessageRole, content });
          }
        }
      }
    }
  }

  const result: AnthropicRequestBody = {
    model: modelName,
    messages,
    system,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens ?? 16000,
  };

  // Claude thinking models don't support temperature (centralized detection)
  const { isThinkingModel } = detectModelCapabilitiesByName(modelName);
  if (!isThinkingModel) {
    const temp = geminiBody.generationConfig?.temperature;
    if (temp !== undefined && temp !== null) result.temperature = temp;
  }

  if (geminiBody.tools && Array.isArray(geminiBody.tools)) {
    const anthTools = mapGeminiToolsToAnthropic(geminiBody.tools);
    if (anthTools.length > 0) result.tools = anthTools;
  }

  return result;
}

// ─── RESPONSE: Anthropic → Gemini ─────────────────────────────────────────

export function mapAnthropicToGemini(anthRes: AnthropicResponse, modelName: string): GeminiGenerateContentResponse {
  const contentBlocks = anthRes.content || [];
  const parts: GeminiPart[] = [];
  const functionCalls: GeminiPart[] = [];
  let signature: string | undefined;

  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) {
      parts.push({ text: block.text });
    } else if (block.type === 'thinking' && block.thinking) {
      if ((block as any).signature) {
        signature = (block as any).signature;
      }
      const part: GeminiPart = { text: block.thinking, thought: true };
      if (signature) (part as any).thoughtSignature = signature;
      parts.push(part);
    } else if (block.type === 'tool_use') {
      const modelKey = getSessionModelKey(modelName, (anthRes as any)?._sessionId || (anthRes as any)?.sessionId);
      const modelTCIds = modelToolCallIds.get(modelKey) || {};
      modelTCIds[block.name || ''] = block.id || '';
      modelToolCallIds.set(modelKey, modelTCIds);
      if (modelKey !== modelName) {
        const fallbackTCIds = modelToolCallIds.get(modelName) || {};
        fallbackTCIds[block.name || ''] = block.id || '';
        modelToolCallIds.set(modelName, fallbackTCIds);
      }
      touchStateTimestamp(stateTimestamps.toolCallIds, modelKey);

      const normalizedInput = normalizeToolArgs(block.name || '', block.input || {});
      const translated = translateToolCallToNative(block.name || '', normalizedInput);
      if (translated.name && translated.name !== block.name) {
        modelTCIds[translated.name] = block.id || '';
        if (modelKey !== modelName) {
          const fallbackTCIds = modelToolCallIds.get(modelName) || {};
          fallbackTCIds[translated.name] = block.id || '';
          modelToolCallIds.set(modelName, fallbackTCIds);
        }
      }
      if (translated.name !== block.name) {
        translated.args = normalizeToolArgs(translated.name, translated.args) as Record<string, unknown>;
        translatedToolCalls.set(block.id || '', {
          originalName: block.name || '',
          translatedName: translated.name,
          cmd: (normalizedInput.CommandLine as string) || '',
          cwd: (normalizedInput.Cwd as string) || '',
        });
        touchStateTimestamp(stateTimestamps.translatedCalls, block.id || '');
      }

      const tcPart: GeminiPart = {
        functionCall: { name: translated.name, args: translated.args as Record<string, unknown>, id: block.id },
      };
      if (signature) (tcPart as any).thoughtSignature = signature;
      functionCalls.push(tcPart);
    }
  }

  if (functionCalls.length > 0) {
    return {
      candidates: [
        { content: { parts: [...parts, ...functionCalls], role: 'model' }, finishReason: 'TOOL_CALL', index: 0 },
      ],
      usageMetadata: {
        promptTokenCount: anthRes.usage?.input_tokens || 0,
        candidatesTokenCount: anthRes.usage?.output_tokens || 0,
        totalTokenCount: (anthRes.usage?.input_tokens || 0) + (anthRes.usage?.output_tokens || 0),
      },
    };
  }

  const finishReason =
    anthRes.stop_reason === 'end_turn' ? 'STOP' : anthRes.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'OTHER';

  return {
    candidates: [{ content: { parts, role: 'model' }, finishReason, index: 0 }],
    usageMetadata: {
      promptTokenCount: anthRes.usage?.input_tokens || 0,
      candidatesTokenCount: anthRes.usage?.output_tokens || 0,
      totalTokenCount: (anthRes.usage?.input_tokens || 0) + (anthRes.usage?.output_tokens || 0),
    },
  };
}

// ─── STREAM CHUNK: Anthropic SSE → Gemini ─────────────────────────────────

export function mapAnthropicChunkToGemini(chunk: AnthropicResponse, modelName: string): GeminiCandidate | null {
  const type = chunk.type;
  const streamId = chunk.message?.id || 'anthropic_stream';

  if (!activeStreamContexts.has(streamId)) {
    activeStreamContexts.set(streamId, { accumulatedText: '', accumulatedReasoning: '', toolCalls: {} });
    touchStateTimestamp(stateTimestamps.streamCtx, streamId);
  }
  const context = activeStreamContexts.get(streamId)!;

  if (type === 'content_block_start') {
    const block = chunk.content_block;
    const idx = chunk.index ?? 0;
    if (block?.type === 'tool_use') {
      context.toolCalls[idx] = { id: block.id || '', name: block.name || '', arguments: '' };
    } else if (block?.type === 'thinking' && (block as any).signature) {
      context.signature = (block as any).signature;
    }
  }

  if (type === 'content_block_delta') {
    const delta = chunk.delta;
    const idx = chunk.index ?? 0;
    if (delta?.type === 'text_delta') {
      const text = delta.text || '';
      context.accumulatedText += text;
      return { content: { parts: [{ text }], role: 'model' }, finishReason: 'OTHER', index: 0 };
    } else if (delta?.type === 'thinking_delta') {
      const thinkingText = delta.thinking || '';
      context.accumulatedReasoning += thinkingText;
      const part: GeminiPart = { text: thinkingText, thought: true };
      if (context.signature) (part as any).thoughtSignature = context.signature;
      return {
        content: { parts: [part], role: 'model' },
        finishReason: 'OTHER',
        index: 0,
      };
    } else if (delta?.type === 'input_delta') {
      if (context.toolCalls[idx]) {
        context.toolCalls[idx].arguments += delta.partial_json || '';
      }
    }
  }

  if (type === 'message_delta') {
    const delta = chunk.delta;
    if (delta?.stop_reason === 'tool_use') {
      const parts: GeminiPart[] = Object.values(context.toolCalls).map((tc) => {
        let args: ToolCallArgs = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch (e) {
          log.debug('[Anthropic] Stream tool args parse fallback:', (e as Error).message);
          args = {};
        }
        args = normalizeToolArgs(tc.name, args) as ToolCallArgs;
        const modelKey = getSessionModelKey(modelName, (chunk as any)?._sessionId || (chunk as any)?.sessionId);
        const modelTCIds = modelToolCallIds.get(modelKey) || {};
        modelTCIds[tc.name] = tc.id;
        modelToolCallIds.set(modelKey, modelTCIds);
        if (modelKey !== modelName) {
          const fallbackTCIds = modelToolCallIds.get(modelName) || {};
          fallbackTCIds[tc.name] = tc.id;
          modelToolCallIds.set(modelName, fallbackTCIds);
        }
        touchStateTimestamp(stateTimestamps.toolCallIds, modelKey);
        const translated = translateToolCallToNative(tc.name, args);
        if (translated.name && translated.name !== tc.name) {
          modelTCIds[translated.name] = tc.id;
          if (modelKey !== modelName) {
            const fallbackTCIds = modelToolCallIds.get(modelName) || {};
            fallbackTCIds[translated.name] = tc.id;
            modelToolCallIds.set(modelName, fallbackTCIds);
          }
        }
        if (translated.name !== tc.name) {
          translatedToolCalls.set(tc.id, {
            originalName: tc.name,
            translatedName: translated.name,
            cmd: args.CommandLine || '',
            cwd: args.Cwd || '',
          });
          touchStateTimestamp(stateTimestamps.translatedCalls, tc.id);
        }
        const tcPart: GeminiPart = { functionCall: { name: translated.name, args: translated.args as Record<string, unknown>, id: tc.id } };
        if (context.signature) (tcPart as any).thoughtSignature = context.signature;
        return tcPart;
      });
      activeStreamContexts.delete(streamId);
      return { content: { parts, role: 'model' }, finishReason: 'TOOL_CALL', index: 0 };
    }
  }

  if (type === 'message_stop') {
    activeStreamContexts.delete(streamId);
    return { content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP', index: 0 };
  }

  return null;
}

export { mapGeminiToolsToAnthropic };
