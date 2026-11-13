import * as http from 'http';
import log from 'electron-log';
import { DEFAULT_MAX_BODY_SIZE } from '../../../../constants';
import { runPreflightGuards } from './preflightGuard';
import { handleRelayRoutes } from './relayRouter';
import { handleDiscoveryRoutes } from './discovery';
import {
  handleCloudCodeGenerationRoute,
  handleStandardGenerationRoute,
  handleFallbackGoogleRoute,
} from './generation';

export function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (runPreflightGuards(req, res)) {
    return;
  }

  req.url = req.url!.replace(/^.*\/dummy_path_padding/, '');
  req.url = req.url!.replace(/\/v1internal\/x+/, '');

  const MAX_BODY_SIZE = DEFAULT_MAX_BODY_SIZE;
  let bodyLength = 0;
  let bodyRejected = false;

  const bodyChunks: Buffer[] = [];
  req.on('data', (chunk) => {
    bodyLength += chunk.length;
    if (bodyLength > MAX_BODY_SIZE) {
      if (!bodyRejected) {
        bodyRejected = true;
        const maxMb = Math.round(MAX_BODY_SIZE / (1024 * 1024));
        log.warn(`[Proxy] Request body exceeds ${maxMb}MB limit (${req.method} ${req.url})`);
        if (!res.headersSent) {
          res.writeHead(413, {
            'Content-Type': 'application/json',
            'Connection': 'close',
          });
          res.end(
            JSON.stringify({ error: { message: `Request body too large. Maximum: ${maxMb}MB` } }),
          );
        }
        req.resume();
        res.on('finish', () => {
          req.destroy();
        });
      }
      return;
    }
    bodyChunks.push(chunk);
  });

  req.on('end', async () => {
    if (bodyRejected) return;

    const fullBody = Buffer.concat(bodyChunks);
    const bodyStr = fullBody.toString('utf-8');

    const isRoutineNoise =
      req.url?.includes('Heartbeat') ||
      req.url?.includes('GetUserStatus') ||
      req.url?.includes('listExperiments') ||
      req.url?.includes('loadCodeAssist') ||
      req.url?.includes('recordTrajectoryAnalytics') ||
      req.url?.includes('writeTrajectoryAcls') ||
      req.url?.includes('retrieveUserQuotaSummary') ||
      req.url?.includes('fetchAvailableModels') ||
      req.url?.includes('fetchAdminControls') ||
      req.url?.includes('buildWithGooglePlugins') ||
      req.url?.includes('cascadeNuxes') ||
      req.url?.includes('fetchUserInfo') ||
      req.url === '/health';
    if (isRoutineNoise) {
      log.debug(`[Proxy] Request: ${req.method} ${req.url}`);
    } else {
      log.info(`[Proxy] Request: ${req.method} ${req.url}`);
    }

    if (await handleRelayRoutes(req, res, bodyStr)) {
      return;
    }

    if (await handleDiscoveryRoutes(req, res, fullBody)) {
      return;
    }

    const isSessionRemote = false;
    const cloudCodeResult = await handleCloudCodeGenerationRoute(req, res, bodyStr, isSessionRemote);
    if (cloudCodeResult.handled) {
      return;
    }

    if (await handleStandardGenerationRoute(req, res, bodyStr, cloudCodeResult.convId, cloudCodeResult.sessId)) {
      return;
    }

    await handleFallbackGoogleRoute(
      req,
      res,
      fullBody,
      bodyStr,
      isSessionRemote,
      cloudCodeResult.convId,
      cloudCodeResult.sessId,
    );
  });
}
