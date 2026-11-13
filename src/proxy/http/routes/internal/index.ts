import * as http from 'http';
import { handleSystemDiagnosticRoutes } from './systemDiagnosticRoutes';
import { handlePluginAndUiRoutes } from './pluginAndUiRoutes';
import { handleQuotaAndPoolRoutes } from './quotaAndPoolRoutes';

export function handleInternalApiRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (handleSystemDiagnosticRoutes(req, res)) return true;
  if (handlePluginAndUiRoutes(req, res)) return true;
  if (handleQuotaAndPoolRoutes(req, res)) return true;
  return false;
}

export {
  handleSystemDiagnosticRoutes,
  handlePluginAndUiRoutes,
  handleQuotaAndPoolRoutes,
};
