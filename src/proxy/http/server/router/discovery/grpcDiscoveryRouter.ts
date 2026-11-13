import * as http from 'http';
import { URL } from 'url';
import { LOOPBACK_HOSTS } from '../../../../../constants';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import {
  handleGetAvailableModelsProxy,
  handleGetUserStatusProxy,
} from '../../../routes/endpointHandlers';

export function handleGrpcDiscoveryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
): boolean {
  if (req.url!.startsWith('/GetAvailableModels')) {
    const gavParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
    const lsUrl = gavParsed.searchParams.get('ls');
    if (lsUrl) {
      handleGetAvailableModelsProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
      return true;
    }
    if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
      safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
    }
    return true;
  }

  if (req.url!.startsWith('/GetUserStatus')) {
    const gusParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
    const lsUrl = gusParsed.searchParams.get('ls');
    if (lsUrl) {
      handleGetUserStatusProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
      return true;
    }
    if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
      safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
    }
    return true;
  }

  return false;
}
