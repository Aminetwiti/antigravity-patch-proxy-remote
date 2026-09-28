import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenTrackerEngine,
  tokenizeText,
  estimateTokenCost,
  MODEL_PRICING,
} from './token-tracker';

describe('token-tracker', () => {
  describe('estimateTokenCost', () => {
    it('calculates correct cost for Claude 3.5 Sonnet', () => {
      // 100,000 prompt tokens ($3/M) + 50,000 completion tokens ($15/M)
      // in: 100,000 * 3 / 1,000,000 = 0.3
      // out: 50,000 * 15 / 1,000,000 = 0.75
      // total = 1.05
      const cost = estimateTokenCost('claude-3-5-sonnet', 100_000, 50_000);
      expect(cost).toBeCloseTo(1.05, 3);
    });

    it('calculates correct cost for GPT-4o', () => {
      // 200,000 prompt tokens ($2.5/M) + 10,000 completion tokens ($10/M)
      // in: 0.5, out: 0.1 -> total 0.6
      const cost = estimateTokenCost('gpt-4o', 200_000, 10_000);
      expect(cost).toBeCloseTo(0.6, 3);
    });

    it('calculates correct cost for Gemini 2.5 Pro and Flash', () => {
      // 100,000 prompt ($1.25/M) + 50,000 completion ($5.0/M) -> in 0.125, out 0.25 -> 0.375
      const costPro = estimateTokenCost('gemini-2.5-pro', 100_000, 50_000);
      expect(costPro).toBeCloseTo(0.375, 3);

      // Flash: 100,000 prompt ($0.10/M) + 50,000 completion ($0.40/M) -> in 0.01, out 0.02 -> 0.03
      const costFlash = estimateTokenCost('gemini-2.5-flash', 100_000, 50_000);
      expect(costFlash).toBeCloseTo(0.03, 3);
    });

    it('returns zero cost for local / ollama models', () => {
      const cost = estimateTokenCost('ollama-llama-3', 100_000, 100_000);
      expect(cost).toBe(0);
    });

    it('uses fallback pricing for unknown models', () => {
      const cost = estimateTokenCost('custom-unknown-model', 1_000_000, 1_000_000);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('tokenizeText', () => {
    it('handles empty input gracefully', () => {
      const res = tokenizeText('');
      expect(res.tokenCount).toBe(0);
      expect(res.charCount).toBe(0);
      expect(res.wordCount).toBe(0);
      expect(res.lineCount).toBe(0);
      expect(res.tokens).toEqual([]);
      expect(res.inputCostEstimate).toBe(0);
    });

    it('segments English prose and estimates counts', () => {
      const text = 'Hello world! This is a test of the tokenizer engine.';
      const res = tokenizeText(text, 'claude-3-5-sonnet');
      expect(res.tokenCount).toBeGreaterThan(0);
      expect(res.charCount).toBe(text.length);
      expect(res.wordCount).toBe(10);
      expect(res.lineCount).toBe(1);
      expect(res.tokens.length).toBe(res.tokenCount);
      expect(res.tokens[0].colorIndex).toBeGreaterThanOrEqual(0);
      expect(res.tokens[0].colorIndex).toBeLessThan(6);
    });

    it('splits code snippets and multiline text correctly', () => {
      const code = `function calculateTotal(price: number, quantity: number): number {\n  return price * quantity;\n}`;
      const res = tokenizeText(code, 'gpt-4o');
      expect(res.lineCount).toBe(3);
      expect(res.tokenCount).toBeGreaterThan(10);
      expect(res.charCount).toBe(code.length);
    });
  });

  describe('TokenTrackerEngine', () => {
    let engine: TokenTrackerEngine;

    beforeEach(() => {
      engine = new TokenTrackerEngine(false);
      engine.clear();
    });

    it('logs new usage entry with automatic calculation', () => {
      const entry = engine.logUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        promptTokens: 1000,
        completionTokens: 500,
        latencyMs: 1000,
        status: 200,
      });

      expect(entry.id).toBeDefined();
      expect(entry.totalTokens).toBe(1500);
      expect(entry.tokensPerSec).toBe(500); // 500 completion tokens / 1 sec
      expect(entry.estimatedCost).toBeGreaterThan(0);
      expect(engine.getEntries().length).toBe(1);
    });

    it('filters entries by query, provider, and model', () => {
      engine.logUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        promptTokens: 500,
        completionTokens: 200,
        latencyMs: 800,
        status: 200,
      });
      engine.logUsage({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 800,
        completionTokens: 300,
        latencyMs: 1200,
        status: 200,
      });
      engine.logUsage({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        promptTokens: 2000,
        completionTokens: 400,
        latencyMs: 900,
        status: 200,
      });

      expect(engine.filterEntries('', 'all', 'all').length).toBe(3);
      expect(engine.filterEntries('', 'anthropic', 'all').length).toBe(1);
      expect(engine.filterEntries('', 'all', 'gpt-4o').length).toBe(1);
      expect(engine.filterEntries('gemini', 'all', 'all').length).toBe(1);
      expect(engine.filterEntries('nonexistent', 'all', 'all').length).toBe(0);
    });

    it('computes accurate summary statistics', () => {
      engine.logUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        promptTokens: 1000,
        completionTokens: 500,
        latencyMs: 1000,
        status: 200,
      });
      engine.logUsage({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        promptTokens: 2000,
        completionTokens: 1000,
        latencyMs: 2000,
        status: 200,
      });

      const stats = engine.getStats();
      expect(stats.requestCount).toBe(2);
      expect(stats.promptTokens).toBe(3000);
      expect(stats.completionTokens).toBe(1500);
      expect(stats.totalTokens).toBe(4500);
      expect(stats.avgTokensPerReq).toBe(2250);
      expect(stats.avgLatencyMs).toBe(1500);
      expect(stats.byProvider['anthropic'].totalTokens).toBe(4500);
      expect(stats.byModel['claude-3-5-sonnet'].count).toBe(2);
    });

    it('aggregates Google / Antigravity stats and context caching accurately', () => {
      engine.logUsage({
        provider: 'google',
        model: 'gemini-2.5-pro',
        promptTokens: 10000,
        completionTokens: 2000,
        cachedTokens: 7500,
        latencyMs: 650,
        status: 200,
      });

      const stats = engine.getStats();
      expect(stats.googleStats).toBeDefined();
      expect(stats.googleStats.totalTokens).toBe(12000);
      expect(stats.googleStats.cachedTokens).toBe(7500);
      expect(stats.googleStats.cacheHitRatioPct).toBe(75);
      expect(stats.googleStats.estimatedSavings).toBeGreaterThan(0);
    });

    it('exports valid JSON and CSV formats', () => {
      engine.logUsage({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 120,
        completionTokens: 80,
        latencyMs: 500,
        status: 200,
      });

      const jsonStr = engine.exportJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed.entries.length).toBe(1);
      expect(parsed.stats.totalTokens).toBe(200);

      const csvStr = engine.exportCsv();
      expect(csvStr).toContain('gpt-4o');
      expect(csvStr).toContain('openai');
      expect(csvStr).toContain('Prompt Tokens');
    });

    it('clears all entries and resets stats', () => {
      engine.logUsage({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: 100,
        completionTokens: 50,
        latencyMs: 400,
        status: 200,
      });
      expect(engine.getEntries().length).toBe(1);

      engine.clear();
      expect(engine.getEntries().length).toBe(0);
      const stats = engine.getStats();
      expect(stats.totalTokens).toBe(0);
      expect(stats.requestCount).toBe(0);
    });

    it('seeds demo data when empty', () => {
      engine.seedDemoData();
      expect(engine.getEntries().length).toBeGreaterThan(0);
      const stats = engine.getStats();
      expect(stats.totalTokens).toBeGreaterThan(1000);
      expect(Object.keys(stats.byProvider).length).toBeGreaterThan(1);
    });
  });
});
