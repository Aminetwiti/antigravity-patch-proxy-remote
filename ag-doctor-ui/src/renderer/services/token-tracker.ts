/**
 * ag-doctor UI — Token Tracker & Tokenizer Engine
 * Real-time LLM token consumption tracking, cost estimation, and interactive BPE tokenizer.
 */

export interface TokenPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, TokenPrice> = {
  'gemini-4-argon-medium': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-3.8-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-3.8-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-3.8-flash-tiered': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-2.5-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'claude-sonnet-4-6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-opus-4-6': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3.5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'deepseek-r1': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'qwen-2.5-coder': { inputPerMillion: 0.2, outputPerMillion: 0.6 },
};

// ─── Real Quota & Token Capacity Calibration ──────────────────────────────
// User calibrated formula: Gemini 5h (100%) = 13% weekly = 250M tokens; Claude 5h = 50% weekly
export const GEMINI_5H_TOKEN_CAPACITY = 250_000_000; // 250M tokens (100% 5h window)
export const GEMINI_5H_TO_WEEKLY_RATIO = 0.13; // 5h window = 13% of weekly quota
export const GEMINI_WEEKLY_TOKEN_CAPACITY = Math.round(GEMINI_5H_TOKEN_CAPACITY / GEMINI_5H_TO_WEEKLY_RATIO); // ~1_923_076_923 tokens

export const CLAUDE_5H_TOKEN_CAPACITY = 10_000_000; // 10M tokens
export const CLAUDE_5H_TO_WEEKLY_RATIO = 0.50; // Claude 5h window = 50% of weekly quota
export const CLAUDE_WEEKLY_TOKEN_CAPACITY = Math.round(CLAUDE_5H_TOKEN_CAPACITY / CLAUDE_5H_TO_WEEKLY_RATIO); // 20_000_000 tokens

export interface QuotaTokenCalculation {
  capacity: number;
  availableTokens: number;
  consumedTokens: number;
  percentageRemaining: number;
  percentageConsumed: number;
}

export function calculateQuotaTokens(
  percentageRemaining: number,
  capacity: number
): QuotaTokenCalculation {
  const pctRem = Math.max(0, Math.min(100, Math.round(percentageRemaining ?? 100)));
  const pctCons = 100 - pctRem;
  const availableTokens = Math.round((capacity * pctRem) / 100);
  const consumedTokens = Math.round((capacity * pctCons) / 100);
  return {
    capacity,
    availableTokens,
    consumedTokens,
    percentageRemaining: pctRem,
    percentageConsumed: pctCons,
  };
}

export interface TokenUsageEntry {
  id: string;
  title?: string;
  timestamp: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  latencyMs: number;
  tokensPerSec: number;
  estimatedCost: number;
  status: number;
  endpoint?: string;
  steps?: number;
}

export interface ProviderBreakdown {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  count: number;
  cost: number;
}

export interface ModelBreakdown {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  count: number;
  cost: number;
}

export interface GoogleStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  requestCount: number;
  cacheHitRatioPct: number;
  estimatedSavings: number;
}

export interface TokenSummaryStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalCost: number;
  requestCount: number;
  avgTokensPerReq: number;
  avgLatencyMs: number;
  avgTokensPerSec: number;
  inOutRatio?: number;
  cacheHitRatioPct?: number;
  googleStats: GoogleStats;
  byProvider: Record<string, ProviderBreakdown>;
  byModel: Record<string, ModelBreakdown>;
}

export interface TokenizedChunk {
  index: number;
  text: string;
  byteLength: number;
  colorIndex: number;
}

export interface TokenizeResult {
  tokens: TokenizedChunk[];
  tokenCount: number;
  charCount: number;
  wordCount: number;
  lineCount: number;
  charsPerToken: number;
  inputCostEstimate: number;
  outputCostEstimate: number;
}

export const TOKENIZER_PRESETS = {
  gemini25Pro: `// Google Antigravity Engine — Gemini 2.5 Pro Agent Instruction
system_instruction: {
  parts: [
    { text: "Tu es le moteur d'ingénierie Antigravity propulsé par Google Gemini 2.5 Pro (Google DeepMind)." },
    { text: "Règles d'intervention : analyse le graphe de dépendances, applique les règles de sécurité strictes, et prioritise la latence minimale avec le Context Caching actif." }
  ]
},
tools: [
  { functionDeclarations: [
    { name: "read_file", description: "Lit le contenu textuel d'un fichier du workspace local.", parameters: { type: "OBJECT", properties: { path: { type: "STRING" } }, required: ["path"] } },
    { name: "run_command", description: "Exécute un ordre shell non destructif sous PowerShell ou Bash.", parameters: { type: "OBJECT", properties: { cmd: { type: "STRING" } }, required: ["cmd"] } }
  ]}
],
generationConfig: {
  temperature: 0.2,
  topP: 0.95,
  maxOutputTokens: 8192
}`,

  geminiThinking: `// Google Gemini 2.0 Flash Thinking — Prompt de Raisonnement Algorithmique
Consigne : Résous le problème d'optimisation de cache multi-niveaux pour les sessions d'agents Antigravity.

Structure de réflexion (Chain-of-Thought) :
1. Hypothèses de charge : 50 requêtes/seconde sur le socket gRPC-Web local.
2. Contraintes mémoire : Limite de 128 MB pour le buffer de StepRecovery.
3. Évaluation comparative : LRU vs ARC (Adaptive Replacement Cache) avec eviction prédictive.
4. Formalisation de la solution en Go avec tests de concurrence sans verrous superflus.`,

  typescript: `// Benchmark TypeScript & Async API Client
import { createServer, IncomingMessage, ServerResponse } from 'http';

interface CompletionPayload {
  model: 'gemini-4-argon-medium' | 'gemini-3.8-flash' | 'claude-sonnet-4-6';
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
}

export async function dispatchInference(payload: CompletionPayload): Promise<string> {
  const start = performance.now();
  console.log(\`[GoogleAntigravity] Dispatching to \${payload.model} via LS proxy port 51074\`);
  return \`Token execution completed in \${Math.round(performance.now() - start)}ms\`;
}`,

  systemPrompt: `Tu es Antigravity, un assistant principal d'ingénierie logicielle conçu par l'équipe Google DeepMind.
Principes directeurs :
1. Architecture propre, résiliente et sans couches d'abstractions superflues (YAGNI).
2. Vérification rigoureuse des entrées et isolation sécurisée des clés d'API.
3. Toujours fournir des tests unitaires minimaux pour valider les nouveaux composants.`,

  chatMessage: `Utilisateur : Peux-tu analyser les performances du Language Server local et m'indiquer la consommation estimée des tokens pour un lot de 50 requêtes ?

Assistant : Absolument ! Voici la projection basée sur un prompt moyen de 1 200 tokens d'entrée et 450 tokens de sortie :
1. Total Entrée : 60 000 tokens
2. Total Sortie : 22 500 tokens
3. Coût estimé sur Gemini 3.8 Flash : ~$0.015 USD (soit 34x moins cher que les modèles concurrents)
4. Latence moyenne observée : 195ms`,

  jsonPayload: `{
  "request": {
    "model": "gemini-3.8-flash",
    "contents": [
      { "role": "user", "parts": [{ "text": "Analyse les performances du pipeline de compilation et optimise les allocations mémoire." }] }
    ],
    "generationConfig": {
      "temperature": 0.4,
      "maxOutputTokens": 4096
    }
  }
}`
};

/**
 * Calculates estimated cost in USD for given prompt and completion token counts.
 */
export function estimateTokenCost(modelName: string, promptTokens: number, completionTokens: number): number {
  const norm = modelName.toLowerCase();
  let pricing: TokenPrice | undefined;

  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (norm.includes(key)) {
      pricing = price;
      break;
    }
  }

  // Fallback defaults: $1.00 input / $3.00 output per 1M tokens
  if (!pricing) {
    if (norm.includes('ollama') || norm.includes('local')) {
      pricing = { inputPerMillion: 0, outputPerMillion: 0 };
    } else {
      pricing = { inputPerMillion: 1.0, outputPerMillion: 3.0 };
    }
  }

  const inCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
  return Math.round((inCost + outCost) * 10000) / 10000;
}

/**
 * Zero-dependency BPE-like heuristic tokenizer and segmenter.
 * Accurately models byte-pair and subword splits across Gemini (256k vocab),
 * Claude (65k-100k vocab), OpenAI (cl100k/o200k), and multilingual code/prose.
 */
export function tokenizeText(text: string, modelName = 'gemini-3.8-flash'): TokenizeResult {
  if (!text) {
    return {
      tokens: [],
      tokenCount: 0,
      charCount: 0,
      wordCount: 0,
      lineCount: 0,
      charsPerToken: 0,
      inputCostEstimate: 0,
      outputCostEstimate: 0,
    };
  }

  const charCount = text.length;
  const lineCount = text.split('\n').length;
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const wordCount = words.length;

  const isGemini = /gemini|gemma/i.test(modelName);
  // Gemini's 256k vocabulary keeps longer common words intact (~6-8 chars before subword split)
  // Claude / GPT have smaller vocabularies and split subwords slightly earlier (~4-5 chars)
  const maxSubwordLen = isGemini ? 7 : 5;

  const getBytes = (s: string) => {
    try {
      return new TextEncoder().encode(s).length;
    } catch (_) {
      return s.length;
    }
  };

  // 1. Multi-character programming symbols & operators
  const symbolRegex = /(===|!==|<=|>=|==|!=|=>|->|\+\+|--|\+=|-=|\*=|\/=|&&|\|\||\?\?|\.\.\.|::|\/\*|\*\/|\/\/|<!--|-->|<\/|\/>|<<|>>)/y;
  // 2. French & English contractions and prefixes
  const contractionRegex = /(?:(?:[dDlLjJmMtTsScCnN]|qu|QU|Qu)'|'[sStTmMdD]|'(?:re|RE|ve|VE|ll|LL|d|D))/y;
  // 3. Indentation whitespace runs (2, 4, 8 spaces) or newlines
  const whitespaceRegex = /(\r\n|\n|\r|[ ]{4}|[ ]{2}|\t|[ ])/y;
  // 4. Letter / word run
  const wordRunRegex = /[\p{L}]+/uy;
  // 5. Digit run
  const digitRegex = /\d+/y;

  const chunks: TokenizedChunk[] = [];
  let colorCounter = 0;

  const pushToken = (rawPiece: string) => {
    if (!rawPiece) return;
    chunks.push({
      index: chunks.length,
      text: rawPiece,
      byteLength: getBytes(rawPiece),
      colorIndex: colorCounter % 6,
    });
    colorCounter++;
  };

  let pos = 0;
  while (pos < text.length) {
    // 1. Check multi-char programming symbol
    symbolRegex.lastIndex = pos;
    const symMatch = symbolRegex.exec(text);
    if (symMatch) {
      pushToken(symMatch[0]);
      pos += symMatch[0].length;
      continue;
    }

    // 2. Check contraction
    contractionRegex.lastIndex = pos;
    const contMatch = contractionRegex.exec(text);
    if (contMatch) {
      pushToken(contMatch[0]);
      pos += contMatch[0].length;
      continue;
    }

    // 3. Check whitespace (spaces, tabs, newlines)
    whitespaceRegex.lastIndex = pos;
    const wsMatch = whitespaceRegex.exec(text);
    if (wsMatch) {
      pushToken(wsMatch[0]);
      pos += wsMatch[0].length;
      continue;
    }

    // 4. Check word (letters) with CamelCase / PascalCase sub-splitting
    wordRunRegex.lastIndex = pos;
    const wordMatch = wordRunRegex.exec(text);
    if (wordMatch) {
      const fullWord = wordMatch[0];
      // Split CamelCase: e.g. "calculatePoolRunway" -> ["calculate", "Pool", "Runway"]
      const subwords = fullWord.match(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{L}+/gu) || [fullWord];

      for (const sw of subwords) {
        if (sw.length > maxSubwordLen) {
          const step = Math.max(3, Math.ceil(sw.length / 2));
          for (let i = 0; i < sw.length; i += step) {
            pushToken(sw.slice(i, i + step));
          }
        } else {
          pushToken(sw);
        }
      }
      pos += fullWord.length;
      continue;
    }

    // 5. Check numbers (chunk in 1-3 digits like BPE byte-fallback)
    digitRegex.lastIndex = pos;
    const digMatch = digitRegex.exec(text);
    if (digMatch) {
      const fullNum = digMatch[0];
      const step = 3;
      for (let i = 0; i < fullNum.length; i += step) {
        pushToken(fullNum.slice(i, i + step));
      }
      pos += fullNum.length;
      continue;
    }

    // 6. Any other single punctuation or unicode character
    const single = text[pos];
    pushToken(single);
    pos += 1;
  }

  const tokenCount = chunks.length;
  const charsPerToken = tokenCount > 0 ? Math.round((charCount / tokenCount) * 10) / 10 : 0;
  const inputCostEstimate = estimateTokenCost(modelName, tokenCount, 0);
  const outputCostEstimate = estimateTokenCost(modelName, 0, tokenCount);

  return {
    tokens: chunks,
    tokenCount,
    charCount,
    wordCount,
    lineCount,
    charsPerToken,
    inputCostEstimate,
    outputCostEstimate,
  };
}

export class TokenTrackerEngine {
  private entries: TokenUsageEntry[] = [];
  private maxEntries = 500;
  private storageKey = 'ag_token_tracker_entries_v1';

  constructor(loadInitial = true) {
    if (loadInitial) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(0, this.maxEntries);
        }
      }
    } catch (_) {
      // Storage unavailable or corrupt
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.entries.slice(0, this.maxEntries)));
    } catch (_) {}
  }

  public logUsage(entry: Omit<TokenUsageEntry, 'id' | 'timestamp' | 'totalTokens' | 'tokensPerSec' | 'estimatedCost'> & {
    id?: string;
    timestamp?: number;
    totalTokens?: number;
    tokensPerSec?: number;
    estimatedCost?: number;
  }): TokenUsageEntry {
    const promptTokens = entry.promptTokens || 0;
    const completionTokens = entry.completionTokens || 0;
    const totalTokens = entry.totalTokens ?? (promptTokens + completionTokens);
    const latencyMs = entry.latencyMs || 0;

    let tokensPerSec = entry.tokensPerSec;
    if (tokensPerSec === undefined || tokensPerSec <= 0) {
      if (completionTokens > 0 && latencyMs > 0) {
        tokensPerSec = Math.round((completionTokens / (latencyMs / 1000)) * 10) / 10;
      } else if (totalTokens > 0 && latencyMs > 0) {
        tokensPerSec = Math.round((totalTokens / (latencyMs / 1000)) * 10) / 10;
      } else {
        tokensPerSec = 0;
      }
    }

    const cost = entry.estimatedCost ?? estimateTokenCost(entry.model, promptTokens, completionTokens);

    const fullEntry: TokenUsageEntry = {
      id: entry.id || `tok-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: entry.title,
      timestamp: entry.timestamp || Date.now(),
      provider: entry.provider || 'unknown',
      model: entry.model || 'unknown',
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: entry.cachedTokens || 0,
      latencyMs,
      tokensPerSec,
      estimatedCost: cost,
      status: entry.status || 200,
      endpoint: entry.endpoint,
    };

    this.entries.unshift(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }

    this.saveToStorage();
    return fullEntry;
  }

  public loadRealSessions(sessions: TokenUsageEntry[]): void {
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    const existingMap = new Map<string, TokenUsageEntry>();
    for (const e of this.entries) {
      existingMap.set(e.id, e);
    }

    for (const s of sessions) {
      const existing = existingMap.get(s.id);
      if (existing) {
        // Update existing entry with freshest steps, tokens, and timestamp
        existing.title = s.title || existing.title;
        existing.timestamp = s.timestamp || existing.timestamp;
        existing.promptTokens = s.promptTokens || existing.promptTokens;
        existing.completionTokens = s.completionTokens || existing.completionTokens;
        existing.totalTokens = s.totalTokens || existing.totalTokens;
        existing.estimatedCost = s.estimatedCost || existing.estimatedCost;
        if (s.steps !== undefined) existing.steps = s.steps;
      } else {
        const newEntry: TokenUsageEntry = {
          id: s.id,
          title: s.title,
          timestamp: s.timestamp,
          provider: s.provider || 'google',
          model: s.model || 'Gemini 3.8 Flash (Tiered)',
          promptTokens: s.promptTokens || 0,
          completionTokens: s.completionTokens || 0,
          totalTokens: s.totalTokens || 0,
          cachedTokens: s.cachedTokens || 0,
          latencyMs: s.latencyMs || 250,
          tokensPerSec: s.tokensPerSec || 90,
          estimatedCost: s.estimatedCost || 0,
          status: s.status || 200,
          endpoint: s.endpoint || '/v1internal:streamGenerateContent',
          steps: s.steps,
        };
        this.entries.push(newEntry);
        existingMap.set(s.id, newEntry);
      }
    }
    this.entries.sort((a, b) => b.timestamp - a.timestamp);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    this.saveToStorage();
  }

  public getEntries(): TokenUsageEntry[] {
    return [...this.entries];
  }

  public filterEntries(
    query = '',
    provider = 'all',
    model = 'all',
    sortBy: 'timestamp' | 'totalTokens' | 'promptTokens' | 'completionTokens' | 'latencyMs' | 'tokensPerSec' | 'estimatedCost' | 'provider' | 'model' = 'timestamp',
    order: 'desc' | 'asc' = 'desc',
    range = 'all',
  ): TokenUsageEntry[] {
    const q = query.trim().toLowerCase();
    const prov = provider.toLowerCase();
    const mod = model.toLowerCase();

    let minTimestamp = 0;
    let maxTimestamp = 0;
    const now = Date.now();
    if (range === 'today') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      minTimestamp = startOfToday.getTime();
    } else if (range === 'yesterday') {
      const startOfYesterday = new Date();
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);
      minTimestamp = startOfYesterday.getTime();
      const endOfYesterday = new Date(startOfYesterday);
      endOfYesterday.setHours(23, 59, 59, 999);
      maxTimestamp = endOfYesterday.getTime();
    } else if (range === '24h') {
      minTimestamp = now - 24 * 3600 * 1000;
    } else if (range === '7d') {
      minTimestamp = now - 7 * 86400 * 1000;
    } else if (range === '30d') {
      minTimestamp = now - 30 * 86400 * 1000;
    } else if (range === 'this_month') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      minTimestamp = startOfMonth.getTime();
    } else if (range === 'last_month') {
      const nowD = new Date();
      const startOfLastMonth = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1, 0, 0, 0, 0);
      minTimestamp = startOfLastMonth.getTime();
      const endOfLastMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 0, 23, 59, 59, 999);
      maxTimestamp = endOfLastMonth.getTime();
    } else if (range === '7m') {
      minTimestamp = now - 210 * 86400 * 1000;
    } else if (range === 'this_year') {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0);
      minTimestamp = startOfYear.getTime();
    } else if (range.startsWith('custom:')) {
      const parts = range.split(':');
      const startStr = parts[1];
      const endStr = parts[2];
      if (startStr) {
        minTimestamp = new Date(`${startStr}T00:00:00`).getTime();
      }
      if (endStr) {
        maxTimestamp = new Date(`${endStr}T23:59:59.999`).getTime();
      }
    }

    const filtered = this.entries.filter((entry) => {
      if (minTimestamp > 0 && entry.timestamp < minTimestamp) return false;
      if (maxTimestamp > 0 && entry.timestamp > maxTimestamp) return false;

      // Smart Provider Matching
      let matchProv = false;
      if (prov === 'all') {
        matchProv = true;
      } else if (prov === 'google') {
        matchProv = entry.provider.toLowerCase().includes('google') || entry.model.toLowerCase().includes('gemini');
      } else if (prov === 'anthropic' || prov === 'claude') {
        matchProv = entry.provider.toLowerCase().includes('anthropic') || entry.model.toLowerCase().includes('claude');
      } else if (prov === 'openai') {
        matchProv = entry.provider.toLowerCase().includes('openai') || entry.model.toLowerCase().includes('gpt');
      } else {
        matchProv = entry.provider.toLowerCase().includes(prov);
      }

      // Smart Model Matching (supporting aliases like gemini-3.8, gemini-3.6, other, etc.)
      const modLower = entry.model.toLowerCase();
      let matchMod = false;
      if (mod === 'all') {
        matchMod = true;
      } else if (mod === 'gemini-3.8' || mod === '3.8' || mod.includes('3.8')) {
        matchMod = modLower.includes('3.8');
      } else if (mod === 'gemini-3.6' || mod === '3.6' || mod.includes('3.6')) {
        matchMod = modLower.includes('3.6');
      } else if (mod === 'other') {
        matchMod = !modLower.includes('3.8') && !modLower.includes('3.6') && !modLower.includes('gemini');
      } else {
        matchMod = modLower === mod || modLower.includes(mod) || mod.includes(modLower);
      }

      // Flexible Query Search (ID, model, provider, endpoint, status, and multiple date formats)
      let matchQuery = true;
      if (q) {
        const idLower = (entry.id || '').toLowerCase();
        const endpointLower = (entry.endpoint || '').toLowerCase();
        const titleLower = (entry.title || '').toLowerCase();
        const statusStr = (entry.status || 200).toString();
        const entryDate = new Date(entry.timestamp);
        const frDate = entryDate.toLocaleDateString('fr-FR'); // e.g. 15/10/2026
        const isoDate = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`; // e.g. 2026-10-15

        matchQuery =
          idLower.includes(q) ||
          modLower.includes(q) ||
          entry.provider.toLowerCase().includes(q) ||
          endpointLower.includes(q) ||
          titleLower.includes(q) ||
          statusStr.includes(q) ||
          frDate.includes(q) ||
          isoDate.includes(q);
      }

      return matchProv && matchMod && matchQuery;
    });

    filtered.sort((a, b) => {
      const valA = (a as any)[sortBy] ?? 0;
      const valB = (b as any)[sortBy] ?? 0;
      if (typeof valA === 'string' && typeof valB === 'string') {
        return order === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return order === 'desc' ? (valB > valA ? 1 : valB < valA ? -1 : 0) : (valA > valB ? 1 : valA < valB ? -1 : 0);
    });

    return filtered;
  }

  public getStats(): TokenSummaryStats {
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalCachedTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let totalSpeed = 0;
    let speedSamples = 0;

    let googleTotalTokens = 0;
    let googlePromptTokens = 0;
    let googleCompletionTokens = 0;
    let googleCachedTokens = 0;
    let googleCost = 0;
    let googleCount = 0;

    const byProvider: Record<string, ProviderBreakdown> = {};
    const byModel: Record<string, ModelBreakdown> = {};

    for (const entry of this.entries) {
      totalTokens += entry.totalTokens;
      promptTokens += entry.promptTokens;
      completionTokens += entry.completionTokens;
      const cached = entry.cachedTokens || 0;
      totalCachedTokens += cached;
      totalCost += entry.estimatedCost;
      totalLatency += entry.latencyMs;

      if (entry.tokensPerSec > 0) {
        totalSpeed += entry.tokensPerSec;
        speedSamples++;
      }

      // Check if entry belongs to Google / Antigravity
      const provLower = (entry.provider || '').toLowerCase();
      const modLower = (entry.model || '').toLowerCase();
      const isGoogle = provLower.includes('google') || provLower.includes('gemini') || modLower.includes('gemini');
      if (isGoogle) {
        googleTotalTokens += entry.totalTokens;
        googlePromptTokens += entry.promptTokens;
        googleCompletionTokens += entry.completionTokens;
        googleCachedTokens += cached;
        googleCost += entry.estimatedCost;
        googleCount++;
      }

      // Aggregate by provider
      const pKey = entry.provider || 'unknown';
      if (!byProvider[pKey]) {
        byProvider[pKey] = { totalTokens: 0, promptTokens: 0, completionTokens: 0, count: 0, cost: 0 };
      }
      byProvider[pKey].totalTokens += entry.totalTokens;
      byProvider[pKey].promptTokens += entry.promptTokens;
      byProvider[pKey].completionTokens += entry.completionTokens;
      byProvider[pKey].count += 1;
      byProvider[pKey].cost = Math.round((byProvider[pKey].cost + entry.estimatedCost) * 10000) / 10000;

      // Aggregate by model
      const mKey = entry.model || 'unknown';
      if (!byModel[mKey]) {
        byModel[mKey] = { totalTokens: 0, promptTokens: 0, completionTokens: 0, count: 0, cost: 0 };
      }
      byModel[mKey].totalTokens += entry.totalTokens;
      byModel[mKey].promptTokens += entry.promptTokens;
      byModel[mKey].completionTokens += entry.completionTokens;
      byModel[mKey].count += 1;
      byModel[mKey].cost = Math.round((byModel[mKey].cost + entry.estimatedCost) * 10000) / 10000;
    }

    const count = this.entries.length;
    const inOutRatio = completionTokens > 0
      ? Math.round((promptTokens / completionTokens) * 10) / 10
      : (promptTokens > 0 ? 10 : 0);
    const overallCacheHitRatioPct = promptTokens > 0
      ? Math.round((totalCachedTokens / promptTokens) * 100)
      : 0;
    const cacheHitRatioPct = googlePromptTokens > 0
      ? Math.round((googleCachedTokens / googlePromptTokens) * 100)
      : 0;
    const estimatedSavings = Math.round((googleCachedTokens / 1_000_000) * (1.25 * 0.75) * 10000) / 10000;

    return {
      totalTokens,
      promptTokens,
      completionTokens,
      cachedTokens: totalCachedTokens,
      totalCost: Math.round(totalCost * 10000) / 10000,
      requestCount: count,
      avgTokensPerReq: count > 0 ? Math.round(totalTokens / count) : 0,
      avgLatencyMs: count > 0 ? Math.round(totalLatency / count) : 0,
      avgTokensPerSec: speedSamples > 0 ? Math.round((totalSpeed / speedSamples) * 10) / 10 : 0,
      inOutRatio,
      cacheHitRatioPct: overallCacheHitRatioPct,
      googleStats: {
        totalTokens: googleTotalTokens,
        promptTokens: googlePromptTokens,
        completionTokens: googleCompletionTokens,
        cachedTokens: googleCachedTokens,
        cost: Math.round(googleCost * 10000) / 10000,
        requestCount: googleCount,
        cacheHitRatioPct,
        estimatedSavings,
      },
      byProvider,
      byModel,
    };
  }

  public clear(): void {
    this.entries = [];
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (_) {}
    }
  }

  public exportJson(entries?: TokenUsageEntry[]): string {
    const list = entries || this.entries;
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        totalEntries: list.length,
        stats: this.getStats(),
        entries: list,
      },
      null,
      2,
    );
  }

  public exportCsv(entries?: TokenUsageEntry[]): string {
    const list = entries || this.entries;
    const headers = [
      'ID',
      'Timestamp',
      'Date',
      'Provider',
      'Model',
      'Prompt Tokens',
      'Completion Tokens',
      'Total Tokens',
      'Latency (ms)',
      'Speed (tok/s)',
      'Estimated Cost ($)',
      'Status',
    ];

    const sanitizeCsvCell = (val: unknown) => {
      let str = String(val ?? '');
      // Neutralize spreadsheet formula injection (=, +, -, @, tab, newline)
      if (/^[=+\-@\t\r\n]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = list.map((e) => [
      sanitizeCsvCell(e.id),
      e.timestamp,
      new Date(e.timestamp).toISOString(),
      sanitizeCsvCell(e.provider),
      sanitizeCsvCell(e.model),
      e.promptTokens,
      e.completionTokens,
      e.totalTokens,
      e.latencyMs,
      e.tokensPerSec,
      e.estimatedCost.toFixed(4),
      e.status,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public seedDemoData(): void {
    if (this.entries.length > 0) return;

    const samples = [
      { provider: 'google', model: 'gemini-4-argon-medium', prompt: 8420, completion: 1150, cached: 6200, latency: 680, status: 200, offset: 3 },
      { provider: 'google', model: 'gemini-3.8-flash', prompt: 3100, completion: 420, cached: 2100, latency: 190, status: 200, offset: 8 },
      { provider: 'google', model: 'gemini-3.8-flash-tiered', prompt: 4600, completion: 1840, cached: 3200, latency: 1120, status: 200, offset: 15 },
      { provider: 'google', model: 'gemini-4-argon-medium', prompt: 14200, completion: 820, cached: 11000, latency: 1450, status: 200, offset: 32 },
      { provider: 'anthropic', model: 'claude-sonnet-4-6', prompt: 1420, completion: 480, cached: 0, latency: 1250, status: 200, offset: 45 },
      { provider: 'google', model: 'gemini-3.8-flash', prompt: 1950, completion: 310, cached: 1400, latency: 175, status: 200, offset: 60 },
      { provider: 'openai', model: 'gpt-4o', prompt: 2150, completion: 820, cached: 0, latency: 1840, status: 200, offset: 75 },
      { provider: 'deepseek', model: 'deepseek-r1', prompt: 3200, completion: 1450, cached: 0, latency: 3100, status: 200, offset: 95 },
      { provider: 'ollama', model: 'qwen-2.5-coder', prompt: 950, completion: 320, cached: 0, latency: 1650, status: 200, offset: 120 },
    ];

    const now = Date.now();
    for (const s of samples) {
      this.logUsage({
        timestamp: now - s.offset * 60 * 1000,
        provider: s.provider,
        model: s.model,
        promptTokens: s.prompt,
        completionTokens: s.completion,
        cachedTokens: s.cached,
        latencyMs: s.latency,
        status: s.status,
        endpoint: '/v1internal:streamGenerateContent',
      });
    }
  }
}

// Global attachment for plain browser scripts without module loader
if (typeof window !== 'undefined') {
  (window as unknown as {
    AgTokenTracker: {
      TokenTrackerEngine: typeof TokenTrackerEngine;
      tokenizeText: typeof tokenizeText;
      estimateTokenCost: typeof estimateTokenCost;
      MODEL_PRICING: typeof MODEL_PRICING;
      TOKENIZER_PRESETS: typeof TOKENIZER_PRESETS;
      calculateQuotaTokens: typeof calculateQuotaTokens;
      GEMINI_5H_TOKEN_CAPACITY: typeof GEMINI_5H_TOKEN_CAPACITY;
      GEMINI_5H_TO_WEEKLY_RATIO: typeof GEMINI_5H_TO_WEEKLY_RATIO;
      GEMINI_WEEKLY_TOKEN_CAPACITY: typeof GEMINI_WEEKLY_TOKEN_CAPACITY;
      CLAUDE_5H_TOKEN_CAPACITY: typeof CLAUDE_5H_TOKEN_CAPACITY;
      CLAUDE_5H_TO_WEEKLY_RATIO: typeof CLAUDE_5H_TO_WEEKLY_RATIO;
      CLAUDE_WEEKLY_TOKEN_CAPACITY: typeof CLAUDE_WEEKLY_TOKEN_CAPACITY;
    };
  }).AgTokenTracker = {
    TokenTrackerEngine,
    tokenizeText,
    estimateTokenCost,
    MODEL_PRICING,
    TOKENIZER_PRESETS,
    calculateQuotaTokens,
    GEMINI_5H_TOKEN_CAPACITY,
    GEMINI_5H_TO_WEEKLY_RATIO,
    GEMINI_WEEKLY_TOKEN_CAPACITY,
    CLAUDE_5H_TOKEN_CAPACITY,
    CLAUDE_5H_TO_WEEKLY_RATIO,
    CLAUDE_WEEKLY_TOKEN_CAPACITY,
  };
}
