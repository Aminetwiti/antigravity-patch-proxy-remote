/**
 * Logger + metrics facades used by every other preload module.
 * ponytail: metrics uses lazy `require('./metrics')` so preload-shim standalone bundles don't fail.
 */
import { createLogger } from '../logger';

export const preloadLog = createLogger('Preload');

export const preloadMetrics = {
  inc: (name: string, labels: Record<string, string> = {}, n = 1): void => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { inc } = require('../metrics');
      inc(name, labels, n);
    } catch {
      /* noop when running outside the bundled preload (preload-shim, tests, etc.) */
    }
  },
};

preloadLog.debug('Preload script loaded');
