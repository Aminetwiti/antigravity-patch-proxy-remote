/**
 * CA certificate generation and storage for MITM.
 *
 * Generates a self-signed CA cert (X.509 v3) using only Node's built-in
 * crypto module — no third-party deps. The CA is used by the local proxy
 * to sign forged certificates for intercepted HTTPS traffic.
 *
 * The CA is stored in the Antigravity data dir:
 *   ~/.gemini/antigravity/mitm/
 *     ├── ca.key       (RSA-2048 private key, PEM)
 *     ├── ca.crt       (self-signed certificate, PEM)
 *     └── ca.fingerprint (SHA-256 fingerprint, hex)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAntigravityDataDir } from './paths';

export const CA_DIR_NAME = 'mitm';
export const CA_KEY_FILE = 'ca.key';
export const CA_CERT_FILE = 'ca.crt';
export const CA_FINGERPRINT_FILE = 'ca.fingerprint';
export const CA_NAME = 'Antigravity MITM CA';

export function getMitmDir(): string {
  return path.join(getAntigravityDataDir(), CA_DIR_NAME);
}

export function getCaKeyPath(): string {
  return path.join(getMitmDir(), CA_KEY_FILE);
}

export function getCaCertPath(): string {
  return path.join(getMitmDir(), CA_CERT_FILE);
}

export function getCaFingerprintPath(): string {
  return path.join(getMitmDir(), CA_FINGERPRINT_FILE);
}

export interface CaFiles {
  dir: string;
  keyPath: string;
  certPath: string;
  fingerprintPath: string;
  fingerprint: string;
}

/** Returns CA paths and fingerprint. Generates the CA if missing. */
export function ensureCa(): CaFiles {
  const dir = getMitmDir();
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = getCaKeyPath();
  const certPath = getCaCertPath();
  const fingerprintPath = getCaFingerprintPath();

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    generateCa(keyPath, certPath, fingerprintPath);
  } else {
    // Check if the existing cert is expired
    try {
      const pem = fs.readFileSync(certPath, 'utf8');
      const x509 = new crypto.X509Certificate(pem);
      const isExpired = new Date(x509.validTo).getTime() < Date.now();
      if (isExpired) {
        console.log('[MITM] CA Certificate has expired. Regenerating...');
        fs.unlinkSync(keyPath);
        fs.unlinkSync(certPath);
        if (fs.existsSync(fingerprintPath)) fs.unlinkSync(fingerprintPath);
        generateCa(keyPath, certPath, fingerprintPath);
      }
    } catch (e) {
      // Ignore X509 parse errors, we will fallback
    }
  }

  const fingerprint = fs.existsSync(fingerprintPath)
    ? fs.readFileSync(fingerprintPath, 'utf-8').trim()
    : computeFingerprint(certPath);

  return { dir, keyPath, certPath, fingerprintPath, fingerprint };
}

/** Returns CA info without generating. Returns null if not yet created. */
export function readCa(): CaFiles | null {
  const dir = getMitmDir();
  const keyPath = getCaKeyPath();
  const certPath = getCaCertPath();
  const fingerprintPath = getCaFingerprintPath();
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) return null;
  const fingerprint = fs.existsSync(fingerprintPath)
    ? fs.readFileSync(fingerprintPath, 'utf-8').trim()
    : computeFingerprint(certPath);
  return { dir, keyPath, certPath, fingerprintPath, fingerprint };
}

function generateCa(keyPath: string, certPath: string, fingerprintPath: string): void {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Build a self-signed X.509 v3 certificate using ASN.1 manually.
  // This avoids the deprecated `node-forge` dep and keeps zero-runtime-deps.
  const certPem = buildSelfSignedCert({
    subject: { cn: CA_NAME, o: 'Antigravity', c: 'US' },
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    daysValid: 365 * 5,
    serialHex: crypto.randomBytes(16).toString('hex'),
  });

  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(certPath, certPem, { mode: 0o644 });
  const fp = computeFingerprint(certPath);
  fs.writeFileSync(fingerprintPath, fp, { mode: 0o644 });
}

function computeFingerprint(certPath: string): string {
  const pem = fs.readFileSync(certPath, 'utf-8');
  const der = pemToDer(pem);
  const hash = crypto.createHash('sha256').update(der).digest('hex');
  // Format as colon-separated uppercase pairs (OpenSSL style)
  return hash.toUpperCase().match(/.{2}/g)!.join(':');
}

/** Strip PEM armor and base64-decode. */
function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

/**
 * Build a minimal but standards-compliant self-signed X.509 v3 certificate.
 *
 * Structure:
 *   Certificate ::= SEQUENCE {
 *     tbsCertificate       TBSCertificate,
 *     signatureAlgorithm   AlgorithmIdentifier,
 *     signatureValue       BIT STRING
 *   }
 *
 *   TBSCertificate ::= SEQUENCE {
 *     version         [0] EXPLICIT INTEGER (v3 = 2),
 *     serialNumber         INTEGER,
 *     signature            AlgorithmIdentifier,
 *     issuer               Name (same as subject for self-signed),
 *     validity             SEQUENCE { notBefore, notAfter },
 *     subject              Name,
 *     subjectPublicKeyInfo SubjectPublicKeyInfo,
 *     extensions      [3] EXPLICIT Extensions OPTIONAL
 *   }
 */
function buildSelfSignedCert(opts: {
  subject: { cn: string; o: string; c: string };
  publicKeyPem: string;
  privateKeyPem: string;
  daysValid: number;
  serialHex: string;
}): string {
  const { subject, publicKeyPem, privateKeyPem, daysValid, serialHex } = opts;

  // SHA-256 with RSA OID: 1.2.840.113549.1.1.11
  const sigAlgOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
  const sigAlgNull = Buffer.from([0x05, 0x00]);
  const sigAlgId = asn1Sequence(Buffer.concat([sigAlgOid, sigAlgNull]));

  // Serial number (INTEGER)
  const serialBytes = Buffer.from(serialHex, 'hex');
  const serial = asn1Integer(serialBytes);

  // Name (RDNSequence) — single CN, O, C entry
  const name = buildName(subject);

  // Validity
  const now = new Date();
  const validity = asn1Sequence(Buffer.concat([asn1UtcTime(now), asn1UtcTime(new Date(now.getTime() + daysValid * 86400 * 1000))]));

  // SubjectPublicKeyInfo from SPKI PEM (SPKI is already an ASN.1 SEQUENCE)
  const spki = pemToDer(publicKeyPem);

  // Extensions (v3) — Basic Constraints CA:TRUE, Key Usage: keyCertSign+cRLSign
  const basicConstraintsExt = asn1Sequence(
    Buffer.concat([
      asn1Oid(Buffer.from([0x55, 0x1d, 0x13])), // 2.5.29.19
      asn1Boolean(true),
      asn1OctetString(asn1Sequence(asn1Boolean(true))),
    ]),
  );
  const keyUsageBits = Buffer.from([0x06]); // keyCertSign(5) + cRLSign(6)
  const keyUsageExt = asn1Sequence(
    Buffer.concat([
      asn1Oid(Buffer.from([0x55, 0x1d, 0x0f])), // 2.5.29.15
      asn1Boolean(true),
      asn1OctetString(asn1BitString(keyUsageBits)),
    ]),
  );
  const extensions = asn1Explicit(3, asn1Sequence(Buffer.concat([basicConstraintsExt, keyUsageExt])));

  // TBSCertificate
  const tbs = asn1Sequence(
    Buffer.concat([
      asn1Explicit(0, asn1Integer(2)), // version v3
      serial,
      sigAlgId,
      name, // issuer
      validity,
      name, // subject
      spki,
      extensions,
    ]),
  );

  // Sign TBS with private key
  const signer = crypto.createSign('SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  const sigBitString = asn1BitString(signature);

  // Certificate
  const cert = asn1Sequence(Buffer.concat([tbs, sigAlgId, sigBitString]));
  return derToPem(cert, 'CERTIFICATE');
}

// ─────────────────────────────────────────────────────────────────────────────
// ASN.1 helpers
// ─────────────────────────────────────────────────────────────────────────────

function asn1TagLength(tag: number, content: Buffer | string): Buffer {
  const buf = typeof content === 'string' ? Buffer.from(content, 'binary') : content;
  const length = encodeAsn1Length(buf.length);
  return Buffer.concat([Buffer.from([tag]), length, buf]);
}

function asn1Sequence(content: Buffer | string): Buffer {
  return asn1TagLength(0x30, content);
}

function asn1Set(content: Buffer | string): Buffer {
  return asn1TagLength(0x31, content);
}

function asn1Integer(value: Buffer | number): Buffer {
  const buf = typeof value === 'number' ? Buffer.from([value]) : value;
  // Ensure positive (prepend 0x00 if high bit set)
  const padded = buf.length > 0 && (buf[0] & 0x80) ? Buffer.concat([Buffer.from([0]), buf]) : buf;
  return asn1TagLength(0x02, padded);
}

function asn1BitString(content: Buffer): Buffer {
  // BIT STRING includes a "unused bits" prefix byte (0x00 for no unused bits)
  return asn1TagLength(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function asn1OctetString(content: Buffer): Buffer {
  return asn1TagLength(0x04, content);
}

function asn1Null(): Buffer {
  return Buffer.from([0x05, 0x00]);
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

function asn1UtcTime(date: Date | string): Buffer {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yy = d.getUTCFullYear() % 100;
  const s = `${yy.toString().padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
  return asn1TagLength(0x17, Buffer.from(s, 'ascii'));
}

function asn1Explicit(tagNum: number, content: Buffer): Buffer {
  return asn1TagLength(0xa0 | tagNum, content);
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

function buildName(parts: { cn: string; o: string; c: string }): Buffer {
  // OID 2.5.4.3 = commonName, 2.5.4.10 = organizationName, 2.5.4.6 = countryName
  const cnOid = Buffer.from([0x55, 0x04, 0x03]);
  const oOid = Buffer.from([0x55, 0x04, 0x0a]);
  const cOid = Buffer.from([0x55, 0x04, 0x06]);

  const cnAttr = asn1Sequence(Buffer.concat([asn1Oid(cnOid), asn1Utf8String(parts.cn)]));
  const oAttr = asn1Sequence(Buffer.concat([asn1Oid(oOid), asn1Utf8String(parts.o)]));
  const cAttr = asn1Sequence(Buffer.concat([asn1Oid(cOid), asn1PrintableString(parts.c)]));

  const rdns = asn1Sequence(Buffer.concat([asn1Set(cnAttr), asn1Set(oAttr), asn1Set(cAttr)]));
  return rdns;
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** Format a Date as YYMMDDHHMMSSZ (UTC). */
function formatUtcTime(d: Date): string {
  return (
    String(d.getUTCFullYear() % 100).padStart(2, '0') +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0') +
    String(d.getUTCSeconds()).padStart(2, '0') +
    'Z'
  );
}
