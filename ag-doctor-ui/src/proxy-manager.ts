/**
 * Legacy Re-export for Backward Compatibility.
 * Actual service implementation relocated to src/services/proxyManager.ts (DIP & SOLID).
 */

export * from './services/runtime/proxyManager';
import { ProxyManager } from './services/runtime/proxyManager';
export default ProxyManager;
