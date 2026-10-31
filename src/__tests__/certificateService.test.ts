import { describe, it, expect } from 'vitest';
import { CertificateService } from '../services/certificateService';

describe('CertificateService', () => {
  it('generates a valid RSA key pair', () => {
    const keys = CertificateService.generateKeyPair();
    expect(keys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(keys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('computes sha256 certificate fingerprint correctly', () => {
    const mockCert = '-----BEGIN CERTIFICATE-----\nMIIB...fake...\n-----END CERTIFICATE-----';
    const fingerprint = CertificateService.computeCertificateFingerprint(mockCert);
    expect(fingerprint).toMatch(/^sha256\/.+$/);
  });

  it('ensures certificates exist and returns complete bundle', async () => {
    const bundle = await CertificateService.ensureCertificatesExist();
    expect(bundle.serverKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(bundle.serverCert).toContain('-----BEGIN CERTIFICATE-----');
    expect(bundle.caCert).toContain('-----BEGIN CERTIFICATE-----');
    expect(bundle.caKey).toContain('-----BEGIN PRIVATE KEY-----');
  });
});
