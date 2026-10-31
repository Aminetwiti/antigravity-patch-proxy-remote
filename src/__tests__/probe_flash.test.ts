import { describe, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { refreshGoogleToken } from '../services/googleAuth';

describe.skipIf(!process.env.LIVE_GOOGLE_TEST)('headers test', () => {
  it('checks response headers from cloudcode-pa on 429', async () => {
    const customModelsPath = process.env.CUSTOM_MODELS_PATH || path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
    if (!fs.existsSync(customModelsPath)) {
      return;
    }
    const raw = fs.readFileSync(customModelsPath, 'utf-8');
    const data = JSON.parse(raw);
    const targetEmail = process.env.TEST_GOOGLE_EMAIL || 'test-user@example.com';
    const acc = data.providers?.[0]?.accounts?.find((a: any) => a.email === targetEmail) || data.providers?.[0]?.accounts?.[0];
    if (!acc || !acc.refreshToken) {
      return;
    }
    const token = await refreshGoogleToken(acc.refreshToken, false);

    const payload = JSON.stringify({
      project: 'aicode-consumers',
      model: 'gemini-3.8-flash-tiered',
      enabledCreditTypes: ['GOOGLE_ONE_AI'],
      request: {
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      },
    });

    await new Promise<void>((resolve) => {
      const req = https.request('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse', {
        method: 'POST',
        headers: {
          'Host': 'cloudcode-pa.googleapis.com',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'antigravity',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (r) => {
        console.log('STATUS:', r.statusCode);
        console.log('HEADERS:', JSON.stringify(r.headers, null, 2));
        let text = '';
        r.on('data', chunk => text += chunk);
        r.on('end', () => {
          console.log('BODY:', text);
          resolve();
        });
      });
      req.write(payload);
      req.end();
    });
  }, 10000);
});
