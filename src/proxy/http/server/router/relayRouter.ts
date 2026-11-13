import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../httpUtils';
import { mcpListServers, mcpCallTool } from '../../routes/mcpRelay';
import { loadCustomModels } from '../../../models/catalog/modelLoader';
import { generateModelPlaceholderId } from '../../../models/catalog/idGenerator';
import { isTelemetryRpcUrl } from '../../routes/endpointHandlers';

export async function handleRelayRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bodyStr: string,
): Promise<boolean> {
  // Zero latency: Short-circuit DeepMind / Trajectory telemetry and analytics reporting
  if (
    req.url?.includes('recordTrajectoryAnalytics') ||
    req.url?.includes('writeTrajectoryAcls') ||
    req.url?.includes('analytics')
  ) {
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ ok: true, status: 'RECORDED_NOOP' }));
    }
    return true;
  }

  // MCP relay
  if (req.method === 'GET' && (req.url === '/list_mcp_servers' || req.url === '/mcp_servers')) {
    const listRes = await mcpListServers();
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify(listRes));
    }
    return true;
  }

  // MCP tool relay
  if (req.method === 'POST' && req.url === '/call_mcp_tool') {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(bodyStr || '{}');
    } catch (e) {
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      }
      return true;
    }
    const callRes = await mcpCallTool(payload);
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify(callRes));
    }
    return true;
  }

  // OpenAI /chat/completions relay
  if (req.method === 'POST' && req.url!.includes('/chat/completions')) {
    try {
      const payload = JSON.parse(bodyStr || '{}');
      if (payload.model && /MODEL_PLACEHOLDER_/i.test(payload.model)) {
        const allModels = loadCustomModels();
        const found = allModels.find(
          (m) => generateModelPlaceholderId(m) === payload.model || m.name === payload.model || m.name.endsWith('/' + payload.model),
        );
        if (found && found.externalModelName) {
          payload.model = found.externalModelName;
        } else {
          const active = allModels.filter(m => m.enabled !== false && m.externalModelName);
          const defaultModel = active[0] || allModels[0];
          if (defaultModel && defaultModel.externalModelName) {
            payload.model = defaultModel.externalModelName;
          }
        }
      }
      if (Array.isArray(payload.messages)) {
        for (const msg of payload.messages) {
          delete msg.reasoning_content;
        }
      }
      if (payload.temperature !== undefined && payload.temperature !== 1) {
        delete payload.temperature;
      }
      if (payload.max_tokens && !payload.max_completion_tokens) {
        payload.max_completion_tokens = payload.max_tokens;
        delete payload.max_tokens;
      }
      log.info(`[Relay on 51074] Forwarding request for model: ${payload.model}`);
      const cleanedBody = JSON.stringify(payload);
      const upstreamTarget = (req.headers['x-upstream-url'] as string) || 'https://api.experientiallabs.ai/v1/chat/completions';
      const upstreamUrl = new URL(upstreamTarget);
      const forwardHeaders: Record<string, string> = {
        host: upstreamUrl.host,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(cleanedBody)),
      };
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (
          lk !== 'host' &&
          lk !== 'content-length' &&
          lk !== 'transfer-encoding' &&
          lk !== 'connection' &&
          lk !== 'accept-encoding' &&
          lk !== 'x-upstream-url' &&
          typeof v === 'string'
        ) {
          forwardHeaders[lk] = v;
        }
      }

      const isHttps = upstreamUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      const upstreamReq = client.request(upstreamUrl, {
        method: 'POST',
        headers: forwardHeaders,
      }, (upstreamRes) => {
        safeWriteHead(res, upstreamRes.statusCode || 200, upstreamRes.headers as any);
        upstreamRes.pipe(res);
      });
      upstreamReq.on('error', (err) => {
        log.error('[Proxy] /chat/completions relay network error:', err);
        if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: err.message } }));
        }
      });
      upstreamReq.write(cleanedBody);
      upstreamReq.end();
      return true;
    } catch (err) {
      log.error('[Proxy] /chat/completions relay error:', err);
    }
  }

  // Fast-Ack for Language Server telemetry & shadow eval RPCs
  if (process.env.AG_FAST_ACK_TELEMETRY !== '0' && isTelemetryRpcUrl(req.url)) {
    log.debug(`[Proxy] Fast-Ack telemetry RPC intercepted: ${req.url}`);
    const isJson = !req.headers['content-type'] || req.headers['content-type'].includes('application/json');
    if (isJson) {
      if (safeWriteHead(res, 200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })) {
        safeEnd(res, '{}');
      }
    } else {
      if (safeWriteHead(res, 200, {
        'Content-Type': req.headers['content-type'] || 'application/connect+proto',
        'Access-Control-Allow-Origin': '*',
        'grpc-status': '0',
      })) {
        safeEnd(res, Buffer.from([0, 0, 0, 0, 0]));
      }
    }
    return true;
  }

  return false;
}
