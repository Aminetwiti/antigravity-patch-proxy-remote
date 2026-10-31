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

  /**
   * Ensures local certificates exist in ~/.gemini/antigravity/certs/.
   * If missing, dynamically generates a self-signed bundle on the fly.
   */
  public static async ensureCertificatesExist(): Promise<LocalCertificateBundle> {
    const paths = await this.getCertPaths();
    let serverKey = '';
    let serverCert = '';
    let caKey = '';
    let caCert = '';

    try {
      serverKey = await fs.readFile(paths.serverKeyPath, 'utf-8');
      serverCert = await fs.readFile(paths.serverCertPath, 'utf-8');
      caKey = await fs.readFile(paths.caKeyPath, 'utf-8').catch(() => serverKey);
      caCert = await fs.readFile(paths.caCertPath, 'utf-8').catch(() => serverCert);
    } catch {
      const keys = this.generateKeyPair();
      serverKey = keys.privateKey;
      caKey = keys.privateKey;

      serverCert = buildSelfSignedCert({
        subject: { cn: 'Antigravity Local CA', o: 'Antigravity', c: 'US' },
        publicKeyPem: keys.publicKey,
        privateKeyPem: keys.privateKey,
        daysValid: 365 * 5,
        serialHex: crypto.randomBytes(16).toString('hex'),
      });
      caCert = serverCert;

      await fs.writeFile(paths.serverKeyPath, serverKey, { mode: 0o600 });
      await fs.writeFile(paths.serverCertPath, serverCert, { mode: 0o644 });
      await fs.writeFile(paths.caKeyPath, caKey, { mode: 0o600 });
      await fs.writeFile(paths.caCertPath, caCert, { mode: 0o644 });
    }

    return { caCert, caKey, serverCert, serverKey };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal pure-Node ASN.1 X.509 v3 Certificate Generator
// ─────────────────────────────────────────────────────────────────────────────

function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function encodeAsn1Length(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function asn1TagLength(tag: number, content: Buffer | string): Buffer {
  const buf = typeof content === 'string' ? Buffer.from(content, 'binary') : content;
  const length = encodeAsn1Length(buf.length);
  return Buffer.concat([Buffer.from([tag]), length, buf]);
}

function asn1Sequence(content: Buffer): Buffer {
  return asn1TagLength(0x30, content);
}

function asn1Set(content: Buffer): Buffer {
  return asn1TagLength(0x31, content);
}

function asn1Integer(value: Buffer): Buffer {
  const padded = value.length > 0 && (value[0] & 0x80) ? Buffer.concat([Buffer.from([0]), value]) : value;
  return asn1TagLength(0x02, padded);
}

function asn1BitString(content: Buffer): Buffer {
  return asn1TagLength(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function asn1OctetString(content: Buffer): Buffer {
  return asn1TagLength(0x04, content);
}

function asn1Boolean(value: boolean): Buffer {
  return Buffer.from([0x01, 0x01, value ? 0xff : 0x00]);
}

function asn1Oid(oidBytes: Buffer): Buffer {
  return asn1TagLength(0x06, oidBytes);
}

function asn1Utf8String(s: string): Buffer {
  return asn1TagLength(0x0c, Buffer.from(s, 'utf-8'));
}

function asn1PrintableString(s: string): Buffer {
  return asn1TagLength(0x13, Buffer.from(s, 'ascii'));
}

function asn1UtcTime(date: Date): Buffer {
  const yy = date.getUTCFullYear() % 100;
  const s = `${yy.toString().padStart(2, '0')}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
  return asn1TagLength(0x17, Buffer.from(s, 'ascii'));
}

function asn1Explicit(tagNum: number, content: Buffer): Buffer {
  return asn1TagLength(0xa0 | tagNum, content);
}

function buildSelfSignedCert(opts: {
  subject: { cn: string; o: string; c: string };
  publicKeyPem: string;
  privateKeyPem: string;
  daysValid: number;
  serialHex: string;
}): string {
  const sigAlgOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
  const sigAlgNull = Buffer.from([0x05, 0x00]);
  const sigAlgId = asn1Sequence(Buffer.concat([sigAlgOid, sigAlgNull]));

  const serial = asn1Integer(Buffer.from(opts.serialHex, 'hex'));

  const cnAttr = asn1Sequence(Buffer.concat([asn1Oid(Buffer.from([0x55, 0x04, 0x03])), asn1Utf8String(opts.subject.cn)]));
  const oAttr = asn1Sequence(Buffer.concat([asn1Oid(Buffer.from([0x55, 0x04, 0x0a])), asn1Utf8String(opts.subject.o)]));
  const cAttr = asn1Sequence(Buffer.concat([asn1Oid(Buffer.from([0x55, 0x04, 0x06])), asn1PrintableString(opts.subject.c)]));
  const name = asn1Sequence(Buffer.concat([asn1Set(cnAttr), asn1Set(oAttr), asn1Set(cAttr)]));

  const now = new Date();
  const validity = asn1Sequence(Buffer.concat([asn1UtcTime(now), asn1UtcTime(new Date(now.getTime() + opts.daysValid * 86400 * 1000))]));

  const spkiDer = pemToDer(opts.publicKeyPem);
  const spki = asn1Sequence(spkiDer);

  const basicConstraintsExt = asn1Sequence(
    Buffer.concat([
      asn1Oid(Buffer.from([0x55, 0x1d, 0x13])),
      asn1Boolean(true),
      asn1OctetString(asn1Sequence(asn1Boolean(true))),
    ]),
  );
  const keyUsageExt = asn1Sequence(
    Buffer.concat([
      asn1Oid(Buffer.from([0x55, 0x1d, 0x0f])),
      asn1Boolean(true),
      asn1OctetString(asn1BitString(Buffer.from([0x06]))),
    ]),
  );
  const extensions = asn1Explicit(3, asn1Sequence(Buffer.concat([basicConstraintsExt, keyUsageExt])));

  const tbs = asn1Sequence(
    Buffer.concat([
      asn1Explicit(0, asn1TagLength(0x02, Buffer.from([2]))),
      serial,
      sigAlgId,
      name,
      validity,
      name,
      spki,
      extensions,
    ]),
  );

  const signer = crypto.createSign('SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign(opts.privateKeyPem);
  const sigBitString = asn1BitString(signature);

  const cert = asn1Sequence(Buffer.concat([tbs, sigAlgId, sigBitString]));
  return derToPem(cert, 'CERTIFICATE');
}
