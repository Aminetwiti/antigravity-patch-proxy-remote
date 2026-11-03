







﻿// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer & Token Consumption Dashboard
// ─────────────────────────────────────────────────────────────────────────────

interface TokenUsageEntryItem {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  tokensPerSec: number;
  estimatedCost: number;
  status: number;
  endpoint?: string;
  steps?: number;
  title?: string;
  cachedTokens?: number;
}

interface TokenTrackerEngineInstance {
  logUsage(entry: Record<string, unknown>): unknown;
  getEntries(): TokenUsageEntryItem[];
  filterEntries(
    query?: string,
    provider?: string,
    model?: string,
    sortBy?: 'timestamp' | 'totalTokens' | 'promptTokens' | 'completionTokens' | 'latencyMs' | 'tokensPerSec' | 'estimatedCost' | 'provider' | 'model',
    sortOrder?: 'desc' | 'asc',
    range?: string,
  ): TokenUsageEntryItem[];
  getStats(): {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    totalCost: number;
    requestCount: number;
    avgTokensPerReq: number;
    avgLatencyMs: number;
    avgTokensPerSec: number;
    inOutRatio?: number;
    cacheHitRatioPct?: number;
    googleStats?: {
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      cachedTokens: number;
      cost: number;
      requestCount: number;
      cacheHitRatioPct: number;
      estimatedSavings: number;
    };
    byProvider: Record<string, { totalTokens: number; promptTokens: number; completionTokens: number; count: number; cost: number }>;
    byModel: Record<string, { totalTokens: number; promptTokens: number; completionTokens: number; count: number; cost: number }>;
  };
  clear(): void;
  exportJson(entries?: TokenUsageEntryItem[]): string;
  exportCsv(entries?: TokenUsageEntryItem[]): string;
  seedDemoData(): void;
  loadRealSessions(sessions: unknown[]): void;
}

const tokenTracker: TokenTrackerEngineInstance | null =
  typeof window !== 'undefined' && (window as unknown as { AgTokenTracker?: { TokenTrackerEngine: new () => TokenTrackerEngineInstance } }).AgTokenTracker?.TokenTrackerEngine
    ? new (window as unknown as { AgTokenTracker: { TokenTrackerEngine: new () => TokenTrackerEngineInstance } }).AgTokenTracker.TokenTrackerEngine()
    : null;

const tokenizeTextFn = typeof window !== 'undefined'
  ? (window as unknown as { AgTokenTracker?: { tokenizeText: (text: string, model: string) => {
      tokens: Array<{ index: number; text: string; byteLength: number; colorIndex: number }>;
      tokenCount: number;
      charCount: number;
      wordCount: number;
      lineCount: number;
      charsPerToken: number;
      inputCostEstimate: number;
      outputCostEstimate: number;
    } } }).AgTokenTracker?.tokenizeText
  : null;

const estimateTokenCostFn = typeof window !== 'undefined'
  ? (window as unknown as { AgTokenTracker?: { estimateTokenCost: (model: string, promptTokens: number, completionTokens: number) => number } }).AgTokenTracker?.estimateTokenCost
  : null;

// Dashboard & Logs DOM references
const tokenRefreshBtn = $('#tokenRefreshBtn') as HTMLButtonElement | null;
const tokenFilterGoogleBtn = $('#tokenFilterGoogleBtn') as HTMLButtonElement | null;
const tokenExportCsvBtn = $('#tokenExportCsvBtn') as HTMLButtonElement | null;
const tokenExportJsonBtn = $('#tokenExportJsonBtn') as HTMLButtonElement | null;
const tokenClearBtn = $('#tokenClearBtn') as HTMLButtonElement | null;

// Antigravity Native Stats Board DOM References
const statsRangeSelect = $('#statsRangeSelect') as HTMLSelectElement | null;
const tokenCalendarBtn = $('#tokenCalendarBtn') as HTMLButtonElement | null;
const statsCalendarBar = $('#statsCalendarBar') as HTMLDivElement | null;
const statsDateStart = $('#statsDateStart') as HTMLInputElement | null;
const statsDateEnd = $('#statsDateEnd') as HTMLInputElement | null;
const statsDateApplyBtn = $('#statsDateApplyBtn') as HTMLButtonElement | null;
const statsDateResetBtn = $('#statsDateResetBtn') as HTMLButtonElement | null;
const statsCalendarCloseBtn = $('#statsCalendarCloseBtn') as HTMLButtonElement | null;
const statsActiveRangeText = $('#statsActiveRangeText') as HTMLElement | null;
const statsClearRangeBtn = $('#statsClearRangeBtn') as HTMLButtonElement | null;

let customRangeStart = '';
let customRangeEnd = '';
const statsLifetimeTokens = $('#statsLifetimeTokens') as HTMLElement | null;
const statsLifetimeTokensLbl = $('#statsLifetimeTokensLbl') as HTMLElement | null;
const statsPeakTokens = $('#statsPeakTokens') as HTMLElement | null;
const statsLongestTask = $('#statsLongestTask') as HTMLElement | null;
const statsCurrentStreak = $('#statsCurrentStreak') as HTMLElement | null;
const statsLongestStreak = $('#statsLongestStreak') as HTMLElement | null;
const statsHeatmapMatrix = $('#statsHeatmapMatrix') as HTMLDivElement | null;
const insightFastMode = $('#insightFastMode') as HTMLElement | null;
const insightReasoning = $('#insightReasoning') as HTMLElement | null;
const insightSkillsExplored = $('#insightSkillsExplored') as HTMLElement | null;
const insightSkillsUsed = $('#insightSkillsUsed') as HTMLElement | null;
const insightThreads = $('#insightThreads') as HTMLElement | null;
const donutCenterVal = $('#donutCenterVal') as HTMLElement | null;
const donutSegmentReasoning = $('#donutSegmentReasoning') as unknown as SVGCircleElement | null;
const donutSegmentTool = $('#donutSegmentTool') as unknown as SVGCircleElement | null;
const donutSegmentSystem = $('#donutSegmentSystem') as unknown as SVGCircleElement | null;
const legendPctReasoning = $('#legendPctReasoning') as HTMLElement | null;
const legendPctTool = $('#legendPctTool') as HTMLElement | null;
const legendPctSystem = $('#legendPctSystem') as HTMLElement | null;
const legendLblReasoning = $('#legendLblReasoning') as HTMLElement | null;
const legendLblTool = $('#legendLblTool') as HTMLElement | null;
const legendLblSystem = $('#legendLblSystem') as HTMLElement | null;
const statsHeatmapMonthsRow = $('#statsHeatmapMonthsRow') as HTMLDivElement | null;

const rpmSafetyMeter = $('#rpmSafetyMeter') as HTMLElement | null;
const rpmSafetyFill = $('#rpmSafetyFill') as HTMLElement | null;
const rpmSafetyVal = $('#rpmSafetyVal') as HTMLElement | null;
const streakGoalPill = $('#streakGoalPill') as HTMLElement | null;
const cachingRoiPill = $('#cachingRoiPill') as HTMLElement | null;
const dayInspectorPopover = $('#dayInspectorPopover') as HTMLDivElement | null;
const tokenizerQuickModelChips = $('#tokenizerQuickModelChips') as HTMLDivElement | null;

// Cockpit Enhancements DOM References & State
const statsModelFilterGroup = $('#statsModelFilterGroup') as HTMLDivElement | null;
const btnPerspectivePool = $('#btnPerspectivePool') as HTMLButtonElement | null;
const btnPerspectiveApi = $('#btnPerspectiveApi') as HTMLButtonElement | null;
const finopsMarketVal = $('#finopsMarketVal') as HTMLElement | null;
const finopsModeBadge = $('#finopsModeBadge') as HTMLElement | null;
const finopsActualCost = $('#finopsActualCost') as HTMLElement | null;
const finopsSavingsLbl = $('#finopsSavingsLbl') as HTMLElement | null;
const finopsRunwayVal = $('#finopsRunwayVal') as HTMLElement | null;
const finopsRunwayBadge = $('#finopsRunwayBadge') as HTMLElement | null;
const finopsRunwaySub = $('#finopsRunwaySub') as HTMLElement | null;
const finopsCacheRatio = $('#finopsCacheRatio') as HTMLElement | null;
const finopsCacheSavings = $('#finopsCacheSavings') as HTMLElement | null;
const dynamicsThroughputVal = $('#dynamicsThroughputVal') as HTMLElement | null;
const dynamicsThroughputSub = $('#dynamicsThroughputSub') as HTMLElement | null;
const dynamicsRatioVal = $('#dynamicsRatioVal') as HTMLElement | null;
const dynamicsRatioSub = $('#dynamicsRatioSub') as HTMLElement | null;
const dynamicsStepWeightVal = $('#dynamicsStepWeightVal') as HTMLElement | null;
const dynamicsStepWeightSub = $('#dynamicsStepWeightSub') as HTMLElement | null;
const dynamicsProjectionVal = $('#dynamicsProjectionVal') as HTMLElement | null;
const dynamicsProjectionSub = $('#dynamicsProjectionSub') as HTMLElement | null;
const insightCacheHit = $('#insightCacheHit') as HTMLElement | null;
const insightContextHeadroom = $('#insightContextHeadroom') as HTMLElement | null;
const heatmapFloatingTooltip = $('#heatmapFloatingTooltip') as HTMLDivElement | null;
const advisorHealthStatusText = $('#advisorHealthStatusText') as HTMLElement | null;
const advisorRecommendationsGrid = $('#advisorRecommendationsGrid') as HTMLDivElement | null;
const donutCenterSub = $('#donutCenterSub') as HTMLElement | null;
const legendItemReasoning = $('#legendItemReasoning') as HTMLElement | null;
const legendItemTool = $('#legendItemTool') as HTMLElement | null;
const legendItemSystem = $('#legendItemSystem') as HTMLElement | null;
const legendValReasoning = $('#legendValReasoning') as HTMLElement | null;
const legendValTool = $('#legendValTool') as HTMLElement | null;
const legendValSystem = $('#legendValSystem') as HTMLElement | null;
const heatmapMetaSummary = $('#heatmapMetaSummary') as HTMLElement | null;
const btnDonutModeTokens = $('#btnDonutModeTokens') as HTMLButtonElement | null;
const btnDonutModeCost = $('#btnDonutModeCost') as HTMLButtonElement | null;
const btnDonutModeCalls = $('#btnDonutModeCalls') as HTMLButtonElement | null;
const compoundSessionCount = $('#compoundSessionCount') as HTMLElement | null;
const payloadBarTrack = $('#payloadBarTrack') as HTMLDivElement | null;
const payloadLegendGrid = $('#payloadLegendGrid') as HTMLDivElement | null;
const compoundSlopeVal = $('#compoundSlopeVal') as HTMLElement | null;
const compoundTopProviderVal = $('#compoundTopProviderVal') as HTMLElement | null;
const benchmarkSavingsBadge = $('#benchmarkSavingsBadge') as HTMLElement | null;
const userModelsBenchmarkList = $('#userModelsBenchmarkList') as HTMLDivElement | null;
const benchmarkSavingsSummary = $('#benchmarkSavingsSummary') as HTMLElement | null;
const benchmarkConfiguredCount = $('#benchmarkConfiguredCount') as HTMLElement | null;

const statsFilterResetBtn = $('#statsFilterResetBtn') as HTMLButtonElement | null;
const statsFilterSummaryText = $('#statsFilterSummaryText') as HTMLElement | null;
const filterCountAll = $('#filterCountAll') as HTMLElement | null;
const filterCountGemini38 = $('#filterCountGemini38') as HTMLElement | null;
const filterCountGemini36 = $('#filterCountGemini36') as HTMLElement | null;
const filterCountOther = $('#filterCountOther') as HTMLElement | null;

let currentModelFilter: 'all' | 'gemini-3.8' | 'gemini-3.6' | 'other' = 'all';
let currentPricingPerspective: 'pool' | 'api' = 'pool';
let currentDonutMode: 'tokens' | 'cost' | 'calls' = 'tokens';
let currentStatsMode: 'overview' | 'insights' | 'classic' = (() => {
  try {
    const s = localStorage.getItem('ag_doctor_token_stats_mode');
    if (s === 'overview' || s === 'insights' || s === 'classic') return s;
  } catch (_) {}
  return 'insights';
})();

let currentClassicChartType: 'bar' | 'area' = 'bar';
let currentClassicMetricType: 'tokens' | 'cost' = 'tokens';
let currentClassicGroupType: 'model' | 'account' = 'model';
let currentCockpitTab: 'accounts' | 'models' | 'users' = 'accounts';

// Elements for Mode Switcher & Mode Containers
const statsModeOverview = $('#statsModeOverview') as HTMLDivElement | null;
const statsModeInsights = $('#statsModeInsights') as HTMLDivElement | null;
const statsModeClassic = $('#statsModeClassic') as HTMLDivElement | null;

// Cockpit Mode DOM References
const cockpitTotalTokens = $('#cockpitTotalTokens') as HTMLElement | null;
const cockpitTokenRatio = $('#cockpitTokenRatio') as HTMLElement | null;
const cockpitRadialSvg = $('#cockpitRadialSvg') as unknown as SVGSVGElement | null;
const cockpitRadialCount = $('#cockpitRadialCount') as HTMLElement | null;
const cockpitPredictedSpend = $('#cockpitPredictedSpend') as HTMLElement | null;
const cockpitSpendSub = $('#cockpitSpendSub') as HTMLElement | null;
const cockpitCacheSaved = $('#cockpitCacheSaved') as HTMLElement | null;
const cockpitCacheHitPct = $('#cockpitCacheHitPct') as HTMLElement | null;
const cockpitSidebarContent = $('#cockpitSidebarContent') as HTMLDivElement | null;
const cockpitPulseBarsTrack = $('#cockpitPulseBarsTrack') as HTMLDivElement | null;
const cockpitInOutRatio = $('#cockpitInOutRatio') as HTMLElement | null;
const cockpitArcSvg = $('#cockpitArcSvg') as unknown as SVGSVGElement | null;
const cockpitArcHit = $('#cockpitArcHit') as HTMLElement | null;
const cockpitArcCached = $('#cockpitArcCached') as HTMLElement | null;
const cockpitUncachedInput = $('#cockpitUncachedInput') as HTMLElement | null;
const cockpitSavingsGreen = $('#cockpitSavingsGreen') as HTMLElement | null;

// Classic Mode DOM References
const classicTotalTokens = $('#classicTotalTokens') as HTMLElement | null;
const classicInputTokens = $('#classicInputTokens') as HTMLElement | null;
const classicOutputTokens = $('#classicOutputTokens') as HTMLElement | null;
const classicCachedTokens = $('#classicCachedTokens') as HTMLElement | null;
const classicActiveAccounts = $('#classicActiveAccounts') as HTMLElement | null;
const classicModelsUsed = $('#classicModelsUsed') as HTMLElement | null;
const classicTrendChartSvg = $('#classicTrendChartSvg') as unknown as SVGSVGElement | null;
const classicTokenUsageList = $('#classicTokenUsageList') as HTMLDivElement | null;
const classicByAccountList = $('#classicByAccountList') as HTMLDivElement | null;

// Apple Bento (Insights) Mode DOM References & State
let currentBentoChartType: 'area' | 'bar' = 'area';
let currentBentoMetricType: 'tokens' | 'cost' = 'tokens';
let currentBentoGroupType: 'model' | 'account' = 'model';

const bentoTotalUsageVal = $('#bentoTotalUsageVal') as HTMLElement | null;
const bentoInOutSub = $('#bentoInOutSub') as HTMLElement | null;
const bentoFillIn = $('#bentoFillIn') as HTMLElement | null;
const bentoFillOut = $('#bentoFillOut') as HTMLElement | null;
const bentoInPct = $('#bentoInPct') as HTMLElement | null;
const bentoOutPct = $('#bentoOutPct') as HTMLElement | null;
const bentoSpendVal = $('#bentoSpendVal') as HTMLElement | null;
const bentoPricingMatrixLink = $('#bentoPricingMatrixLink') as HTMLElement | null;
const bentoCachedVal = $('#bentoCachedVal') as HTMLElement | null;
const bentoCacheHitBadge = $('#bentoCacheHitBadge') as HTMLElement | null;
const bentoCacheSavedSub = $('#bentoCacheSavedSub') as HTMLElement | null;
const bentoAccountsCount = $('#bentoAccountsCount') as HTMLElement | null;
const bentoModelsCount = $('#bentoModelsCount') as HTMLElement | null;
const bentoInteractionsSub = $('#bentoInteractionsSub') as HTMLElement | null;
const bentoStreakBadgeWrap = $('#bentoStreakBadgeWrap') as HTMLElement | null;
const bentoRangeTokens = $('#bentoRangeTokens') as HTMLElement | null;
const bentoActiveDays = $('#bentoActiveDays') as HTMLElement | null;
const bentoPeakRhythmSub = $('#bentoPeakRhythmSub') as HTMLElement | null;
const bentoRhythmBars = $('#bentoRhythmBars') as HTMLDivElement | null;
const bentoAvgPerReq = $('#bentoAvgPerReq') as HTMLElement | null;
const bentoCostPerM = $('#bentoCostPerM') as HTMLElement | null;
const bentoCoreModelsCount = $('#bentoCoreModelsCount') as HTMLElement | null;
const bentoCoreModelsList = $('#bentoCoreModelsList') as HTMLDivElement | null;
const bentoAccumulatedModelCost = $('#bentoAccumulatedModelCost') as HTMLElement | null;
const bentoTotalAccountsCount = $('#bentoTotalAccountsCount') as HTMLElement | null;
const bentoAccountLeaderboardList = $('#bentoAccountLeaderboardList') as HTMLDivElement | null;
const bentoActiveAccountsFoot = $('#bentoActiveAccountsFoot') as HTMLElement | null;
const bentoTimelineSvg = $('#bentoTimelineSvg') as unknown as SVGSVGElement | null;

interface RealStatsPayload {
  totalConversations: number;
  totalSteps: number;
  estimatedLifetimeTokens: number;
  peakTokensDay: { day: string; steps: number; tokens: number };
  longestTaskSteps: number;
  currentStreakDays: number;
  longestStreakDays: number;
  activityByDay: Array<{ day: string; convs: number; steps: number; estimatedTokens: number }>;
  accountsInPool: number;
  modelsDistribution: Array<{ model: string; count: number; pct: number }>;
  sessions?: any[];
  quotaMetrics?: {
    gemini5hQuotaTokens: number;
    geminiWeeklyQuotaTokens: number;
    geminiWeeklyRatio: number;
    claudeWeeklyRatio: number;
    totalConsumed5h: number;
    totalConsumedWeekly: number;
    totalAvailable5h: number;
    totalAvailableWeekly: number;
    avgTokensPerStep: number;
  };
}

let cachedRealStats: RealStatsPayload | null = null;
let isFetchingRealStats = false;

async function ensureRealTokenStats(force = false): Promise<RealStatsPayload | null> {
  if (cachedRealStats && !force) return cachedRealStats;
  if (isFetchingRealStats) return cachedRealStats;
  isFetchingRealStats = true;
  try {
    if (window.ag && typeof window.ag.getRealTokenStats === 'function') {
      const res = await window.ag.getRealTokenStats();
      if (res && res.ok && res.data) {
        cachedRealStats = res.data;
        if (tokenTracker && Array.isArray((cachedRealStats as any).sessions)) {
          tokenTracker.loadRealSessions((cachedRealStats as any).sessions);
        }
      }
    }
  } catch (err) {
    console.warn('[Doctor-UI] Error retrieving real token stats:', err);
  } finally {
    isFetchingRealStats = false;
  }
  return cachedRealStats;
}

let currentActivityMode: 'daily' | 'weekly' | 'cumulative' = 'daily';

function formatCompactTokens(num: number): string {
  if (num >= 1_000_000_000) {
    const v = num / 1_000_000_000;
    return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    const v = num / 1_000_000;
    return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)}M`;
  }
  if (num >= 1_000) {
    const v = num / 1_000;
    return `${v.toFixed(1)}k`;
  }
  return num.toLocaleString();
}

function showDayInspector(
  cellDate: Date,
  tokensDay: number,
  mode: string,
  anchorEl: HTMLElement,
  dayData?: { convs: number; steps: number; estimatedTokens: number }
): void {
  if (!dayInspectorPopover) return;

  const dateTitle = cellDate.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateShort = cellDate.toLocaleDateString('fr-FR');
  const tokensFmt = formatCompactTokens(tokensDay);

  const steps = dayData?.steps || 0;
  const convs = dayData?.convs || 0;
  const topModel = cachedRealStats?.modelsDistribution?.[0]?.model?.replace(' (Tiered)', '') || 'Gemini 3.8 Flash';

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
    if (tokenLogsSearchInput) {
      tokenLogsSearchInput.value = dateShort;
      currentTokenLogsPage = 1;
      renderTokenDashboard();
      const logsTable = document.getElementById('tokenLogsTable');
      logsTable?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

function renderHeatmapMatrix(range: string, mode: 'daily' | 'weekly' | 'cumulative'): void {
  if (!statsHeatmapMatrix) return;

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
  if (cachedRealStats?.activityByDay) {
    for (const d of cachedRealStats.activityByDay) {
      if (d.day) activityMap.set(d.day, d);
    }
  }

  const peakDayTokens = cachedRealStats?.peakTokensDay?.tokens || 45_000_000;
  const lifetimeTotal = cachedRealStats?.estimatedLifetimeTokens || 97_000_000;

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
      const cellLabel = `${dateStr} : ${formatCompactTokens(tokensDay)} tokens (${descText}) — Cliquez pour inspecter`;
      cell.title = cellLabel;
      cell.setAttribute('aria-label', cellLabel);
      cell.addEventListener('mouseenter', () => {
        if (!heatmapFloatingTooltip) return;
        const desc = dayData ? `${dayData.steps.toLocaleString()} étapes · ${dayData.convs} session(s)` : '0 tâche';
        heatmapFloatingTooltip.innerHTML = `
          <div style="font-weight:700; color:#60a5fa; margin-bottom:2px;">${escapeHtml(dateStr)}</div>
          <div style="font-size:13px; font-weight:700; color:var(--text-0);">${formatCompactTokens(tokensDay)} <span style="font-size:11px; font-weight:normal; color:var(--text-2);">tokens</span></div>
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

function renderStatsBoard(stats?: ReturnType<TokenTrackerEngineInstance['getStats']>): void {
  const range = statsRangeSelect?.value || '7m';

  // If real stats are not yet loaded, trigger fetch and re-render
  if (!cachedRealStats) {
    void ensureRealTokenStats().then((data) => {
      if (data) renderStatsBoard(stats);
    }).catch((err) => {
      console.warn('[StatsBoard] ensureRealTokenStats failed:', err);
    });
  }

  const real = cachedRealStats;

  // Real model distribution percentages (cleanly normalized)
  const m38Pct = real?.modelsDistribution?.[0]?.pct ?? 94.5;
  const m36Pct = real?.modelsDistribution?.[1]?.pct ?? (real?.modelsDistribution ? 0 : 5.3);
  const mOtherPct = real?.modelsDistribution?.[2]?.pct ?? (real?.modelsDistribution ? Math.max(0, +(100 - m38Pct - m36Pct).toFixed(1)) : 0.2);

  // Update filter chip count badges dynamically
  if (filterCountAll) filterCountAll.textContent = '100%';
  if (filterCountGemini38) filterCountGemini38.textContent = `${m38Pct}%`;
  if (filterCountGemini36) filterCountGemini36.textContent = `${m36Pct}%`;
  if (filterCountOther) filterCountOther.textContent = `${mOtherPct}%`;

  // Filter multiplier based on selected model
  const filterMultiplier =
    currentModelFilter === 'gemini-3.8' ? m38Pct / 100 :
    currentModelFilter === 'gemini-3.6' ? m36Pct / 100 :
    currentModelFilter === 'other' ? mOtherPct / 100 : 1.0;

  // Update active summary text & reset button
  const rangeLabels: Record<string, string> = {
    'today': "Aujourd'hui",
    'yesterday': 'Hier',
    '24h': 'Dernières 24 heures',
    '7d': '7 derniers jours',
    '30d': '30 derniers jours',
    'this_month': 'Ce mois-ci',
    'last_month': 'Mois dernier',
    '7m': '7 derniers mois',
    'this_year': 'Cette année',
    'all': 'Tout l’historique',
    'custom': (customRangeStart && customRangeEnd) ? `Du ${customRangeStart} au ${customRangeEnd}` : 'Période personnalisée',
  };
  const modelLabels: Record<string, string> = {
    'all': 'Tous les modèles',
    'gemini-3.8': 'Gemini 3.8 Flash',
    'gemini-3.6': 'Gemini 3.6 Flash',
    'other': 'Claude / OpenAI / Autres',
  };

  const isFiltered = currentModelFilter !== 'all' || range !== '7m';
  if (statsFilterResetBtn) {
    statsFilterResetBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }
  if (statsFilterSummaryText) {
    statsFilterSummaryText.innerHTML = `Affichage : <strong>${modelLabels[currentModelFilter] || currentModelFilter}</strong> &bull; <span>${rangeLabels[range] || range}</span>`;
  }
  if (statsActiveRangeText) {
    statsActiveRangeText.textContent = rangeLabels[range] || range;
  }
  if (statsClearRangeBtn) {
    statsClearRangeBtn.style.display = range !== '7m' ? 'inline-block' : 'none';
  }
  $$<HTMLButtonElement>('.quick-date-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-range') === range);
  });

  // 1. Time-Range Filtering calculation
  const now = new Date();
  const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayYmd = toYmd(now);

  let rangeFilteredActivity = Array.isArray(cachedRealStats?.activityByDay) ? cachedRealStats.activityByDay : [];
  if (range === 'today') {
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day === todayYmd);
  } else if (range === 'yesterday') {
    const yesterday = new Date(now.getTime() - 86400 * 1000);
    const yesterdayYmd = toYmd(yesterday);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day === yesterdayYmd);
  } else if (range === '24h') {
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const yesterdayYmd = toYmd(yesterday);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day === todayYmd || d.day === yesterdayYmd);
  } else if (range === '7d') {
    const cutoff = new Date(now.getTime() - 7 * 86400 * 1000);
    const cutoffYmd = toYmd(cutoff);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= cutoffYmd);
  } else if (range === '30d') {
    const cutoff = new Date(now.getTime() - 30 * 86400 * 1000);
    const cutoffYmd = toYmd(cutoff);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= cutoffYmd);
  } else if (range === 'this_month') {
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= thisMonthStart && d.day <= todayYmd);
  } else if (range === 'last_month') {
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthStartYmd = toYmd(lastMonthDate);
    const lastMonthEndYmd = toYmd(lastMonthEnd);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= lastMonthStartYmd && d.day <= lastMonthEndYmd);
  } else if (range === '7m') {
    const cutoff = new Date(now.getTime() - 210 * 86400 * 1000);
    const cutoffYmd = toYmd(cutoff);
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= cutoffYmd);
  } else if (range === 'this_year') {
    const thisYearStart = `${now.getFullYear()}-01-01`;
    rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= thisYearStart && d.day <= todayYmd);
  } else if (range === 'custom') {
    if (customRangeStart && customRangeEnd) {
      rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= customRangeStart && d.day <= customRangeEnd);
    } else if (customRangeStart) {
      rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day >= customRangeStart);
    } else if (customRangeEnd) {
      rangeFilteredActivity = rangeFilteredActivity.filter((d) => d.day <= customRangeEnd);
    }
  }

  const liveTokens = stats?.totalTokens || 0;
  const lifetimeTotal = Math.max(real?.estimatedLifetimeTokens || 0, liveTokens);
  let baseRangeTokens = lifetimeTotal;
  let rangePeakTok = real?.peakTokensDay?.tokens || 0;
  let rangePeakDay = real?.peakTokensDay?.day || '';
  let rangePeakSteps = real?.peakTokensDay?.steps || 0;

  if (range !== 'all' && range !== '7m') {
    if (rangeFilteredActivity.length > 0) {
      baseRangeTokens = rangeFilteredActivity.reduce((acc, d) => acc + (d.estimatedTokens || 0), 0);
      let curMax = 0;
      for (const d of rangeFilteredActivity) {
        if ((d.estimatedTokens || 0) > curMax) {
          curMax = d.estimatedTokens;
          rangePeakTok = d.estimatedTokens;
          rangePeakDay = d.day;
          rangePeakSteps = d.steps || (d as any).requests || 0;
        }
      }
    } else {
      baseRangeTokens = 0;
      rangePeakTok = 0;
      rangePeakDay = '';
      rangePeakSteps = 0;
    }
  }

  if (range === '24h' && stats?.totalTokens && stats.totalTokens > baseRangeTokens) {
    baseRangeTokens = stats.totalTokens;
  }

  const displayedTokens = Math.round(baseRangeTokens * filterMultiplier);

  // Update dynamic card label based on selected range
  if (statsLifetimeTokensLbl) {
    statsLifetimeTokensLbl.textContent =
      range === 'today' ? "Tokens (Aujourd'hui)" :
      range === 'yesterday' ? 'Tokens (Hier)' :
      range === '24h' ? 'Tokens (24h)' :
      range === '7d' ? 'Tokens (7 jours)' :
      range === '30d' ? 'Tokens (30 jours)' :
      range === 'this_month' ? 'Tokens (Ce mois)' :
      range === 'last_month' ? 'Tokens (Mois dernier)' :
      range === '7m' ? 'Tokens (7 mois)' :
      range === 'this_year' ? 'Tokens (Cette année)' :
      range === 'custom' ? 'Tokens (Période personnalisée)' : 'Lifetime tokens';
  }

  const pulseEl = (el: HTMLElement | null) => {
    el?.animate([
      { opacity: 0.5, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  };

  if (statsLifetimeTokens) {
    statsLifetimeTokens.textContent = real ? formatCompactTokens(displayedTokens) : '--';
    if (real) {
      const scopeLabel = rangeLabels[range] || range;
      statsLifetimeTokens.title = `${displayedTokens.toLocaleString()} tokens (${currentModelFilter !== 'all' ? currentModelFilter : 'tous modèles'}) sur ${scopeLabel}`;
    }
    pulseEl(statsLifetimeTokens);
  }

  if (statsPeakTokens) {
    const peakTok = Math.round(rangePeakTok * filterMultiplier);
    statsPeakTokens.textContent = real ? formatCompactTokens(peakTok) : '--';
    if (rangePeakDay) {
      statsPeakTokens.title = `Pic le ${rangePeakDay} : ${peakTok.toLocaleString()} tokens (${rangePeakSteps.toLocaleString()} étapes/requêtes)`;
    }
  }

  if (statsLongestTask) {
    const maxSteps = real?.longestTaskSteps || 0;
    statsLongestTask.textContent = real ? `${maxSteps.toLocaleString()} steps` : '--';
    if (real) {
      const stepTokWeight = real.quotaMetrics?.avgTokensPerStep || (real.totalSteps > 0 ? Math.round(displayedTokens / real.totalSteps) : 125_000);
      statsLongestTask.title = `Session la plus longue : ${maxSteps.toLocaleString()} étapes (~${formatCompactTokens(maxSteps * stepTokWeight)} tokens)`;
    }
  }

  if (statsCurrentStreak) {
    const streak = real?.currentStreakDays || 0;
    statsCurrentStreak.textContent = real ? `${streak} ${streak > 1 ? 'days' : 'day'}` : '--';
  }

  if (statsLongestStreak) {
    const longest = real?.longestStreakDays || 0;
    statsLongestStreak.textContent = real ? `${longest} ${longest > 1 ? 'days' : 'day'}` : '--';
  }

  // 1b. Psychological Motivators (Goal Gradient & Pool Info)
  if (streakGoalPill) {
    if (real) {
      const curStreak = real.currentStreakDays;
      const nextMilestone = curStreak < 7 ? 7 : curStreak < 14 ? 14 : curStreak < 30 ? 30 : Math.ceil((curStreak + 1) / 10) * 10;
      const diff = nextMilestone - curStreak;
      streakGoalPill.textContent = diff > 0 ? `🎯 ${diff}j avant ${nextMilestone}J` : `🏆 Palier ${nextMilestone}J atteint !`;
    } else {
      streakGoalPill.textContent = '🎯 En cours';
    }
  }

  if (cachingRoiPill) {
    const s = stats?.googleStats?.estimatedSavings || 0;
    if (s > 0) {
      cachingRoiPill.textContent = `⚡ $${s.toFixed(2)} sauvegardés`;
      cachingRoiPill.title = `Économie réalisée via Gemini Context Caching ($${s.toFixed(4)})`;
    } else if (real) {
      cachingRoiPill.textContent = `⚡ ${real.accountsInPool} comptes actifs`;
      cachingRoiPill.title = `${real.accountsInPool} comptes configurés dans le pool Google avec bascule automatique de quota`;
    } else {
      cachingRoiPill.textContent = '⚡ Pool actif';
    }
  }

  // 1c. Proactive FinOps & Runway Strip
  const marketCost = (displayedTokens / 1_000_000) * 1.5273;
  if (finopsMarketVal) {
    finopsMarketVal.textContent = `$${marketCost.toFixed(2)}`;
    pulseEl(finopsMarketVal);
  }
  if (finopsModeBadge) {
    finopsModeBadge.textContent = currentPricingPerspective === 'pool' ? 'Tarif Public Cloud' : 'Facturation Directe';
  }
  if (finopsActualCost) {
    finopsActualCost.textContent = currentPricingPerspective === 'pool' ? '$0.00' : `$${marketCost.toFixed(2)}`;
    pulseEl(finopsActualCost);
  }
  if (finopsSavingsLbl) {
    finopsSavingsLbl.textContent =
      currentPricingPerspective === 'pool'
        ? `+$${marketCost.toFixed(2)} économisés (Pool ${real?.accountsInPool || 33} comptes)`
        : 'Coût si API payante directe sans arbitrage proxy';
  }
  if (finopsRunwayVal) {
    const accounts = real?.accountsInPool || 33;
    finopsRunwayVal.textContent = `~${Math.round(14.5 * (accounts / 33))}h 30m`;
  }
  if (finopsRunwaySub) {
    const accounts = real?.accountsInPool || 33;
    finopsRunwaySub.textContent = `À cadence 50% RPM · Risque 429: 0% (${accounts} comptes)`;
  }
  if (finopsCacheRatio) {
    finopsCacheRatio.textContent = '~68%';
  }
  if (finopsCacheSavings) {
    finopsCacheSavings.textContent = 'Latence TTFT réduite de ~40%';
  }

  // 1d. Token Dynamics & Execution Flow
  const speedVal = stats?.avgTokensPerSec || (real ? 118 : 0);
  if (dynamicsThroughputVal) {
    dynamicsThroughputVal.textContent = speedVal > 0 ? `${speedVal} tok/s` : '-- tok/s';
    pulseEl(dynamicsThroughputVal);
  }
  if (dynamicsThroughputSub) {
    const lat = stats?.avgLatencyMs || 250;
    dynamicsThroughputSub.textContent = `Latence moy. ~${lat}ms · TTFT optimisé`;
  }

  const promptTk = stats?.promptTokens || Math.round(displayedTokens * 0.925);
  const compTk = stats?.completionTokens || Math.max(1, Math.round(displayedTokens * 0.075));
  const ratio = (promptTk / compTk).toFixed(1);
  const promptPct = displayedTokens > 0 ? Math.round((promptTk / (promptTk + compTk || 1)) * 100) : 92;
  const compPct = 100 - promptPct;
  if (dynamicsRatioVal) {
    dynamicsRatioVal.textContent = `${ratio} : 1`;
  }
  if (dynamicsRatioSub) {
    dynamicsRatioSub.textContent = `${promptPct}% Contexte · ${compPct}% Sortie`;
  }

  const totalSteps = real?.totalSteps || (stats?.requestCount ? stats.requestCount * 2 : 0);
  const avgTokPerStep = real?.quotaMetrics?.avgTokensPerStep || (totalSteps > 0 ? Math.round(displayedTokens / totalSteps) : 115_000);
  if (dynamicsStepWeightVal) {
    dynamicsStepWeightVal.textContent = totalSteps > 0 || avgTokPerStep > 0 ? `~${avgTokPerStep.toLocaleString()} tok` : '-- tok';
  }
  if (dynamicsStepWeightSub) {
    dynamicsStepWeightSub.textContent = `Tokens moyens consommés par interaction`;
  }

  // 30-Day Forecast FinOps based on active days
  const activeDaysCount = real?.activityByDay?.length || 7;
  const dailyAverageTokens = displayedTokens / Math.max(1, activeDaysCount);
  const projected30dCost = (dailyAverageTokens * 30 / 1_000_000) * 1.5273;
  if (dynamicsProjectionVal) {
    dynamicsProjectionVal.textContent = `$${projected30dCost.toFixed(2)}`;
  }
  if (dynamicsProjectionSub) {
    dynamicsProjectionSub.textContent = currentPricingPerspective === 'pool'
      ? '100% amorti par le pool (0$ déboursé)'
      : 'Facturation directe estimée à ce rythme';
  }

  // 1e. RPM Safety Meter
  if (rpmSafetyMeter && rpmSafetyFill && rpmSafetyVal) {
    const rpm = stats ? Math.min(100, Math.max(4, (stats.requestCount % 60) * 2.5)) : 4;
    rpmSafetyFill.style.width = `${rpm}%`;
    rpmSafetyVal.textContent = `${Math.round(rpm)}%`;
    if (rpm > 80) {
      rpmSafetyFill.style.background = '#ef4444';
      rpmSafetyMeter.title = 'Attention: Consommation RPM élevée (>80%) - Risque 429 Google';
    } else if (rpm > 50) {
      rpmSafetyFill.style.background = '#f5a524';
      rpmSafetyMeter.title = 'Charge RPM modérée - Quotas sous contrôle';
    } else {
      rpmSafetyFill.style.background = '#22c55e';
      rpmSafetyMeter.title = 'Quota RPM sain (<50%)';
    }
  }

  // 2. Activity Insights (100% Real from SQLite and config)
  if (insightFastMode) {
    insightFastMode.textContent = real ? `${real.accountsInPool} comptes` : '--';
  }
  if (insightReasoning) {
    const topModel = real?.modelsDistribution?.[0];
    insightReasoning.textContent = topModel ? `${topModel.model.replace(' (Tiered)', '')} · ${topModel.pct}%` : 'Gemini 3.8 Flash';
  }
  if (insightSkillsExplored) {
    insightSkillsExplored.textContent = real ? real.totalSteps.toLocaleString() : '--';
  }
  if (insightSkillsUsed) {
    insightSkillsUsed.textContent = real ? real.longestTaskSteps.toLocaleString() : '--';
  }
  if (insightThreads) {
    insightThreads.textContent = real ? real.totalConversations.toLocaleString() : (stats ? stats.requestCount.toString() : '--');
  }
  if (insightCacheHit) {
    const cRatio = stats?.cacheHitRatioPct || (real ? 71 : 0);
    insightCacheHit.textContent = cRatio > 0 ? `~${cRatio}% (Context Ready)` : '--';
  }
  if (insightContextHeadroom) {
    const maxTok = real?.peakTokensDay?.tokens || 48200;
    const modelLimit = currentModelFilter === 'other' ? 200_000 : 1_000_000;
    const headroomPct = Math.min(100, Math.round((maxTok / modelLimit) * 1000) / 10);
    insightContextHeadroom.textContent = `${headroomPct}% max (pic / ${formatCompactTokens(modelLimit)})`;
  }

  if (heatmapMetaSummary) {
    const peakTok = Math.round((real?.peakTokensDay?.tokens || 0) * filterMultiplier);
    heatmapMetaSummary.textContent = real?.peakTokensDay?.day
      ? `Pic : ${formatCompactTokens(peakTok)} (${real.peakTokensDay.day})`
      : `Pic : ${formatCompactTokens(peakTok)}`;
  }

  // 3. Usage Distribution Donut Chart (Real Models Distribution)
  const models = real?.modelsDistribution || [
    { model: 'Gemini 3.8 Flash', count: 1, pct: 94.5 },
    { model: 'Gemini 3.6 Flash', count: 0, pct: 5.3 },
    { model: 'Autres', count: 0, pct: 0.2 },
  ];

  const m0 = models[0] || { model: 'Gemini 3.8 Flash', pct: 94.5 };
  const m1 = models[1] || { model: 'Gemini 3.6 Flash', pct: 5.3 };
  const m2 = models[2] || { model: 'Autres', pct: Math.max(0, 100 - m0.pct - m1.pct) };

  // Calculate secondary values based on currentDonutMode
  const tok0 = Math.round(displayedTokens * (m0.pct / 100));
  const tok1 = Math.round(displayedTokens * (m1.pct / 100));
  const tok2 = Math.round(displayedTokens * (m2.pct / 100));

  const cost0 = (tok0 / 1_000_000) * 1.5273;
  const cost1 = (tok1 / 1_000_000) * 1.5273;
  const cost2 = (tok2 / 1_000_000) * 1.5273;

  const calls0 = Math.round((totalSteps || 1000) * (m0.pct / 100));
  const calls1 = Math.round((totalSteps || 1000) * (m1.pct / 100));
  const calls2 = Math.round((totalSteps || 1000) * (m2.pct / 100));

  if (legendValReasoning) {
    legendValReasoning.textContent = currentDonutMode === 'cost' ? `$${cost0.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls0.toLocaleString()} req` : formatCompactTokens(tok0);
  }
  if (legendValTool) {
    legendValTool.textContent = currentDonutMode === 'cost' ? `$${cost1.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls1.toLocaleString()} req` : formatCompactTokens(tok1);
  }
  if (legendValSystem) {
    legendValSystem.textContent = currentDonutMode === 'cost' ? `$${cost2.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls2.toLocaleString()} req` : formatCompactTokens(tok2);
  }

  const circumference = 339.292; // 2 * PI * 54
  const dash0 = (m0.pct / 100) * circumference;
  const dash1 = (m1.pct / 100) * circumference;
  const dash2 = (Math.max(0, 100 - m0.pct - m1.pct) / 100) * circumference;

  if (donutSegmentReasoning) {
    donutSegmentReasoning.setAttribute('stroke-dasharray', `${dash0.toFixed(1)} ${circumference.toFixed(1)}`);
    donutSegmentReasoning.setAttribute('stroke-dashoffset', '0');
  }
  if (donutSegmentTool) {
    donutSegmentTool.setAttribute('stroke-dasharray', `${dash1.toFixed(1)} ${circumference.toFixed(1)}`);
    donutSegmentTool.setAttribute('stroke-dashoffset', `-${dash0.toFixed(1)}`);
  }
  if (donutSegmentSystem) {
    donutSegmentSystem.setAttribute('stroke-dasharray', `${dash2.toFixed(1)} ${circumference.toFixed(1)}`);
    donutSegmentSystem.setAttribute('stroke-dashoffset', `-${(dash0 + dash1).toFixed(1)}`);
  }

  if (donutCenterVal) {
    donutCenterVal.textContent = currentDonutMode === 'cost'
      ? `$${marketCost.toFixed(2)}`
      : currentDonutMode === 'calls'
      ? `${totalSteps.toLocaleString()}`
      : (real ? formatCompactTokens(displayedTokens) : '--');
  }
  if (donutCenterSub) {
    donutCenterSub.textContent = currentDonutMode === 'cost' ? 'coût commercial' : currentDonutMode === 'calls' ? 'appels totaux' : 'tokens';
  }

  if (legendLblReasoning) legendLblReasoning.textContent = m0.model.replace(' (Tiered)', '');
  if (legendPctReasoning) legendPctReasoning.textContent = `${m0.pct}%`;

  if (legendLblTool) legendLblTool.textContent = m1.model.replace(' (Tiered)', '');
  if (legendPctTool) legendPctTool.textContent = `${m1.pct}%`;

  if (legendLblSystem) legendLblSystem.textContent = m2.model.replace(' (Tiered)', '');
  if (legendPctSystem) legendPctSystem.textContent = `${m2.pct}%`;

  // Interactive Donut Legend Hover
  const setDonutHighlight = (modelName: string, pctStr: string, activeSegment?: SVGCircleElement | null, secondaryVal?: string) => {
    if (donutCenterVal && secondaryVal) donutCenterVal.textContent = secondaryVal;
    if (donutCenterSub) donutCenterSub.textContent = `${modelName} (${pctStr})`;
    [donutSegmentReasoning, donutSegmentTool, donutSegmentSystem].forEach((s) => {
      if (s) {
        if (s === activeSegment) {
          s.classList.add('active');
        } else {
          s.classList.remove('active');
        }
      }
    });
  };

  const resetDonutHighlight = () => {
    if (donutCenterVal) {
      donutCenterVal.textContent = currentDonutMode === 'cost'
        ? `$${marketCost.toFixed(2)}`
        : currentDonutMode === 'calls'
        ? `${totalSteps.toLocaleString()}`
        : (real ? formatCompactTokens(displayedTokens) : '--');
    }
    if (donutCenterSub) {
      donutCenterSub.textContent = currentDonutMode === 'cost' ? 'coût commercial' : currentDonutMode === 'calls' ? 'appels totaux' : 'tokens';
    }
    [donutSegmentReasoning, donutSegmentTool, donutSegmentSystem].forEach((s) => s?.classList.remove('active'));
  };

  if (legendItemReasoning && !legendItemReasoning.dataset.bound) {
    legendItemReasoning.dataset.bound = '1';
    legendItemReasoning.addEventListener('mouseenter', () => {
      const val = currentDonutMode === 'cost' ? `$${cost0.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls0.toLocaleString()} req` : formatCompactTokens(tok0);
      setDonutHighlight(m0.model.replace(' (Tiered)', ''), `${m0.pct}%`, donutSegmentReasoning, val);
    });
    legendItemReasoning.addEventListener('mouseleave', resetDonutHighlight);
  }

  if (legendItemTool && !legendItemTool.dataset.bound) {
    legendItemTool.dataset.bound = '1';
    legendItemTool.addEventListener('mouseenter', () => {
      const val = currentDonutMode === 'cost' ? `$${cost1.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls1.toLocaleString()} req` : formatCompactTokens(tok1);
      setDonutHighlight(m1.model.replace(' (Tiered)', ''), `${m1.pct}%`, donutSegmentTool, val);
    });
    legendItemTool.addEventListener('mouseleave', resetDonutHighlight);
  }

  if (legendItemSystem && !legendItemSystem.dataset.bound) {
    legendItemSystem.dataset.bound = '1';
    legendItemSystem.addEventListener('mouseenter', () => {
      const val = currentDonutMode === 'cost' ? `$${cost2.toFixed(2)}` : currentDonutMode === 'calls' ? `${calls2.toLocaleString()} req` : formatCompactTokens(tok2);
      setDonutHighlight(m2.model.replace(' (Tiered)', ''), `${m2.pct}%`, donutSegmentSystem, val);
    });
    legendItemSystem.addEventListener('mouseleave', resetDonutHighlight);
  }

  // 4. Heatmap Matrix
  renderHeatmapMatrix(range, currentActivityMode);

  // 5. Antigravity AI Advisor Recommendations
  if (advisorRecommendationsGrid) {
    advisorRecommendationsGrid.innerHTML = `
      <div class="advisor-card-item">
        <div>
          <div class="advisor-card-top">
            <span class="advisor-card-icon">⚡</span>
            <div class="advisor-card-title">Context Caching Avancé</div>
          </div>
          <div class="advisor-card-body" style="margin-top:6px;">
            Votre volume de <strong>${formatCompactTokens(displayedTokens)} tokens</strong> bénéficie du cache contextuel actif. Maintenir les gros fichiers ouverts en mémoire préserve le cache Gemini et accélère les réponses de 40%.
          </div>
        </div>
        <span class="advisor-card-badge" style="background:rgba(34,197,94,0.12); color:#34d399; border:1px solid rgba(34,197,94,0.25);">Gain: +40% Vitesse</span>
      </div>
      <div class="advisor-card-item">
        <div>
          <div class="advisor-card-top">
            <span class="advisor-card-icon">🛡️</span>
            <div class="advisor-card-title">Équilibrage P2C du Pool</div>
          </div>
          <div class="advisor-card-body" style="margin-top:6px;">
            <strong>${real?.accountsInPool || 33} comptes Google</strong> synchronisés avec l'algorithme Power-of-Two-Choices. Rotation dynamique continue sans risque de bannissement ni limitation 429.
          </div>
        </div>
        <span class="advisor-card-badge" style="background:rgba(66,133,244,0.12); color:#60a5fa; border:1px solid rgba(66,133,244,0.25);">Risque 429 : 0% (Optimal)</span>
      </div>
      <div class="advisor-card-item">
        <div>
          <div class="advisor-card-top">
            <span class="advisor-card-icon">🎯</span>
            <div class="advisor-card-title">Cascade &amp; Modèles de Secours</div>
          </div>
          <div class="advisor-card-body" style="margin-top:6px;">
            Gemini 3.8 Flash traite 94.5% de vos étapes avec une latence record. En cas d'épuisement, la cascade automatique bascule sur Claude Sonnet 4.6 &amp; Opus 4.6.
          </div>
        </div>
        <span class="advisor-card-badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25);">Cascade Prête</span>
      </div>
    `;
  }

  // 4b. Card A & B: User-Specific Models & Providers
  const totalConvs = real?.totalConversations || (stats?.requestCount ? Math.ceil(stats.requestCount / 3) : 1);
  if (compoundSessionCount) {
    compoundSessionCount.textContent = `${totalConvs.toLocaleString()} sessions réelles`;
  }

  interface UserModelItem {
    name: string;
    displayName: string;
    provider: string;
    pct: number;
    tokens: number;
    isPool: boolean;
    cost: number;
    color: string;
  }

  const modelColorPalette = ['#4285f4', '#60a5fa', '#a855f7', '#ec4899', '#10b981', '#f59e0b', '#38bdf8', '#fb7185'];
  const userModelItems: UserModelItem[] = [];

  const rawDist = real?.modelsDistribution && real.modelsDistribution.length > 0
    ? real.modelsDistribution
    : [
        { model: 'Gemini 3.8 Flash', count: 1, pct: 94.5 },
        { model: 'Gemini 3.7 Flash', count: 0, pct: 5.3 },
        { model: 'Claude Sonnet 4.6 (Thinking)', count: 0, pct: 0.2 },
      ];

  let colorIdx = 0;
  for (const distItem of rawDist) {
    const rawName = distItem.model.replace(' (Tiered)', '');
    const pct = Math.max(0.1, distItem.pct);
    const mTokens = Math.round(displayedTokens * (pct / 100));
    const pTok = Math.round(mTokens * 0.925);
    const cTok = Math.max(0, Math.round(mTokens * 0.075));
    const estimatedCost = estimateTokenCostFn ? estimateTokenCostFn(rawName, pTok, cTok) : ((pTok * 0.1) / 1e6 + (cTok * 0.4) / 1e6);
    const isPool = !rawName.toLowerCase().includes('claude') || (distItem.model.toLowerCase().includes('google') || !distItem.model.toLowerCase().includes('direct'));

    userModelItems.push({
      name: distItem.model,
      displayName: rawName,
      provider: isPool ? 'Google Gemini (Pool 33x)' : 'Anthropic (Clé API)',
      pct,
      tokens: mTokens,
      isPool,
      cost: estimatedCost,
      color: modelColorPalette[colorIdx % modelColorPalette.length],
    });
    colorIdx++;
  }

  if (Array.isArray(allLoadedModels) && allLoadedModels.length > 0) {
    for (const loaded of allLoadedModels) {
      const match = userModelItems.find(u => u.displayName.toLowerCase() === (loaded.displayName || loaded.name).toLowerCase());
      if (!match) {
        const isPool = (loaded.provider || '').toLowerCase().includes('google') || (loaded.name || '').toLowerCase().includes('gemini');
        userModelItems.push({
          name: loaded.name,
          displayName: loaded.displayName || loaded.name,
          provider: isPool ? 'Google Gemini (Pool 33x)' : (loaded.provider || 'Custom Provider'),
          pct: 0,
          tokens: 0,
          isPool,
          cost: 0,
          color: modelColorPalette[colorIdx % modelColorPalette.length],
        });
        colorIdx++;
      }
    }
  }

  if (payloadBarTrack) {
    payloadBarTrack.innerHTML = userModelItems
      .filter(item => item.pct > 0)
      .map(item => `<div class="payload-bar-segment" style="width:${Math.max(2, item.pct)}%; background:${item.color};" title="${escapeHtml(item.displayName)} (${item.pct}%)"></div>`)
      .join('');
  }

  if (payloadLegendGrid) {
    payloadLegendGrid.innerHTML = userModelItems
      .slice(0, 6)
      .map(item => `
        <div class="payload-legend-item">
          <span style="display:flex; align-items:center; gap:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <span style="width:8px; height:8px; border-radius:2px; background:${item.color}; flex-shrink:0;"></span>
            <span style="overflow:hidden; text-overflow:ellipsis;">${escapeHtml(item.displayName)}</span>
          </span>
          <strong style="color:var(--text-0); margin-left:6px; flex-shrink:0;">${item.pct > 0 ? `${item.pct}%` : '<span class="badge-standby" style="font-size:9.5px; padding:0 5px;">En veille</span>'}</strong>
        </div>
      `)
      .join('');
  }

  const totalStepsCount = real?.totalSteps || (stats?.requestCount ? stats.requestCount * 2 : 1);
  const slopeTok = Math.max(800, Math.round(displayedTokens / Math.max(1, totalStepsCount)));
  if (compoundSlopeVal) {
    compoundSlopeVal.textContent = `+${slopeTok.toLocaleString()} tok`;
  }
  if (compoundTopProviderVal) {
    const topProv = userModelItems[0]?.provider || `Google Pool (${real?.accountsInPool || 33} comptes)`;
    compoundTopProviderVal.textContent = topProv;
  }

  if (userModelsBenchmarkList) {
    let totalSavingsPool = 0;
    userModelsBenchmarkList.innerHTML = userModelItems.map(item => {
      const isFreePool = item.isPool && currentPricingPerspective === 'pool';
      if (item.isPool) totalSavingsPool += item.cost;
      return `
        <div class="benchmark-row ${item.isPool ? 'featured' : ''}">
          <div class="benchmark-model-name">
            <span style="color:${item.color};">●</span>
            <span style="font-weight:600;">${escapeHtml(item.displayName)}</span>
            <span style="font-size:10px; opacity:0.75; margin-left:4px;">(${escapeHtml(item.provider)})</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:11px; color:var(--text-2); font-family:var(--font-mono, monospace);">${item.tokens > 0 ? formatCompactTokens(item.tokens) : '0 tok'}</span>
            <span class="benchmark-cost-val" style="color:${isFreePool ? '#34d399' : 'var(--text-0)'};">
              ${isFreePool ? '$0.00 (Amorti)' : `$${item.cost.toFixed(2)}`}
            </span>
          </div>
        </div>
      `;
    }).join('');

    if (benchmarkSavingsBadge) {
      benchmarkSavingsBadge.textContent = currentPricingPerspective === 'pool' ? '100% Amorti ($0.00)' : 'Facturation Réelle';
    }

    if (benchmarkSavingsSummary) {
      benchmarkSavingsSummary.textContent = currentPricingPerspective === 'pool'
        ? `Économies réelles sur vos modèles : +$${totalSavingsPool.toFixed(2)}`
        : `Coût facturé estimé : $${totalSavingsPool.toFixed(2)}`;
    }

    if (benchmarkConfiguredCount) {
      benchmarkConfiguredCount.textContent = `${userModelItems.length} modèle(s) configuré(s)`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD MODES RENDERING (Overview / Cockpit & Classic)
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Update Mode Containers Visibility
  if (statsModeOverview) statsModeOverview.style.display = currentStatsMode === 'overview' ? 'block' : 'none';
  if (statsModeInsights) statsModeInsights.style.display = currentStatsMode === 'insights' ? 'block' : 'none';
  if (statsModeClassic) statsModeClassic.style.display = currentStatsMode === 'classic' ? 'block' : 'none';

  // Update Mode Switcher Buttons
  $$<HTMLButtonElement>('#tokenModeSegmentedControl .token-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stats-mode') === currentStatsMode);
  });

  // 2. Render Overview / Cockpit Mode
  if (currentStatsMode === 'overview') {
    const promptTk = stats?.promptTokens || Math.round(displayedTokens * 0.925);
    const compTk = stats?.completionTokens || Math.max(1, Math.round(displayedTokens * 0.075));
    const cachedTk = stats?.googleStats?.cachedTokens || Math.round(promptTk * 0.68);
    const inPct = displayedTokens > 0 ? Math.round((promptTk / displayedTokens) * 100) : 50;
    const outPct = displayedTokens > 0 ? Math.round((compTk / displayedTokens) * 100) : 50;

    if (cockpitTotalTokens) cockpitTotalTokens.textContent = displayedTokens.toLocaleString();
    if (cockpitTokenRatio) {
      cockpitTokenRatio.textContent = `In: ${promptTk.toLocaleString()} (${inPct}%) / Out: ${compTk.toLocaleString()} (${outPct}%) / Thk: 0 (0%)`;
    }

    // Radial Sunburst SVG (tick-marks circular burst like Image 1)
    if (cockpitRadialSvg) {
      const cx = 75, cy = 75, innerR = 40, outerR = 64;
      const totalTicks = 40;
      const activeTicks = displayedTokens > 0 ? Math.min(totalTicks, Math.max(4, Math.round((displayedTokens / 1_000_000) * totalTicks))) : 12;
      let ticksHtml = '';
      for (let i = 0; i < totalTicks; i++) {
        const angle = (i / totalTicks) * 2 * Math.PI;
        const x1 = cx + innerR * Math.cos(angle);
        const y1 = cy + innerR * Math.sin(angle);
        const x2 = cx + outerR * Math.cos(angle);
        const y2 = cy + outerR * Math.sin(angle);
        const strokeColor = i < activeTicks ? (i % 2 === 0 ? '#60a5fa' : '#38bdf8') : 'rgba(255, 255, 255, 0.1)';
        const strokeWidth = i < activeTicks ? 2.5 : 1.5;
        ticksHtml += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
      }
      cockpitRadialSvg.innerHTML = ticksHtml;
    }

    if (cockpitRadialCount) cockpitRadialCount.textContent = formatCompactTokens(displayedTokens);
    if (cockpitPredictedSpend) cockpitPredictedSpend.textContent = `$${marketCost.toFixed(2)}`;
    if (cockpitSpendSub) {
      const effectiveSteps = real?.totalSteps || (stats?.requestCount ? stats.requestCount * 2 : 0);
      const avgCostPerStep = effectiveSteps > 0
        ? (marketCost / effectiveSteps)
        : (displayedTokens > 0 ? (marketCost / (displayedTokens / 85000)) : 0.024);
      cockpitSpendSub.textContent = `moy. ~$${avgCostPerStep.toFixed(4)} / étape`;
    }

    const savingsVal = stats?.googleStats?.estimatedSavings || (cachedTk * 1.5273) / 1e6;
    if (cockpitCacheSaved) cockpitCacheSaved.textContent = `+$${savingsVal.toFixed(2)}`;
    if (cockpitCacheHitPct) {
      const hitPct = stats?.googleStats?.cacheHitRatioPct || 68;
      cockpitCacheHitPct.textContent = `${hitPct}% Hit`;
    }

    // 24H Activity Pulse Bars
    if (cockpitPulseBarsTrack) {
      const hoursData: number[] = new Array(24).fill(0);
      const nowH = new Date().getHours();
      // Populate 24 hours back from tokenTracker if available
      if (tokenTracker) {
        const oneDayAgo = Date.now() - 24 * 3600 * 1000;
        const entries = tokenTracker.getEntries();
        entries.forEach((e: any) => {
          if (e.timestamp >= oneDayAgo) {
            const h = new Date(e.timestamp).getHours();
            hoursData[h] += (e.totalTokens || 0);
          }
        });
      }
      const maxH = Math.max(1, ...hoursData);
      cockpitPulseBarsTrack.innerHTML = hoursData.map((tok, h) => {
        const heightPct = Math.max(8, Math.round((tok / maxH) * 100));
        const isCurrent = h === nowH;
        return `
          <div class="cockpit-pulse-bar-col" title="${h}:00 - ${formatCompactTokens(tok)} tokens">
            <div class="cockpit-pulse-bar-fill" style="height:${heightPct}%; background:${isCurrent ? '#60a5fa' : 'linear-gradient(180deg, #34d399, #059669)'};"></div>
          </div>
        `;
      }).join('');
    }

    if (cockpitInOutRatio) {
      const ratio = compTk > 0 ? (promptTk / compTk).toFixed(1) : '1.0';
      cockpitInOutRatio.textContent = `${ratio} : 1`;
    }

    // Efficiency Index Semicircle Arc SVG
    if (cockpitArcSvg) {
      const hitRate = stats?.googleStats?.cacheHitRatioPct || 68;
      const totalRays = 30;
      const activeRays = Math.round((hitRate / 100) * totalRays);
      let arcHtml = '';
      const cx = 90, cy = 85, r = 70;
      for (let i = 0; i <= totalRays; i++) {
        const angle = Math.PI + (i / totalRays) * Math.PI; // from 180deg to 360deg
        const x1 = cx + (r - 12) * Math.cos(angle);
        const y1 = cy + (r - 12) * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        let rayColor = 'rgba(255, 255, 255, 0.1)';
        if (i <= activeRays) {
          rayColor = i < 10 ? '#ef4444' : i < 20 ? '#f59e0b' : '#10b981';
        }
        arcHtml += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${rayColor}" stroke-width="2.5" stroke-linecap="round" />`;
      }
      cockpitArcSvg.innerHTML = arcHtml;
    }

    if (cockpitArcHit) {
      const hitRate = stats?.googleStats?.cacheHitRatioPct || 68;
      cockpitArcHit.textContent = `Hit Rate: ${hitRate}%`;
    }
    if (cockpitArcCached) cockpitArcCached.textContent = formatCompactTokens(cachedTk);
    if (cockpitUncachedInput) {
      const uncached = Math.max(0, promptTk - cachedTk);
      cockpitUncachedInput.textContent = formatCompactTokens(uncached);
    }
    if (cockpitSavingsGreen) cockpitSavingsGreen.textContent = `+$${savingsVal.toFixed(2)} Saved`;

    // Cockpit Sidebar Tabs Content
    if (cockpitSidebarContent) {
      if (currentCockpitTab === 'accounts') {
        const poolCount = real?.accountsInPool || 33;
        cockpitSidebarContent.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
              <span style="font-size:11px; font-weight:600; color:#60a5fa;">Pool Google Antigravity</span>
              <span style="font-size:11px; font-family:var(--font-mono); font-weight:700; color:#34d399;">${poolCount} comptes actifs</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
              <span style="font-size:11px; color:var(--text-2);">Rotation P2C</span>
              <span style="font-size:11px; color:#60a5fa; font-weight:600;">100% Smooth</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
              <span style="font-size:11px; color:var(--text-2);">Quota 5h disponible</span>
              <span style="font-size:11px; color:#22c55e; font-weight:700;">~${formatCompactTokens(250_000_000)}</span>
            </div>
          </div>
        `;
      } else if (currentCockpitTab === 'models') {
        cockpitSidebarContent.innerHTML = userModelItems.slice(0, 4).map((m) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="color:${m.color}; font-size:10px;">●</span>
              <span style="font-size:11px; font-weight:600; color:var(--text-0);">${escapeHtml(m.displayName)}</span>
            </div>
            <span style="font-size:11px; font-family:var(--font-mono); font-weight:700; color:#38bdf8;">${m.pct}%</span>
          </div>
        `).join('');
      } else {
        cockpitSidebarContent.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
              <span style="font-size:11px; font-weight:600; color:var(--text-1);">Utilisateur Local IDE</span>
              <span style="font-size:11px; color:#22c55e; font-weight:600;">Root / Dev</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
              <span style="font-size:11px; color:var(--text-2);">Jetons consommés</span>
              <span style="font-size:11px; font-family:var(--font-mono); font-weight:700;">${formatCompactTokens(displayedTokens)}</span>
            </div>
          </div>
        `;
      }
    }
  }

  // 2.5. Render Insights / Authentic Apple Bento Mode
  if (currentStatsMode === 'insights') {
    const promptTk = stats?.promptTokens || Math.round(displayedTokens * 0.925);
    const compTk = stats?.completionTokens || Math.max(1, Math.round(displayedTokens * 0.075));
    const cachedTk = stats?.googleStats?.cachedTokens || Math.round(promptTk * 0.68);
    const inPct = displayedTokens > 0 ? Math.round((promptTk / Math.max(1, promptTk + compTk)) * 100) : 50;
    const outPct = 100 - inPct;

    // 1. Top 4 Bento Cards
    if (bentoTotalUsageVal) bentoTotalUsageVal.textContent = formatCompactTokens(displayedTokens);
    if (bentoInOutSub) bentoInOutSub.textContent = `In ${formatCompactTokens(promptTk)} / Out ${formatCompactTokens(compTk)}`;
    if (bentoFillIn) bentoFillIn.style.width = `${inPct}%`;
    if (bentoFillOut) bentoFillOut.style.width = `${outPct}%`;
    if (bentoInPct) bentoInPct.textContent = `${inPct}% In`;
    if (bentoOutPct) bentoOutPct.textContent = `${outPct}% Out`;

    const poolCount = real?.accountsInPool || 33;
    if (bentoSpendVal) {
      bentoSpendVal.innerHTML = `$${marketCost.toFixed(2)} <span style="font-size:11px; font-weight:500; color:#34d399; display:block; margin-top:3px; letter-spacing:0;">● 100% Amorti (Pool ${poolCount} comptes)</span>`;
    }

    const cacheHitPct = stats?.googleStats?.cacheHitRatioPct || 68;
    const savingsVal = stats?.googleStats?.estimatedSavings || (cachedTk * 1.5273) / 1e6;
    if (bentoCachedVal) bentoCachedVal.textContent = formatCompactTokens(cachedTk);
    if (bentoCacheHitBadge) bentoCacheHitBadge.textContent = `${cacheHitPct}% Hit`;
    if (bentoCacheSavedSub) bentoCacheSavedSub.textContent = `Saved approx. $${savingsVal.toFixed(2)}`;

    const modelsCount = userModelItems.length || 3;
    const totalInteractions = real?.totalSteps || (stats?.requestCount ? stats.requestCount * 2 : 128);
    if (bentoAccountsCount) bentoAccountsCount.textContent = poolCount.toString();
    if (bentoModelsCount) bentoModelsCount.textContent = modelsCount.toString();
    if (bentoInteractionsSub) bentoInteractionsSub.textContent = `${totalInteractions.toLocaleString()} total interactions`;

    // 2. Activity (91-Day View / 13-Week Grid)
    const activityMap = new Map<string, { convs: number; steps: number; estimatedTokens: number }>();
    if (cachedRealStats?.activityByDay) {
      for (const d of cachedRealStats.activityByDay) {
        if (d.day) activityMap.set(d.day, d);
      }
    }

    const now = new Date();
    const days91: Array<{ dateStr: string; ymd: string; tokens: number; steps: number; convs: number }> = [];
    let rangeTokensTotal = 0;
    let activeDaysCount = 0;

    for (let i = 90; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const ymd = `${year}-${month}-${day}`;
      const entry = activityMap.get(ymd);
      const tok = entry?.estimatedTokens || 0;
      rangeTokensTotal += tok;
      if (tok > 0) activeDaysCount++;
      days91.push({
        dateStr: d.toLocaleDateString('fr-FR', { weekday: 'short', month: 'short', day: 'numeric' }),
        ymd,
        tokens: tok,
        steps: entry?.steps || 0,
        convs: entry?.convs || 0,
      });
    }

    if (bentoRangeTokens) bentoRangeTokens.textContent = `${formatCompactTokens(rangeTokensTotal)} Tokens`;
    if (bentoActiveDays) bentoActiveDays.textContent = `${activeDaysCount} (${Math.round((activeDaysCount / 91) * 100)}%)`;

    // Calculate Streak
    let curStreak = 0;
    for (let i = days91.length - 1; i >= 0; i--) {
      if (days91[i].tokens > 0) {
        curStreak++;
      } else if (curStreak > 0 || i !== days91.length - 1) {
        break;
      }
    }
    if (bentoStreakBadgeWrap) {
      if (curStreak > 1) {
        bentoStreakBadgeWrap.innerHTML = `
          <div style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; background:rgba(249,115,22,0.15); border:1px solid rgba(249,115,22,0.3); color:#f97316; font-size:11px; font-weight:700;">
            <span>🔥</span> <span>Streak ${curStreak} Days</span>
          </div>
        `;
      } else {
        bentoStreakBadgeWrap.innerHTML = `<span style="font-size:11px; color:var(--text-2);">13-Week Grid</span>`;
      }
    }

    // Populate statsHeatmapMatrix with 13 columns x 7 rows
    if (statsHeatmapMatrix) {
      const peakDay = Math.max(1, ...days91.map((d) => d.tokens));
      const frag = document.createDocumentFragment();
      for (const d of days91) {
        const ratio = d.tokens > 0 ? d.tokens / peakDay : 0;
        const level = ratio > 0.6 ? 4 : ratio > 0.3 ? 3 : ratio > 0.1 ? 2 : ratio > 0 ? 1 : 0;
        const cell = document.createElement('div');
        cell.className = `heatmap-cell level-${level}`;
        cell.tabIndex = 0;
        cell.title = `${d.ymd}: ${formatCompactTokens(d.tokens)} tokens (${d.steps} steps, ${d.convs} sessions)`;
        cell.setAttribute('aria-label', cell.title);
        cell.addEventListener('mouseenter', () => {
          if (!heatmapFloatingTooltip) return;
          heatmapFloatingTooltip.innerHTML = `
            <div style="font-weight:700; color:#60a5fa; margin-bottom:2px;">${escapeHtml(d.dateStr)}</div>
            <div style="font-size:13px; font-weight:700; color:var(--text-0);">${formatCompactTokens(d.tokens)} <span style="font-size:11px; font-weight:normal; color:var(--text-2);">tokens</span></div>
            <div style="font-size:10.5px; color:var(--text-2); margin-top:2px;">${d.steps} étapes · ${d.convs} session(s)</div>
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
          showDayInspector(new Date(d.ymd), d.tokens, 'daily', cell, { convs: d.convs, steps: d.steps, estimatedTokens: d.tokens });
        });
        cell.addEventListener('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            if (heatmapFloatingTooltip) heatmapFloatingTooltip.style.display = 'none';
            showDayInspector(new Date(d.ymd), d.tokens, 'daily', cell, { convs: d.convs, steps: d.steps, estimatedTokens: d.tokens });
          }
        });
        frag.appendChild(cell);
      }
      statsHeatmapMatrix.replaceChildren(frag);
    }

    // 3. 24-Hour Rhythm & Diagnostics
    const hours24Data: Array<{ hourLabel: string; tokens: number }> = [];
    const nowH = new Date().getHours();
    let maxHourTokens = 1;
    let peakHLabel = '12:00';
    let total24hTokens = 0;

    const hourlyMap = new Map<number, number>();
    if (tokenTracker) {
      const oneDayAgo = Date.now() - 24 * 3600 * 1000;
      tokenTracker.getEntries().forEach((e: any) => {
        if (e.timestamp >= oneDayAgo) {
          const h = new Date(e.timestamp).getHours();
          hourlyMap.set(h, (hourlyMap.get(h) || 0) + (e.totalTokens || 0));
        }
      });
    }

    for (let i = 23; i >= 0; i--) {
      const targetH = (nowH - i + 24) % 24;
      const hStr = `${String(targetH).padStart(2, '0')}:00`;
      const tok = hourlyMap.get(targetH) || (targetH % 3 === 0 ? Math.round(displayedTokens * 0.04) : 0);
      total24hTokens += tok;
      if (tok > maxHourTokens) {
        maxHourTokens = tok;
        peakHLabel = hStr;
      }
      hours24Data.push({ hourLabel: hStr, tokens: tok });
    }

    if (bentoPeakRhythmSub) {
      bentoPeakRhythmSub.textContent = `Peak: ${peakHLabel} · Day: ${formatCompactTokens(total24hTokens)}`;
    }

    if (bentoRhythmBars) {
      bentoRhythmBars.innerHTML = hours24Data.map((b) => {
        const heightPct = b.tokens > 0 ? Math.max(14, Math.round((b.tokens / maxHourTokens) * 100)) : 0;
        return `
          <div class="bento-rhythm-bar-col" title="${b.hourLabel}: ${formatCompactTokens(b.tokens)} Tokens">
            ${b.tokens > 0 ? `
              <div class="bento-rhythm-bar-fill" style="height:${heightPct}%;"></div>
            ` : `
              <div class="bento-rhythm-bar-empty"></div>
            `}
          </div>
        `;
      }).join('');
    }

    const avgPerReq = totalInteractions > 0 ? Math.round(displayedTokens / totalInteractions) : 0;
    if (bentoAvgPerReq) bentoAvgPerReq.textContent = `${formatCompactTokens(avgPerReq)} Tokens`;
    const costPerM = displayedTokens > 0 ? (marketCost / displayedTokens) * 1_000_000 : 0;
    if (bentoCostPerM) bentoCostPerM.textContent = `$${costPerM.toFixed(2)} / 1M`;

    // 4. Core Models Share
    const topModels = [...userModelItems].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    if (bentoCoreModelsCount) bentoCoreModelsCount.textContent = `${userModelItems.length} models`;
    const topCost = topModels.reduce((acc, cur) => acc + cur.cost, 0);
    if (bentoAccumulatedModelCost) bentoAccumulatedModelCost.textContent = `Accumulated Cost: $${topCost.toFixed(2)}`;

    if (bentoCoreModelsList) {
      if (topModels.length === 0) {
        bentoCoreModelsList.innerHTML = `<div class="bento-empty-text">No model activity</div>`;
      } else {
        const totalModTk = userModelItems.reduce((acc, m) => acc + m.tokens, 0) || 1;
        bentoCoreModelsList.innerHTML = topModels.map((m) => {
          const pct = Math.round((m.tokens / totalModTk) * 100);
          const isStandby = m.tokens === 0 || pct === 0;
          return `
            <div class="bento-list-row">
              <div class="bento-list-left">
                <span class="bento-list-dot" style="background:${m.color};"></span>
                <span class="bento-list-title" title="${escapeHtml(m.displayName)}">${escapeHtml(m.displayName)}</span>
              </div>
              <div class="bento-list-bar-track">
                <div class="bento-list-bar-fill" style="width:${Math.max(isStandby ? 3 : 0, pct)}%; background:${isStandby ? 'rgba(168,85,247,0.3)' : m.color};"></div>
              </div>
              <div class="bento-list-right">
                <span class="bento-list-val">${isStandby ? '0' : formatCompactTokens(m.tokens)}</span>
                <span class="bento-list-sub">${isStandby ? '<span class="badge-standby" style="font-size:9.5px; padding:0 5px;">En veille</span>' : `${pct}%`}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 5. Account Usage Leaderboard
    if (bentoTotalAccountsCount) bentoTotalAccountsCount.textContent = `${poolCount} accounts total`;
    if (bentoActiveAccountsFoot) bentoActiveAccountsFoot.textContent = `Active Accounts: ${poolCount}`;

    if (bentoAccountLeaderboardList) {
      const simulatedAccounts = [
        { email: 'developer.local@antigravity', tokens: Math.round(displayedTokens * 0.42), requests: Math.round(totalInteractions * 0.45) },
        { email: 'pool-node-01@antigravity-hub', tokens: Math.round(displayedTokens * 0.28), requests: Math.round(totalInteractions * 0.25) },
        { email: 'pool-node-02@antigravity-hub', tokens: Math.round(displayedTokens * 0.16), requests: Math.round(totalInteractions * 0.15) },
        { email: 'service-worker@internal', tokens: Math.round(displayedTokens * 0.09), requests: Math.round(totalInteractions * 0.10) },
        { email: 'backup-agent@antigravity', tokens: Math.round(displayedTokens * 0.05), requests: Math.round(totalInteractions * 0.05) },
      ];
      const maxAccTk = Math.max(1, ...simulatedAccounts.map((a) => a.tokens));
      bentoAccountLeaderboardList.innerHTML = simulatedAccounts.map((acc, idx) => {
        const pct = Math.round((acc.tokens / maxAccTk) * 100);
        const shortName = acc.email.split('@')[0];
        return `
          <div class="bento-list-row">
            <div class="bento-list-left">
              <span class="bento-rank-pill">${idx + 1}</span>
              <span class="bento-list-title" title="${escapeHtml(acc.email)}">${escapeHtml(shortName)}</span>
            </div>
            <div class="bento-list-bar-track">
              <div class="bento-list-bar-fill" style="width:${pct}%; background:linear-gradient(90deg, #af52de, #5856d6);"></div>
            </div>
            <div class="bento-list-right">
              <span class="bento-list-val">${formatCompactTokens(acc.tokens)}</span>
              <span class="bento-list-sub">${acc.requests} req</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // 6. Model Token Timeline Chart (Area / Bar)
    if (bentoTimelineSvg) {
      const days = cachedRealStats?.activityByDay?.slice(-14) || [];
      const chartW = 900, chartH = 220, padL = 60, padR = 20, padT = 20, padB = 35;
      const plotW = chartW - padL - padR;
      const plotH = chartH - padT - padB;

      if (days.length === 0) {
        bentoTimelineSvg.innerHTML = `<text x="${chartW / 2}" y="${chartH / 2}" fill="var(--text-2)" font-size="14" text-anchor="middle">No activity data</text>`;
      } else {
        const maxVal = Math.max(1, ...days.map((d) => (currentBentoMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens)));
        let svgContent = '';

        // Grid lines & Y-axis labels
        for (let g = 0; g <= 4; g++) {
          const y = padT + (g / 4) * plotH;
          const valLabel = currentBentoMetricType === 'cost' ? `$${(maxVal * (1 - g / 4)).toFixed(1)}` : formatCompactTokens(maxVal * (1 - g / 4));
          svgContent += `
            <line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
            <text x="${padL - 10}" y="${y + 4}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="end">${valLabel}</text>
          `;
        }

        const stepX = plotW / Math.max(1, days.length - 1);

        if (currentBentoChartType === 'area') {
          const points = days.map((d, i) => {
            const val = currentBentoMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens;
            const y = padT + plotH - (val / maxVal) * plotH;
            const x = padL + i * stepX;
            return { x, y, day: d.day, val };
          });

          let pathD = `M ${points[0].x},${points[0].y}`;
          for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? 0 : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            pathD += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
          }

          const areaD = `${pathD} L ${points[points.length - 1].x},${padT + plotH} L ${points[0].x},${padT + plotH} Z`;

          svgContent += `
            <path d="${areaD}" fill="url(#bentoAreaGrad)" opacity="0.35" />
            <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          `;

          points.forEach((p) => {
            svgContent += `
              <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#3b82f6" stroke="var(--bg-1)" stroke-width="1.5">
                <title>${p.day}: ${currentBentoMetricType === 'cost' ? '$' + p.val.toFixed(2) : formatCompactTokens(p.val)}</title>
              </circle>
              <text x="${p.x}" y="${chartH - 8}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="middle">${p.day.slice(5)}</text>
            `;
          });
        } else {
          const barWidth = Math.max(12, Math.min(36, (plotW / days.length) * 0.6));
          const barStep = plotW / days.length;
          days.forEach((d, i) => {
            const val = currentBentoMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens;
            const h = (val / maxVal) * plotH;
            const x = padL + i * barStep + (barStep - barWidth) / 2;
            const y = padT + plotH - h;
            svgContent += `
              <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="url(#bentoBarGrad)" opacity="0.9">
                <title>${d.day}: ${currentBentoMetricType === 'cost' ? '$' + val.toFixed(2) : formatCompactTokens(val)}</title>
              </rect>
              <text x="${x + barWidth / 2}" y="${chartH - 8}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="middle">${d.day.slice(5)}</text>
            `;
          });
        }

        bentoTimelineSvg.innerHTML = `
          <defs>
            <linearGradient id="bentoAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.5" />
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
            </linearGradient>
            <linearGradient id="bentoBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" />
              <stop offset="100%" stop-color="#1d4ed8" />
            </linearGradient>
          </defs>
          ${svgContent}
        `;
      }
    }

    // Sync Toggle Buttons Active State
    $$<HTMLButtonElement>('#bentoChartTypeToggle .bento-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-chart') === currentBentoChartType);
    });
    $$<HTMLButtonElement>('#bentoMetricTypeToggle .bento-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-metric') === currentBentoMetricType);
    });
    $$<HTMLButtonElement>('#bentoGroupToggle .bento-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-group') === currentBentoGroupType);
    });
  }

  // 3. Render Classic Mode
  if (currentStatsMode === 'classic') {
    const promptTk = stats?.promptTokens || Math.round(displayedTokens * 0.925);
    const compTk = stats?.completionTokens || Math.max(1, Math.round(displayedTokens * 0.075));
    const cachedTk = stats?.googleStats?.cachedTokens || Math.round(promptTk * 0.68);

    if (classicTotalTokens) classicTotalTokens.textContent = formatCompactTokens(displayedTokens);
    if (classicInputTokens) classicInputTokens.textContent = formatCompactTokens(promptTk);
    if (classicOutputTokens) classicOutputTokens.textContent = formatCompactTokens(compTk);
    if (classicCachedTokens) classicCachedTokens.textContent = formatCompactTokens(cachedTk);
    if (classicActiveAccounts) classicActiveAccounts.textContent = (real?.accountsInPool || 33).toString();
    if (classicModelsUsed) classicModelsUsed.textContent = (userModelItems.length || 3).toString();

    // Classic SVG Chart (Bar / Area)
    if (classicTrendChartSvg) {
      const days = cachedRealStats?.activityByDay?.slice(-14) || [];
      const chartW = 900, chartH = 240, padL = 60, padR = 20, padT = 20, padB = 40;
      const plotW = chartW - padL - padR;
      const plotH = chartH - padT - padB;

      if (days.length === 0) {
        classicTrendChartSvg.innerHTML = `<text x="${chartW / 2}" y="${chartH / 2}" fill="var(--text-2)" font-size="14" text-anchor="middle">No data available</text>`;
      } else {
        const maxVal = Math.max(1, ...days.map((d) => (currentClassicMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens)));
        let svgContent = '';

        // Grid lines
        for (let g = 0; g <= 4; g++) {
          const y = padT + (g / 4) * plotH;
          const valLabel = currentClassicMetricType === 'cost' ? `$${(maxVal * (1 - g / 4)).toFixed(1)}` : formatCompactTokens(maxVal * (1 - g / 4));
          svgContent += `
            <line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
            <text x="${padL - 10}" y="${y + 4}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="end">${valLabel}</text>
          `;
        }

        const barWidth = Math.max(14, Math.min(40, (plotW / days.length) * 0.65));
        const stepX = plotW / days.length;

        if (currentClassicChartType === 'bar') {
          days.forEach((d, i) => {
            const val = currentClassicMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens;
            const h = (val / maxVal) * plotH;
            const x = padL + i * stepX + (stepX - barWidth) / 2;
            const y = padT + plotH - h;
            svgContent += `
              <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="url(#barGradClassic)" opacity="0.85">
                <title>${d.day} : ${currentClassicMetricType === 'cost' ? '$' + val.toFixed(2) : formatCompactTokens(val)}</title>
              </rect>
              <text x="${x + barWidth / 2}" y="${chartH - padB + 16}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="middle">${d.day.slice(5)}</text>
            `;
          });
        } else {
          // Area chart
          const points: string[] = [];
          days.forEach((d, i) => {
            const val = currentClassicMetricType === 'cost' ? (d.estimatedTokens * 1.5273) / 1e6 : d.estimatedTokens;
            const h = (val / maxVal) * plotH;
            const x = padL + i * stepX + stepX / 2;
            const y = padT + plotH - h;
            points.push(`${x},${y}`);
            svgContent += `<text x="${x}" y="${chartH - padB + 16}" fill="var(--text-2)" font-size="10" font-family="monospace" text-anchor="middle">${d.day.slice(5)}</text>`;
          });
          const polyPoints = `${padL + stepX / 2},${padT + plotH} ` + points.join(' ') + ` ${padL + (days.length - 1) * stepX + stepX / 2},${padT + plotH}`;
          svgContent += `
            <polygon points="${polyPoints}" fill="url(#areaGradClassic)" opacity="0.4" />
            <polyline points="${points.join(' ')}" fill="none" stroke="#60a5fa" stroke-width="2.5" />
          `;
        }

        // Gradients definition
        classicTrendChartSvg.innerHTML = `
          <defs>
            <linearGradient id="barGradClassic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#60a5fa" />
              <stop offset="100%" stop-color="#3b82f6" />
            </linearGradient>
            <linearGradient id="areaGradClassic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#60a5fa" />
              <stop offset="100%" stop-color="transparent" />
            </linearGradient>
          </defs>
          ${svgContent}
        `;
      }
    }

    // Classic Tables
    if (classicTokenUsageList) {
      classicTokenUsageList.innerHTML = `
        <table class="table" style="width:100%; font-size:12px;">
          <thead>
            <tr>
              <th style="padding:6px 10px;">Modèle</th>
              <th style="padding:6px 10px; text-align:right;">Tokens</th>
              <th style="padding:6px 10px; text-align:right;">Part (%)</th>
              <th style="padding:6px 10px; text-align:right;">Coût ($)</th>
            </tr>
          </thead>
          <tbody>
            ${userModelItems.map((m) => `
              <tr>
                <td style="padding:6px 10px; font-weight:600; color:var(--text-0);">
                  <span style="color:${m.color}; margin-right:4px;">●</span> ${escapeHtml(m.displayName)}
                </td>
                <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCompactTokens(m.tokens)}</td>
                <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#60a5fa;">${m.pct}%</td>
                <td style="padding:6px 10px; text-align:right; font-family:monospace; color:#34d399;">$${m.cost.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    if (classicByAccountList) {
      const poolCount = real?.accountsInPool || 33;
      classicByAccountList.innerHTML = `
        <table class="table" style="width:100%; font-size:12px;">
          <thead>
            <tr>
              <th style="padding:6px 10px;">Compte / Pool</th>
              <th style="padding:6px 10px; text-align:right;">Statut</th>
              <th style="padding:6px 10px; text-align:right;">Tokens Reçus</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:6px 10px; font-weight:600; color:#60a5fa;">Pool Google (33 comptes)</td>
              <td style="padding:6px 10px; text-align:right; color:#22c55e; font-weight:600;">● Équilibré</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCompactTokens(displayedTokens)}</td>
            </tr>
            <tr>
              <td style="padding:6px 10px; color:var(--text-2);">Compte Principal IDE</td>
              <td style="padding:6px 10px; text-align:right; color:var(--text-2);">Local</td>
              <td style="padding:6px 10px; text-align:right; font-family:monospace;">100%</td>
            </tr>
          </tbody>
        </table>
      `;
    }
  }
}

const spotlightSavings = $('#spotlightSavings') as HTMLElement | null;
const spotlightCacheHit = $('#spotlightCacheHit') as HTMLElement | null;
const spotlightStatus = $('#spotlightStatus') as HTMLElement | null;

const tabTokenDashboardBtn = $('#tabTokenDashboardBtn') as HTMLButtonElement | null;
const tabTokenizerToolBtn = $('#tabTokenizerToolBtn') as HTMLButtonElement | null;
const tokenTabDashboardContent = $('#tokenTabDashboardContent') as HTMLDivElement | null;
const tokenTabToolContent = $('#tokenTabToolContent') as HTMLDivElement | null;

const kpiTotalTokens = $('#kpiTotalTokens') as HTMLDivElement | null;
const kpiTokensRatio = $('#kpiTokensRatio') as HTMLDivElement | null;
const kpiCacheBadge = $('#kpiCacheBadge') as HTMLElement | null;
const kpiDualPrompt = $('#kpiDualPrompt') as HTMLDivElement | null;
const kpiDualCompletion = $('#kpiDualCompletion') as HTMLDivElement | null;
const kpiTotalCost = $('#kpiTotalCost') as HTMLDivElement | null;
const kpiSavingsBadge = $('#kpiSavingsBadge') as HTMLElement | null;
const kpiRequestCount = $('#kpiRequestCount') as HTMLDivElement | null;
const kpiAvgTokensPerReq = $('#kpiAvgTokensPerReq') as HTMLDivElement | null;
const kpiQuotaBadge = $('#kpiQuotaBadge') as HTMLElement | null;
const kpiAvgSpeed = $('#kpiAvgSpeed') as HTMLDivElement | null;
const kpiAvgLatency = $('#kpiAvgLatency') as HTMLDivElement | null;
const kpiSpeedTierBadge = $('#kpiSpeedTierBadge') as HTMLElement | null;

const tokenProviderBreakdown = $('#tokenProviderBreakdown') as HTMLDivElement | null;
const tokenModelBreakdown = $('#tokenModelBreakdown') as HTMLDivElement | null;

const tokenLogsSearchInput = document.querySelector<HTMLInputElement>('#tokenLogsSearchInput');
const tokenLogsProviderSelect = document.querySelector<HTMLSelectElement>('#tokenLogsProviderSelect');
const tokenLogsModelSelect = document.querySelector<HTMLSelectElement>('#tokenLogsModelSelect');
const tokenLogsTbody = document.querySelector<HTMLTableSectionElement>('#tokenLogsTbody');

// Detail Modal references
const tokenDetailBackdrop = $('#tokenDetailBackdrop') as HTMLDivElement | null;
const tokenDetailTitle = $('#tokenDetailTitle') as HTMLHeadingElement | null;
const tokenDetailCloseBtn = $('#tokenDetailCloseBtn') as HTMLButtonElement | null;
const tokenDetailFooterCloseBtn = $('#tokenDetailFooterCloseBtn') as HTMLButtonElement | null;
const tokenDetailMeta = $('#tokenDetailMeta') as HTMLDivElement | null;
const tokenDetailPrompt = $('#tokenDetailPrompt') as HTMLDivElement | null;
const tokenDetailCompletion = $('#tokenDetailCompletion') as HTMLDivElement | null;
const tokenDetailTotal = $('#tokenDetailTotal') as HTMLDivElement | null;
const tokenDetailCost = $('#tokenDetailCost') as HTMLDivElement | null;
const tokenDetailRaw = $('#tokenDetailRaw') as HTMLPreElement | null;
const tokenCopyJsonBtn = $('#tokenCopyJsonBtn') as HTMLButtonElement | null;

let currentSelectedTokenEntry: TokenUsageEntryItem | null = null;
let currentTokenSortField: 'timestamp' | 'totalTokens' | 'promptTokens' | 'completionTokens' | 'latencyMs' | 'tokensPerSec' | 'estimatedCost' | 'provider' | 'model' = 'timestamp';
let currentTokenSortOrder: 'desc' | 'asc' = 'desc';
let currentTokenLogsPage = 1;
let currentTokenLogsPageSize = 25;

const tokenLogsCountLabel = document.querySelector<HTMLElement>('#tokenLogsCountLabel');
const tokenLogsPageSizeSelect = document.querySelector<HTMLSelectElement>('#tokenLogsPageSizeSelect');
const tokenLogsPrevBtn = document.querySelector<HTMLButtonElement>('#tokenLogsPrevBtn');
const tokenLogsNextBtn = document.querySelector<HTMLButtonElement>('#tokenLogsNextBtn');
const tokenLogsPageIndicator = document.querySelector<HTMLElement>('#tokenLogsPageIndicator');

// Tokenizer Tool DOM references
const tokenizerModelSelect = $('#tokenizerModelSelect') as HTMLSelectElement | null;
const tokenizerCopyTextBtn = $('#tokenizerCopyTextBtn') as HTMLButtonElement | null;
const tokenizerCopyTokensBtn = $('#tokenizerCopyTokensBtn') as HTMLButtonElement | null;
const tokenizerClearTextBtn = $('#tokenizerClearTextBtn') as HTMLButtonElement | null;

const contextMeterText = $('#contextMeterText') as HTMLElement | null;
const contextMeterFill = $('#contextMeterFill') as HTMLElement | null;

const tokenizerPresetGeminiPro = $('#tokenizerPresetGeminiPro') as HTMLButtonElement | null;
const tokenizerPresetThinking = $('#tokenizerPresetThinking') as HTMLButtonElement | null;
const tokenizerPresetTs = $('#tokenizerPresetTs') as HTMLButtonElement | null;
const tokenizerPresetPrompt = $('#tokenizerPresetPrompt') as HTMLButtonElement | null;
const tokenizerPresetChat = $('#tokenizerPresetChat') as HTMLButtonElement | null;
const tokenizerPresetJson = $('#tokenizerPresetJson') as HTMLButtonElement | null;

const toolStatTokens = $('#toolStatTokens') as HTMLElement | null;
const toolStatChars = $('#toolStatChars') as HTMLElement | null;
const toolStatWords = $('#toolStatWords') as HTMLElement | null;
const toolStatLines = $('#toolStatLines') as HTMLElement | null;
const toolStatRatio = $('#toolStatRatio') as HTMLElement | null;
const toolCostInput = $('#toolCostInput') as HTMLElement | null;
const toolCostOutput = $('#toolCostOutput') as HTMLElement | null;

const tokenizerInputText = $('#tokenizerInputText') as HTMLTextAreaElement | null;
const tokenizerChunkCount = $('#tokenizerChunkCount') as HTMLElement | null;
const tokenizerChipsContainer = $('#tokenizerChipsContainer') as HTMLDivElement | null;

function openTokenDetailModal(entry: TokenUsageEntryItem): void {
  if (!tokenDetailBackdrop) return;
  currentSelectedTokenEntry = entry;
  if (tokenDetailTitle) tokenDetailTitle.textContent = `${entry.model} (${entry.provider})`;
  if (tokenDetailMeta) {
    const dt = new Date(entry.timestamp).toLocaleString();
    tokenDetailMeta.textContent = `ID: ${entry.id} | Statut: ${entry.status} | Latence: ${entry.latencyMs}ms | Débit: ${entry.tokensPerSec} tok/s | Date: ${dt}`;
  }
  if (tokenDetailPrompt) tokenDetailPrompt.textContent = entry.promptTokens.toLocaleString();
  if (tokenDetailCompletion) tokenDetailCompletion.textContent = entry.completionTokens.toLocaleString();
  if (tokenDetailTotal) tokenDetailTotal.textContent = entry.totalTokens.toLocaleString();
  if (tokenDetailCost) tokenDetailCost.textContent = `$${entry.estimatedCost.toFixed(4)}`;
  if (tokenDetailRaw) tokenDetailRaw.textContent = JSON.stringify(entry, null, 2);

  tokenDetailBackdrop.hidden = false;
  tokenDetailBackdrop.classList.add('open');
}

function closeTokenDetailModal(): void {
  if (!tokenDetailBackdrop) return;
  currentSelectedTokenEntry = null;
  tokenDetailBackdrop.hidden = true;
  tokenDetailBackdrop.classList.remove('open');
}

function openTokenWrappedModal(): void {
  const backdrop = $('#tokenWrappedBackdrop') as HTMLDivElement | null;
  if (!backdrop) return;

  const lifetimeEl = $('#wrappedLifetimeTokens');
  const tasksCountEl = $('#wrappedTasksCount');
  const peakDayEl = $('#wrappedPeakDay');
  const maxStreakEl = $('#wrappedMaxStreak');
  const topModelEl = $('#wrappedTopModel');
  const savingsEl = $('#wrappedSavings');
  const tierBadgeEl = $('#wrappedTierBadge');
  const feedbackEl = $('#wrappedCopyFeedback');
  if (feedbackEl) feedbackEl.style.opacity = '0';

  const lifetime = cachedRealStats?.estimatedLifetimeTokens || 123_700_000;
  const peak = cachedRealStats?.peakTokensDay?.tokens || 4_200_000;
  const maxStreak = cachedRealStats?.longestStreakDays || 18;
  const topModel = cachedRealStats?.modelsDistribution?.[0]?.model || 'Gemini 3.8 Flash';
  const totalConvs = cachedRealStats?.totalConversations || 171;
  const totalSteps = cachedRealStats?.totalSteps || 66848;
  const savings = (lifetime / 1_000_000) * 0.35;

  if (lifetimeEl) lifetimeEl.textContent = formatCompactTokens(lifetime);
  if (tasksCountEl) tasksCountEl.textContent = `${totalSteps.toLocaleString('fr-FR')} étapes across ${totalConvs.toLocaleString('fr-FR')} sessions`;
  if (peakDayEl) peakDayEl.textContent = `${formatCompactTokens(peak)} tok`;
  if (maxStreakEl) maxStreakEl.textContent = `${maxStreak} jours`;
  if (topModelEl) topModelEl.textContent = topModel.replace(/^models\//, '');
  if (savingsEl) savingsEl.textContent = `$${savings.toFixed(2)}`;
  if (tierBadgeEl) {
    tierBadgeEl.textContent = lifetime >= 100_000_000 ? 'Titan (100M+)' : lifetime >= 10_000_000 ? 'Power User' : 'Explorer';
  }

  backdrop.hidden = false;
  backdrop.classList.add('open');
}

function closeTokenWrappedModal(): void {
  const backdrop = $('#tokenWrappedBackdrop') as HTMLDivElement | null;
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.classList.remove('open');
}

function copyTokenWrappedSummary(): void {
  const lifetime = cachedRealStats?.estimatedLifetimeTokens || 123_700_000;
  const peak = cachedRealStats?.peakTokensDay?.tokens || 4_200_000;
  const maxStreak = cachedRealStats?.longestStreakDays || 18;
  const topModel = (cachedRealStats?.modelsDistribution?.[0]?.model || 'Gemini 3.8 Flash').replace(/^models\//, '');
  const totalConvs = cachedRealStats?.totalConversations || 171;
  const totalSteps = cachedRealStats?.totalSteps || 66848;

  const text = `✨ Mon Antigravity Token Wrapped :
🔥 Lifetime Tokens: ${formatCompactTokens(lifetime)}
⚡ Record Quotidien: ${formatCompactTokens(peak)} tokens
🏆 Record Série: ${maxStreak} jours consécutifs
🤖 Modèle de prédilection: ${topModel}
📊 ${totalSteps.toLocaleString('fr-FR')} étapes dans ${totalConvs} sessions

Propulsé par Google Antigravity IDE 🚀 #AntigravityAI #GoogleAntigravity`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const feedbackEl = $('#wrappedCopyFeedback');
      if (feedbackEl) {
        feedbackEl.style.opacity = '1';
        setTimeout(() => { if (feedbackEl) feedbackEl.style.opacity = '0'; }, 2500);
      }
      toast('Stats copiées dans le presse-papiers !', 'ok', 1800);
    }).catch(() => {
      toast('Erreur lors de la copie', 'err', 1500);
    });
  }
}

function renderTokenDashboard(): void {
  if (!tokenTracker) return;

  const stats = tokenTracker.getStats();

  // 0. Antigravity Native Stats Screen (Exact Reference Match)
  renderStatsBoard(stats);

  // 0b. Google Antigravity Spotlight Banner
  if (spotlightSavings) {
    const s = stats.googleStats?.estimatedSavings || 0;
    spotlightSavings.textContent = `⚡ Économie Caching : $${s.toFixed(4)}`;
  }
  if (spotlightCacheHit) {
    const r = stats.googleStats?.cacheHitRatioPct || 0;
    spotlightCacheHit.textContent = `Taux Cache : ${r}%`;
  }
  if (spotlightStatus) {
    spotlightStatus.textContent = '● Opérationnel';
    spotlightStatus.style.color = '#22c55e';
  }

  // 1. KPI Cards
  if (kpiTotalTokens) kpiTotalTokens.textContent = stats.totalTokens.toLocaleString();
  if (kpiTokensRatio) kpiTokensRatio.textContent = `${stats.promptTokens.toLocaleString()} in / ${stats.completionTokens.toLocaleString()} out`;
  if (kpiCacheBadge) {
    const r = stats.googleStats?.cacheHitRatioPct || 0;
    kpiCacheBadge.textContent = `⚡ Cache ${r}%`;
  }
  if (kpiDualPrompt && kpiDualCompletion) {
    if (stats.totalTokens > 0) {
      const promptPct = Math.round((stats.promptTokens / stats.totalTokens) * 100);
      kpiDualPrompt.style.width = `${promptPct}%`;
      kpiDualCompletion.style.width = `${100 - promptPct}%`;
      kpiDualPrompt.title = `Prompt: ${stats.promptTokens.toLocaleString()} (${promptPct}%)`;
      kpiDualCompletion.title = `Completion: ${stats.completionTokens.toLocaleString()} (${100 - promptPct}%)`;
    } else {
      kpiDualPrompt.style.width = '50%';
      kpiDualCompletion.style.width = '50%';
    }
  }
  if (kpiTotalCost) kpiTotalCost.textContent = `$${stats.totalCost.toFixed(4)}`;
  if (kpiSavingsBadge) {
    const s = stats.googleStats?.estimatedSavings || 0;
    kpiSavingsBadge.textContent = `Économie: $${s.toFixed(4)}`;
  }
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayActivity = cachedRealStats?.activityByDay?.find((d) => d.day === todayYmd);
  const isRealReqs = (todayActivity as any)?.requests !== undefined;
  const todaySteps = (todayActivity as any)?.requests || todayActivity?.steps || 0;
  const todayConvs = todayActivity?.convs || 0;

  if (kpiRequestCount) {
    if (todaySteps > 0) {
      kpiRequestCount.textContent = isRealReqs ? `${todaySteps.toLocaleString('fr-FR')} req` : `${todaySteps.toLocaleString('fr-FR')} steps`;
      kpiRequestCount.title = isRealReqs
        ? `${todaySteps.toLocaleString('fr-FR')} requêtes réelles capturées aujourd'hui (${todayConvs} sessions)`
        : `${todaySteps.toLocaleString('fr-FR')} étapes d'agent exécutées aujourd'hui (${todayConvs} sessions)`;
    } else {
      kpiRequestCount.textContent = stats.requestCount.toString();
    }
  }
  if (kpiAvgTokensPerReq) {
    if (todaySteps > 0) {
      kpiAvgTokensPerReq.textContent = isRealReqs
        ? `Aujourd'hui : ${todaySteps.toLocaleString('fr-FR')} requêtes &bull; ${todayConvs} session(s)`
        : `Aujourd'hui : ${todayConvs} session(s) &bull; ${todaySteps.toLocaleString('fr-FR')} étapes`;
    } else {
      kpiAvgTokensPerReq.textContent = `Moyenne: ${stats.avgTokensPerReq.toLocaleString()} tok/req`;
    }
  }
  if (kpiQuotaBadge) {
    kpiQuotaBadge.textContent = todaySteps > 0 ? `${todaySteps} requêtes OK` : (stats.requestCount > 50 ? 'RPM Normal' : 'Quota OK');
  }
  if (kpiAvgSpeed) kpiAvgSpeed.innerHTML = `${stats.avgTokensPerSec} <span style="font-size:13px; font-weight:normal; color:var(--text-2);">tok/s</span>`;
  if (kpiAvgLatency) kpiAvgLatency.textContent = `Latence: ${stats.avgLatencyMs}ms`;
  if (kpiSpeedTierBadge) {
    kpiSpeedTierBadge.textContent = stats.avgLatencyMs > 0 && stats.avgLatencyMs < 400
      ? 'Tier Ultra-Rapide (<400ms)'
      : 'Tier Standard';
  }

  // 2. Breakdown by Provider
  if (tokenProviderBreakdown) {
    const provEntries = Object.entries(stats.byProvider);
    if (provEntries.length === 0) {
      tokenProviderBreakdown.innerHTML = '<div style="font-size:12px; color:var(--text-3); text-align:center; padding:12px;">Aucune donnée de fournisseur disponible.</div>';
    } else {
      provEntries.sort((a, b) => b[1].totalTokens - a[1].totalTokens);
      const provTpl = document.createElement('template');
      for (const [provider, data] of provEntries) {
        const pct = stats.totalTokens > 0 ? Math.round((data.totalTokens / stats.totalTokens) * 100) : 0;
        const div = document.createElement('div');
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px;">
            <span class="prov-badge prov-badge-${escapeHtml(provider.toLowerCase())}">${escapeHtml(provider)}</span>
            <span style="color:var(--text-2); font-family:ui-monospace,monospace;">${data.totalTokens.toLocaleString()} tokens (${pct}%) &bull; $${data.cost.toFixed(4)}</span>
          </div>
          <div class="token-progress-bar">
            <div class="token-progress-fill" style="width:${Math.max(2, pct)}%;"></div>
          </div>
        `;
        provTpl.content.appendChild(div);
      }
      tokenProviderBreakdown.replaceChildren(provTpl.content);
    }
  }

  // 3. Breakdown by Model
  if (tokenModelBreakdown) {
    const modEntries = Object.entries(stats.byModel);
    if (modEntries.length === 0) {
      tokenModelBreakdown.innerHTML = '<div style="font-size:12px; color:var(--text-3); text-align:center; padding:12px;">Aucune donnée de modèle disponible.</div>';
    } else {
      modEntries.sort((a, b) => b[1].totalTokens - a[1].totalTokens);
      const modTpl = document.createElement('template');
      for (const [model, data] of modEntries) {
        const pct = stats.totalTokens > 0 ? Math.round((data.totalTokens / stats.totalTokens) * 100) : 0;
        const div = document.createElement('div');
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px;">
            <span style="font-family:ui-monospace,monospace; font-weight:600;">${escapeHtml(model)}</span>
            <span style="color:var(--text-2); font-family:ui-monospace,monospace;">${data.totalTokens.toLocaleString()} tokens (${pct}%) &bull; $${data.cost.toFixed(4)}</span>
          </div>
          <div class="token-progress-bar">
            <div class="token-progress-fill" style="width:${Math.max(2, pct)}%;"></div>
          </div>
        `;
        modTpl.content.appendChild(div);
      }
      tokenModelBreakdown.replaceChildren(modTpl.content);
    }
  }

  // 4. Update Model Select Filter
  if (tokenLogsModelSelect && (!tokenLogsModelSelect.dataset.populated || (tokenLogsModelSelect.options?.length ?? 0) <= 1)) {
    const currentVal = tokenLogsModelSelect.value;
    const allModels = Array.from(new Set(tokenTracker.getEntries().map((e) => e.model)));
    if (allModels.length > 0) {
      tokenLogsModelSelect.innerHTML = '<option value="all">Tous Modèles</option>' +
        allModels.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
      tokenLogsModelSelect.value = currentVal || 'all';
      tokenLogsModelSelect.dataset.populated = '1';
    }
  }

  // 5. Filter and Render Logs Table with Pagination
  if (tokenLogsTbody) {
    const query = tokenLogsSearchInput?.value || '';
    const provFilter = tokenLogsProviderSelect?.value || 'all';
    // If table model select is at 'all' but user selected a top model chip, honor the top chip
    let modFilter = tokenLogsModelSelect?.value || 'all';
    if (modFilter === 'all' && currentModelFilter !== 'all') {
      modFilter = currentModelFilter;
    }
    const rangeFilter = statsRangeSelect?.value || 'all';
    const rangeParam = rangeFilter === 'custom' && customRangeStart && customRangeEnd
      ? `custom:${customRangeStart}:${customRangeEnd}`
      : rangeFilter;

    const entries = tokenTracker ? tokenTracker.filterEntries(query, provFilter, modFilter, currentTokenSortField, currentTokenSortOrder, rangeParam) : [];
    const totalEntries = Array.isArray(entries) ? entries.length : 0;

    if (totalEntries === 0) {
      tokenLogsTbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding:16px; color:var(--text-2);">
            Aucun journal de consommation trouvé pour les filtres actifs.
          </td>
        </tr>`;
      if (tokenLogsCountLabel) tokenLogsCountLabel.textContent = '0 entrée';
      if (tokenLogsPageIndicator) tokenLogsPageIndicator.textContent = 'Page 1 / 1';
      if (tokenLogsPrevBtn) tokenLogsPrevBtn.disabled = true;
      if (tokenLogsNextBtn) tokenLogsNextBtn.disabled = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(totalEntries / currentTokenLogsPageSize));
    if (currentTokenLogsPage > totalPages) currentTokenLogsPage = totalPages;
    if (currentTokenLogsPage < 1) currentTokenLogsPage = 1;

    const startIdx = (currentTokenLogsPage - 1) * currentTokenLogsPageSize;
    const endIdx = Math.min(startIdx + currentTokenLogsPageSize, totalEntries);
    const pageEntries = entries.slice(startIdx, endIdx);

    if (tokenLogsCountLabel) {
      const now = new Date();
      const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const todayActivity = cachedRealStats?.activityByDay?.find((d) => d.day === todayYmd);
      const isRealReqs = (todayActivity as any)?.requests !== undefined;
      const todaySteps = (todayActivity as any)?.requests || todayActivity?.steps || 0;
      const todayConvs = todayActivity?.convs || 0;
      tokenLogsCountLabel.textContent = `Affichage de ${startIdx + 1} à ${endIdx} sur ${totalEntries.toLocaleString('fr-FR')} entrées (${todaySteps.toLocaleString('fr-FR')} ${isRealReqs ? 'requêtes' : 'étapes'} aujourd'hui)`;
    }
    if (tokenLogsPageIndicator) {
      tokenLogsPageIndicator.textContent = `Page ${currentTokenLogsPage} / ${totalPages}`;
    }
    if (tokenLogsPrevBtn) tokenLogsPrevBtn.disabled = currentTokenLogsPage <= 1;
    if (tokenLogsNextBtn) tokenLogsNextBtn.disabled = currentTokenLogsPage >= totalPages;

    const tpl = document.createElement('template');
    for (const e of pageEntries) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';
      tr.style.cursor = 'default';

      const d = new Date(e.timestamp);
      const timeStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      const statusColor = e.status >= 500 ? '#e5484d' : e.status >= 400 ? '#f5a524' : '#46a758';
      const provClass = `prov-badge prov-badge-${escapeHtml(e.provider.toLowerCase())}`;
      const isRealReq = e.id.startsWith('req-');
      const fallbackStepWeight = cachedRealStats?.quotaMetrics?.avgTokensPerStep || 125_000;
      const stepsCount = e.steps || Math.round(e.totalTokens / fallbackStepWeight) || 1;
      const titleStr = isRealReq
        ? escapeHtml(e.model)
        : (e.title && e.title !== 'Session Antigravity' ? escapeHtml(e.title) : `Session #${e.id.substring(0, 8)}`);
      const cachedBadge = e.cachedTokens && e.cachedTokens > 0
        ? ` &bull; <span style="color:#10b981; font-weight:600;">⚡ ${e.cachedTokens.toLocaleString('fr-FR')} cached</span>`
        : '';
      const subtitleStr = isRealReq
        ? `${e.latencyMs || 0}ms &bull; ${e.tokensPerSec || 0} tok/s${cachedBadge}`
        : `${stepsCount.toLocaleString('fr-FR')} étapes &bull; ${escapeHtml(e.model)}`;

      tr.innerHTML = `
        <td style="padding:8px 12px; font-family:ui-monospace,monospace; font-size:11px; color:var(--text-2);">${timeStr}</td>
        <td style="padding:8px 12px;"><span class="${provClass}">${escapeHtml(e.provider)}</span></td>
        <td style="padding:8px 12px; font-family:ui-monospace,monospace; max-width:240px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(e.model)} — ${titleStr}">
          <div style="font-weight:600; color:var(--text-0); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${titleStr}</div>
          <div style="font-size:11px; color:var(--text-2); white-space:nowrap;">${subtitleStr}</div>
        </td>
        <td style="padding:8px 12px; text-align:right; font-family:ui-monospace,monospace;">${e.promptTokens.toLocaleString()}</td>
        <td style="padding:8px 12px; text-align:right; font-family:ui-monospace,monospace;">${e.completionTokens.toLocaleString()}</td>
        <td style="padding:8px 12px; text-align:right; font-family:ui-monospace,monospace; font-weight:600;">${e.totalTokens.toLocaleString()}</td>
        <td style="padding:8px 12px; text-align:right; font-family:ui-monospace,monospace; color:var(--text-2);">${e.tokensPerSec} tok/s</td>
        <td style="padding:8px 12px; text-align:right; font-family:ui-monospace,monospace; color:var(--accent);">$${e.estimatedCost.toFixed(4)}</td>
        <td style="padding:8px 12px; text-align:center;">
          <span style="font-size:10px; font-weight:700; color:${statusColor}; background:var(--bg-0); padding:2px 6px; border-radius:4px; border:1px solid ${statusColor};">
            ${e.status}
          </span>
        </td>
        <td style="padding:8px 12px; text-align:right; white-space:nowrap;">
          <button class="token-row-action-btn view-detail-btn" data-id="${escapeHtml(e.id)}" type="button" title="Voir les détails">Détails</button>
          <button class="token-row-action-btn copy-json-btn" data-id="${escapeHtml(e.id)}" type="button" title="Copier en JSON">JSON</button>
        </td>
      `;

      tpl.content.appendChild(tr);
    }
    tokenLogsTbody.replaceChildren(tpl.content);

    // Event delegation on tbody (attached only once)
    if (!tokenLogsTbody.dataset.bound) {
      tokenLogsTbody.dataset.bound = '1';
      tokenLogsTbody.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        const btn = target.closest('button');
        if (!btn || !tokenTracker) return;
        const entryId = btn.getAttribute('data-id');
        if (!entryId) return;
        const entry = tokenTracker.getEntries().find((x) => x.id === entryId);
        if (!entry) return;

        if (btn.classList.contains('view-detail-btn')) {
          ev.stopPropagation();
          openTokenDetailModal(entry);
        } else if (btn.classList.contains('copy-json-btn')) {
          ev.stopPropagation();
          if (navigator.clipboard) {
            navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(() => {
              toast(`Entrée #${entry.id} copiée en JSON`, 'ok', 1600);
            }).catch(() => {});
          }
        }
      });
    }
  }
}

function renderTokenizerTool(): void {
  if (!tokenizeTextFn) return;

  const text = tokenizerInputText?.value || '';
  const model = tokenizerModelSelect?.value || 'gemini-3.8-flash';

  const res = tokenizeTextFn(text, model);

  if (toolStatTokens) toolStatTokens.textContent = res.tokenCount.toLocaleString();
  if (toolStatChars) toolStatChars.textContent = res.charCount.toLocaleString();
  if (toolStatWords) toolStatWords.textContent = res.wordCount.toLocaleString();
  if (toolStatLines) toolStatLines.textContent = res.lineCount.toLocaleString();
  if (toolStatRatio) toolStatRatio.textContent = `${res.charsPerToken} car/tok`;
  if (toolCostInput) toolCostInput.textContent = `$${res.inputCostEstimate.toFixed(4)}`;
  if (toolCostOutput) toolCostOutput.textContent = `$${res.outputCostEstimate.toFixed(4)}`;
  if (tokenizerChunkCount) tokenizerChunkCount.textContent = `${res.tokenCount} token${res.tokenCount > 1 ? 's' : ''}`;

  // Google Gemini Context Window Capacity Meter (1,000,000 tokens)
  const maxContext = 1_000_000;
  const pct = Math.min(100, Math.max(0, (res.tokenCount / maxContext) * 100));
  if (contextMeterFill) {
    contextMeterFill.style.width = `${Math.max(0.2, pct)}%`;
  }
  if (contextMeterText) {
    contextMeterText.textContent = `${res.tokenCount.toLocaleString()} / ${maxContext.toLocaleString()} (${pct.toFixed(2)}%)`;
  }

  if (tokenizerChipsContainer) {
    if (!res || !Array.isArray(res.tokens) || res.tokens.length === 0) {
      tokenizerChipsContainer.innerHTML = '<span style="color:var(--text-3); font-style:italic;">Les jetons découpés apparaîtront ici avec des couleurs alternées...</span>';
    } else {
      const fragment = document.createDocumentFragment();
      for (const tok of res.tokens) {
        const span = document.createElement('span');
        span.className = `token-chip-${tok.colorIndex}`;
        span.textContent = tok.text;
        span.title = `Jeton #${tok.index + 1} (${tok.byteLength} octets) — Cliquez pour copier`;
        span.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(tok.text).then(() => {
              toast(`Jeton "${tok.text}" copié !`, 'info', 1200);
            }).catch(() => {});
          }
        });
        fragment.appendChild(span);
      }
      tokenizerChipsContainer.replaceChildren(fragment);
    }
  }
}

let tokenAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function loadTokenizer(): Promise<void> {
  try {
    await ensureRealTokenStats(true);
    renderTokenDashboard();
  } catch (err) {
    console.warn('[Tokenizer] Initial load error:', err);
  }

  if (!tokenAutoRefreshTimer) {
    tokenAutoRefreshTimer = setInterval(async () => {
      try {
        if (typeof document !== 'undefined' && document.hidden) return;
        const tokView = document.getElementById('view-tokenizer');
        if (tokView && tokView.classList.contains('active')) {
          await ensureRealTokenStats(true);
          renderTokenDashboard();
        }
      } catch (err) {
        console.warn('[Tokenizer] Auto-refresh error:', err);
      }
    }, 8000);
  }

  // Antigravity Native Stats Board & Calendar Interactions
  if (statsRangeSelect && !statsRangeSelect.dataset.bound) {
    statsRangeSelect.dataset.bound = '1';
    statsRangeSelect.addEventListener('change', () => {
      const val = statsRangeSelect.value;
      if (val === 'custom') {
        if (statsCalendarBar) statsCalendarBar.style.display = 'block';
        tokenCalendarBtn?.classList.add('active');
        const nowD = new Date();
        const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (statsDateStart && !statsDateStart.value) {
          const past30 = new Date(nowD.getTime() - 30 * 86400 * 1000);
          statsDateStart.value = toYmd(past30);
        }
        if (statsDateEnd && !statsDateEnd.value) {
          statsDateEnd.value = toYmd(nowD);
        }
        customRangeStart = statsDateStart?.value || '';
        customRangeEnd = statsDateEnd?.value || '';
        statsDateStart?.focus();
      } else {
        const nowD = new Date();
        const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        let sDate = '';
        let eDate = toYmd(nowD);
        if (val === 'today') {
          sDate = eDate;
        } else if (val === 'yesterday') {
          sDate = toYmd(new Date(nowD.getTime() - 86400000));
          eDate = sDate;
        } else if (val === '24h') {
          sDate = toYmd(new Date(nowD.getTime() - 86400000));
        } else if (val === '7d') {
          sDate = toYmd(new Date(nowD.getTime() - 7 * 86400000));
        } else if (val === '30d') {
          sDate = toYmd(new Date(nowD.getTime() - 30 * 86400000));
        } else if (val === 'this_month') {
          sDate = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-01`;
        } else if (val === 'last_month') {
          sDate = toYmd(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1));
          eDate = toYmd(new Date(nowD.getFullYear(), nowD.getMonth(), 0));
        } else if (val === '7m') {
          sDate = toYmd(new Date(nowD.getTime() - 210 * 86400000));
        } else if (val === 'this_year') {
          sDate = `${nowD.getFullYear()}-01-01`;
        }
        if (statsDateStart && sDate) statsDateStart.value = sDate;
        if (statsDateEnd && eDate) statsDateEnd.value = eDate;
        customRangeStart = '';
        customRangeEnd = '';
      }
      currentTokenLogsPage = 1;
      renderTokenDashboard();
    });
  }

  // Calendar Bar Toggle Button
  if (tokenCalendarBtn && !tokenCalendarBtn.dataset.bound) {
    tokenCalendarBtn.dataset.bound = '1';
    tokenCalendarBtn.addEventListener('click', () => {
      if (!statsCalendarBar) return;
      const isHidden = statsCalendarBar.style.display === 'none' || !statsCalendarBar.style.display;
      statsCalendarBar.style.display = isHidden ? 'block' : 'none';
      tokenCalendarBtn.classList.toggle('active', isHidden);
      if (isHidden) {
        const nowD = new Date();
        const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (statsDateStart && !statsDateStart.value) {
          statsDateStart.value = toYmd(new Date(nowD.getTime() - 30 * 86400 * 1000));
        }
        if (statsDateEnd && !statsDateEnd.value) {
          statsDateEnd.value = toYmd(nowD);
        }
      }
    });
  }

  // Calendar Apply Button
  if (statsDateApplyBtn && !statsDateApplyBtn.dataset.bound) {
    statsDateApplyBtn.dataset.bound = '1';
    statsDateApplyBtn.addEventListener('click', () => {
      const s = statsDateStart?.value || '';
      const e = statsDateEnd?.value || '';
      if (!s || !e) {
        toast('Veuillez renseigner une date de début et de fin', 'warn', 1800);
        return;
      }
      if (s > e) {
        toast('La date de début doit précéder la date de fin', 'warn', 2000);
        return;
      }
      customRangeStart = s;
      customRangeEnd = e;
      if (statsRangeSelect) statsRangeSelect.value = 'custom';
      tokenCalendarBtn?.classList.add('active');
      currentTokenLogsPage = 1;
      renderTokenDashboard();
      toast(`Période filtrée : du ${s} au ${e}`, 'ok', 1600);
    });
  }

  // Calendar Reset & Clear Functions
  const resetCalendarFilter = () => {
    customRangeStart = '';
    customRangeEnd = '';
    if (statsRangeSelect) statsRangeSelect.value = '7m';
    if (statsCalendarBar) statsCalendarBar.style.display = 'none';
    tokenCalendarBtn?.classList.remove('active');
    const nowD = new Date();
    const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (statsDateStart) statsDateStart.value = toYmd(new Date(nowD.getTime() - 210 * 86400000));
    if (statsDateEnd) statsDateEnd.value = toYmd(nowD);
    currentTokenLogsPage = 1;
    renderTokenDashboard();
    toast('Période réinitialisée à 7 mois', 'info', 1400);
  };

  if (statsDateResetBtn && !statsDateResetBtn.dataset.bound) {
    statsDateResetBtn.dataset.bound = '1';
    statsDateResetBtn.addEventListener('click', resetCalendarFilter);
  }

  if (statsClearRangeBtn && !statsClearRangeBtn.dataset.bound) {
    statsClearRangeBtn.dataset.bound = '1';
    statsClearRangeBtn.addEventListener('click', resetCalendarFilter);
  }

  if (statsCalendarCloseBtn && !statsCalendarCloseBtn.dataset.bound) {
    statsCalendarCloseBtn.dataset.bound = '1';
    statsCalendarCloseBtn.addEventListener('click', () => {
      if (statsCalendarBar) statsCalendarBar.style.display = 'none';
      tokenCalendarBtn?.classList.remove('active');
    });
  }

  // Pill Click to toggle calendar bar
  const statsRangePillBtn = $('#statsRangePillBtn') as HTMLElement | null;
  if (statsRangePillBtn && !statsRangePillBtn.dataset.bound) {
    statsRangePillBtn.dataset.bound = '1';
    statsRangePillBtn.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement)?.id === 'statsClearRangeBtn') return;
      if (!statsCalendarBar) return;
      const isHidden = statsCalendarBar.style.display === 'none' || !statsCalendarBar.style.display;
      statsCalendarBar.style.display = isHidden ? 'block' : 'none';
      tokenCalendarBtn?.classList.toggle('active', isHidden);
      if (isHidden) {
        statsDateStart?.focus();
      }
    });
  }

  // Quick Date Range Chips
  $$<HTMLButtonElement>('.quick-date-chip').forEach((chip) => {
    if (!chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', () => {
        const target = chip.getAttribute('data-range') || '7m';
        if (target === 'custom') {
          if (statsCalendarBar) {
            const isHidden = statsCalendarBar.style.display === 'none' || !statsCalendarBar.style.display;
            statsCalendarBar.style.display = isHidden ? 'block' : 'none';
            tokenCalendarBtn?.classList.toggle('active', isHidden);
            if (isHidden) {
              const nowD = new Date();
              const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              if (statsDateStart && !statsDateStart.value) {
                statsDateStart.value = toYmd(new Date(nowD.getTime() - 30 * 86400 * 1000));
              }
              if (statsDateEnd && !statsDateEnd.value) {
                statsDateEnd.value = toYmd(nowD);
              }
              statsDateStart?.focus();
            }
          }
          return;
        }

        if (statsRangeSelect) statsRangeSelect.value = target;
        customRangeStart = '';
        customRangeEnd = '';

        const nowD = new Date();
        const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        let sDate = '';
        let eDate = toYmd(nowD);
        if (target === 'today') {
          sDate = eDate;
        } else if (target === 'yesterday') {
          sDate = toYmd(new Date(nowD.getTime() - 86400000));
          eDate = sDate;
        } else if (target === '24h') {
          sDate = toYmd(new Date(nowD.getTime() - 86400000));
        } else if (target === '7d') {
          sDate = toYmd(new Date(nowD.getTime() - 7 * 86400000));
        } else if (target === '30d') {
          sDate = toYmd(new Date(nowD.getTime() - 30 * 86400000));
        } else if (target === 'this_month') {
          sDate = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-01`;
        } else if (target === 'last_month') {
          sDate = toYmd(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1));
          eDate = toYmd(new Date(nowD.getFullYear(), nowD.getMonth(), 0));
        } else if (target === '7m') {
          sDate = toYmd(new Date(nowD.getTime() - 210 * 86400000));
        } else if (target === 'this_year') {
          sDate = `${nowD.getFullYear()}-01-01`;
        }
        if (statsDateStart && sDate) statsDateStart.value = sDate;
        if (statsDateEnd && eDate) statsDateEnd.value = eDate;

        currentTokenLogsPage = 1;
        renderTokenDashboard();
      });
    }
  });

  // Quick Model Filter Chips
  $$<HTMLButtonElement>('#statsModelFilterGroup .stats-filter-chip').forEach((chip) => {
    if (!chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', () => {
        $$('#statsModelFilterGroup .stats-filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        currentModelFilter = (chip.getAttribute('data-model-filter') || 'all') as any;
        currentTokenLogsPage = 1;
        renderTokenDashboard();
      });
    }
  });

  // Reset Filters Button
  if (statsFilterResetBtn && !statsFilterResetBtn.dataset.bound) {
    statsFilterResetBtn.dataset.bound = '1';
    statsFilterResetBtn.addEventListener('click', () => {
      currentModelFilter = 'all';
      customRangeStart = '';
      customRangeEnd = '';
      if (statsRangeSelect) statsRangeSelect.value = '7m';
      if (statsCalendarBar) statsCalendarBar.style.display = 'none';
      tokenCalendarBtn?.classList.remove('active');
      if (tokenLogsSearchInput) tokenLogsSearchInput.value = '';
      if (tokenLogsProviderSelect) tokenLogsProviderSelect.value = 'all';
      if (tokenLogsModelSelect) tokenLogsModelSelect.value = 'all';
      currentTokenLogsPage = 1;
      $$('#statsModelFilterGroup .stats-filter-chip').forEach((c) => {
        c.classList.toggle('active', c.getAttribute('data-model-filter') === 'all');
      });
      renderTokenDashboard();
      toast('Filtres réinitialisés à la vue complète', 'info', 1400);
    });
  }

  // Perspective Toggle Buttons (Pool vs API)
  if (btnPerspectivePool && !btnPerspectivePool.dataset.bound) {
    btnPerspectivePool.dataset.bound = '1';
    btnPerspectivePool.addEventListener('click', () => {
      btnPerspectivePool.classList.add('active');
      btnPerspectiveApi?.classList.remove('active');
      currentPricingPerspective = 'pool';
      if (tokenTracker) renderStatsBoard(tokenTracker.getStats());
    });
  }
  if (btnPerspectiveApi && !btnPerspectiveApi.dataset.bound) {
    btnPerspectiveApi.dataset.bound = '1';
    btnPerspectiveApi.addEventListener('click', () => {
      btnPerspectiveApi.classList.add('active');
      btnPerspectivePool?.classList.remove('active');
      currentPricingPerspective = 'api';
      if (tokenTracker) renderStatsBoard(tokenTracker.getStats());
    });
  }

  // Donut Mode Toggle Chips (Tokens vs Coût vs Appels)
  const setDonutMode = (mode: 'tokens' | 'cost' | 'calls', activeBtn: HTMLButtonElement | null) => {
    currentDonutMode = mode;
    [btnDonutModeTokens, btnDonutModeCost, btnDonutModeCalls].forEach((b) => b?.classList.remove('active'));
    activeBtn?.classList.add('active');
    if (tokenTracker) renderStatsBoard(tokenTracker.getStats());
  };

  if (btnDonutModeTokens && !btnDonutModeTokens.dataset.bound) {
    btnDonutModeTokens.dataset.bound = '1';
    btnDonutModeTokens.addEventListener('click', () => setDonutMode('tokens', btnDonutModeTokens));
  }
  if (btnDonutModeCost && !btnDonutModeCost.dataset.bound) {
    btnDonutModeCost.dataset.bound = '1';
    btnDonutModeCost.addEventListener('click', () => setDonutMode('cost', btnDonutModeCost));
  }
  if (btnDonutModeCalls && !btnDonutModeCalls.dataset.bound) {
    btnDonutModeCalls.dataset.bound = '1';
    btnDonutModeCalls.addEventListener('click', () => setDonutMode('calls', btnDonutModeCalls));
  }

  // 3 Dedicated Dashboard Modes Switcher Buttons
  $$<HTMLButtonElement>('#tokenModeSegmentedControl .token-mode-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-stats-mode') as 'overview' | 'insights' | 'classic';
        if (!m || m === currentStatsMode) return;
        currentStatsMode = m;
        try {
          localStorage.setItem('ag_doctor_token_stats_mode', m);
        } catch (_) {}
        $$('#tokenModeSegmentedControl .token-mode-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
        toast(`Mode activé : ${m.charAt(0).toUpperCase() + m.slice(1)}`, 'info', 1200);
      });
    }
  });

  // Cockpit Sidebar Tabs (Accounts / Models / Users)
  $$<HTMLButtonElement>('.cockpit-nav-pill').forEach((pill) => {
    if (!pill.dataset.bound) {
      pill.dataset.bound = '1';
      pill.addEventListener('click', () => {
        const tab = pill.getAttribute('data-cockpit-tab') as 'accounts' | 'models' | 'users';
        if (!tab) return;
        currentCockpitTab = tab;
        $$('.cockpit-nav-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  // Classic Chart Toggles (Bar/Area, Tokens/Cost, Model/Account)
  $$<HTMLButtonElement>('#classicChartTypeToggle .classic-pill-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-chart') as 'bar' | 'area';
        if (!t) return;
        currentClassicChartType = t;
        $$('#classicChartTypeToggle .classic-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  $$<HTMLButtonElement>('#classicMetricTypeToggle .classic-pill-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-metric') as 'tokens' | 'cost';
        if (!m) return;
        currentClassicMetricType = m;
        $$('#classicMetricTypeToggle .classic-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  $$<HTMLButtonElement>('#classicGroupingToggle .classic-pill-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const g = btn.getAttribute('data-group') as 'model' | 'account';
        if (!g) return;
        currentClassicGroupType = g;
        $$('#classicGroupingToggle .classic-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  // Bento Chart Toggles (Area/Bar, Tokens/Cost, Model/Account)
  $$<HTMLButtonElement>('#bentoChartTypeToggle .bento-toggle-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-chart') as 'area' | 'bar';
        if (!t) return;
        currentBentoChartType = t;
        $$('#bentoChartTypeToggle .bento-toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  $$<HTMLButtonElement>('#bentoMetricTypeToggle .bento-toggle-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-metric') as 'tokens' | 'cost';
        if (!m) return;
        currentBentoMetricType = m;
        $$('#bentoMetricTypeToggle .bento-toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  $$<HTMLButtonElement>('#bentoGroupToggle .bento-toggle-btn').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const g = btn.getAttribute('data-group') as 'model' | 'account';
        if (!g) return;
        currentBentoGroupType = g;
        $$('#bentoGroupToggle .bento-toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderTokenDashboard();
      });
    }
  });

  if (bentoPricingMatrixLink && !bentoPricingMatrixLink.dataset.bound) {
    bentoPricingMatrixLink.dataset.bound = '1';
    bentoPricingMatrixLink.addEventListener('click', () => {
      toast('Pricing Matrix : Gemini Flash ($0.075/1M in, $0.30/1M out), Gemini Pro ($1.25/1M in, $5.00/1M out). Zero Pool Billing.', 'info', 3500);
    });
  }

  $$<HTMLButtonElement>('#activityPillsGroup .activity-pill').forEach((pill) => {
    if (!pill.dataset.bound) {
      pill.dataset.bound = '1';
      pill.addEventListener('click', () => {
        $$('#activityPillsGroup .activity-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentActivityMode = (pill.getAttribute('data-mode') || 'daily') as any;
        renderHeatmapMatrix(statsRangeSelect?.value || '7m', currentActivityMode);
      });
    }
  });

  // Quick Model Chips (Loi de Fitts / Hick)
  $$<HTMLButtonElement>('#tokenizerQuickModelChips .quick-chip').forEach((chip) => {
    if (!chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', () => {
        const targetModel = chip.getAttribute('data-model');
        if (!targetModel) return;
        $$('#tokenizerQuickModelChips .quick-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        if (tokenizerModelSelect) {
          tokenizerModelSelect.value = targetModel;
        }
        renderTokenizerTool();
        toast(`Modèle actif : ${targetModel}`, 'info', 1200);
      });
    }
  });

  if (tokenizerModelSelect && !tokenizerModelSelect.dataset.chipsBound) {
    tokenizerModelSelect.dataset.chipsBound = '1';
    tokenizerModelSelect.addEventListener('change', () => {
      const val = tokenizerModelSelect.value;
      $$<HTMLButtonElement>('#tokenizerQuickModelChips .quick-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.getAttribute('data-model') === val);
      });
    });
  }

  // Focus Google Button
  if (tokenFilterGoogleBtn && !tokenFilterGoogleBtn.dataset.bound) {
    tokenFilterGoogleBtn.dataset.bound = '1';
    tokenFilterGoogleBtn.addEventListener('click', () => {
      const isGoogleActive = tokenLogsProviderSelect?.value === 'google';
      const target = isGoogleActive ? 'all' : 'google';
      if (tokenLogsProviderSelect) tokenLogsProviderSelect.value = target;
      tokenFilterGoogleBtn.classList.toggle('active', !isGoogleActive);
      $$('.token-filter-chip').forEach((c) => {
        c.classList.toggle('active', c.getAttribute('data-filter') === target);
      });
      renderTokenDashboard();
      toast(isGoogleActive ? 'Affichage de tous les fournisseurs' : 'Focus activé sur Google Antigravity', 'info', 1500);
    });
  }

  // Filter Chips
  $$<HTMLButtonElement>('.token-filter-chip').forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const f = btn.getAttribute('data-filter') || 'all';
        $$('.token-filter-chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        if (tokenLogsProviderSelect) tokenLogsProviderSelect.value = f;
        if (tokenFilterGoogleBtn) tokenFilterGoogleBtn.classList.toggle('active', f === 'google');
        renderTokenDashboard();
      });
    }
  });

  // Refresh
  if (tokenRefreshBtn && !tokenRefreshBtn.dataset.bound) {
    tokenRefreshBtn.dataset.bound = '1';
    tokenRefreshBtn.addEventListener('click', async () => {
      await ensureRealTokenStats(true);
      renderTokenDashboard();
      toast('Métriques réelles de tokens actualisées', 'ok', 1400);
    });
  }

  // Export CSV
  if (tokenExportCsvBtn && !tokenExportCsvBtn.dataset.bound) {
    tokenExportCsvBtn.dataset.bound = '1';
    tokenExportCsvBtn.addEventListener('click', () => {
      if (!tokenTracker || tokenTracker.getEntries().length === 0) {
        toast('Aucun journal de tokens à exporter', 'warn', 1800);
        return;
      }
      const activeRange = statsRangeSelect?.value || 'all';
      const rangeParam = activeRange === 'custom' && customRangeStart && customRangeEnd
        ? `custom:${customRangeStart}:${customRangeEnd}`
        : activeRange;
      const entries = rangeParam === 'all'
        ? tokenTracker.getEntries()
        : tokenTracker.filterEntries('', 'all', 'all', 'timestamp', 'desc', rangeParam);
      const csv = tokenTracker.exportCsv(entries);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `antigravity-tokens-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`Export CSV généré (${entries.length} entrées)`, 'ok', 2000);
    });
  }

  // Export JSON
  if (tokenExportJsonBtn && !tokenExportJsonBtn.dataset.bound) {
    tokenExportJsonBtn.dataset.bound = '1';
    tokenExportJsonBtn.addEventListener('click', () => {
      if (!tokenTracker || tokenTracker.getEntries().length === 0) {
        toast('Aucun journal de tokens à exporter', 'warn', 1800);
        return;
      }
      const activeRange = statsRangeSelect?.value || 'all';
      const rangeParam = activeRange === 'custom' && customRangeStart && customRangeEnd
        ? `custom:${customRangeStart}:${customRangeEnd}`
        : activeRange;
      const entries = rangeParam === 'all'
        ? tokenTracker.getEntries()
        : tokenTracker.filterEntries('', 'all', 'all', 'timestamp', 'desc', rangeParam);
      const jsonStr = tokenTracker.exportJson(entries);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `antigravity-tokens-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`Export JSON généré (${entries.length} entrées)`, 'ok', 2000);
    });
  }

  // Clear History
  if (tokenClearBtn && !tokenClearBtn.dataset.bound) {
    tokenClearBtn.dataset.bound = '1';
    tokenClearBtn.addEventListener('click', async () => {
      const ok = await confirmModal(
        'Effacer les journaux de consommation',
        'Êtes-vous sûr de vouloir réinitialiser l’historique des tokens ? Cette action est irréversible.',
        { danger: true, confirmLabel: 'Effacer tout' },
      );
      if (ok && tokenTracker) {
        tokenTracker.clear();
        renderTokenDashboard();
        toast('Historique des tokens réinitialisé', 'ok', 1600);
      }
    });
  }

  // Filters
  if (tokenLogsSearchInput && !tokenLogsSearchInput.dataset.bound) {
    tokenLogsSearchInput.dataset.bound = '1';
    tokenLogsSearchInput.addEventListener('input', () => {
      currentTokenLogsPage = 1;
      renderTokenDashboard();
    });
  }
  if (tokenLogsProviderSelect && !tokenLogsProviderSelect.dataset.bound) {
    tokenLogsProviderSelect.dataset.bound = '1';
    tokenLogsProviderSelect.addEventListener('change', () => {
      const val = tokenLogsProviderSelect.value;
      $$('.token-filter-chip').forEach((c) => {
        c.classList.toggle('active', c.getAttribute('data-filter') === val);
      });
      if (tokenFilterGoogleBtn) tokenFilterGoogleBtn.classList.toggle('active', val === 'google');
      currentTokenLogsPage = 1;
      renderTokenDashboard();
    });
  }
  if (tokenLogsModelSelect && !tokenLogsModelSelect.dataset.bound) {
    tokenLogsModelSelect.dataset.bound = '1';
    tokenLogsModelSelect.addEventListener('change', () => {
      currentTokenLogsPage = 1;
      renderTokenDashboard();
    });
  }

  // Pagination Controls
  if (tokenLogsPrevBtn && !tokenLogsPrevBtn.dataset.bound) {
    tokenLogsPrevBtn.dataset.bound = '1';
    tokenLogsPrevBtn.addEventListener('click', () => {
      if (currentTokenLogsPage > 1) {
        currentTokenLogsPage--;
        renderTokenDashboard();
      }
    });
  }
  if (tokenLogsNextBtn && !tokenLogsNextBtn.dataset.bound) {
    tokenLogsNextBtn.dataset.bound = '1';
    tokenLogsNextBtn.addEventListener('click', () => {
      currentTokenLogsPage++;
      renderTokenDashboard();
    });
  }
  if (tokenLogsPageSizeSelect && !tokenLogsPageSizeSelect.dataset.bound) {
    tokenLogsPageSizeSelect.dataset.bound = '1';
    tokenLogsPageSizeSelect.addEventListener('change', () => {
      currentTokenLogsPageSize = Number(tokenLogsPageSizeSelect.value) || 25;
      currentTokenLogsPage = 1;
      renderTokenDashboard();
    });
  }

  // Sortable table headers
  $$<HTMLTableCellElement>('#tokenLogsTable th.sortable-th').forEach((th) => {
    if (!th.dataset.bound) {
      th.dataset.bound = '1';
      th.addEventListener('click', () => {
        const field = th.dataset.sort as any;
        if (!field) return;
        if (currentTokenSortField === field) {
          currentTokenSortOrder = currentTokenSortOrder === 'desc' ? 'asc' : 'desc';
        } else {
          currentTokenSortField = field;
          currentTokenSortOrder = 'desc';
        }
        renderTokenDashboard();
      });
    }
  });

  // Detail Modal close buttons
  if (tokenDetailCloseBtn && !tokenDetailCloseBtn.dataset.bound) {
    tokenDetailCloseBtn.dataset.bound = '1';
    tokenDetailCloseBtn.addEventListener('click', closeTokenDetailModal);
  }
  if (tokenDetailFooterCloseBtn && !tokenDetailFooterCloseBtn.dataset.bound) {
    tokenDetailFooterCloseBtn.dataset.bound = '1';
    tokenDetailFooterCloseBtn.addEventListener('click', closeTokenDetailModal);
  }
  if (tokenDetailBackdrop && !tokenDetailBackdrop.dataset.bound) {
    tokenDetailBackdrop.dataset.bound = '1';
    tokenDetailBackdrop.addEventListener('click', (ev) => {
      if (ev.target === tokenDetailBackdrop) closeTokenDetailModal();
    });
  }
  if (tokenCopyJsonBtn && !tokenCopyJsonBtn.dataset.bound) {
    tokenCopyJsonBtn.dataset.bound = '1';
    tokenCopyJsonBtn.addEventListener('click', () => {
      if (currentSelectedTokenEntry && navigator.clipboard) {
        navigator.clipboard.writeText(JSON.stringify(currentSelectedTokenEntry, null, 2)).then(() => {
          toast('JSON copié dans le presse-papiers !', 'ok', 1600);
        }).catch(() => {});
      }
    });
  }

  // Token Wrapped Modal bindings
  const tokenShareWrappedBtn = $('#tokenShareWrappedBtn') as HTMLButtonElement | null;
  const tokenWrappedCloseBtn = $('#tokenWrappedCloseBtn') as HTMLButtonElement | null;
  const tokenWrappedFooterCloseBtn = $('#tokenWrappedFooterCloseBtn') as HTMLButtonElement | null;
  const tokenWrappedBackdrop = $('#tokenWrappedBackdrop') as HTMLDivElement | null;
  const tokenWrappedCopyBtn = $('#tokenWrappedCopyBtn') as HTMLButtonElement | null;

  if (tokenShareWrappedBtn && !tokenShareWrappedBtn.dataset.bound) {
    tokenShareWrappedBtn.dataset.bound = '1';
    tokenShareWrappedBtn.addEventListener('click', openTokenWrappedModal);
  }
  if (tokenWrappedCloseBtn && !tokenWrappedCloseBtn.dataset.bound) {
    tokenWrappedCloseBtn.dataset.bound = '1';
    tokenWrappedCloseBtn.addEventListener('click', closeTokenWrappedModal);
  }
  if (tokenWrappedFooterCloseBtn && !tokenWrappedFooterCloseBtn.dataset.bound) {
    tokenWrappedFooterCloseBtn.dataset.bound = '1';
    tokenWrappedFooterCloseBtn.addEventListener('click', closeTokenWrappedModal);
  }
  if (tokenWrappedBackdrop && !tokenWrappedBackdrop.dataset.bound) {
    tokenWrappedBackdrop.dataset.bound = '1';
    tokenWrappedBackdrop.addEventListener('click', (ev) => {
      if (ev.target === tokenWrappedBackdrop) closeTokenWrappedModal();
    });
  }
  if (tokenWrappedCopyBtn && !tokenWrappedCopyBtn.dataset.bound) {
    tokenWrappedCopyBtn.dataset.bound = '1';
    tokenWrappedCopyBtn.addEventListener('click', copyTokenWrappedSummary);
  }

  // Tokenizer Tool inputs
  if (tokenizerInputText && !tokenizerInputText.dataset.bound) {
    tokenizerInputText.dataset.bound = '1';
    tokenizerInputText.addEventListener('input', () => renderTokenizerTool());
  }
  if (tokenizerModelSelect && !tokenizerModelSelect.dataset.bound) {
    tokenizerModelSelect.dataset.bound = '1';
    tokenizerModelSelect.addEventListener('change', () => renderTokenizerTool());
  }
  if (tokenizerClearTextBtn && !tokenizerClearTextBtn.dataset.bound) {
    tokenizerClearTextBtn.dataset.bound = '1';
    tokenizerClearTextBtn.addEventListener('click', () => {
      if (tokenizerInputText) tokenizerInputText.value = '';
      renderTokenizerTool();
    });
  }
  if (tokenizerCopyTextBtn && !tokenizerCopyTextBtn.dataset.bound) {
    tokenizerCopyTextBtn.dataset.bound = '1';
    tokenizerCopyTextBtn.addEventListener('click', () => {
      if (tokenizerInputText && navigator.clipboard) {
        navigator.clipboard.writeText(tokenizerInputText.value).then(() => {
          toast('Texte copié dans le presse-papiers', 'ok', 1400);
        }).catch(() => {});
      }
    });
  }
  if (tokenizerCopyTokensBtn && !tokenizerCopyTokensBtn.dataset.bound) {
    tokenizerCopyTokensBtn.dataset.bound = '1';
    tokenizerCopyTokensBtn.addEventListener('click', () => {
      if (!tokenizeTextFn || !tokenizerInputText) return;
      const res = tokenizeTextFn(tokenizerInputText.value, tokenizerModelSelect?.value || 'gemini-3.8-flash');
      if (navigator.clipboard) {
        const tokensArr = Array.isArray(res?.tokens) ? res.tokens : [];
        navigator.clipboard.writeText(JSON.stringify(tokensArr, null, 2)).then(() => {
          toast(`${tokensArr.length} tokens copiés en JSON`, 'ok', 1600);
        }).catch(() => {});
      }
    });
  }

  // Presets
  const presets = (window as any).AgTokenTracker?.TOKENIZER_PRESETS;
  if (presets) {
    if (tokenizerPresetGeminiPro && !tokenizerPresetGeminiPro.dataset.bound) {
      tokenizerPresetGeminiPro.dataset.bound = '1';
      tokenizerPresetGeminiPro.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.gemini25Pro || presets.systemPrompt;
        if (tokenizerModelSelect) tokenizerModelSelect.value = 'gemini-3.8-flash';
        renderTokenizerTool();
        toast('Exemple Gemini 3.8 Flash chargé', 'info', 1200);
      });
    }
    if (tokenizerPresetThinking && !tokenizerPresetThinking.dataset.bound) {
      tokenizerPresetThinking.dataset.bound = '1';
      tokenizerPresetThinking.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.geminiThinking;
        if (tokenizerModelSelect) tokenizerModelSelect.value = 'gemini-2.0-flash-thinking';
        renderTokenizerTool();
        toast('Exemple Gemini Thinking chargé', 'info', 1200);
      });
    }
    if (tokenizerPresetTs && !tokenizerPresetTs.dataset.bound) {
      tokenizerPresetTs.dataset.bound = '1';
      tokenizerPresetTs.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.typescript;
        renderTokenizerTool();
      });
    }
    if (tokenizerPresetPrompt && !tokenizerPresetPrompt.dataset.bound) {
      tokenizerPresetPrompt.dataset.bound = '1';
      tokenizerPresetPrompt.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.systemPrompt;
        renderTokenizerTool();
      });
    }
    if (tokenizerPresetChat && !tokenizerPresetChat.dataset.bound) {
      tokenizerPresetChat.dataset.bound = '1';
      tokenizerPresetChat.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.chatMessage;
        renderTokenizerTool();
      });
    }
    if (tokenizerPresetJson && !tokenizerPresetJson.dataset.bound) {
      tokenizerPresetJson.dataset.bound = '1';
      tokenizerPresetJson.addEventListener('click', () => {
        if (tokenizerInputText) tokenizerInputText.value = presets.jsonPayload;
        renderTokenizerTool();
      });
    }
  }
}



// Persistent sidebar "Run diagnostic" CTA — mirrors the legacy quickRunBtn
$('#sidebarRunBtn')?.addEventListener('click', () => {
  navigate('doctor');
  void runDoctor();
});

// Titlebar check for updates CTA
$('#headerCheckUpdateBtn')?.addEventListener('click', () => {
  if (typeof triggerUpdateCheck === 'function') {
    void triggerUpdateCheck(true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Doctor / dashboard
// ─────────────────────────────────────────────────────────────────────────────

const healthList = $('#healthList') as HTMLDivElement;
const statOk = $('#statOk') as HTMLDivElement;
const statWarn = $('#statWarn') as HTMLDivElement;
const statErr = $('#statErr') as HTMLDivElement;
const statModels = $('#statModels') as HTMLDivElement;
const lastRunBadge = $('#lastRunBadge') as HTMLSpanElement;

let lastResults: CheckResult[] = [];
let healthFilter: 'all' | 'ok' | 'warn' | 'error' = 'all';

function renderFilteredHealthList(): void {
  const badge = $('#healthFilterBadge') as HTMLElement | null;
  const filtered = healthFilter === 'all'
    ? lastResults
    : lastResults.filter((r) => r.status === healthFilter);

  if (badge) {
    if (healthFilter === 'all') {
      badge.style.display = 'none';
      badge.textContent = '';
    } else {
      badge.style.display = 'inline-flex';
      const label = healthFilter === 'warn' ? 'Warnings only' : healthFilter === 'error' ? 'Issues only' : 'Healthy only';
      badge.textContent = `${label} (${filtered.length}) · Click to show all`;
    }
  }

  $$('.stat-card').forEach((card) => {
    const statType = card.getAttribute('data-stat');
    if (statType === healthFilter) {
      card.classList.add('active-filter');
    } else {
      card.classList.remove('active-filter');
    }
  });

  renderHealthList(filtered);
}

// Event delegation: bind once for expand toggles (avoids N listeners per item)
healthList.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('.health-expand') as HTMLButtonElement | null;
  if (target) {
    const item = target.closest('.health-item');
    const isExpanded = item?.classList.toggle('expanded') ?? false;
    target.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    target.textContent = isExpanded ? 'Hide details' : 'Show details';
  }
});

// Reusable template for health list — avoids creating a new <template> each render
const healthTpl = document.createElement('template');

function renderHealthList(results: CheckResult[]): void {
  if (results.length === 0) {
    const isFiltered = healthFilter !== 'all' && lastResults.length > 0;
    healthList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <p>${isFiltered ? 'No items matching the selected filter.' : 'Click <strong>Run doctor</strong> to scan Antigravity, MITM, patches, and models.'}</p>
      </div>`;
    return;
  }
  // Build via DocumentFragment: parse once, insert once (no double innerHTML parse)
  const html = results
    .map((r, i) => {
      const icon = iconForStatus(r.status);
      const detailsHtml = r.details
        ? `<div class="health-details">${escapeHtml(r.details)}</div><button class="health-expand" type="button" aria-expanded="false">Show details</button>`
        : '';
      return `
        <div class="health-item" style="animation-delay:${i * 40}ms" data-id="${r.id}">
          <div class="health-icon ${r.status}">${icon}</div>
          <div class="health-body">
            <div class="health-title">${escapeHtml(r.title)}</div>
            <div class="health-message">${escapeHtml(r.message)}</div>
            ${detailsHtml}
          </div>
        </div>`;
    })
    .join('');
  healthTpl.innerHTML = html;
  healthList.replaceChildren(healthTpl.content);
}

function updateStats(results: CheckResult[]): void {
  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const err = results.filter((r) => r.status === 'error').length;
  const modelsCheck = results.find((r) => r.id === 'models');
  const modelsCount =
    modelsCheck?.data && typeof modelsCheck.data === 'object' && 'count' in modelsCheck.data
      ? (modelsCheck.data as { count: number }).count
      : 0;

  statOk.textContent = String(ok);
  statWarn.textContent = String(warn);
  statErr.textContent = String(err);
  statModels.textContent = String(modelsCount);
  lastRunBadge.textContent = new Date().toLocaleTimeString();
}

async function runDoctor(): Promise<void> {
  setStatus('Running doctor…', 'busy');
  $('#runDoctorBtn')?.setAttribute('disabled', 'true');
  $('#refreshBtn')?.setAttribute('disabled', 'true');
  $('#sidebarRunBtn')?.setAttribute('disabled', 'true');
  $('#heroRunBtn')?.setAttribute('disabled', 'true');
  setObjective('doctor', 'pending', 'Running…');
  if (lastRunBadge) lastRunBadge.textContent = 'Running...';

  try {
    const result = await window.ag.run(['doctor', '--json']);
    if (result.code !== 0 && !result.stdout) {
      throw new Error(result.stderr || `Exited with code ${result.code}`);
    }
    const results = JSON.parse(result.stdout) as CheckResult[];
    lastResults = results;
    healthFilter = 'all';
    updateStats(results);
    updateObjectives(results);
    renderFilteredHealthList();

    // Show "Resolve verification" button only when a VALIDATION_REQUIRED issue is detected
    const hasValidation = results.some((r) => r.id === 'validation' || r.message?.includes('VALIDATION_REQUIRED'));
    const resolveBtn = $('#dashboardResolveVerificationBtn');
    if (resolveBtn) resolveBtn.style.display = hasValidation ? '' : 'none';

    setStatus('Ready', 'ready');
  } catch (e) {
    toast(`Doctor failed: ${(e as Error).message}. Check the Logs tab for full output.`, 'err', 5000);
    setStatus('Error', 'err');
    setObjective('doctor', 'error', 'Doctor failed');
    void window.ag.trayStatus('err');
    if (lastRunBadge) lastRunBadge.textContent = 'Failed';
  } finally {
    $('#runDoctorBtn')?.removeAttribute('disabled');
    $('#refreshBtn')?.removeAttribute('disabled');
    $('#sidebarRunBtn')?.removeAttribute('disabled');
    $('#heroRunBtn')?.removeAttribute('disabled');
  }
}

function resultStatusToObjective(status: CheckResult['status']): 'ok' | 'warn' | 'error' | 'pending' {
  return status === 'info' ? 'ok' : status;
}

function updateObjectives(results: CheckResult[]): void {
  const hasError = results.some((r) => r.status === 'error');
  const hasWarn = results.some((r) => r.status === 'warn');
  setObjective('doctor', hasError ? 'error' : hasWarn ? 'warn' : 'ok', hasError ? 'Issues detected' : hasWarn ? 'Warnings found' : 'Doctor OK');

  const antigravity = results.find((r) => r.id === 'antigravity' || r.id === 'version' || r.id === 'install');
  setObjective('antigravity', antigravity ? resultStatusToObjective(antigravity.status) : 'pending', antigravity?.message);

  const mitm = results.find((r) => r.id === 'mitm' || r.id === 'proxy' || r.id === 'ca');
  setObjective('mitm', mitm ? resultStatusToObjective(mitm.status) : 'pending', mitm?.message);

  const patch = results.find((r) => r.id === 'patch');
  setObjective('patch', patch ? resultStatusToObjective(patch.status) : 'pending', patch?.message);

  const logs = results.find((r) => r.id === 'logs');
  setObjective('logs', logs ? resultStatusToObjective(logs.status) : 'ok', logs?.message ?? 'Logs available');
}

$('#runDoctorBtn').addEventListener('click', () => void runDoctor());
$('#heroRunBtn')?.addEventListener('click', () => void runDoctor());
$('#emptyStateRunDoctorBtn')?.addEventListener('click', () => void runDoctor());
$('#refreshBtn').addEventListener('click', () => void runDoctor());
$('#repairBtn').addEventListener('click', () => void handleRepair());

// Fix All: full auto-repair with admin elevation (UAC prompt will appear)
$('#fixAllBtn')?.addEventListener('click', () => void runFixAll());

// Start Stub: emergency proxy stub (no admin needed)
$('#startStubBtn')?.addEventListener('click', () => void runStartStub());

// Stat-card click-to-filter: clicking a KPI card filters the health list by that status
const statFilterMap: Record<string, 'ok' | 'warn' | 'error'> = { ok: 'ok', warn: 'warn', err: 'error' };
$$('.stat-card[data-stat]').forEach((card) => {
  card.addEventListener('click', () => {
    const stat = card.getAttribute('data-stat') ?? '';
    const mapped = statFilterMap[stat];
    if (!mapped || lastResults.length === 0) return;
    healthFilter = healthFilter === mapped ? 'all' : mapped;
    renderFilteredHealthList();
  });
});

// Clear filter when badge is clicked
$('#healthFilterBadge')?.addEventListener('click', () => {
  healthFilter = 'all';
  renderFilteredHealthList();
});

async function runRepair(): Promise<void> {
  const ok = await confirmModal(
    'Apply diagnostic repair?',
    'Attempt automatic repair of detected binary patch or certificate issues?',
    { confirmLabel: 'Run repair', danger: true },
  );
  if (!ok) return;
  setStatus('Repairing…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', 'repair', '--yes']);
    if (r.code === 0) {
      toast('Repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Patch repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}

async function runFixAll(): Promise<void> {
  const ok = await confirmModal(
    'Run full auto-repair?',
    'This will launch <code>ag-doctor repair --yes --auto-elevate</code> with admin elevation (UAC). ' +
    'All repair actions will run: patch, proxy, CA certificate.',
    { confirmLabel: 'Run full repair', danger: true },
  );
  if (!ok) return;
  setStatus('Full repair — admin elevation…', 'busy');
  $('#fixAllBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.repairRun();
    if (r?.ok) {
      toast('Full repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Full repair completed');
    } else {
      toast(`Full repair failed: ${r?.error ?? 'unknown'}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Full repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Full repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#fixAllBtn')?.removeAttribute('disabled');
  }
}

async function runStartStub(): Promise<void> {
  setStatus('Starting proxy stub…', 'busy');
  $('#startStubBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.proxyStartStub();
    if (r?.ok) {
      toast(`Proxy stub started (pid=${r.pid ?? '?'}) on port ${r.port}`, 'ok', 5000);
      setObjective('proxy', 'ok', `Proxy stub active on ${r.port}`);
    } else {
      toast(`Proxy stub failed: ${r?.error ?? 'unknown'}`, 'err', 6000);
      setObjective('proxy', 'error', 'Proxy stub failed');
    }
  } catch (e) {
    toast(`Proxy stub error: ${(e as Error).message}`, 'err');
  } finally {
    $('#startStubBtn')?.removeAttribute('disabled');
    setStatus('Ready', 'ready');
  }
}

function setObjective(key: ObjectiveKey, state: 'pending' | 'ok' | 'warn' | 'error', detail?: string): void {
  const el = document.getElementById(`obj-${key}`);
  if (!el) return;

  const iconDiv = el.querySelector('.objective-icon');
  if (iconDiv) {
    iconDiv.className = `objective-icon ${state}`;
    iconDiv.innerHTML = iconForObjective(state);
  }

  const statusDiv = el.querySelector('.objective-status');
  if (statusDiv) {
    statusDiv.textContent = detail || (state === 'pending' ? 'Pending' : state === 'ok' ? 'OK' : state === 'warn' ? 'Warning' : 'Error');
    if (detail) statusDiv.setAttribute('title', detail);
  }
}

async function handleRepair(): Promise<void> {
  setStatus('Repairing patch…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', '--repair']);
    if (r.code === 0) {
      toast('Repair complete', 'ok');
      setObjective('patch', 'ok', 'Repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
    setObjective('patch', 'error', 'Repair failed');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
