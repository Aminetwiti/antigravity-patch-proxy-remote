/**
 * Doctor UI CSS Styles & Tokens
 */
export const AGY_DOCTOR_CSS = `
  :root {
    --agy-bg-base: #18181b;
    --agy-bg-surface: #1c1c1f;
    --agy-bg-elevated: #212124;
    --agy-bg-input: #27272a;
    --agy-bg-input-hover: #3f3f46;
    --agy-border: #27272a;
    --agy-border-strong: #3f3f46;
    --agy-ink-primary: #f4f4f5;
    --agy-ink-secondary: #a1a1aa;
    --agy-ink-muted: #71717a;
    --agy-accent: #3b82f6;
    --agy-accent-hover: #2563eb;
    --agy-success: #22c55e;
    --agy-success-hover: #16a34a;
    --agy-warning: #eab308;
    --agy-danger: #ef4444;
    --agy-danger-hover: #dc2626;
    --agy-overlay-bg: rgba(0, 0, 0, 0.7);
    --agy-shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    --agy-z-overlay: 100000;
    --agy-radius-sm: 4px;
    --agy-radius-md: 8px;
    --agy-radius-lg: 12px;
    --agy-radius-xl: 14px;
    --agy-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --agy-font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --agy-font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }

  /* ── Structural & View Classes ────────────────────────────────── */
  .agy-view {
    display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px;
    font-family: var(--agy-font); color: var(--agy-ink-primary);
  }
  .agy-view-header {
    display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 8px;
  }
  .agy-view-title {
    font-size: 18px; font-weight: 600; color: var(--agy-ink-primary); margin: 0; line-height: 1.2;
  }
  .agy-view-subtitle {
    font-size: 13px; color: var(--agy-ink-secondary); margin: 4px 0 0 0; line-height: 1.4;
  }
  .agy-header-actions {
    display: flex; align-items: center; gap: 8px;
  }
  .agy-panel {
    background: var(--agy-bg-base); border: 1px solid var(--agy-border); border-radius: var(--agy-radius-md); overflow: hidden;
  }
  .agy-panel-body {
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
  }

  /* ── Provider & Modality Badges ──────────────────────────────── */
  .agy-badge {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 2px 6px; border-radius: var(--agy-radius-sm);
    font-size: 10px; font-weight: 600; letter-spacing: 0.5px;
    text-transform: uppercase; line-height: 1; flex-shrink: 0;
  }

  /* ── Overlay & Modal ────────────────────────────────────────── */
  .agy-overlay {
    position: fixed; inset: 0;
    background: var(--agy-overlay-bg);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: grid; place-items: center;
    z-index: var(--agy-z-overlay);
    animation: agy-fade-in 180ms cubic-bezier(0.4, 0, 0.2, 1);
    font-family: var(--agy-font);
    color: var(--agy-ink-primary);
  }
  @keyframes agy-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .agy-modal {
    background: var(--agy-bg-surface);
    border: 1px solid var(--agy-border-strong);
    border-radius: var(--agy-radius-lg);
    width: 90%; max-width: 560px;
    max-height: min(680px, 88vh);
    display: flex; flex-direction: column;
    box-shadow: var(--agy-shadow-modal);
    overflow: hidden;
    animation: agy-modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .agy-modal-lg {
    max-width: 650px;
  }
  @keyframes agy-modal-in {
    from { opacity: 0; transform: translate3d(0, 8px, 0) scale(0.98); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .agy-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--agy-border);
    background: var(--agy-bg-surface);
  }
  .agy-modal-header-title-wrap {
    display: flex; align-items: center; gap: 10px;
  }
  .agy-modal-header-icon {
    display: grid; place-items: center; width: 24px; height: 24px;
    border-radius: var(--agy-radius-sm); background: rgba(59, 130, 246, 0.15);
    color: var(--agy-accent); font-weight: 600; font-size: 13px;
  }
  .agy-modal-title {
    font-family: var(--agy-font-display);
    font-size: 15px; font-weight: 600; margin: 0;
    display: flex; align-items: center; gap: 8px;
  }
  .agy-modal-body {
    display: flex; flex-direction: column; flex: 1; overflow: hidden; position: relative;
    font-size: 13px; line-height: 1.6;
    background: var(--agy-bg-base);
  }
  .agy-modal-footer {
    display: flex; justify-content: flex-end; align-items: center; gap: 12px;
    padding: 14px 18px; border-top: 1px solid var(--agy-border);
    background: var(--agy-bg-surface);
  }
  .agy-modal-list {
    padding: 18px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 12px;
  }
  .agy-modal-form {
    padding: 18px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 14px;
  }

  /* ── Provider Rows & Action Buttons ──────────────────────────── */
  .agy-provider-row {
    background: var(--agy-bg-surface); border: 1px solid var(--agy-border);
    border-radius: var(--agy-radius-md); padding: 12px 14px;
    display: flex; flex-direction: column; gap: 6px; transition: border-color 150ms ease;
  }
  .agy-provider-row:hover { border-color: var(--agy-border-strong); }
  .agy-row-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .agy-row-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .agy-row-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .agy-row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .agy-row-sub { font-size: 12px; color: var(--agy-ink-secondary); }
  .agy-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .agy-status-on { background-color: var(--agy-success); box-shadow: 0 0 6px hsla(136, 60%, 50%, 0.4); }
  .agy-status-off { background-color: var(--agy-ink-muted); }

  .agy-btn-primary {
    background: var(--agy-accent); color: white; border: none;
    padding: 6px 14px; border-radius: var(--agy-radius-md);
    font-size: 13px; font-weight: 500; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px; transition: background 150ms ease;
  }
  .agy-btn-primary:hover:not(:disabled) { background: var(--agy-accent-hover); }

  .agy-btn-secondary {
    background: var(--agy-bg-input); color: var(--agy-ink-primary); border: 1px solid var(--agy-border);
    padding: 6px 14px; border-radius: var(--agy-radius-md);
    font-size: 13px; font-weight: 500; cursor: pointer; transition: background 150ms ease;
  }
  .agy-btn-secondary:hover:not(:disabled) { background: var(--agy-bg-input-hover); }

  .agy-btn-ghost {
    background: transparent; color: var(--agy-ink-secondary); border: none;
    padding: 6px 10px; border-radius: var(--agy-radius-md);
    font-size: 13px; font-weight: 500; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px; transition: color 150ms ease, background 150ms ease;
  }
  .agy-btn-ghost:hover:not(:disabled) { color: var(--agy-ink-primary); background: var(--agy-bg-input); }

  .agy-btn-danger {
    background: var(--agy-danger); color: white; border: none;
    padding: 4px 10px; border-radius: var(--agy-radius-sm);
    font-size: 12px; font-weight: 500; cursor: pointer; transition: background 150ms ease;
  }
  .agy-btn-danger:hover:not(:disabled) { background: var(--agy-danger-hover); }

  .agy-icon-btn {
    background: transparent; border: none; color: var(--agy-ink-secondary);
    padding: 4px; border-radius: var(--agy-radius-sm); cursor: pointer; display: grid; place-items: center;
  }
  .agy-icon-btn:hover { color: var(--agy-ink-primary); background: var(--agy-bg-input); }

  /* ── Form Controls & Checkboxes ──────────────────────────────── */
  .agy-form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .agy-form-group label { font-size: 13px; font-weight: 500; color: var(--agy-ink-primary); }
  .agy-form-hint { font-size: 11px; color: var(--agy-ink-secondary); font-weight: 400; }
  .agy-input {
    background: var(--agy-bg-input); border: 1px solid var(--agy-border);
    border-radius: var(--agy-radius-md); padding: 8px 12px; color: var(--agy-ink-primary);
    font-family: var(--agy-font-mono); font-size: 13px; outline: none; transition: border-color 150ms ease;
  }
  .agy-input:focus { border-color: var(--agy-accent); }
  .agy-form-group-checkbox { flex-direction: row; align-items: center; gap: 8px; margin-top: 4px; }
  .agy-form-checkbox { accent-color: var(--agy-accent); width: 14px; height: 14px; cursor: pointer; }
  .agy-form-label-inline { font-size: 13px; color: var(--agy-ink-primary); cursor: pointer; }

  .agy-fetched-models-container {
    background: var(--agy-bg-surface); border: 1px solid var(--agy-border);
    border-radius: var(--agy-radius-md); max-height: 180px; overflow-y: auto; padding: 8px;
  }
  .agy-fetched-models-empty { font-size: 12px; color: var(--agy-ink-secondary); padding: 12px; text-align: center; }
  .agy-fetched-model-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--agy-radius-sm); font-size: 13px; cursor: pointer; }
  .agy-fetched-model-row:hover { background: var(--agy-bg-input); }
  .agy-form-error-banner {
    background: rgba(239, 68, 68, 0.15); border: 1px solid var(--agy-danger); color: var(--agy-danger);
    padding: 8px 12px; border-radius: var(--agy-radius-md); font-size: 12px; display: none; margin-top: 8px;
  }
  .agy-form-error-visible { display: block; }
`;

export function ensureAgyTokens(): void {
  if (document.getElementById('agy-style-tokens')) return;
  const style = document.createElement('style');
  style.id = 'agy-style-tokens';
  style.textContent = AGY_DOCTOR_CSS;
  document.head.appendChild(style);
}

