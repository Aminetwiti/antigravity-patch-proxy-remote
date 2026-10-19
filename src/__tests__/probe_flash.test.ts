import { describe, it } from 'vitest';
import fs from 'fs';
import https from 'https';
import { refreshGoogleToken } from '../services/googleAuth';
import { resolveGoogleIp } from '../proxy/dnsResolver';

describe('ip test', () => {
  it('sends request to resolved IP with host header', async () => {
    const raw = fs.readFileSync('C:/Users/amine/.gemini/antigravity/custom_models.json', 'utf-8');
    const data = JSON.parse(raw);
    const acc = data.providers[0].accounts.find((a: any) => a.email === 'benn31109@gmail.com');
    const token = await refreshGoogleToken(acc.refreshToken, false);

    const realIp = await resolveGoogleIp('daily-cloudcode-pa.googleapis.com');
    console.log('Using IP:', realIp);

    const payload = JSON.stringify({
      project: 'aicode-consumers',
      model: 'gemini-3.8-flash-tiered',
      enabledCreditTypes: ['GOOGLE_ONE_AI'],
      request: {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      },
    });

    const res = await new Promise<{ status: number; body: string }>((resolve) => {
      const parsedUrl = new URL('https://' + realIp + '/v1internal:streamGenerateContent?alt=sse');
      const req = https.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Host': 'daily-cloudcode-pa.googleapis.com',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'antigravity',
          'Content-Length': Buffer.byteLength(payload),
        },
        servername: 'daily-cloudcode-pa.googleapis.com',
      }, (r) => {
        let text = '';
        r.on('data', chunk => text += chunk);
        r.on('end', () => resolve({ status: r.statusCode || 0, body: text }));
      });
      req.on('error', err => resolve({ status: 0, body: err.message }));
      req.write(payload);
      req.end();
    });

    console.log('STATUS VIA IP:', res.status);
    console.log('BODY VIA IP:', res.body.substring(0, 200));
  }, 30000);
});
