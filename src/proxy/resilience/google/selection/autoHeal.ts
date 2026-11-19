import log from 'electron-log';
import type { AccountLiveQuota } from '../../../../services/auth/googleAuth';
import { PREVENTIVE_QUOTA_THRESHOLD_PCT } from '../../../../constants';
import { triggerQuotaCachePersist } from '../../../../services/storage/quotaCacheStore';
import { unmarkAccountUnlicensed } from '../identity/licensing';
import { clearAccountQuotaExhaustedFromDisk } from '../identity/diskPersistence';
import {
  googleAccountCooldowns,
  accountProbationUntil,
  quotaExhaustedAccountKeys,
  rateLimitedCooldownKeys,
  quarantinedAccountKeys,
} from '../cooldown/cooldownState';

export function autoHealAccountOnQuotaRecovery(accountKey: string, quota: AccountLiveQuota): void {
  if (!quota || !accountKey) return;

  const now = Date.now();
  const FIVE_HOURS_MS = 5 * 3600 * 1000;

  const normAccountKey = accountKey.startsWith('google:') ? accountKey : `google:${accountKey}`;
  const rawAccountKey = accountKey.replace(/^google:/, '');

  const isAccountWideQuarantined =
    quarantinedAccountKeys.has(normAccountKey) ||
    quarantinedAccountKeys.has(rawAccountKey);
  const isGeminiQuarantined =
    isAccountWideQuarantined ||
    quarantinedAccountKeys.has(`${normAccountKey}:gemini`) ||
    quarantinedAccountKeys.has(`${rawAccountKey}:gemini`);
  const isClaudeQuarantined =
    isAccountWideQuarantined ||
    quarantinedAccountKeys.has(`${normAccountKey}:claude`) ||
    quarantinedAccountKeys.has(`${rawAccountKey}:claude`);

  if (!isAccountWideQuarantined && (quota.geminiFiveHourPct >= PREVENTIVE_QUOTA_THRESHOLD_PCT || quota.claudeFiveHourPct >= PREVENTIVE_QUOTA_THRESHOLD_PCT)) {
    unmarkAccountUnlicensed(accountKey);
  }

  const getCooldownRemainingForFamily = (family: string): number => {
    const cd1 = googleAccountCooldowns.get(`${normAccountKey}:${family}`);
    const cd2 = googleAccountCooldowns.get(`${rawAccountKey}:${family}`);
    const cdGen1 = googleAccountCooldowns.get(normAccountKey);
    const cdGen2 = googleAccountCooldowns.get(rawAccountKey);
    const cd = Math.max(cd1 || 0, cd2 || 0, cdGen1 || 0, cdGen2 || 0);
    return cd && cd > now ? cd - now : 0;
  };

  const getGeneralCooldownRemaining = (): number => {
    const cd1 = googleAccountCooldowns.get(normAccountKey);
    const cd2 = googleAccountCooldowns.get(rawAccountKey);
    const cd = cd1 || cd2;
    return cd && cd > now ? cd - now : 0;
  };

  const geminiResetStr = quota.geminiFiveHourReset || (quota as any).fiveHourResetTime || quota.geminiResetTime;
  const geminiResetTs = geminiResetStr ? new Date(geminiResetStr).getTime() : 0;
  const geminiWeeklyResetStr = quota.geminiWeeklyReset || (quota as any).weeklyResetTime || quota.geminiResetTime;
  const geminiWeeklyResetTs = geminiWeeklyResetStr ? new Date(geminiWeeklyResetStr).getTime() : 0;

  const claudeResetStr = quota.claudeFiveHourReset || (quota as any).fiveHourResetTime || quota.claudeResetTime;
  const claudeResetTs = claudeResetStr ? new Date(claudeResetStr).getTime() : 0;
  const claudeWeeklyResetStr = quota.claudeWeeklyReset || (quota as any).weeklyResetTime || quota.claudeResetTime;
  const claudeWeeklyResetTs = claudeWeeklyResetStr ? new Date(claudeWeeklyResetStr).getTime() : 0;

  let geminiWeeklyDepleted = (typeof quota.geminiWeeklyPct === 'number' && quota.geminiWeeklyPct < PREVENTIVE_QUOTA_THRESHOLD_PCT && (!geminiWeeklyResetTs || geminiWeeklyResetTs > now)) ||
                             (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < PREVENTIVE_QUOTA_THRESHOLD_PCT && (!geminiWeeklyResetTs || geminiWeeklyResetTs > now));
  let claudeWeeklyDepleted = (typeof quota.claudeWeeklyPct === 'number' && quota.claudeWeeklyPct < PREVENTIVE_QUOTA_THRESHOLD_PCT && (!claudeWeeklyResetTs || claudeWeeklyResetTs > now)) ||
                             (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < PREVENTIVE_QUOTA_THRESHOLD_PCT && (!claudeWeeklyResetTs || claudeWeeklyResetTs > now));

  if (quota.geminiFiveHourPct >= PREVENTIVE_QUOTA_THRESHOLD_PCT) {
    const remaining = getCooldownRemainingForFamily('gemini');
    const isStrictCooldown = remaining > FIVE_HOURS_MS;
    const isRateLimited = (remaining > 0) && (
      rateLimitedCooldownKeys.has(`${normAccountKey}:gemini`) ||
      rateLimitedCooldownKeys.has(`${rawAccountKey}:gemini`) ||
      rateLimitedCooldownKeys.has(normAccountKey) ||
      rateLimitedCooldownKeys.has(rawAccountKey)
    );

    const hasAnyCooldown =
      googleAccountCooldowns.has(`${normAccountKey}:gemini`) ||
      googleAccountCooldowns.has(`${rawAccountKey}:gemini`) ||
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    const isGeminiQuotaExhausted =
      isStrictCooldown ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    const geminiWeeklyResetPassed = Boolean(geminiWeeklyResetStr && geminiWeeklyResetTs > 0 && geminiWeeklyResetTs <= now);
    const geminiResetPassed = Boolean(
      geminiResetStr && geminiResetTs > 0 && geminiResetTs <= now &&
      (!isStrictCooldown && (remaining <= 0 || geminiResetTs >= (now + remaining - 300_000)))
    );

    geminiWeeklyDepleted = (typeof quota.geminiWeeklyPct === 'number' && quota.geminiWeeklyPct < PREVENTIVE_QUOTA_THRESHOLD_PCT && !geminiWeeklyResetPassed) ||
                           (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < PREVENTIVE_QUOTA_THRESHOLD_PCT && !geminiWeeklyResetPassed);

    const isGeminiExhaustionCleared =
      !isGeminiQuotaExhausted ||
      (isStrictCooldown ? geminiWeeklyResetPassed : (geminiResetPassed || remaining <= 0));

    const canHealGemini =
      !isGeminiQuarantined &&
      !isRateLimited &&
      (!isStrictCooldown || geminiWeeklyResetPassed) &&
      isGeminiExhaustionCleared &&
      quota.geminiFiveHourPct >= 5 &&
      !geminiWeeklyDepleted &&
      hasAnyCooldown;

    if (canHealGemini) {
      log.info(`[Proxy] Auto-healing Gemini cooldown for ${accountKey}: quota recovered to 5h=${quota.geminiFiveHourPct}%, week=${quota.geminiWeeklyPct}%`);
      googleAccountCooldowns.delete(`${normAccountKey}:gemini`);
      googleAccountCooldowns.delete(`${rawAccountKey}:gemini`);
      accountProbationUntil.delete(`${normAccountKey}:gemini`);
      accountProbationUntil.delete(`${rawAccountKey}:gemini`);
      quotaExhaustedAccountKeys.delete(`${normAccountKey}:gemini`);
      quotaExhaustedAccountKeys.delete(`${rawAccountKey}:gemini`);
      rateLimitedCooldownKeys.delete(`${normAccountKey}:gemini`);
      rateLimitedCooldownKeys.delete(`${rawAccountKey}:gemini`);

      const genCd = googleAccountCooldowns.get(normAccountKey) || googleAccountCooldowns.get(rawAccountKey);
      if (genCd) {
        if (quota.claudeFiveHourPct < PREVENTIVE_QUOTA_THRESHOLD_PCT || claudeWeeklyDepleted) {
          googleAccountCooldowns.set(`${normAccountKey}:claude`, genCd);
          googleAccountCooldowns.set(`${rawAccountKey}:claude`, genCd);
        }
        googleAccountCooldowns.delete(normAccountKey);
        googleAccountCooldowns.delete(rawAccountKey);
        accountProbationUntil.delete(normAccountKey);
        accountProbationUntil.delete(rawAccountKey);
        rateLimitedCooldownKeys.delete(normAccountKey);
        rateLimitedCooldownKeys.delete(rawAccountKey);
      }
      if (quotaExhaustedAccountKeys.has(normAccountKey) || quotaExhaustedAccountKeys.has(rawAccountKey)) {
        if (quota.claudeFiveHourPct < PREVENTIVE_QUOTA_THRESHOLD_PCT || claudeWeeklyDepleted) {
          quotaExhaustedAccountKeys.add(`${normAccountKey}:claude`);
          quotaExhaustedAccountKeys.add(`${rawAccountKey}:claude`);
        }
        quotaExhaustedAccountKeys.delete(normAccountKey);
        quotaExhaustedAccountKeys.delete(rawAccountKey);
      }
      clearAccountQuotaExhaustedFromDisk(normAccountKey);
      clearAccountQuotaExhaustedFromDisk(rawAccountKey);
      triggerQuotaCachePersist();
    } else if (isStrictCooldown || geminiWeeklyDepleted) {
      log.debug(`[Proxy] Skipping Gemini auto-heal for ${accountKey}: cooldown still active`);
    }
  } else if (quota.geminiFiveHourPct <= 0 && geminiResetTs > now) {
    const remainingResetMs = geminiResetTs - now;
    const currentCd = getCooldownRemainingForFamily('gemini');
    if (currentCd < 5 * 60_000 || currentCd < remainingResetMs) {
      googleAccountCooldowns.set(`${normAccountKey}:gemini`, now + remainingResetMs);
      googleAccountCooldowns.set(`${rawAccountKey}:gemini`, now + remainingResetMs);
      quotaExhaustedAccountKeys.add(`${normAccountKey}:gemini`);
      quotaExhaustedAccountKeys.add(`${rawAccountKey}:gemini`);
      rateLimitedCooldownKeys.delete(`${normAccountKey}:gemini`);
      rateLimitedCooldownKeys.delete(`${rawAccountKey}:gemini`);
      triggerQuotaCachePersist();
      log.warn(`[Proxy] Detected 0% Gemini quota for ${accountKey}. Enforcing cooldown.`);
    }
  }

  if (quota.claudeFiveHourPct >= PREVENTIVE_QUOTA_THRESHOLD_PCT) {
    const remaining = getCooldownRemainingForFamily('claude');
    const isStrictCooldown = remaining > FIVE_HOURS_MS;
    const isRateLimited = (remaining > 0) && (
      rateLimitedCooldownKeys.has(`${normAccountKey}:claude`) ||
      rateLimitedCooldownKeys.has(`${rawAccountKey}:claude`) ||
      rateLimitedCooldownKeys.has(normAccountKey) ||
      rateLimitedCooldownKeys.has(rawAccountKey)
    );

    const hasAnyCooldown =
      googleAccountCooldowns.has(`${normAccountKey}:claude`) ||
      googleAccountCooldowns.has(`${rawAccountKey}:claude`) ||
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    const isClaudeQuotaExhausted =
      isStrictCooldown ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    const claudeWeeklyResetPassed = Boolean(claudeWeeklyResetStr && claudeWeeklyResetTs > 0 && claudeWeeklyResetTs <= now);
    const claudeResetPassed = Boolean(
      claudeResetStr && claudeResetTs > 0 && claudeResetTs <= now &&
      (!isStrictCooldown && (remaining <= 0 || claudeResetTs >= (now + remaining - 300_000)))
    );

    claudeWeeklyDepleted = (typeof quota.claudeWeeklyPct === 'number' && quota.claudeWeeklyPct < PREVENTIVE_QUOTA_THRESHOLD_PCT && !claudeWeeklyResetPassed) ||
                           (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < PREVENTIVE_QUOTA_THRESHOLD_PCT && !claudeWeeklyResetPassed);

    const isClaudeExhaustionCleared =
      !isClaudeQuotaExhausted ||
      (isStrictCooldown ? claudeWeeklyResetPassed : (claudeResetPassed || remaining <= 0));

    const canHealClaude =
      !isClaudeQuarantined &&
      !isRateLimited &&
      (!isStrictCooldown || claudeWeeklyResetPassed) &&
      isClaudeExhaustionCleared &&
      quota.claudeFiveHourPct >= 5 &&
      !claudeWeeklyDepleted &&
      hasAnyCooldown;

    if (canHealClaude) {
      log.info(`[Proxy] Auto-healing Claude cooldown for ${accountKey}: quota recovered to 5h=${quota.claudeFiveHourPct}%`);
      googleAccountCooldowns.delete(`${normAccountKey}:claude`);
      googleAccountCooldowns.delete(`${rawAccountKey}:claude`);
      accountProbationUntil.delete(`${normAccountKey}:claude`);
      accountProbationUntil.delete(`${rawAccountKey}:claude`);
      quotaExhaustedAccountKeys.delete(`${normAccountKey}:claude`);
      quotaExhaustedAccountKeys.delete(`${rawAccountKey}:claude`);
      rateLimitedCooldownKeys.delete(`${normAccountKey}:claude`);
      rateLimitedCooldownKeys.delete(`${rawAccountKey}:claude`);

      const genCd = googleAccountCooldowns.get(normAccountKey) || googleAccountCooldowns.get(rawAccountKey);
      if (genCd) {
        if (quota.geminiFiveHourPct < PREVENTIVE_QUOTA_THRESHOLD_PCT || geminiWeeklyDepleted) {
          googleAccountCooldowns.set(`${normAccountKey}:gemini`, genCd);
          googleAccountCooldowns.set(`${rawAccountKey}:gemini`, genCd);
        }
        googleAccountCooldowns.delete(normAccountKey);
        googleAccountCooldowns.delete(rawAccountKey);
        accountProbationUntil.delete(normAccountKey);
        accountProbationUntil.delete(rawAccountKey);
        rateLimitedCooldownKeys.delete(normAccountKey);
        rateLimitedCooldownKeys.delete(rawAccountKey);
      }
      if (quotaExhaustedAccountKeys.has(normAccountKey) || quotaExhaustedAccountKeys.has(rawAccountKey)) {
        if (quota.geminiFiveHourPct < PREVENTIVE_QUOTA_THRESHOLD_PCT || geminiWeeklyDepleted) {
          quotaExhaustedAccountKeys.add(`${normAccountKey}:gemini`);
          quotaExhaustedAccountKeys.add(`${rawAccountKey}:gemini`);
        }
        quotaExhaustedAccountKeys.delete(normAccountKey);
        quotaExhaustedAccountKeys.delete(rawAccountKey);
      }
      triggerQuotaCachePersist();
    } else if (isStrictCooldown || claudeWeeklyDepleted) {
      log.debug(`[Proxy] Skipping Claude auto-heal for ${accountKey}: cooldown still active`);
    }
  } else if (quota.claudeFiveHourPct <= 0 && claudeResetTs > now) {
    const remainingResetMs = claudeResetTs - now;
    const currentCd = getCooldownRemainingForFamily('claude');
    if (currentCd < 5 * 60_000 || currentCd < remainingResetMs) {
      googleAccountCooldowns.set(`${normAccountKey}:claude`, now + remainingResetMs);
      googleAccountCooldowns.set(`${rawAccountKey}:claude`, now + remainingResetMs);
      quotaExhaustedAccountKeys.add(`${normAccountKey}:claude`);
      quotaExhaustedAccountKeys.add(`${rawAccountKey}:claude`);
      rateLimitedCooldownKeys.delete(`${normAccountKey}:claude`);
      rateLimitedCooldownKeys.delete(`${rawAccountKey}:claude`);
      triggerQuotaCachePersist();
      log.warn(`[Proxy] Detected 0% Claude quota for ${accountKey}. Enforcing cooldown.`);
    }
  }

  if (quota.geminiFiveHourPct >= 5 || quota.claudeFiveHourPct >= 5) {
    const remaining = getGeneralCooldownRemaining();
    const isStrictCooldown = remaining > FIVE_HOURS_MS;
    const isGeneralRateLimited = (remaining > 0) && (
      rateLimitedCooldownKeys.has(normAccountKey) ||
      rateLimitedCooldownKeys.has(rawAccountKey)
    );

    const hasAnyCooldown =
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    if (!isAccountWideQuarantined && !isGeneralRateLimited && !isStrictCooldown && !geminiWeeklyDepleted && !claudeWeeklyDepleted && hasAnyCooldown) {
      log.info(`[Proxy] Auto-healing general cooldown for ${accountKey}`);
      googleAccountCooldowns.delete(normAccountKey);
      googleAccountCooldowns.delete(rawAccountKey);
      accountProbationUntil.delete(normAccountKey);
      accountProbationUntil.delete(rawAccountKey);
      quotaExhaustedAccountKeys.delete(normAccountKey);
      quotaExhaustedAccountKeys.delete(rawAccountKey);
      rateLimitedCooldownKeys.delete(normAccountKey);
      rateLimitedCooldownKeys.delete(rawAccountKey);
    } else if (isStrictCooldown || (geminiWeeklyDepleted && claudeWeeklyDepleted)) {
      log.debug(`[Proxy] Skipping general auto-heal for ${accountKey}: multi-day/weekly cooldown still active`);
    }
  }
}
