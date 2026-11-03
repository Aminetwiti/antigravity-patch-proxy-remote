// Command palette
// ─────────────────────────────────────────────────────────────────────────────



const paletteBackdrop = $('#paletteBackdrop') as HTMLDivElement;
const paletteInput = $('#paletteInput') as HTMLInputElement;
const paletteResults = $('#paletteResults') as HTMLDivElement;

const PALETTE_COMMANDS: Array<{ id: string; label: string; view: string; action?: () => void }> = [
  { id: 'dashboard', label: 'Go to Dashboard', view: 'dashboard' },
  { id: 'doctor', label: 'Run System Diagnostic (Doctor)', view: 'dashboard', action: () => void (window as any).runDoctor?.() },
  { id: 'fix-all', label: 'Fix All — Full Auto-Repair', view: 'dashboard', action: () => void (window as any).runFixAll?.() },
  { id: 'antigravity', label: 'Go to Antigravity Status', view: 'info' },
  { id: 'models', label: 'Go to Custom Models', view: 'models' },
  { id: 'mitm', label: 'Go to MITM Proxy Manager', view: 'mitm' },
  { id: 'patch', label: 'Go to Binary Patch Manager', view: 'patch' },
  { id: 'proxy-stub', label: 'Start Emergency Proxy Stub', view: 'mitm', action: () => void (window as any).runStartStub?.() },
  { id: 'logs', label: 'Go to System Logs', view: 'logs' },
  { id: 'settings', label: 'Go to Settings', view: 'settings' },
  { id: 'theme', label: 'Toggle Light / Dark Theme', view: 'settings', action: () => {
    const current = document.documentElement.dataset.theme ?? 'dark';
    void (window as any).setTheme?.(current === 'dark' ? 'light' : 'dark');
  } },
  { id: 'info', label: 'Go to System Info & Installations', view: 'info' },
];

function openPalette(): void {
  if (!paletteBackdrop) return;
  paletteBackdrop.hidden = false;
  if (paletteInput) {
    paletteInput.value = '';
    paletteInput.focus();
  }
  renderPalette('');
}

function closePalette(): void {
  if (paletteBackdrop) paletteBackdrop.hidden = true;
}

// Reusable template element — avoids creating a new <template> on every keystroke
const paletteTpl = document.createElement('template');

// Single delegated click listener (bound once) instead of N listeners per item
if (paletteResults) {
  paletteResults.addEventListener('click', (ev) => {
    const item = (ev.target as HTMLElement).closest<HTMLDivElement>('.palette-item');
    if (!item) return;
    const id = item.dataset.id;
    const cmd = PALETTE_COMMANDS.find((c) => c.id === id);
    if (!cmd) return;
    closePalette();
    if (cmd.action) cmd.action();
    else navigate(cmd.view);
  });
}

function renderPalette(query: string): void {
  if (!paletteResults) return;
  const q = query.trim().toLowerCase();
  const matches = PALETTE_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.view.toLowerCase().includes(q),
  );
  if (matches.length === 0) {
    paletteResults.innerHTML = '<div class="palette-empty">No matching commands</div>';
    return;
  }
  // Build a single HTML string with escaped attributes/text and parse once via <template>
  paletteTpl.innerHTML = matches
    .map(
      (c) =>
        `<div class="palette-item" data-id="${escapeHtml(c.id)}" tabindex="0">` +
        `<span class="palette-item-label">${escapeHtml(c.label)}</span>` +
        `<span class="palette-item-view">${escapeHtml(c.view)}</span>` +
        `</div>`,
    )
    .join('');
  paletteResults.replaceChildren(paletteTpl.content);
}

if (paletteInput) {
  paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
  paletteInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closePalette();
    } else if (ev.key === 'Enter') {
      const first = paletteResults?.querySelector<HTMLDivElement>('.palette-item');
      if (first) {
        const cmd = PALETTE_COMMANDS.find((c) => c.id === first.dataset.id);
        if (cmd) {
          closePalette();
          if (cmd.action) cmd.action();
          else navigate(cmd.view);
        }
      }
    }
  });
}

if (paletteBackdrop) {
  paletteBackdrop.addEventListener('click', (ev) => {
    if (ev.target === paletteBackdrop) closePalette();
  });
}

window.ag?.onCommandPalette?.(() => openPalette());
