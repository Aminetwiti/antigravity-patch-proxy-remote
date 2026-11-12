export interface OutcomeLoopState {
  lastStatus: number;
  lastErrorText: string;
  consecutiveTransportErrorCount: number;
  consecutiveServer5xxCount: number;
  consecutiveUnknownCount: number;
  preventiveSkipCount: number;
}
