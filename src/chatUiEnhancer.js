// Antigravity 2.23.0 Safe Chat UI Enhancer
// Non-destructive UI augmentation:
// 1. Suggestion Pills Bar (/plan, Continue, Analyser et auditer, Keep going, Exécuter all steps, Next phase)
// 2. Inline Retry Button next to Send button
// Guarantees:
// - ZERO interference with official 2.23.0 Permissions Picker (Full Access, Ask, Deny)
// - ZERO interference with official 2.23.0 attachments (+ menu, .zip, folders)
// - ZERO interference with official 2.23.0 plugins or native slash commands
(() => {
  if (window.__ag_chat_ui_enhancer_installed) return;
  window.__ag_chat_ui_enhancer_installed = true;

  // Defensive prototype shields against b.startsWith is not a function in 2.25.0
  try {
    if (!Number.prototype.startsWith) {
      Number.prototype.startsWith = function() { return false; };
    }
    if (!Boolean.prototype.startsWith) {
      Boolean.prototype.startsWith = function() { return false; };
    }
  } catch (_) {}

  // Cleanup any legacy malformed featureEnvironmentOverride that causes b.startsWith crashes in 2.25.0
  try {
    localStorage.removeItem('jetski.developer.featureEnvironmentOverride');
  } catch (_) {}

  // Intercept benign Antigravity IDE UI errors (e.g. DraftCommentEditor on image/binary assets)
  window.addEventListener('error', (event) => {
    if (event && event.message && event.message.includes('DraftCommentEditor: A line number or selection context is required')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  const DEFAULT_SUGGESTIONS = [
    { label: '/plan', text: '/plan ' },
    { label: 'Continue', text: 'Continue' },
    { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
    { label: 'Keep going', text: 'Keep going' },
    { label: 'Exécuter all steps', text: 'Exécuter toutes les étapes prévues' },
    { label: 'Next phase', text: 'Passer à la phase suivante (Next phase)' }
  ];

  let chatUiConfig = {
    retryButton: true,
    suggestionPills: true,
    suggestions: DEFAULT_SUGGESTIONS
  };

  try {
    const rawStored = localStorage.getItem('ag_chat_ui_config');
    if (rawStored) {
      const parsed = JSON.parse(rawStored);
      if (parsed && typeof parsed === 'object') {
        chatUiConfig = {
          retryButton: parsed.retryButton !== undefined ? Boolean(parsed.retryButton) : true,
          suggestionPills: parsed.suggestionPills !== undefined ? Boolean(parsed.suggestionPills) : true,
          suggestions: Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0 ? parsed.suggestions : DEFAULT_SUGGESTIONS
        };
      }
    }
  } catch (_) {}

  // Helper to get active session/conversation ID
  function getActiveSessionId() {
    const path = window.location.pathname || '';
    const parts = path.split('/c/');
    if (parts.length > 1) {
      const id = parts[1].split('/')[0].split('?')[0];
      if (id) return id;
    }
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (promptBox) {
      const key = Object.keys(promptBox).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      let fiber = key ? promptBox[key] : null;
      while (fiber) {
        if (fiber.memoizedProps && (fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId)) {
          return fiber.memoizedProps.cascadeId || fiber.memoizedProps.conversationId;
        }
        fiber = fiber.return;
      }
    }
    return null;
  }

  // Insert text into prompt box (Lexical editor, contenteditable, or textarea)
  function insertTextIntoPrompt(text, autoSubmit = false) {
    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (!promptBox) return;

    // 1. Try Lexical editor via React Fiber
    const key = Object.keys(promptBox).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let fiber = key ? promptBox[key] : null;
    let editor = null;
    while (fiber) {
      if (fiber.memoizedProps && fiber.memoizedProps.editor) {
        editor = fiber.memoizedProps.editor;
        break;
      }
      fiber = fiber.return;
    }

    if (editor && editor._nodes) {
      const TextNode = editor._nodes.get('text')?.klass;
      if (TextNode) {
        editor.update(() => {
          const state = editor._pendingEditorState || editor._editorState;
          const root = state ? state._nodeMap.get('root') : null;
          if (root) {
            root.clear();
            const sel = root.selectEnd();
            sel.insertNodes([new TextNode(text)]);
          }
        });
        editor.focus();

        if (autoSubmit) {
          setTimeout(() => {
            const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label="Send message"]') ||
                            document.querySelector('button[aria-label*="Send"]');
            if (sendBtn) sendBtn.click();
          }, 80);
        }
        return;
      }
    }

    // 2. Fallback: execCommand / input event
    promptBox.focus();
    if (promptBox.tagName === 'TEXTAREA' || promptBox.tagName === 'INPUT') {
      promptBox.value = text;
      promptBox.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(promptBox);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, text);
      } catch (_) {
        promptBox.innerText = text;
        promptBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }

    if (autoSubmit) {
      setTimeout(() => {
        const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label="Send message"]') ||
                        document.querySelector('button[aria-label*="Send"]');
        if (sendBtn) sendBtn.click();
      }, 80);
    }
  }

  // Helper to verify that the chat input card is genuinely visible and in an active chat route
  function isChatInputVisible(inputCard) {
    const path = (window.location && window.location.pathname) || '';
    const isExcluded = path.startsWith('/customizations') ||
                       path.startsWith('/automations') ||
                       path.startsWith('/settings');
    if (isExcluded) return false;
    if (!path.includes('/c/') && path !== '/' && path !== '') return false;
    if (!inputCard || !inputCard.isConnected) return false;
    if (inputCard.offsetParent === null) return false;
    const rect = inputCard.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 20) return false;
    try {
      const style = window.getComputedStyle(inputCard);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    } catch (_) {}
    return true;
  }

  // --- 1. Suggestion Pills Bar ---
  function injectSuggestionPills() {
    let bar = document.getElementById('__ag_suggestion_pills_bar');
    if (chatUiConfig.suggestionPills === false) {
      if (bar) bar.remove();
      return;
    }

    let inputCard = document.getElementById('antigravity.agentSidePanelInputBox') ||
                    document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                    document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border');
    if (!inputCard) {
      const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (promptBox) {
        inputCard = promptBox.closest('.relative.flex.flex-col.p-px') ||
                    promptBox.closest('.rounded-2xl') ||
                    promptBox.closest('[class*="rounded"]') ||
                    promptBox.parentElement?.parentElement?.parentElement?.parentElement ||
                    promptBox.parentElement?.parentElement;
      }
    }

    // STRICT VISIBILITY & ROUTE GUARD: If not visible or not in chat, hide bar and abort
    if (!isChatInputVisible(inputCard)) {
      if (bar) bar.style.display = 'none';
      return;
    }

    if (!inputCard.parentElement) return;

    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__ag_suggestion_pills_bar';
    }

    if (!document.getElementById('__ag_pills_style')) {
      const st = document.createElement('style');
      st.id = '__ag_pills_style';
      st.textContent = '#__ag_suggestion_pills_bar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
      (document.head || document.documentElement).appendChild(st);
    }

    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:nowrap;gap:6px;padding:4px 2px 6px 2px;width:100%;max-width:100%;box-sizing:border-box;user-select:none;z-index:5;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;';

    if (!bar.__ag_wheel_attached) {
      bar.__ag_wheel_attached = true;
      bar.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          bar.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    const currentSuggestions = Array.isArray(chatUiConfig.suggestions) && chatUiConfig.suggestions.length > 0
      ? chatUiConfig.suggestions
      : DEFAULT_SUGGESTIONS;

    const signature = JSON.stringify(currentSuggestions);
    if (bar.dataset.suggestionsSignature !== signature) {
      bar.dataset.suggestionsSignature = signature;
      bar.innerHTML = '';
      currentSuggestions.forEach((sug) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = '__ag_suggestion_pill';
        pill.setAttribute('data-ag-suggestion', sug.text);
        pill.setAttribute('aria-label', `Insérer la suggestion ${sug.label}`);
        pill.title = `Insérer: "${sug.text}"`;
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:10px;font-size:12px;font-weight:500;font-family:system-ui,-apple-system,sans-serif;color:var(--vscode-editor-foreground, #f4f4f5);background:var(--vscode-badge-background, rgba(255,255,255,0.06));border:1px solid var(--vscode-widget-border, rgba(255,255,255,0.12));cursor:pointer;transition:all 0.15s ease-in-out;backdrop-filter:blur(4px);white-space:nowrap;outline:none;flex-shrink:0;';

        pill.innerHTML = `
          <span style="opacity:0.65;font-size:10px;">✦</span>
          <span>${sug.label}</span>
        `;

        pill.onmouseenter = () => {
          pill.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.14))';
          pill.style.borderColor = 'var(--vscode-focusBorder, rgba(255,255,255,0.25))';
          pill.style.color = '#ffffff';
          pill.style.transform = 'translateY(-1px)';
        };
        pill.onmouseleave = () => {
          pill.style.background = 'var(--vscode-badge-background, rgba(255,255,255,0.06))';
          pill.style.borderColor = 'var(--vscode-widget-border, rgba(255,255,255,0.12))';
          pill.style.color = 'var(--vscode-editor-foreground, #f4f4f5)';
          pill.style.transform = 'translateY(0)';
        };
        pill.onfocus = () => {
          pill.style.borderColor = 'var(--vscode-focusBorder, #3b82f6)';
        };
        pill.onblur = () => {
          pill.style.borderColor = 'var(--vscode-widget-border, rgba(255,255,255,0.12))';
        };

        pill.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          insertTextIntoPrompt(sug.text, false);
        };

        bar.appendChild(pill);
      });
    }

    try {
      if (inputCard && inputCard.parentElement && inputCard.parentElement.contains(inputCard)) {
        if (inputCard.previousElementSibling !== bar) {
          inputCard.parentElement.insertBefore(bar, inputCard);
        }
      }
    } catch (_) {}
  }

  // --- 2. Permanent Inline Retry Button ---
  function injectRetryButton() {
    let retryBtn = document.getElementById('__ag_inline_retry_btn');
    if (chatUiConfig.retryButton === false) {
      if (retryBtn) retryBtn.remove();
      return;
    }

    const promptBox = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    const inputCard = document.getElementById('antigravity.agentSidePanelInputBox') ||
                      document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
                      document.querySelector('.relative.flex.flex-col.p-px.rounded-2xl.bg-card-border') ||
                      (promptBox ? (promptBox.closest('.rounded-2xl') || promptBox.closest('.relative.flex.flex-col.p-px') || promptBox.closest('[class*="rounded"]') || promptBox.parentElement?.parentElement?.parentElement) : null);

    // STRICT VISIBILITY & ROUTE GUARD: If not visible or not in chat, hide retryBtn and abort
    if (!isChatInputVisible(inputCard)) {
      if (retryBtn) retryBtn.style.display = 'none';
      return;
    }

    const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                    document.querySelector('[data-tooltip-id="input-send-button-send-tooltip"]') ||
                    document.querySelector('[data-testid="send-button-pending"]') ||
                    document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
                    document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[aria-label*="send"]') ||
                    (inputCard ? inputCard.querySelector('button:last-of-type') : null);

    let container = null;
    if (sendBtn && sendBtn.parentElement) {
      container = sendBtn.parentElement;
    } else if (inputCard) {
      container = inputCard.querySelector('.flex.items-center.gap-1') ||
                  inputCard.querySelector('.flex.items-center:last-child') ||
                  inputCard.querySelector('div:last-child');
    }

    if (!container) {
      if (retryBtn) retryBtn.style.display = 'none';
      return;
    }

    if (!retryBtn) {
      retryBtn = document.createElement('button');
      retryBtn.id = '__ag_inline_retry_btn';
      retryBtn.type = 'button';
      retryBtn.setAttribute('aria-label', 'Retry');
      retryBtn.setAttribute('data-testid', 'inline-retry-button');
      retryBtn.title = 'Retry / Continue (Reprendre)';
      retryBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 10px;margin-left:4px;border-radius:12px;font-size:12px;font-weight:600;font-family:system-ui,-apple-system,sans-serif;cursor:pointer;user-select:none;transition:all 0.15s ease-in-out;background:var(--vscode-button-background, #0b57d0);color:var(--vscode-button-foreground, #ffffff);border:none;box-shadow:0 1px 2px rgba(0,0,0,0.25);outline:none;';
      retryBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
        </svg>
        <span>Retry</span>
      `;
      retryBtn.onmouseenter = () => { retryBtn.style.background = 'var(--vscode-button-hoverBackground, #1b6ef3)'; };
      retryBtn.onmouseleave = () => { retryBtn.style.background = 'var(--vscode-button-background, #0b57d0)'; };

      retryBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('[Antigravity 2.0] Retry button clicked!');

        // 1. Check if native error notification with "Retry" or "Try again" exists in DOM
        const nativeButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
          if (b === retryBtn || b.id === '__ag_inline_retry_btn') return false;
          const txt = (b.innerText || b.textContent || '').trim();
          return txt === 'Retry' || txt === 'Try again';
        });
        if (nativeButtons.length > 0) {
          console.log('[Antigravity 2.0] Clicking native Retry button from error notification');
          nativeButtons[0].click();
          return;
        }

        // 2. Extract sendMessage from React Fiber
        const anchor = document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea') ||
                       sendBtn;
        let foundSend = null;
        if (anchor) {
          const key = Object.keys(anchor).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
          let fiber = key ? anchor[key] : null;
          while (fiber) {
            if (fiber.memoizedProps && typeof fiber.memoizedProps.sendMessage === 'function') {
              foundSend = fiber.memoizedProps.sendMessage;
              break;
            }
            fiber = fiber.return;
          }
        }

        const cid = getActiveSessionId();
        if (foundSend && cid) {
          console.log('[Antigravity 2.0] Invoking sendMessage({ type: 7 }) via React Fiber for cascadeId:', cid);
          foundSend({ type: 7, cascadeId: cid });
          return;
        }

        // 3. Fallback: insert "Continue" into prompt and submit
        insertTextIntoPrompt('Continue', true);
      };
    } else {
      retryBtn.style.display = 'inline-flex';
    }

    // Ensure it is positioned safely to the right of the send button
    try {
      if (sendBtn && container && container.contains(sendBtn)) {
        if (sendBtn.nextSibling !== retryBtn) {
          container.insertBefore(retryBtn, sendBtn.nextSibling);
        }
      } else if (container && !container.contains(retryBtn)) {
        container.appendChild(retryBtn);
      }
    } catch (_) {}
  }

  // --- Scheduler & Observer (Debounced, Zero-Lock, Disconnect-Protected) ---
  let isUpdating = false;
  let updateTimer = null;

  function scheduleUpdate() {
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      if (isUpdating) return;
      isUpdating = true;
      try {
        if (window.__ag_chat_ui_observer) {
          window.__ag_chat_ui_observer.disconnect();
        }
        injectRetryButton();
        injectSuggestionPills();
      } catch (err) {
        // Silently ignore transient React reconciliation passes
      } finally {
        if (window.__ag_chat_ui_observer && (document.body || document.documentElement)) {
          window.__ag_chat_ui_observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
        isUpdating = false;
      }
    }, 120);
  }

  function startObserver() {
    if (window.__ag_chat_ui_observer) {
      window.__ag_chat_ui_observer.disconnect();
    }
    const obs = new MutationObserver((mutations) => {
      let isOwn = true;
      for (let i = 0; i < mutations.length; i++) {
        const t = mutations[i].target;
        if (!t || !t.closest || !t.closest('#__ag_inline_retry_btn, #__ag_suggestion_pills_bar, .__ag_suggestion_pill')) {
          isOwn = false;
          break;
        }
      }
      if (isOwn) return;
      scheduleUpdate();
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.__ag_chat_ui_observer = obs;

    scheduleUpdate();
  }

  // Hook history navigation so route changes hide/show UI instantly
  try {
    const origPush = history.pushState;
    history.pushState = function(...args) {
      const res = origPush.apply(this, args);
      scheduleUpdate();
      return res;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(...args) {
      const res = origReplace.apply(this, args);
      scheduleUpdate();
      return res;
    };
  } catch (_) {}

  document.addEventListener('click', () => {
    scheduleUpdate();
  }, { passive: true });

  window.addEventListener('popstate', scheduleUpdate);
  window.addEventListener('hashchange', scheduleUpdate);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startObserver();
      scheduleUpdate();
    });
    window.addEventListener('load', scheduleUpdate);
  } else {
    startObserver();
    scheduleUpdate();
  }

  console.log('[Antigravity 2.25.0] Chat UI Enhancer loaded (Retry button + Suggestion pills).');
})();

