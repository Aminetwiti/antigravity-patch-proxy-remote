import { describe, it, expect } from 'vitest';
import { classifyError, generateDiagnosticCardMarkdown } from '../proxy/errorClassifier';


describe('Error Classifier', () => {
  describe('Billing / Quota errors', () => {
    it('classifies HTTP 402 as billing error', () => {
      const result = classifyError(402);
      expect(result.errorType).toBe('billing');
      expect(result.title).toBe('Insufficient Credits');
      expect(result.retryable).toBe(false);
    });

    it('classifies billing_error in body as billing error', () => {
      const body = JSON.stringify({
        error: {
          type: 'billing_error',
          message: 'insufficient tokens',
        },
      });
      const result = classifyError(200, null, body);
      expect(result.errorType).toBe('billing');
      expect(result.retryable).toBe(false);
    });

    it('classifies insufficient_quota in body as billing error', () => {
      const body = JSON.stringify({
        error: {
          code: 'insufficient_quota',
        },
      });
      const result = classifyError(400, null, body);
      expect(result.errorType).toBe('billing');
    });

    it('classifies raw string including quota exceeded as billing error', () => {
      const result = classifyError(400, null, 'Quota exceeded for model developer');
      expect(result.errorType).toBe('billing');
    });

    it('assigns provider-specific billing URLs', () => {
      const resOpenAI = classifyError(402, null, undefined, 'OpenAI');
      expect(resOpenAI.actionUrl).toBe('https://platform.openai.com/billing');

      const resAnthropic = classifyError(402, null, undefined, 'anthropic');
      expect(resAnthropic.actionUrl).toBe('https://console.anthropic.com/settings/billing');

      const resUnknown = classifyError(402, null, undefined, 'SomeUnknownProvider');
      expect(resUnknown.actionUrl).toBeUndefined();
    });
  });

  describe('Authentication errors', () => {
    it('classifies HTTP 401 as auth error', () => {
      const result = classifyError(401);
      expect(result.errorType).toBe('auth');
      expect(result.title).toBe('Authentication Failed');
      expect(result.retryable).toBe(false);
    });

    it('classifies invalid_api_key in body as auth error', () => {
      const body = JSON.stringify({
        error: {
          code: 'invalid_api_key',
        },
      });
      const result = classifyError(400, null, body);
      expect(result.errorType).toBe('auth');
    });

    it('classifies message with unauthorized as auth error', () => {
      const result = classifyError(undefined, { message: 'Request unauthorized' });
      expect(result.errorType).toBe('auth');
    });
  });

  describe('Forbidden errors', () => {
    it('classifies HTTP 403 as forbidden error', () => {
      const result = classifyError(403);
      expect(result.errorType).toBe('forbidden');
      expect(result.title).toBe('Access Denied');
      expect(result.retryable).toBe(false);
    });

    it('classifies permission_denied in body as forbidden error', () => {
      const result = classifyError(200, null, 'permission_denied to model resource');
      expect(result.errorType).toBe('forbidden');
    });
  });

  describe('Rate limit errors', () => {
    it('classifies HTTP 429 as rate limit error', () => {
      const result = classifyError(429);
      expect(result.errorType).toBe('rate_limit');
      expect(result.title).toBe('Rate Limited');
      expect(result.retryable).toBe(true);
    });

    it('classifies too_many_requests in response body as rate limit', () => {
      const result = classifyError(400, null, 'too_many_requests to this endpoint');
      expect(result.errorType).toBe('rate_limit');
    });
  });

  describe('DNS resolution errors', () => {
    it('classifies ENOTFOUND code as DNS error', () => {
      const result = classifyError(undefined, { code: 'ENOTFOUND' });
      expect(result.errorType).toBe('dns');
      expect(result.title).toBe('DNS Resolution Failed');
      expect(result.retryable).toBe(false);
    });

    it('classifies getaddrinfo message as DNS error', () => {
      const result = classifyError(undefined, { message: 'getaddrinfo ENOTFOUND api.openai.com' });
      expect(result.errorType).toBe('dns');
    });
  });

  describe('Timeout errors', () => {
    it('classifies HTTP 504 as timeout error', () => {
      const result = classifyError(504);
      expect(result.errorType).toBe('timeout');
      expect(result.title).toBe('Request Timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies ETIMEDOUT code as timeout error', () => {
      const result = classifyError(undefined, { code: 'ETIMEDOUT' });
      expect(result.errorType).toBe('timeout');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Network errors', () => {
    it('classifies ECONNREFUSED as network error', () => {
      const result = classifyError(undefined, { code: 'ECONNREFUSED' });
      expect(result.errorType).toBe('network');
      expect(result.title).toBe('Network Connection Failed');
      expect(result.retryable).toBe(true);
    });

    it('classifies connrefused in error message as network error', () => {
      const result = classifyError(undefined, { message: 'connect ECONNREFUSED 127.0.0.1:11434' });
      expect(result.errorType).toBe('network');
    });
  });

  describe('Server errors', () => {
    it('classifies HTTP 500 as server error', () => {
      const result = classifyError(500);
      expect(result.errorType).toBe('server');
      expect(result.title).toBe('Provider Server Error');
      expect(result.retryable).toBe(true);
    });

    it('classifies HTTP 503 as server error', () => {
      const result = classifyError(503);
      expect(result.errorType).toBe('server');
      expect(result.retryable).toBe(true);
    });
  });

  describe('400 and 404 errors', () => {
    it('classifies HTTP 404 as Model Not Found with upstream detail', () => {
      const result = classifyError(404, null, JSON.stringify({ error: { message: 'Model free/mimo-v2.5 not found' } }));
      expect(result.title).toBe('Model Not Found (404)');
      expect(result.message).toContain('Model free/mimo-v2.5 not found');
    });

    it('classifies HTTP 400 as Invalid Request with upstream detail', () => {
      const result = classifyError(400, null, JSON.stringify({ error: { message: 'Context window exceeded' } }));
      expect(result.title).toBe('Invalid Request (400)');
      expect(result.message).toContain('Context window exceeded');
    });
  });

  describe('generateDiagnosticCardMarkdown', () => {
    it('formats a Markdown alert card with title, message, suggestions and actionUrl', () => {
      const diag = classifyError(402, null, null, 'openai');
      const md = generateDiagnosticCardMarkdown(diag);

      expect(md).toContain('[!CAUTION]');
      expect(md).toContain('Insufficient Credits');
      expect(md).toContain('Suggested Actions');
      expect(md).toContain('https://platform.openai.com/billing');
      expect(md).toContain('ag-system-error-marker');
    });
  });
});

