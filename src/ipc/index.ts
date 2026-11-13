import { StorageManager } from '../compat/storage';
import { registerSystemHandlers } from './handlers/systemHandlers';
import { registerModelHandlers } from './handlers/modelHandlers';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerRemoteHandlers } from './handlers/remoteHandlers';

/**
 * Registers all IPC handlers for the main process.
 * Decomposed into modular domain engines in src/ipc/handlers/
 */
export function registerIpcHandlers(storageManager: StorageManager): void {
  registerSystemHandlers();
  registerModelHandlers(storageManager);
  registerConnectionHandlers();
  registerRemoteHandlers();
}

export * from './handlers/systemHandlers';
export * from './handlers/modelHandlers';
export * from './handlers/connectionHandlers';
export * from './handlers/remoteHandlers';