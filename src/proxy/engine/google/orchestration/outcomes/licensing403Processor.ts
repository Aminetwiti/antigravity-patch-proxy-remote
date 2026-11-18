import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { PoolLoopState } from '../types';
import {
  setAccountCooldown,
  markAccountUnlicensed,
} from '../../../../resilience/pools/googlePool';
import {
  isGoogleCloudCodeModel,
  getValidGoogleAccessToken,
  onboardUserAndAcceptTerms,
} from '../../../../../services/auth/googleAuth';
import { sessionAffinities } from '../../../../resilience/pools/sessionAffinities';

export async function processOutcome403(
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  sessId: string | null,
  state: PoolLoopState,
): Promise<void> {
  if (sessId) sessionAffinities.delete(sessId);
  const isValidationRequired = /validation_required|verify.*account|verification.*required/i.test(state.lastErrorText);
  const isLicenseError =
    /license|licens|permission|unauthorized|forbidden|not have a valid|account.*restricted|restricted|unavailable tier|suspended|denied access/i.test(
      state.lastErrorText,
    ) || isValidationRequired;

  if (isValidationRequired && isGoogleCloudCodeModel(candidate)) {
    let validationUrl = '';
    try {
      const parsed = JSON.parse(state.lastErrorText);
      const errInfo = parsed.error?.details?.find((d: any) => d['@type']?.includes('ErrorInfo'));
      validationUrl = errInfo?.metadata?.validation_url || '';
      if (!validationUrl) {
        const help = parsed.error?.details?.find((d: any) => d['@type']?.includes('Help'));
        validationUrl = help?.links?.[0]?.url || '';
      }
    } catch (_) {}

    if (validationUrl) {
      log.warn(`[Proxy] 🚨 Compte ${candidateName} requiert une validation Google (Challenge interactif / plt) !`);
      log.warn(`[Proxy] 🔗 Lien de déblocage direct navigateur : ${validationUrl}`);
    } else {
      log.warn(`[Proxy] Account ${candidateName} encountered VALIDATION_REQUIRED. Triggering automatic background onboarding...`);
    }

    getValidGoogleAccessToken(candidate)
      .then((token) => {
        if (token) onboardUserAndAcceptTerms(token).catch(() => {});
      })
      .catch(() => {});
  }

  const quarantineMs = isLicenseError ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
  const isAccountWideRestriction = isValidationRequired || /suspended|account.*restricted|underage|minor/i.test(state.lastErrorText);

  if (isAccountWideRestriction) {
    log.warn(
      `[Proxy] Account ${candidateName} received HTTP 403 (account-level restriction). Placing in ${Math.round(quarantineMs / 3600000)}h quarantine.`,
    );
    if (isLicenseError) markAccountUnlicensed(candidate);
    setAccountCooldown(candidate, quarantineMs);
    setAccountCooldown(candidate, quarantineMs, 'gemini');
    setAccountCooldown(candidate, quarantineMs, 'claude');
    if (modelFamily) setAccountCooldown(candidate, quarantineMs, modelFamily);
  } else {
    // Model-specific licensing / tier permission 403 (e.g. Sonar or Claude on free tier):
    // Only quarantine the specific model family so remaining models (e.g. Gemini 3.8 Flash) remain fully available!
    const targetFamily = modelFamily || 'gemini';
    log.warn(
      `[Proxy] Account ${candidateName} received HTTP 403 for model family [${targetFamily}]. Quarantining only [${targetFamily}] for ${Math.round(quarantineMs / 3600000)}h.`,
    );
    setAccountCooldown(candidate, quarantineMs, targetFamily);
  }
}
