/**
 * token-heatmap-matrix.ts — Activity Heatmap Matrix & Day Inspector Component.
 * Extracted from view-dashboard.ts for Single Responsibility and modularity.
 */

function showDayInspector(
  cellDate: Date,
  tokensDay: number,
  mode: string,
  anchorEl: HTMLElement,
  dayData?: { convs: number; steps: number; estimatedTokens: number }
): void {
  const dayInspectorPopover = document.getElementById('dayInspectorPopover') as HTMLDivElement | null;
  const statsHeatmapMatrix = document.getElementById('statsHeatmapMatrix') as HTMLDivElement | null;
  if (!dayInspectorPopover) return;

  const dateTitle = cellDate.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateShort = cellDate.toLocaleDateString('fr-FR');
  const tokensFmt = typeof formatCompactTokens === 'function'
    ? formatCompactTokens(tokensDay)
    : (window as any).formatCompactTokens?.(tokensDay) || tokensDay.toLocaleString();

  const steps = dayData?.steps || 0;
  const convs = dayData?.convs || 0;
  const realStats = (window as any).cachedRealStats;
  const topModel = realStats?.modelsDistribution?.[0]?.model?.replace(' (Tiered)', '') || 'Gemini 3.8 Flash';

  let detailContent = '';
  if (tokensDay > 0 || steps > 0) {
    detailContent = `
      <div class="inspector-metric-val">${tokensFmt} <span style="font-size:12px; font-weight:normal; color:var(--text-2);">tokens</span></div>
      <div class="inspector-sub">Modèle prédominant : <strong>${escapeHtml(topModel)}</strong></div>
      <div class="inspector-chips">
        <span class="inspector-chip" style="color:#60a5fa;">📑 ${convs} session${convs > 1 ? 's' : ''}</span>
        <span class="inspector-chip" style="color:#93c5fd;">⚡ ${steps.toLocaleString()} étapes</span>
        <span class="inspector-chip" style="color:#34d399;">● Données réelles</span>
      </div>
    `;
  } else {
    detailContent = `
      <div class="inspector-metric-val" style="color:var(--text-3); font-size:18px;">0 <span style="font-size:12px; font-weight:normal;">token</span></div>
      <div class="inspector-sub" style="color:var(--text-3);">Aucune session enregistrée pour cette date</div>
      <div class="inspector-chips">
        <span class="inspector-chip" style="color:var(--text-3);">Journée inactive</span>
      </div>
    `;
  }

  dayInspectorPopover.innerHTML = `
    <div class="inspector-header">
      <div class="inspector-date">${escapeHtml(dateTitle)}</div>
      <button type="button" class="inspector-close-btn" id="inspectorCloseBtn" title="Fermer">✕</button>
    </div>
    ${detailContent}
    <button type="button" class="btn btn-sm btn-ghost" id="inspectorFilterLogsBtn" style="width:100%; font-size:11px; padding:5px 8px; justify-content:center; margin-top:8px;">
      🔍 Filtrer cette date dans les logs
    </button>
  `;

  // Position popover relative to heatmap container
  const parentRect = statsHeatmapMatrix?.parentElement?.getBoundingClientRect();
  const cellRect = anchorEl.getBoundingClientRect();
  if (parentRect) {
    const left = Math.max(10, Math.min(parentRect.width - 240, cellRect.left - parentRect.left - 100));
    dayInspectorPopover.style.left = `${left}px`;
    dayInspectorPopover.style.top = `38px`;
  }

  dayInspectorPopover.style.display = 'block';

  // Close event
  dayInspectorPopover.querySelector('#inspectorCloseBtn')?.addEventListener('click', () => {
    dayInspectorPopover.style.display = 'none';
  });

  // Filter logs event
  dayInspectorPopover.querySelector('#inspectorFilterLogsBtn')?.addEventListener('click', () => {
    dayInspectorPopover.style.display = 'none';
    const tokenLogsSearchInput = document.getElementById('tokenLogsSearch') as HTMLInputElement | null;
    if (tokenLogsSearchInput) {
      tokenLogsSearchInput.value = dateShort;
      if (typeof (window as any).currentTokenLogsPage !== 'undefined') {
        (window as any).currentTokenLogsPage = 1;
      }
      if (typeof (window as any).renderTokenDashboard === 'function') {
        (window as any).renderTokenDashboard();
      }
      const logsTable = document.getElementById('tokenLogsTable');
      logsTable?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

function renderHeatmapMatrix(range: string, mode: 'daily' | 'weekly' | 'cumulative', customStats?: any): void {
  const statsHeatmapMatrix = document.getElementById('statsHeatmapMatrix') as HTMLDivElement | null;
  const statsHeatmapMonthsRow = document.getElementById('statsHeatmapMonthsRow') as HTMLDivElement | null;
  const heatmapFloatingTooltip = document.getElementById('heatmapFloatingTooltip') as HTMLDivElement | null;
  if (!statsHeatmapMatrix) return;

  const realStats = customStats || (window as any).cachedRealStats;
  const customRangeStart = (window as any).customRangeStart || '';
  const customRangeEnd = (window as any).customRangeEnd || '';

  let totalCols = 32;
  let customEndDateObj: Date | null = null;
  if (range === 'today' || range === 'yesterday' || range === '24h') {
    totalCols = 1;
    if (range === 'yesterday') {
      customEndDateObj = new Date(Date.now() - 86400000);
    }
  } else if (range === '7d') {
    totalCols = 2;
  } else if (range === '30d' || range === 'this_month' || range === 'last_month') {
    totalCols = 5;
    if (range === 'last_month') {
      const d = new Date();
      customEndDateObj = new Date(d.getFullYear(), d.getMonth(), 0);
    }
  } else if (range === '7m') {
    totalCols = 32;
  } else if (range === 'all' || range === 'this_year') {
    totalCols = 52;
  } else if (range === 'custom') {
    if (customRangeStart && customRangeEnd) {
      const diffMs = Math.abs(new Date(customRangeEnd).getTime() - new Date(customRangeStart).getTime());
      const diffDays = Math.max(1, Math.ceil(diffMs / 86400000));
      totalCols = Math.max(2, Math.min(52, Math.ceil(diffDays / 7)));
      customEndDateObj = new Date(customRangeEnd + 'T23:59:59');
    } else {
      totalCols = 16;
    }
  }

  const daysPerCol = 7;
  const totalCells = totalCols * daysPerCol;

  // Build lookup map from real activity by day
  const activityMap = new Map<string, { convs: number; steps: number; estimatedTokens: number }>();
  if (realStats?.activityByDay) {
    for (const d of realStats.activityByDay) {
      if (d.day) activityMap.set(d.day, d);
    }
  }

  const peakDayTokens = realStats?.peakTokensDay?.tokens || 45_000_000;
  const lifetimeTotal = realStats?.estimatedLifetimeTokens || 97_000_000;

  const now = customEndDateObj || new Date();
  const frag = document.createDocumentFragment();

  const toYmd = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Pre-calculate weekly column totals
  const colWeeklyTokens = new Array<number>(totalCols).fill(0);
  let maxWeekTokens = 1;
  for (let c = 0; c < totalCols; c++) {
    let weekTok = 0;
    for (let r = 0; r < daysPerCol; r++) {
      const cellIndex = c * daysPerCol + r;
      const daysAgo = totalCells - 1 - cellIndex;
      const cellDate = new Date(now.getTime() - daysAgo * 86400000);
      const entry = activityMap.get(toYmd(cellDate));
      if (entry) weekTok += entry.estimatedTokens;
    }
    colWeeklyTokens[c] = weekTok;
    if (weekTok > maxWeekTokens) maxWeekTokens = weekTok;
  }

  let runningCumulative = 0;
  // Track each month's starting column so month labels align pixel-perfect with heatmap columns
  const monthPositions: Array<{ name: string; col: number }> = [];
  let lastMonthName = '';

  for (let c = 0; c < totalCols; c++) {
    // Detect month change on the column
    const colFirstCellIndex = c * daysPerCol;
    const colDaysAgo = totalCells - 1 - colFirstCellIndex;
    const colStartDate = new Date(now.getTime() - colDaysAgo * 86400000);
    const mName = colStartDate.toLocaleDateString('fr-FR', { month: 'short' });
    if (mName !== lastMonthName) {
      monthPositions.push({
        name: mName.charAt(0).toUpperCase() + mName.slice(1),
        col: c,
      });
      lastMonthName = mName;
    }

    for (let r = 0; r < daysPerCol; r++) {
      const cellIndex = c * daysPerCol + r;
      const daysAgo = totalCells - 1 - cellIndex;
      const cellDate = new Date(now.getTime() - daysAgo * 86400000);
      const dateStr = cellDate.toLocaleDateString('fr-FR', { weekday: 'short', month: 'short', day: 'numeric' });
      const ymd = toYmd(cellDate);
      const dayData = activityMap.get(ymd);

      let level = 0;
      let tokensDay = 0;

      if (mode === 'daily') {
        if (dayData && dayData.estimatedTokens > 0) {
          tokensDay = dayData.estimatedTokens;
          const ratio = tokensDay / peakDayTokens;
          level = ratio > 0.5 ? 4 : ratio > 0.2 ? 3 : ratio > 0.05 ? 2 : 1;
        } else {
          tokensDay = 0;
          level = 0;
        }
      } else if (mode === 'weekly') {
        const weekTok = colWeeklyTokens[c];
        tokensDay = weekTok;
        const ratio = weekTok / maxWeekTokens;
        level = ratio > 0.6 ? 4 : ratio > 0.3 ? 3 : ratio > 0.1 ? 2 : ratio > 0 ? 1 : 0;
      } else {
        // cumulative
        if (dayData) {
          runningCumulative += dayData.estimatedTokens;
        }
        tokensDay = runningCumulative;
        const ratio = runningCumulative / Math.max(1, lifetimeTotal);
        level = ratio > 0.8 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : ratio > 0.02 ? 1 : 0;
      }

      const cell = document.createElement('div');
      cell.className = `heatmap-cell level-${level}`;
      cell.tabIndex = 0;
      cell.setAttribute('role', 'gridcell');
      const descText = dayData ? `${dayData.steps} étapes, ${dayData.convs} session(s)` : '0 tâche';
      const formatTokens = typeof formatCompactTokens === 'function' ? formatCompactTokens : (window as any).formatCompactTokens;
      const cellLabel = `${dateStr} : ${formatTokens(tokensDay)} tokens (${descText}) — Cliquez pour inspecter`;
      cell.title = cellLabel;
      cell.setAttribute('aria-label', cellLabel);
      cell.addEventListener('mouseenter', () => {
        if (!heatmapFloatingTooltip) return;
        const desc = dayData ? `${dayData.steps.toLocaleString()} étapes · ${dayData.convs} session(s)` : '0 tâche';
        heatmapFloatingTooltip.innerHTML = `
          <div style="font-weight:700; color:#60a5fa; margin-bottom:2px;">${escapeHtml(dateStr)}</div>
          <div style="font-size:13px; font-weight:700; color:var(--text-0);">${formatTokens(tokensDay)} <span style="font-size:11px; font-weight:normal; color:var(--text-2);">tokens</span></div>
          <div style="font-size:10.5px; color:var(--text-2); margin-top:2px;">${desc}</div>
        `;
        const parentRect = statsHeatmapMatrix?.parentElement?.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        if (parentRect) {
          const left = Math.max(50, Math.min(parentRect.width - 60, cellRect.left - parentRect.left + 6));
          heatmapFloatingTooltip.style.left = `${left}px`;
          heatmapFloatingTooltip.style.top = `${Math.max(10, cellRect.top - parentRect.top)}px`;
          heatmapFloatingTooltip.style.display = 'block';
        }
      });
      cell.addEventListener('mouseleave', () => {
        if (heatmapFloatingTooltip) heatmapFloatingTooltip.style.display = 'none';
      });
      cell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (heatmapFloatingTooltip) heatmapFloatingTooltip.style.display = 'none';
        showDayInspector(cellDate, tokensDay, mode, cell, dayData);
      });
      cell.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          if (heatmapFloatingTooltip) heatmapFloatingTooltip.style.display = 'none';
          showDayInspector(cellDate, tokensDay, mode, cell, dayData);
        }
      });
      frag.appendChild(cell);
    }
  }

  statsHeatmapMatrix.replaceChildren(frag);

  // Update dynamic months row aligned with columns (each cell is 12px + 3.5px gap = 15.5px)
  if (statsHeatmapMonthsRow && monthPositions.length > 0) {
    const colStepPx = 15.5;
    const totalMatrixWidthPx = totalCols * colStepPx;
    statsHeatmapMonthsRow.style.position = 'relative';
    statsHeatmapMonthsRow.style.width = `${totalMatrixWidthPx}px`;
    statsHeatmapMonthsRow.style.height = '18px';
    statsHeatmapMonthsRow.style.display = 'block';

    const monthsFrag = document.createDocumentFragment();
    for (const m of monthPositions) {
      const span = document.createElement('span');
      span.textContent = m.name;
      span.style.position = 'absolute';
      span.style.left = `${Math.round(m.col * colStepPx)}px`;
      span.style.whiteSpace = 'nowrap';
      monthsFrag.appendChild(span);
    }
    statsHeatmapMonthsRow.replaceChildren(monthsFrag);
  }
}

if (typeof window !== 'undefined') {
  (window as any).renderHeatmapMatrix = renderHeatmapMatrix;
  (window as any).showDayInspector = showDayInspector;
}
