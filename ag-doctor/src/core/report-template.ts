/**
 * Report template generators for `ag-doctor doctor --report`.
 *
 * Produces a self-contained HTML/Markdown/JSON document from a doctor
 * result set. HTML is fully inline (CSS + no CDN) so the file can be
 * shared as a single attachment.
 */
import type { CheckResult } from '../types';

export type ReportFormat = 'html' | 'md' | 'json';

export interface ReportInput {
  results: CheckResult[];
  generatedAt: string;
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  agDoctorVersion: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!>])/g, '\\$1');
}

function statusEmoji(status: CheckResult['status']): string {
  switch (status) {
    case 'ok': return '✅';
    case 'warn': return '⚠️';
    case 'error': return '❌';
    default: return 'ℹ️';
  }
}

/** Generate a JSON report (no escaping needed). */
export function renderJsonReport(input: ReportInput): string {
  return JSON.stringify(input, null, 2);
}

/** Generate a Markdown report. */
export function renderMarkdownReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# ag-doctor report`);
  lines.push('');
  lines.push(`- **Generated**: ${input.generatedAt}`);
  lines.push(`- **Host**: ${input.hostname}`);
  lines.push(`- **Platform**: ${input.platform}/${input.arch}`);
  lines.push(`- **Node**: ${input.nodeVersion}`);
  lines.push(`- **ag-doctor**: v${input.agDoctorVersion}`);
  lines.push('');

  const ok = input.results.filter((r) => r.status === 'ok').length;
  const warn = input.results.filter((r) => r.status === 'warn').length;
  const err = input.results.filter((r) => r.status === 'error').length;
  const info = input.results.filter((r) => r.status === 'info').length;
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- ✅ ${ok} ok`);
  lines.push(`- ⚠️ ${warn} warnings`);
  lines.push(`- ❌ ${err} errors`);
  lines.push(`- ℹ️ ${info} info`);
  lines.push('');

  lines.push(`## Checks`);
  lines.push('');
  for (const r of input.results) {
    lines.push(`### ${statusEmoji(r.status)} ${escapeMd(r.title)}`);
    lines.push('');
    lines.push(`**Status**: \`${r.status}\``);
    lines.push('');
    lines.push(`> ${escapeMd(r.message)}`);
    if (r.details) {
      lines.push('');
      lines.push('```');
      lines.push(r.details);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Generate a self-contained HTML report. */
export function renderHtmlReport(input: ReportInput): string {
  const ok = input.results.filter((r) => r.status === 'ok').length;
  const warn = input.results.filter((r) => r.status === 'warn').length;
  const err = input.results.filter((r) => r.status === 'error').length;
  const info = input.results.filter((r) => r.status === 'info').length;

  const css = `
    :root {
      --bg: #0b1020;
      --panel: #131a2e;
      --text: #e6edf7;
      --muted: #8b97b3;
      --ok: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
      --info: #38bdf8;
      --border: #1f2a44;
      --accent: #22d3ee;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -0.02em; }
    h2 { font-size: 20px; margin: 32px 0 12px; color: var(--accent); }
    .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
    .meta span { display: inline-block; margin-right: 16px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
    .stat {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .stat .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
    .stat.ok .value { color: var(--ok); }
    .stat.warn .value { color: var(--warn); }
    .stat.err .value { color: var(--err); }
    .stat.info .value { color: var(--info); }
    .check {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .check-head { display: flex; align-items: center; gap: 10px; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge.ok { background: rgba(34,197,94,0.15); color: var(--ok); }
    .badge.warn { background: rgba(245,158,11,0.15); color: var(--warn); }
    .badge.err { background: rgba(239,68,68,0.15); color: var(--err); }
    .badge.info { background: rgba(56,189,248,0.15); color: var(--info); }
    .title { font-weight: 600; flex: 1; }
    .message { color: var(--muted); margin-top: 4px; font-size: 14px; }
    .details {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(0,0,0,0.25);
      border-radius: 8px;
      font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--muted);
    }
    footer { margin-top: 48px; color: var(--muted); font-size: 12px; text-align: center; }
  `.trim();

  const checkHtml = input.results
    .map((r) => {
      const details = r.details
        ? `<div class="details">${escapeHtml(r.details)}</div>`
        : '';
      return `
        <div class="check">
          <div class="check-head">
            <span class="badge ${r.status}">${r.status}</span>
            <span class="title">${escapeHtml(r.title)}</span>
          </div>
          <div class="message">${escapeHtml(r.message)}</div>
          ${details}
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ag-doctor report — ${escapeHtml(input.generatedAt)}</title>
<style>${css}</style>
</head>
<body>
<div class="container">
  <h1>ag-doctor report</h1>
  <div class="meta">
    <span>🕒 ${escapeHtml(input.generatedAt)}</span>
    <span>💻 ${escapeHtml(input.hostname)}</span>
    <span>🖥️ ${escapeHtml(input.platform)}/${escapeHtml(input.arch)}</span>
    <span>📦 Node ${escapeHtml(input.nodeVersion)}</span>
    <span>🩺 ag-doctor v${escapeHtml(input.agDoctorVersion)}</span>
  </div>

  <div class="summary">
    <div class="stat ok"><div class="label">Healthy</div><div class="value">${ok}</div></div>
    <div class="stat warn"><div class="label">Warnings</div><div class="value">${warn}</div></div>
    <div class="stat err"><div class="label">Errors</div><div class="value">${err}</div></div>
    <div class="stat info"><div class="label">Info</div><div class="value">${info}</div></div>
  </div>

  <h2>Checks</h2>
  ${checkHtml}

  <footer>Generated by ag-doctor · self-contained, no external resources</footer>
</div>
</body>
</html>`;
}
