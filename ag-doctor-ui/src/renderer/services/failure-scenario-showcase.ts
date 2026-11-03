/**
 * Custom Provider Error Showcase
 * A lightweight demo module that previews all known failure scenarios
 * as native Antigravity-style quota/error cards. Useful for QA, training,
 * and visual debugging of error message rendering.
 */

import {
  CUSTOM_PROVIDER_FAILURE_SCENARIOS,
  type FailureScenario,
} from './custom-error-scenarios';

/**
 * Render all failure scenarios as preview cards inside a target container.
 * Each card is a full replica of the native Antigravity quota banner.
 */
export function renderFailureScenariosShowcase(
  targetSelector = '#failureScenarioShowcase',
): number {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return 0;
  const container = document.querySelector(targetSelector);
  if (!container) return 0;

  container.innerHTML = '';

  let count = 0;
  for (const scenario of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
    const card = createScenarioPreviewCard(scenario);
    container.appendChild(card);
    count++;
  }
  return count;
}

/**
 * Create a single preview card DOM element for a scenario.
 */
function createScenarioPreviewCard(scenario: FailureScenario): HTMLElement {
  const wrapper = document.createElement('div') as HTMLElement;
  wrapper.className = 'agy-showcase-card';
  wrapper.setAttribute('data-scenario-id', scenario.id);

  // Top label strip with category badge + provider tag
  const meta = document.createElement('div');
  meta.className = 'agy-showcase-meta';

  const cat = document.createElement('span');
  cat.className = 'agy-showcase-badge';
  cat.textContent = scenario.category;
  meta.appendChild(cat);

  const prov = document.createElement('span');
  prov.className = 'agy-showcase-provider';
  prov.textContent = scenario.exampleProvider;
  meta.appendChild(prov);

  if (scenario.httpStatus) {
    const status = document.createElement('span');
    status.className = 'agy-showcase-status';
    status.textContent = `HTTP ${scenario.httpStatus}`;
    meta.appendChild(status);
  }

  wrapper.appendChild(meta);

  // The actual native-style card (using the same renderer output)
  const card = document.createElement('div');
  card.className = 'agy-showcase-card-inner';
  card.innerHTML = buildCardHtml(scenario);
  wrapper.appendChild(card);

  // Footer with raw example error text
  const raw = document.createElement('div');
  raw.className = 'agy-showcase-raw';
  raw.textContent = `Raw: ${scenario.exampleErrorText}`;
  wrapper.appendChild(raw);

  return wrapper;
}

/**
 * Build the native Antigravity-style card HTML for a scenario.
 * Same structure as NativeQuotaCardRenderer but inlined for self-contained preview.
 */
function buildCardHtml(scenario: FailureScenario): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `
    <div class="agy-native-quota-card" role="alert">
      <div class="agy-quota-header">
        <svg class="agy-quota-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
        <span class="agy-quota-title">${esc(scenario.decodedTitle)}</span>
      </div>
      <div class="agy-quota-body">${esc(scenario.decodedHint)}</div>
      <div class="agy-quota-actions">
        <button class="agy-btn agy-btn-dismiss" type="button">${esc(scenario.dismissLabel)}</button>
        <button class="agy-btn agy-btn-secondary" type="button">${esc(scenario.secondaryActionLabel)}</button>
        <button class="agy-btn agy-btn-primary" type="button">${esc(scenario.primaryActionLabel)}</button>
      </div>
    </div>
  `.trim();
}

/**
 * Wire a single trigger button to render the showcase on demand.
 * Returns true if the button was found and wired.
 */
export function wireShowcaseTrigger(
  buttonId = 'openFailureShowcaseBtn',
  targetSelector = '#failureScenarioShowcase',
): boolean {
  if (typeof document === 'undefined') return false;
  const btn = document.getElementById(buttonId);
  if (!btn) return false;

  btn.addEventListener('click', () => {
    const n = renderFailureScenariosShowcase(targetSelector);
    if (typeof console !== 'undefined') {
      console.info(`[failure-showcase] rendered ${n} scenarios`);
    }
  });
  return true;
}

/**
 * Wire the showcase to auto-render when the "Failure Scenarios" view becomes active,
 * and also handle the filter chips to narrow visible scenarios.
 */
export function wireShowcaseAutoRender(
  viewSelector = '#view-failures',
  targetSelector = '#failureScenarioShowcase',
  chipsSelector = '.agy-filter-chip',
): { renderWired: boolean; chipsWired: boolean; totalChips: number } {
  if (typeof document === 'undefined') {
    return { renderWired: false, chipsWired: false, totalChips: 0 };
  }

  let renderWired = false;
  let chipsWired = false;
  let totalChips = 0;

  // Auto-render: observe the failures view container; render only when active.
  const view = document.querySelector(viewSelector);
  const target = document.querySelector(targetSelector);

  if (view && target) {
    // Initial render if the view is already displayed on load.
    if (view.classList.contains('active')) {
      renderFailureScenariosShowcase(targetSelector);
    }

    // Hook into the nav-list click delegation: any nav-item[data-view] triggers a render after transition.
    document.body.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const navBtn = t.closest('.nav-item[data-view="failures"]');
      if (navBtn) {
        // Wait for the active class to be applied (synchronous in this app).
        setTimeout(() => {
          if (view.classList.contains('active')) {
            renderFailureScenariosShowcase(targetSelector);
          }
        }, 30);
      }
    });

    // Also hook into the inner Refresh button (#openFailureShowcaseBtn2)
    const refresh = document.getElementById('openFailureShowcaseBtn2');
    if (refresh) {
      refresh.addEventListener('click', () => {
        renderFailureScenariosShowcase(targetSelector);
      });
    }

    renderWired = true;
  }

  // Wire filter chips: click toggles .active on a chip and re-renders with filter.
  const chips = Array.from(document.querySelectorAll(chipsSelector));
  totalChips = chips.length;
  if (chips.length > 0 && target) {
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = (chip as HTMLElement).getAttribute('data-filter') || 'all';
        const n = renderFailureScenariosShowcase(targetSelector);
        if (filter !== 'all') {
          const visible = Array.from(target.querySelectorAll(`[data-scenario-id]`)).filter((el) => {
            const cat = (el as HTMLElement).getAttribute('data-scenario-id') || '';
            return cat === filter;
          });
          Array.from(target.children).forEach((el) => {
            const cat = (el as HTMLElement).getAttribute('data-scenario-id') || '';
            (el as HTMLElement).style.display = filter === 'all' || cat === filter ? '' : 'none';
          });
        } else {
          Array.from(target.children).forEach((el) => {
            (el as HTMLElement).style.display = '';
          });
        }
        if (typeof console !== 'undefined') {
          console.info(`[failure-showcase] filtered=${filter}, total=${n}`);
        }
      });
    });
    chipsWired = true;
  }

  return { renderWired, chipsWired, totalChips };
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, {
    renderFailureScenariosShowcase,
    wireShowcaseTrigger,
    wireShowcaseAutoRender,
  });
}
// CJS/AMD/global hookup for <script> tag use (no bundler required in renderer).
if (typeof window !== 'undefined') {
  (window as unknown as { AgFailureShowcase?: unknown }).AgFailureShowcase = {
    renderFailureScenariosShowcase,
    wireShowcaseTrigger,
    wireShowcaseAutoRender,
  };
}
