import type { MainContext } from '../types';
import { registerDaemonNetworkIpc } from './system/daemonNetworkIpc';
import { registerProvidersIpc } from './accounts/providersIpc';
import { registerGoogleAccountsIpc } from './accounts/googleAccountsIpc';
import { registerAntigravityIpc } from './system/antigravityIpc';
import { registerProxyLifecycleIpc } from './system/proxyLifecycleIpc';
import { registerStatsTokensIpc } from './accounts/statsTokensIpc';
import { registerUpdatesConfigIpc } from './system/updatesConfigIpc';
import { registerCliStreamIpc } from './system/cliStreamIpc';

export function registerAllIpcHandlers(ctx: MainContext): void {
  registerDaemonNetworkIpc(ctx);
  registerProvidersIpc(ctx);
  registerGoogleAccountsIpc(ctx);
  registerAntigravityIpc(ctx);
  registerProxyLifecycleIpc(ctx);
  registerStatsTokensIpc(ctx);
  registerUpdatesConfigIpc(ctx);
  registerCliStreamIpc(ctx);
}

export * from './system/daemonNetworkIpc';
export * from './accounts/providersIpc';
export * from './accounts/googleAccountsIpc';
export * from './system/antigravityIpc';
export * from './system/proxyLifecycleIpc';
export * from './accounts/statsTokensIpc';
export * from './system/updatesConfigIpc';
export * from './system/cliStreamIpc';
