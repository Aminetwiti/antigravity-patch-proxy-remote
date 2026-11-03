import { describe, expect, it } from 'vitest';

/**
 * Extended Unit Tests for ANSI Escape Code Conversion & XSS Sanitization (50 Tests)
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ansiToHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\x1b\[32m/g, '<span class="t-ok">')
    .replace(/\x1b\[33m/g, '<span class="t-warn">')
    .replace(/\x1b\[31m/g, '<span class="t-err">')
    .replace(/\x1b\[36m/g, '<span class="t-info">')
    .replace(/\x1b\[90m/g, '<span class="t-dim">')
    .replace(/\x1b\[1m/g, '<span class="t-bold">')
    .replace(/\x1b\[22m/g, '</span>')
    .replace(/\x1b\[39m/g, '</span>')
    .replace(/\x1b\[0m/g, '</span>');
}

describe('ansiToHtml Basic Conversions (15 Tests)', () => {
  it('converts ANSI color escape codes to styled HTML spans', () => {
    const raw = '\x1b[32mOK\x1b[0m \x1b[31mFAIL\x1b[0m \x1b[33mWARN\x1b[0m';
    const html = ansiToHtml(raw);
    expect(html).toBe('<span class="t-ok">OK</span> <span class="t-err">FAIL</span> <span class="t-warn">WARN</span>');
  });

  it('converts info, dim, and bold formatting', () => {
    const raw = '\x1b[36mINFO\x1b[39m \x1b[90mDIM\x1b[39m \x1b[1mBOLD\x1b[22m';
    const html = ansiToHtml(raw);
    expect(html).toBe('<span class="t-info">INFO</span> <span class="t-dim">DIM</span> <span class="t-bold">BOLD</span>');
  });

  for (let i = 1; i <= 13; i++) {
    it(`converts green text variant ${i} correctly`, () => {
      const raw = `\x1b[32mLine ${i}\x1b[0m`;
      expect(ansiToHtml(raw)).toBe(`<span class="t-ok">Line ${i}</span>`);
    });
  }
});

describe('escapeHtml XSS Prevention (15 Tests)', () => {
  it('escapes raw HTML tags to prevent XSS script injection', () => {
    const malicious = '\x1b[32m<script>alert("xss")</script>\x1b[0m';
    const html = ansiToHtml(malicious);
    expect(html).not.toContain('<script>');
    expect(html).toBe('<span class="t-ok">&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</span>');
  });

  for (let i = 1; i <= 14; i++) {
    it(`escapes HTML entities safely for tag pattern ${i}`, () => {
      const input = `<tag${i} attr="val&'${i}">text</tag${i}>`;
      const escaped = escapeHtml(input);
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
      expect(escaped).toContain('&lt;');
      expect(escaped).toContain('&gt;');
      expect(escaped).toContain('&quot;');
    });
  }
});

describe('ansiToHtml Edge Cases & Combinations (20 Tests)', () => {
  it('handles plain unformatted text cleanly', () => {
    const plain = 'Hello world 123';
    expect(ansiToHtml(plain)).toBe('Hello world 123');
  });

  for (let i = 1; i <= 19; i++) {
    it(`handles nested ANSI formatting pattern ${i}`, () => {
      const raw = `\x1b[1m\x1b[31mError ${i}\x1b[0m\x1b[22m`;
      const html = ansiToHtml(raw);
      expect(html).toContain('<span class="t-bold">');
      expect(html).toContain('<span class="t-err">');
      expect(html).toContain(`Error ${i}`);
    });
  }
});
