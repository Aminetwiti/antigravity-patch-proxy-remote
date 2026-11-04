/**
 * ag-doctor UI — Health Sentinel Module
 * Proactive binary update detector and system patch health monitor.
 */

export interface SystemHealthState {
  binaryPath?: string;
  lastModified?: number;
  asarStatus: 'clean' | 'blocked' | 'warning';
  proxyActive: boolean;
  mitmActive: boolean;
}

export interface SentinelStatus {
  healthy: boolean;
  statusText: string;
  updateDetected: boolean;
  recommendedAction?: string;
}

export function evaluateSystemHealth(
  currentState: SystemHealthState,
  previousModified?: number
): SentinelStatus {
  const updateDetected = Boolean(
    previousModified && currentState.lastModified && currentState.lastModified > previousModified
  );

  if (updateDetected) {
    return {
      healthy: false,
      statusText: 'Antigravity IDE update detected!',
      updateDetected: true,
      recommendedAction: 'Run binary patch scan again to verify patch compatibility.',
    };
  }

  if (currentState.asarStatus === 'blocked') {
    return {
      healthy: false,
      statusText: 'ASAR Integrity warning (patch blocked)',
      updateDetected: false,
      recommendedAction: 'Inspect preflight details before applying patch.',
    };
  }

  if (!currentState.proxyActive || !currentState.mitmActive) {
    return {
      healthy: false,
      statusText: 'Proxy services degraded',
      updateDetected: false,
      recommendedAction: 'Click "Enable proxy" or run repair.',
    };
  }

  return {
    healthy: true,
    statusText: 'All systems operational',
    updateDetected: false,
  };
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { evaluateSystemHealth });
}
