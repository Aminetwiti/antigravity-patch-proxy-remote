import type * as http from 'http';
import type { CustomModel } from '../../../../core/types';

export interface FallbackParams {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  reqJson: Record<string, unknown>;
  accountPool: CustomModel[];
  isSessionRemote: boolean;
  convId: string;
  sessId: string | null;
  attemptedModels: Set<string>;
  fallbackDepth: number;
  lastStatus: number;
  lastErrorText: string;
  targetRaw: string;
  poolExecutor: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqJson: Record<string, unknown>,
    fallbackPool: CustomModel[],
    isSessionRemote: boolean,
    convId: string,
    sessId: string | null,
    nextAttempted: Set<string>,
    fallbackDepth: number,
  ) => Promise<boolean>;
}
