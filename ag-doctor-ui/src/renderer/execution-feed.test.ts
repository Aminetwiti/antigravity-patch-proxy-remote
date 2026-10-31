import { describe, expect, it } from 'vitest';
import { ExecutionFeedRenderer, ExecutionStepItem } from './execution-feed';

describe('ExecutionFeedRenderer — Antigravity 2.0 Fidelity Tests', () => {
  const renderer = new ExecutionFeedRenderer();

  it('renders live working indicator when isStreaming is true', () => {
    const html = renderer.renderHtml({
      isStreaming: true,
      workingText: 'Working…',
      steps: [],
    });

    expect(html).toContain('class="execution-working-indicator"');
    expect(html).toContain('class="execution-spinner"');
    expect(html).toContain('Working…');
  });

  it('renders collapsed summary bar when completed and not streaming', () => {
    const steps: ExecutionStepItem[] = [
      { id: '1', type: 'fileEdit', verb: 'Edited', title: 'proxy.ts', addedLines: 12, removedLines: 3 },
    ];
    const html = renderer.renderHtml({
      isStreaming: false,
      steps,
    });

    expect(html).toContain('id="executionSummaryBar"');
    expect(html).toContain('Thought for a few seconds, edited 1 item(s)');
    expect(html).not.toContain('execution-spinner');
  });

  it('renders granular fileEdit step with +N and -N diff badges', () => {
    const step: ExecutionStepItem = {
      id: 'step-edit',
      type: 'fileEdit',
      verb: 'Edited',
      title: 'src/main.ts',
      addedLines: 24,
      removedLines: 7,
    };
    const rowHtml = renderer.renderStepRow(step);

    expect(rowHtml).toContain('class="execution-action-verb">Edited</span>');
    expect(rowHtml).toContain('class="execution-step-title mono">src/main.ts</span>');
    expect(rowHtml).toContain('class="execution-diff-added">+24</span>');
    expect(rowHtml).toContain('class="execution-diff-removed">-7</span>');
    expect(rowHtml).toContain('execution-step-icon edit');
  });

  it('renders fileAnalysis step with line range', () => {
    const step: ExecutionStepItem = {
      id: 'step-analyze',
      type: 'fileAnalysis',
      verb: 'Analyzed',
      title: 'ag-doctor-ui/src/renderer/app.ts',
      lineRange: '#L1068-1100',
    };
    const rowHtml = renderer.renderStepRow(step);

    expect(rowHtml).toContain('class="execution-action-verb">Analyzed</span>');
    expect(rowHtml).toContain('class="execution-line-range">#L1068-1100</span>');
    expect(rowHtml).toContain('execution-step-icon analysis');
  });

  it('renders command step with inline terminal box and prompt', () => {
    const step: ExecutionStepItem = {
      id: 'step-cmd',
      type: 'command',
      verb: 'Ran',
      title: 'npm test',
      commandStr: 'npm test -- --run',
      outputStr: '31 passed (31)',
    };
    const rowHtml = renderer.renderStepRow(step);

    expect(rowHtml).toContain('class="execution-terminal-box" id="term-step-cmd"');
    expect(rowHtml).toContain('&gt; npm test -- --run');
    expect(rowHtml).toContain('31 passed (31)');
  });

  it('renders nested subitems with timeline track indentation', () => {
    const step: ExecutionStepItem = {
      id: 'step-group',
      type: 'exploredGroup',
      title: 'Explored 2 files',
      subItems: [
        { id: 'sub-1', type: 'fileAnalysis', verb: 'Viewed', title: 'styles.css' },
        { id: 'sub-2', type: 'fileAnalysis', verb: 'Viewed', title: 'app.ts' },
      ],
    };
    const rowHtml = renderer.renderStepRow(step);

    expect(rowHtml).toContain('class="execution-subitems" id="subitems-step-group"');
    expect(rowHtml).toContain('Viewed');
    expect(rowHtml).toContain('styles.css');
    expect(rowHtml).toContain('app.ts');
  });

  it('escapes special characters to prevent XSS in titles and output', () => {
    const step: ExecutionStepItem = {
      id: 'step-xss',
      type: 'command',
      title: '<script>alert(1)</script>',
      commandStr: 'echo "hello & goodbye"',
      outputStr: '<b>bold</b>',
    };
    const rowHtml = renderer.renderStepRow(step);

    expect(rowHtml).not.toContain('<script>');
    expect(rowHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rowHtml).toContain('&quot;hello &amp; goodbye&quot;');
    expect(rowHtml).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
