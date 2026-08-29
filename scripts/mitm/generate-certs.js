/**
 * Regenerate the MITM proxy self-signed certificate and private key.
 *
 * Uses only Node.js built-in crypto — no external openssl binary required.
 * Writes to <repo-root>/certs/server-cert.pem and server-key.pem.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = path.resolve(__dirname, '..', '..', 'certs');

function generateCert() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const serial = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const notBefore = now.toISOString();
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  const cert = crypto.createX509Certificate({
    subject: [{ value: 'CN=Antigravity MITM', type: 'commonName' }],
    issuer: [{ value: 'CN=Antigravity MITM', type: 'commonName' }],
    serial: BigInt('0x' + serial),
    notBefore,
    notAfter,
    publicKey,
    extensions: [
      {
        name: 'basicConstraints',
        cA: false,
      },
      {
        name: 'keyUsage',
        keyCertSign: false,
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 'IPAddress', value: '127.0.0.1' },
          { type: 'IPAddress', value: '::1' },
          { type: 'DNS', value: 'localhost' },
        ],
      },
    ],
    signingAlgorithm: 'SHA256WITHRSA',
    signingKey: crypto.createPrivateKey(privateKey),
  });

  const certPem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64')}\n-----END CERTIFICATE-----\n`;
  fs.writeFileSync(path.join(CERTS_DIR, 'server-cert.pem'), certPem, 'utf8');
  fs.writeFileSync(path.join(CERTS_DIR, 'server-key.pem'), privateKey, 'utf8');

  console.log(`Regenerated MITM certs in ${CERTS_DIR}`);
}

generateCert();
