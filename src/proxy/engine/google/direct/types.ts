import type http from 'http';

export interface GoogleRequestOutcome {
  success: boolean;
  statusCode?: number;
  error?: string;
  headers?: http.IncomingHttpHeaders;
  isTransportError?: boolean;
}
