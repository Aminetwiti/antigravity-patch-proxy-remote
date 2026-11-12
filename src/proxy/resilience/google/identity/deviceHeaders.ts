import { createHash } from 'crypto';
import type { CustomModel } from '../../../core/types';

/**
 * Returns deterministic virtualized device headers per account to prevent Google
 * from correlating 30+ accounts to a single physical machineId/device fingerprint.
 */
export function getAccountVirtualDeviceHeaders(account: CustomModel): Record<string, string> {
  const seed = (account.accountEmail || account.refreshToken || account.name || 'default').toLowerCase().trim();
  const machineHash = createHash('sha256').update(`mach:${seed}:v1`).digest('hex');
  const serviceMachineHash = createHash('sha256').update(`svc:${seed}:v1`).digest('hex');
  const formattedSvcId = `${serviceMachineHash.substring(0, 8)}-${serviceMachineHash.substring(8, 12)}-4${serviceMachineHash.substring(13, 16)}-a${serviceMachineHash.substring(17, 20)}-${serviceMachineHash.substring(20, 32)}`;

  return {
    'x-client-machine-id': machineHash,
    'x-service-machine-id': formattedSvcId,
  };
}
