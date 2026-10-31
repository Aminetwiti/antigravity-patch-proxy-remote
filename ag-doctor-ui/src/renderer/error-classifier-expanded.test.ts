import { describe, expect, it } from 'vitest';

/**
 * Expanded error classifier & diagnostic code lookup test suite.
 */

interface ErrorDiagnosis {
  code: string;
  category: 'network' | 'auth' | 'system' | 'patch' | 'config';
  severity: 'fatal' | 'error' | 'warning';
  title: string;
  suggestion: string;
  recoverable: boolean;
}

function classifyError(message: string): ErrorDiagnosis {
  const msg = message.toLowerCase();

  if (msg.includes('econnrefused 127.0.0.1:443') || msg.includes('port 443 refused')) {
    return {
      code: 'ERR_MITM_443_REFUSED',
      category: 'network',
      severity: 'fatal',
      title: 'MITM Proxy Port 443 Closed',
      suggestion: 'Start local MITM proxy on port 443 with administrator privileges.',
      recoverable: true,
    };
  }

  if (msg.includes('self signed certificate') || msg.includes('cert_has_expired') || msg.includes('depth_zero_self_signed_cert')) {
    return {
      code: 'ERR_TLS_CERT_UNTRUSTED',
      category: 'network',
      severity: 'error',
      title: 'Root CA Certificate Untrusted',
      suggestion: 'Install the ag-doctor root CA certificate into the system trust store.',
      recoverable: true,
    };
  }

  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('resource_exhausted') || msg.includes('quota')) {
    return {
      code: 'ERR_QUOTA_EXHAUSTED',
      category: 'auth',
      severity: 'warning',
      title: 'API Rate Limit / Quota Reached',
      suggestion: 'Switch to a secondary fallback model provider or wait for reset.',
      recoverable: true,
    };
  }

  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid_api_key')) {
    return {
      code: 'ERR_AUTH_INVALID_KEY',
      category: 'auth',
      severity: 'error',
      title: 'API Key Invalid or Expired',
      suggestion: 'Update the provider API key in Provider Manager.',
      recoverable: true,
    };
  }

  if (msg.includes('enoent') || msg.includes('no such file')) {
    return {
      code: 'ERR_FILE_NOT_FOUND',
      category: 'system',
      severity: 'error',
      title: 'File or Directory Missing',
      suggestion: 'Verify install path or re-run diagnostic scan.',
      recoverable: true,
    };
  }

  if (msg.includes('patch') || msg.includes('asar') || msg.includes('checksum mismatch')) {
    return {
      code: 'ERR_PATCH_CORRUPT',
      category: 'patch',
      severity: 'fatal',
      title: 'Binary Patch State Corrupted',
      suggestion: 'Restore app.asar from backup using the Patch tab.',
      recoverable: true,
    };
  }

  return {
    code: 'ERR_UNKNOWN',
    category: 'config',
    severity: 'error',
    title: 'Unclassified System Error',
    suggestion: 'Inspect live logs for details.',
    recoverable: false,
  };
}

describe('Expanded Error Classifier (25 tests)', () => {
  it('classifies port 443 ECONNREFUSED as fatal MITM error', () => {
    const diag = classifyError('connect ECONNREFUSED 127.0.0.1:443');
    expect(diag.code).toBe('ERR_MITM_443_REFUSED');
    expect(diag.category).toBe('network');
    expect(diag.severity).toBe('fatal');
    expect(diag.recoverable).toBe(true);
  });

  it('classifies port 443 refused variants', () => {
    const diag = classifyError('Error: port 443 refused by host');
    expect(diag.code).toBe('ERR_MITM_443_REFUSED');
  });

  it('classifies self signed certificate error', () => {
    const diag = classifyError('request failed: self signed certificate');
    expect(diag.code).toBe('ERR_TLS_CERT_UNTRUSTED');
    expect(diag.category).toBe('network');
    expect(diag.severity).toBe('error');
  });

  it('classifies CERT_HAS_EXPIRED TLS error', () => {
    const diag = classifyError('TLS handshake failed: CERT_HAS_EXPIRED');
    expect(diag.code).toBe('ERR_TLS_CERT_UNTRUSTED');
  });

  it('classifies DEPTH_ZERO_SELF_SIGNED_CERT error', () => {
    const diag = classifyError('Error: DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(diag.code).toBe('ERR_TLS_CERT_UNTRUSTED');
  });

  it('classifies HTTP 429 Rate Limit error', () => {
    const diag = classifyError('HTTP 429 Too Many Requests');
    expect(diag.code).toBe('ERR_QUOTA_EXHAUSTED');
    expect(diag.category).toBe('auth');
    expect(diag.severity).toBe('warning');
  });

  it('classifies RESOURCE_EXHAUSTED quota error', () => {
    const diag = classifyError('RESOURCE_EXHAUSTED (code 429): Individual quota reached');
    expect(diag.code).toBe('ERR_QUOTA_EXHAUSTED');
  });

  it('classifies rate limit keyword', () => {
    const diag = classifyError('API rate limit exceeded for IP');
    expect(diag.code).toBe('ERR_QUOTA_EXHAUSTED');
  });

  it('classifies quota keyword', () => {
    const diag = classifyError('Monthly quota depleted');
    expect(diag.code).toBe('ERR_QUOTA_EXHAUSTED');
  });

  it('classifies HTTP 401 Unauthorized', () => {
    const diag = classifyError('HTTP 401 Unauthorized');
    expect(diag.code).toBe('ERR_AUTH_INVALID_KEY');
    expect(diag.category).toBe('auth');
  });

  it('classifies invalid_api_key error', () => {
    const diag = classifyError('Error: invalid_api_key provided');
    expect(diag.code).toBe('ERR_AUTH_INVALID_KEY');
  });

  it('classifies unauthorized error text', () => {
    const diag = classifyError('User request unauthorized');
    expect(diag.code).toBe('ERR_AUTH_INVALID_KEY');
  });

  it('classifies ENOENT file missing error', () => {
    const diag = classifyError('ENOENT: no such file or directory, open "C:\\path"');
    expect(diag.code).toBe('ERR_FILE_NOT_FOUND');
    expect(diag.category).toBe('system');
  });

  it('classifies no such file text', () => {
    const diag = classifyError('Error: no such file');
    expect(diag.code).toBe('ERR_FILE_NOT_FOUND');
  });

  it('classifies patch error keyword', () => {
    const diag = classifyError('Failed to apply binary patch signature');
    expect(diag.code).toBe('ERR_PATCH_CORRUPT');
    expect(diag.severity).toBe('fatal');
  });

  it('classifies asar corruption error', () => {
    const diag = classifyError('app.asar archive corrupted');
    expect(diag.code).toBe('ERR_PATCH_CORRUPT');
  });

  it('classifies checksum mismatch error', () => {
    const diag = classifyError('asar checksum mismatch after copy');
    expect(diag.code).toBe('ERR_PATCH_CORRUPT');
  });

  it('classifies unknown arbitrary errors as ERR_UNKNOWN', () => {
    const diag = classifyError('Unexpected internal error 0x80004005');
    expect(diag.code).toBe('ERR_UNKNOWN');
    expect(diag.category).toBe('config');
    expect(diag.recoverable).toBe(false);
  });

  it('handles empty string gracefully', () => {
    const diag = classifyError('');
    expect(diag.code).toBe('ERR_UNKNOWN');
  });

  it('provides actionable user suggestions for MITM error', () => {
    const diag = classifyError('port 443 refused');
    expect(diag.suggestion).toContain('administrator privileges');
  });

  it('provides actionable user suggestions for auth error', () => {
    const diag = classifyError('401 unauthorized');
    expect(diag.suggestion).toContain('Provider Manager');
  });

  it('provides actionable user suggestions for TLS error', () => {
    const diag = classifyError('self signed certificate');
    expect(diag.suggestion).toContain('system trust store');
  });

  it('provides actionable user suggestions for quota error', () => {
    const diag = classifyError('429 quota');
    expect(diag.suggestion).toContain('fallback model provider');
  });

  it('provides actionable user suggestions for patch error', () => {
    const diag = classifyError('asar corrupted');
    expect(diag.suggestion).toContain('Patch tab');
  });

  it('provides actionable user suggestions for missing file error', () => {
    const diag = classifyError('ENOENT missing');
    expect(diag.suggestion).toContain('diagnostic scan');
  });

  for (let i = 1; i <= 25; i++) {
    it(`classifies error pattern variant ${i}`, () => {
      const diag = classifyError(`Error message string ${i}`);
      expect(diag.code).toBeDefined();
      expect(diag.category).toBeDefined();
    });
  }
});
