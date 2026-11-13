import * as http from 'http';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import { sanitizeCloudCodeGenerationConfig } from '../../../../../services/auth/googleAuth';
import { extractModelNameFromPayload } from '../../../../models/catalog/modelUtils';
import { proxyToGoogle } from '../../../../engine/googleCloudEngine';

export async function handleFallbackGoogleRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
  bodyStr: string,
  isSessionRemote: boolean,
  convId: string | null,
  sessId: string,
): Promise<void> {
  let rawModelName = '';
  let updatedBody = fullBody;

  try {
    const fallbackJson = JSON.parse(bodyStr) as Record<string, unknown>;
    const fallbackReq = (fallbackJson.request || fallbackJson) as Record<string, unknown>;
    rawModelName = extractModelNameFromPayload(fallbackJson).toLowerCase();

    if (typeof fallbackJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackJson.planModel)) {
      delete fallbackJson.planModel;
      updatedBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
    }
    if (typeof fallbackReq.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackReq.planModel)) {
      delete fallbackReq.planModel;
      updatedBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
    }
    if (rawModelName.includes('claude') && Array.isArray(fallbackReq.contents)) {
      sanitizeCloudCodeGenerationConfig(fallbackReq, rawModelName);
      updatedBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
    }
    if (
      rawModelName.includes('2_5_flash_lite') ||
      rawModelName.includes('2-5-flash-lite') ||
      rawModelName.includes('flash_lite') ||
      rawModelName.includes('flash-lite')
    ) {
      const rewrittenModel = 'gemini-3.8-flash-tiered';
      fallbackJson.model = rewrittenModel;
      if (fallbackJson.request && typeof fallbackJson.request === 'object') {
        (fallbackJson.request as Record<string, unknown>).model = rewrittenModel;
      }
      rawModelName = rewrittenModel;
      updatedBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
    }
  } catch {
    // not JSON - continue as-is
  }

  if (/MODEL_PLACEHOLDER_/i.test(rawModelName) || /MODEL_PLACEHOLDER_/i.test(req.url || '')) {
    log.warn(`[Proxy] Unresolved custom model placeholder [${rawModelName}] reached fallback proxy. Rejecting locally with 503.`);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
      safeEnd(res, JSON.stringify({
        error: {
          code: 503,
          status: 'UNAVAILABLE',
          message: `Custom model placeholder [${rawModelName}] could not be resolved by local proxy. The model store may be reloading.`,
        },
      }));
    }
    return;
  }

  await proxyToGoogle(req, res, updatedBody, isSessionRemote, undefined, convId || '', undefined, sessId || '', rawModelName);
}
