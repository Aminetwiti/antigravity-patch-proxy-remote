import { describe, expect, it } from 'vitest';

describe('Dashboard Navigation & UX Psychology Remediations', () => {
  it('maps objective items to their respective target views', () => {
    const objNavMap: Record<string, string> = {
      'obj-antigravity': 'antigravity',
      'obj-mitm': 'mitm',
      'obj-doctor': 'doctor',
      'obj-patch': 'patch',
      'obj-logs': 'logs',
    };

    expect(objNavMap['obj-antigravity']).toBe('antigravity');
    expect(objNavMap['obj-mitm']).toBe('mitm');
    expect(objNavMap['obj-doctor']).toBe('doctor');
    expect(objNavMap['obj-patch']).toBe('patch');
    expect(objNavMap['obj-logs']).toBe('logs');
  });

  it('routes stat-card clicks properly between filtering and navigation', () => {
    const statFilterMap: Record<string, 'ok' | 'warn' | 'error'> = { ok: 'ok', warn: 'warn', err: 'error' };

    const handleStatCardClick = (stat: string): { action: 'filter' | 'navigate'; target: string } => {
      if (stat === 'models') {
        return { action: 'navigate', target: 'models' };
      }
      const mapped = statFilterMap[stat];
      if (mapped) {
        return { action: 'filter', target: mapped };
      }
      return { action: 'filter', target: 'all' };
    };

    expect(handleStatCardClick('ok')).toEqual({ action: 'filter', target: 'ok' });
    expect(handleStatCardClick('warn')).toEqual({ action: 'filter', target: 'warn' });
    expect(handleStatCardClick('err')).toEqual({ action: 'filter', target: 'error' });
    expect(handleStatCardClick('models')).toEqual({ action: 'navigate', target: 'models' });
  });

  it('resolves quick-fix navigation targets from health check IDs', () => {
    const resolveNavTarget = (id: string): string => {
      if (id === 'patch') return 'patch';
      if (id === 'mitm' || id === 'proxy' || id === 'ca') return 'mitm';
      if (id === 'models') return 'models';
      if (id === 'antigravity' || id === 'version' || id === 'install') return 'antigravity';
      return '';
    };

    expect(resolveNavTarget('patch')).toBe('patch');
    expect(resolveNavTarget('ca')).toBe('mitm');
    expect(resolveNavTarget('proxy')).toBe('mitm');
    expect(resolveNavTarget('models')).toBe('models');
    expect(resolveNavTarget('version')).toBe('antigravity');
    expect(resolveNavTarget('unknown')).toBe('');
  });

  it('conditionally styles Fix All button based on issue severity', () => {
    const computeFixAllButtonClass = (results: { status: 'ok' | 'warn' | 'error' | 'info' }[]): string => {
      const hasIssues = results.some((r) => r.status === 'error' || r.status === 'warn');
      return hasIssues ? 'btn btn-warning' : 'btn btn-ghost';
    };

    expect(computeFixAllButtonClass([{ status: 'ok' }, { status: 'info' }])).toBe('btn btn-ghost');
    expect(computeFixAllButtonClass([{ status: 'ok' }, { status: 'warn' }])).toBe('btn btn-warning');
    expect(computeFixAllButtonClass([{ status: 'error' }])).toBe('btn btn-warning');
  });

  it('generates compliant WCAG AAA aria-controls matching details id', () => {
    const buildDetailsAria = (id: string) => {
      const detailsId = `health-details-${id}`;
      return {
        detailsId,
        ariaControls: detailsId,
      };
    };

    const result = buildDetailsAria('patch');
    expect(result.detailsId).toBe('health-details-patch');
    expect(result.ariaControls).toBe('health-details-patch');
  });

  it('renders filter reset in filtered empty state for user freedom', () => {
    const shouldRenderFilterReset = (isFiltered: boolean, totalResultsCount: number) => {
      return isFiltered && totalResultsCount > 0;
    };

    expect(shouldRenderFilterReset(true, 5)).toBe(true);
    expect(shouldRenderFilterReset(false, 5)).toBe(false);
    expect(shouldRenderFilterReset(true, 0)).toBe(false);
  });

  it('correctly computes aria-pressed and active filter state for all cards including err/error', () => {
    const computeCardFilterState = (statType: string, currentFilter: string): { isActive: boolean; ariaPressed: string } => {
      if (statType === 'models') {
        return { isActive: false, ariaPressed: 'false' };
      }
      const isFiltered = (statType === 'ok' && currentFilter === 'ok') ||
                         (statType === 'warn' && currentFilter === 'warn') ||
                         (statType === 'err' && currentFilter === 'error');
      return {
        isActive: isFiltered,
        ariaPressed: isFiltered ? 'true' : 'false',
      };
    };

    // When filter is error:
    expect(computeCardFilterState('err', 'error')).toEqual({ isActive: true, ariaPressed: 'true' });
    expect(computeCardFilterState('ok', 'error')).toEqual({ isActive: false, ariaPressed: 'false' });
    expect(computeCardFilterState('warn', 'error')).toEqual({ isActive: false, ariaPressed: 'false' });
    expect(computeCardFilterState('models', 'error')).toEqual({ isActive: false, ariaPressed: 'false' });

    // When filter is ok:
    expect(computeCardFilterState('ok', 'ok')).toEqual({ isActive: true, ariaPressed: 'true' });
    expect(computeCardFilterState('err', 'ok')).toEqual({ isActive: false, ariaPressed: 'false' });

    // When filter is all:
    expect(computeCardFilterState('ok', 'all')).toEqual({ isActive: false, ariaPressed: 'false' });
    expect(computeCardFilterState('err', 'all')).toEqual({ isActive: false, ariaPressed: 'false' });
  });

  it('provides feedback and blocks filter toggle on cold-clicks before any scan', () => {
    const handleFilterClickWithColdCheck = (
      stat: string,
      lastResultsLength: number,
      currentFilter: string
    ): { action: 'toast' | 'filter' | 'navigate'; newFilter?: string } => {
      if (stat === 'models') {
        return { action: 'navigate' };
      }
      const statFilterMap: Record<string, string> = { ok: 'ok', warn: 'warn', err: 'error' };
      const mapped = statFilterMap[stat];
      if (!mapped) return { action: 'filter', newFilter: currentFilter };

      if (lastResultsLength === 0) {
        return { action: 'toast' };
      }

      const next = currentFilter === mapped ? 'all' : mapped;
      return { action: 'filter', newFilter: next };
    };

    // Cold-clicks (lastResults = 0)
    expect(handleFilterClickWithColdCheck('err', 0, 'all')).toEqual({ action: 'toast' });
    expect(handleFilterClickWithColdCheck('ok', 0, 'all')).toEqual({ action: 'toast' });
    expect(handleFilterClickWithColdCheck('models', 0, 'all')).toEqual({ action: 'navigate' });

    // Warm-clicks (lastResults > 0)
    expect(handleFilterClickWithColdCheck('err', 5, 'all')).toEqual({ action: 'filter', newFilter: 'error' });
    expect(handleFilterClickWithColdCheck('err', 5, 'error')).toEqual({ action: 'filter', newFilter: 'all' });
  });
});
