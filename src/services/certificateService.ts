import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface LocalCertificateBundle {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
}

/**
 * Service to dynamically generate and manage unique local TLS certificates
 * in the user's secure application directory (~/.gemini/antigravity/certs/).
 * Eliminates the security risk of committing static private keys to source control (CWE-798).
 */
export class CertificateService {
  private static getCertsDirectory(): string {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    return path.join(home, '.gemini', 'antigravity', 'certs');
  }

  /**
   * Returns paths to the local certificate files, ensuring the directory exists.
   */
  public static async getCertPaths(): Promise<{ certDir: string; caCertPath: string; caKeyPath: string; serverCertPath: string; serverKeyPath: string }> {
    const certDir = this.getCertsDirectory();
    await fs.mkdir(certDir, { recursive: true, mode: 0o700 });
    return {
      certDir,
      caCertPath: path.join(certDir, 'ca-cert.pem'),
      caKeyPath: path.join(certDir, 'ca-key.pem'),
      serverCertPath: path.join(certDir, 'server-cert.pem'),
      serverKeyPath: path.join(certDir, 'server-key.pem'),
    };
  }

  /**
   * Generates a new RSA 2048-bit key pair in PEM format.
   */
  public static generateKeyPair(): { privateKey: string; publicKey: string } {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });
  }

  /**
   * Computes the SHA-256 fingerprint of a PEM certificate.
   */
  public static computeCertificateFingerprint(certPem: string): string {
    const cleanBase64 = certPem
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
    const certBuffer = Buffer.from(cleanBase64, 'base64');
    const hash = crypto.createHash('sha256').update(certBuffer).digest('base64');
    return `sha256/${hash}`;
  }
}
