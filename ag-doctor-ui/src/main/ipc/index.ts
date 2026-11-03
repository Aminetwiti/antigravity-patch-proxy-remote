import type { MainContext } from '../types';
import { registerDaemonNetworkIpc } from './daemonNetworkIpc';
import { registerProvidersIpc } from './providersIpc';
import { registerGoogleAccountsIpc } from './googleAccountsIpc';
import { registerAntigravityIpc } from './antigravityIpc';
import { registerProxyLifecycleIpc } from './proxyLifecycleIpc';
import { registerStatsTokensIpc } from './statsTokensIpc';
import { registerUpdatesConfigIpc } from './updatesConfigIpc';
import { registerCliStreamIpc } from './cliStreamIpc';

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

export * from './daemonNetworkIpc';
export * from './providersIpc';
export * from './googleAccountsIpc';
export * from './antigravityIpc';
export * from './proxyLifecycleIpc';
export * from './statsTokensIpc';
export * from './updatesConfigIpc';
export * from './cliStreamIpc';
