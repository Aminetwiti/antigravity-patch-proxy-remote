export interface LoopExecutionOptions {
  isSessionRemote: boolean;
  convId: string;
  sessId: string | null;
  attemptedModels: Set<string>;
  fallbackDepth: number;
}
