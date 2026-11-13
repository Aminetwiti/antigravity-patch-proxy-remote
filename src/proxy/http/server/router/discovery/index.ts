import * as http from 'http';
import { handleGrpcDiscoveryRoutes } from './grpcDiscoveryRouter';
import { handleExperimentsRoute } from './experimentsRouter';
import { handleCodeAssistRoute } from './codeAssistRouter';
import { handleModelsDiscoveryRoute } from './modelsDiscoveryRouter';

export async function handleDiscoveryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
): Promise<boolean> {
  if (handleGrpcDiscoveryRoutes(req, res, fullBody)) return true;
  if (await handleExperimentsRoute(req, res, fullBody)) return true;
  if (await handleCodeAssistRoute(req, res, fullBody)) return true;
  if (await handleModelsDiscoveryRoute(req, res, fullBody)) return true;
  return false;
}

export {
  handleGrpcDiscoveryRoutes,
  handleExperimentsRoute,
  handleCodeAssistRoute,
  handleModelsDiscoveryRoute,
};
