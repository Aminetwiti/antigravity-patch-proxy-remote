/**
 * dashboard-tokenizer.ts — Antigravity Tokenizer Tool Controller.
 * Extracted from view-dashboard.ts for Single Responsibility (SRP) and modularity.
 */

const tokenizerTokenizeText =
  typeof window !== 'undefined'
    ? ((window as any).AgTokenTracker?.tokenizeText ||
      ((text: string) => ({
        tokenCount: Math.ceil(text.length / 4),
        charCount: text.length,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        lineCount: text.split('\n').length,
        charsPerToken: 4,
        tokens: [] as Array<{ index: number; text: string; colorIndex: number; byteLength: number }>,
        inputCostEstimate: (text.length / 4000) * 0.0001,
        outputCostEstimate: (text.length / 4000) * 0.0004,
      })))
    : null;

function getTokenizerElements() {
  return {
    modelSelect: document.querySelector('#tokenizerModelSelect') as HTMLSelectElement | null,
    inputText: document.querySelector('#tokenizerInputText') as HTMLTextAreaElement | null,
    chunkCount: document.querySelector('#tokenizerChunkCount') as HTMLElement | null,
    chipsContainer: document.querySelector('#tokenizerChipsContainer') as HTMLElement | null,
    copyTextBtn: document.querySelector('#tokenizerCopyTextBtn') as HTMLButtonElement | null,
    copyTokensBtn: document.querySelector('#tokenizerCopyTokensBtn') as HTMLButtonElement | null,
    clearTextBtn: document.querySelector('#tokenizerClearTextBtn') as HTMLButtonElement | null,
    contextMeterText: document.querySelector('#contextMeterText') as HTMLElement | null,
    contextMeterFill: document.querySelector('#contextMeterFill') as HTMLElement | null,
    statTokens: document.querySelector('#toolStatTokens') as HTMLElement | null,
    statChars: document.querySelector('#toolStatChars') as HTMLElement | null,
    statWords: document.querySelector('#toolStatWords') as HTMLElement | null,
    statLines: document.querySelector('#toolStatLines') as HTMLElement | null,
    statRatio: document.querySelector('#toolStatRatio') as HTMLElement | null,
    costInput: document.querySelector('#toolCostInput') as HTMLElement | null,
    costOutput: document.querySelector('#toolCostOutput') as HTMLElement | null,
    presetGeminiPro: document.querySelector('#tokenizerPresetGeminiPro') as HTMLButtonElement | null,
    presetThinking: document.querySelector('#tokenizerPresetThinking') as HTMLButtonElement | null,
    presetTs: document.querySelector('#tokenizerPresetTs') as HTMLButtonElement | null,
    presetPrompt: document.querySelector('#tokenizerPresetPrompt') as HTMLButtonElement | null,
    presetChat: document.querySelector('#tokenizerPresetChat') as HTMLButtonElement | null,
    presetJson: document.querySelector('#tokenizerPresetJson') as HTMLButtonElement | null,
  };
}

export function renderTokenizerTool(): void {
  if (!tokenizerTokenizeText) return;
  const els = getTokenizerElements();
  const text = els.inputText?.value || '';
  const model = els.modelSelect?.value || 'gemini-3.8-flash';
  const res = tokenizerTokenizeText(text, model);

  if (els.statTokens) els.statTokens.textContent = res.tokenCount.toLocaleString();
  if (els.statChars) els.statChars.textContent = res.charCount.toLocaleString();
  if (els.statWords) els.statWords.textContent = res.wordCount.toLocaleString();
  if (els.statLines) els.statLines.textContent = res.lineCount.toLocaleString();
  if (els.statRatio) els.statRatio.textContent = `${res.charsPerToken} car/tok`;
  if (els.costInput) els.costInput.textContent = `$${res.inputCostEstimate.toFixed(4)}`;
  if (els.costOutput) els.costOutput.textContent = `$${res.outputCostEstimate.toFixed(4)}`;
  if (els.chunkCount) els.chunkCount.textContent = `${res.tokenCount} token${res.tokenCount > 1 ? 's' : ''}`;

  const maxContext = 1_000_000;
  const pct = Math.min(100, Math.max(0, (res.tokenCount / maxContext) * 100));
  if (els.contextMeterFill) {
    els.contextMeterFill.style.width = `${Math.max(0.2, pct)}%`;
  }
  if (els.contextMeterText) {
    els.contextMeterText.textContent = `${res.tokenCount.toLocaleString()} / ${maxContext.toLocaleString()} (${pct.toFixed(2)}%)`;
  }

  if (els.chipsContainer) {
    if (!res || !Array.isArray(res.tokens) || res.tokens.length === 0) {
      els.chipsContainer.innerHTML =
        '<span style="color:var(--text-3); font-style:italic;">Les jetons découpés apparaîtront ici avec des couleurs alternées...</span>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const tok of res.tokens) {
        const span = document.createElement('span');
        span.className = `token-chip-${tok.colorIndex}`;
        span.textContent = tok.text;
        span.title = `Jeton #${tok.index + 1} (${tok.byteLength} octets) — Cliquez pour copier`;
        span.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard
              .writeText(tok.text)
              .then(() => {
                (window as any).toast?.(`Jeton "${tok.text}" copié !`, 'info', 1200);
              })
              .catch(() => {});
          }
        });
        fragment.appendChild(span);
      }
      els.chipsContainer.replaceChildren(fragment);
    }
  }
}

export function initTokenizerTool(): void {
  const els = getTokenizerElements();
  if (els.inputText && !els.inputText.dataset.bound) {
    els.inputText.dataset.bound = '1';
    els.inputText.addEventListener('input', () => renderTokenizerTool());
  }
  if (els.modelSelect && !els.modelSelect.dataset.bound) {
    els.modelSelect.dataset.bound = '1';
    els.modelSelect.addEventListener('change', () => renderTokenizerTool());
  }
  if (els.clearTextBtn && !els.clearTextBtn.dataset.bound) {
    els.clearTextBtn.dataset.bound = '1';
    els.clearTextBtn.addEventListener('click', () => {
      if (els.inputText) els.inputText.value = '';
      renderTokenizerTool();
    });
  }
  if (els.copyTextBtn && !els.copyTextBtn.dataset.bound) {
    els.copyTextBtn.dataset.bound = '1';
    els.copyTextBtn.addEventListener('click', () => {
      if (els.inputText && navigator.clipboard) {
        navigator.clipboard
          .writeText(els.inputText.value)
          .then(() => {
            (window as any).toast?.('Texte brut copié dans le presse-papier', 'ok', 1400);
          })
          .catch(() => {});
      }
    });
  }
  if (els.copyTokensBtn && !els.copyTokensBtn.dataset.bound) {
    els.copyTokensBtn.dataset.bound = '1';
    els.copyTokensBtn.addEventListener('click', () => {
      if (!tokenizerTokenizeText || !els.inputText) return;
      const res = tokenizerTokenizeText(els.inputText.value, els.modelSelect?.value || 'gemini-3.8-flash');
      if (navigator.clipboard) {
        const tokensArr = Array.isArray(res?.tokens) ? res.tokens : [];
        navigator.clipboard
          .writeText(JSON.stringify(tokensArr, null, 2))
          .then(() => {
            (window as any).toast?.(`${tokensArr.length} tokens copiés en JSON`, 'ok', 1600);
          })
          .catch(() => {});
      }
    });
  }

  const presets = (window as any).AgTokenTracker?.TOKENIZER_PRESETS;
  if (presets) {
    if (els.presetGeminiPro && !els.presetGeminiPro.dataset.bound) {
      els.presetGeminiPro.dataset.bound = '1';
      els.presetGeminiPro.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.gemini25Pro || presets.systemPrompt;
        if (els.modelSelect) els.modelSelect.value = 'gemini-3.8-flash';
        renderTokenizerTool();
        (window as any).toast?.('Exemple Gemini 3.8 Flash chargé', 'info', 1200);
      });
    }
    if (els.presetThinking && !els.presetThinking.dataset.bound) {
      els.presetThinking.dataset.bound = '1';
      els.presetThinking.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.geminiThinking;
        if (els.modelSelect) els.modelSelect.value = 'gemini-2.0-flash-thinking';
        renderTokenizerTool();
        (window as any).toast?.('Exemple Gemini Thinking chargé', 'info', 1200);
      });
    }
    if (els.presetTs && !els.presetTs.dataset.bound) {
      els.presetTs.dataset.bound = '1';
      els.presetTs.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.typescript;
        renderTokenizerTool();
      });
    }
    if (els.presetPrompt && !els.presetPrompt.dataset.bound) {
      els.presetPrompt.dataset.bound = '1';
      els.presetPrompt.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.systemPrompt;
        renderTokenizerTool();
      });
    }
    if (els.presetChat && !els.presetChat.dataset.bound) {
      els.presetChat.dataset.bound = '1';
      els.presetChat.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.chatMessage;
        renderTokenizerTool();
      });
    }
    if (els.presetJson && !els.presetJson.dataset.bound) {
      els.presetJson.dataset.bound = '1';
      els.presetJson.addEventListener('click', () => {
        if (els.inputText) els.inputText.value = presets.jsonPayload;
        renderTokenizerTool();
      });
    }
  }
}

if (typeof window !== 'undefined') {
  (window as any).renderTokenizerTool = renderTokenizerTool;
  (window as any).initTokenizerTool = initTokenizerTool;
}
