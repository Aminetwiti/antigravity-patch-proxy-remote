/**
 * ag-doctor UI — Execution Feed / Agent Timeline Component
 *
 * Direct port of Antigravity 2.0 ("The Quiet Console") Execution Timeline.
 * Implements observable agentic execution steps, file diffs (+N -N),
 * collapsible command terminals (#0E0F12), working indicator with spinner,
 * and compact summary bar when completed.
 */

export type ExecutionStepType =
  | 'fileEdit'
  | 'fileAnalysis'
  | 'search'
  | 'command'
  | 'commandGroup'
  | 'exploredGroup'
  | 'subagent'
  | 'thought'
  | 'timer'
  | 'taskFinished'
  | 'autoProceed';

export interface ExecutionStepItem {
  id: string;
  type: ExecutionStepType;
  verb?: string;
  title: string;
  filePath?: string;
  lineRange?: string;
  addedLines?: number;
  removedLines?: number;
  commandStr?: string;
  outputStr?: string;
  durationSec?: number;
  subItems?: ExecutionStepItem[];
  isCollapsed?: boolean;
}

export interface ExecutionFeedOptions {
  isStreaming?: boolean;
  isSummaryCollapsed?: boolean;
  workingText?: string;
  steps: ExecutionStepItem[];
}

export class ExecutionFeedRenderer {
  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private renderIcon(type: ExecutionStepType): string {
    switch (type) {
      case 'fileEdit':
        return '<span class="execution-step-icon edit"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>';
      case 'fileAnalysis':
        return '<span class="execution-step-icon analysis"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
      case 'search':
        return '<span class="execution-step-icon search"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>';
      case 'command':
      case 'commandGroup':
        return '<span class="execution-step-icon command"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>';
      case 'subagent':
        return '<span class="execution-step-icon subagent"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg></span>';
      case 'thought':
        return '<span class="execution-step-icon thought"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg></span>';
      case 'timer':
        return '<span class="execution-step-icon timer"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>';
      case 'taskFinished':
        return '<span class="execution-step-icon success"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>';
      default:
        return '<span class="execution-step-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg></span>';
    }
  }

  public renderStepRow(step: ExecutionStepItem): string {
    const isExpandable = !!(step.subItems?.length || step.commandStr || step.outputStr);
    const verb = step.verb ? `<span class="execution-action-verb">${this.escape(step.verb)}</span>` : '';
    const titleClass = step.type === 'fileEdit' || step.type === 'fileAnalysis' ? 'execution-step-title mono' : 'execution-step-title';
    const lineRange = step.lineRange ? `<span class="execution-line-range">${this.escape(step.lineRange)}</span>` : '';

    let diffBadges = '';
    if (step.addedLines !== undefined && step.addedLines > 0) {
      diffBadges += `<span class="execution-diff-added">+${step.addedLines}</span>`;
    }
    if (step.removedLines !== undefined && step.removedLines > 0) {
      diffBadges += `<span class="execution-diff-removed">-${step.removedLines}</span>`;
    }

    let chevron = '';
    if (isExpandable) {
      chevron = `<svg class="execution-chevron" style="margin-left:auto;opacity:0.6;transition:transform 0.15s;" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    }

    let html = `
      <div class="execution-step-row ${isExpandable ? 'is-expandable' : ''}" data-step-id="${this.escape(step.id)}">
        ${this.renderIcon(step.type)}
        ${verb}
        <span class="${titleClass}">${this.escape(step.title)}</span>
        ${lineRange}
        ${diffBadges}
        ${chevron}
      </div>
    `;

    // Collapsible Sub-items (timeline track)
    if (step.subItems && step.subItems.length > 0) {
      const isHidden = step.isCollapsed ? 'style="display:none;"' : '';
      html += `<div class="execution-subitems" id="subitems-${this.escape(step.id)}" ${isHidden}>`;
      for (const sub of step.subItems) {
        html += this.renderStepRow(sub);
      }
      html += `</div>`;
    }

    // Terminal command box
    if (step.commandStr || step.outputStr) {
      const isHidden = step.isCollapsed ? 'style="display:none;"' : '';
      html += `
        <div class="execution-terminal-box" id="term-${this.escape(step.id)}" ${isHidden}>
          ${step.commandStr ? `<div class="execution-terminal-prompt">&gt; ${this.escape(step.commandStr)}</div>` : ''}
          ${step.outputStr ? `<div>${this.escape(step.outputStr)}</div>` : ''}
        </div>
      `;
    }

    return html.trim();
  }

  public renderHtml(options: ExecutionFeedOptions): string {
    const isStreaming = !!options.isStreaming;
    const isSummaryCollapsed = !!options.isSummaryCollapsed;

    let summaryHeader = '';
    if (!isStreaming && options.steps.length > 0) {
      const fileEdits = options.steps.filter(s => s.type === 'fileEdit').length;
      summaryHeader = `
        <div class="execution-summary-bar" id="executionSummaryBar">
          <span class="execution-step-icon thought">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="18" x2="15" y2="18"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
          </span>
          <span>Thought for a few seconds, edited ${fileEdits || options.steps.length} item(s)</span>
          <svg style="margin-left:4px;opacity:0.7;" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      `;
    }

    const timelineDisplay = isSummaryCollapsed ? 'style="display:none;"' : '';
    let stepsHtml = '';
    for (const step of options.steps) {
      stepsHtml += this.renderStepRow(step);
    }

    let workingIndicator = '';
    if (isStreaming) {
      workingIndicator = `
        <div class="execution-working-indicator">
          <span class="execution-spinner"></span>
          <span>${this.escape(options.workingText || 'Working…')}</span>
        </div>
      `;
    }

    return `
      <div class="execution-feed" role="region" aria-label="Execution Timeline">
        ${summaryHeader}
        <div class="execution-timeline" id="executionTimelineList" ${timelineDisplay}>
          ${stepsHtml}
          ${workingIndicator}
        </div>
      </div>
    `.trim();
  }

  public attachInteractiveListeners(container: HTMLElement): void {
    const summaryBar = container.querySelector('#executionSummaryBar');
    const timelineList = container.querySelector('#executionTimelineList') as HTMLElement | null;
    if (summaryBar && timelineList) {
      summaryBar.addEventListener('click', () => {
        const isHidden = timelineList.style.display === 'none';
        timelineList.style.display = isHidden ? 'flex' : 'none';
      });
    }

    const expandableRows = container.querySelectorAll('.execution-step-row.is-expandable');
    expandableRows.forEach(row => {
      row.addEventListener('click', () => {
        const stepId = row.getAttribute('data-step-id');
        if (!stepId) return;

        const subitems = container.querySelector(`#subitems-${stepId}`) as HTMLElement | null;
        if (subitems) {
          subitems.style.display = subitems.style.display === 'none' ? 'flex' : 'none';
        }

        const term = container.querySelector(`#term-${stepId}`) as HTMLElement | null;
        if (term) {
          term.style.display = term.style.display === 'none' ? 'block' : 'none';
        }
      });
    });
  }
}

if (typeof window !== 'undefined') {
  (window as any).ExecutionFeedRenderer = ExecutionFeedRenderer;
}
