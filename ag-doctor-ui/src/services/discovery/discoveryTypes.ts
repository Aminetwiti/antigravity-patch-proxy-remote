/**
 * discoveryTypes.ts — Data contracts and interfaces for Antigravity & IDE Account Discovery.
 */

export interface QuotaBucket {
  bucketId: string;
  window: string;
  percentage: number;
  resetTime?: string;
}

export interface QuotaGroup {
  displayName: string;
  buckets: QuotaBucket[];
}

export interface AccountErrorDetails {
  code: number;
  status: string;
  reason: string;
  message: string;
  appealUrl?: string;
  validationUrl?: string;
  detectionTime: string;
  raw?: any;
}

export interface AccountQuotaSummary {
  fiveHourPercentage: number;
  fiveHourResetTime?: string;
  weeklyPercentage: number;
  weeklyResetTime?: string;
  geminiFiveHourPct?: number;
  geminiFiveHourReset?: string;
  geminiWeeklyPct?: number;
  geminiWeeklyReset?: string;
  claudeFiveHourPct?: number;
  claudeFiveHourReset?: string;
  claudeWeeklyPct?: number;
  claudeWeeklyReset?: string;
  argonFiveHourPct?: number;
  argonFiveHourReset?: string;
  argonWeeklyPct?: number;
  argonWeeklyReset?: string;
  isUnlicensed?: boolean;
  isValidationRequired?: boolean;
  tier?: string;
  errorDetails?: AccountErrorDetails;
  groups: QuotaGroup[];
}

export interface CloudCodeProjectInfo {
  projectId: string;
  tierId?: string;
  accountEmail?: string;
}

export interface DiscoveredAccount {
  email: string;
  name?: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  expiry?: number;
  source: 'antigravity-ide' | 'credential-manager';
  quotas?: AccountQuotaSummary;
  projectId?: string;
  tierId?: string;
}
