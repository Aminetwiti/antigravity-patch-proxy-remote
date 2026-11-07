import { StorageManager } from './storage';
import { registerSystemHandlers } from './ipc/systemHandlers';
import { registerModelHandlers } from './ipc/modelHandlers';
import { registerConnectionHandlers } from './ipc/connectionHandlers';
import { registerRemoteHandlers } from './ipc/remoteHandlers';

/**
 * Registers all IPC handlers for the main process.
 * Decomposed into modular domain engines in src/ipc/
 */
export function registerIpcHandlers(storageManager: StorageManager): void {
  registerSystemHandlers();
  registerModelHandlers(storageManager);
  registerConnectionHandlers();
  registerRemoteHandlers();
}

export * from './ipc/systemHandlers';
export * from './ipc/modelHandlers';
export * from './ipc/connectionHandlers';
export * from './ipc/remoteHandlers';
