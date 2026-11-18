const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const { getValidGoogleAccessToken } = require('../dist/services/auth/googleAuth.js');
const customModelsPath = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
const config = JSON.parse(fs.readFileSync(customModelsPath, 'utf8'));
const gProv = config.providers.find(p => p.id === 'provider-google' || p.provider === 'google');
const accounts = gProv ? gProv.accounts || [] : [];

console.log('Total Google Accounts in pool:', accounts.length);

async function testCloudCode(token, model) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      project: 'aicode-consumers',
      model,
      request: {
        contents: [{ role: 'user', parts: [{ text: 'Bonjour, dis OK' }] }]
      }
    });

    const req = https.request('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/2.24.0 windows/amd64',
        'X-Goog-Api-Client': 'google-cloud-sdk antigravity/2.24.0'
      },
      timeout: 15000,
      rejectUnauthorized: false
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 504, body: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

async function testViaProxy(model) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      project: 'aicode-consumers',
      model,
      request: {
        contents: [{ role: 'user', parts: [{ text: 'Ping proxy test' }] }]
      }
    });

    const req = http.request('http://127.0.0.1:51074/v1internal:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 504, body: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

(async () => {
  // Test direct Cloud Code with first working account
  for (const acc of accounts) {
    if (!acc.email || acc.email.includes('@aistudio')) continue;
    console.log('\n--- Testing with account:', acc.email || acc.name);
    try {
      const token = await getValidGoogleAccessToken(acc);
      if (!token) {
        console.log('No token');
        continue;
      }
      
      console.log('1. Probing direct Cloud Code for gemini-4-hydrogen-sonar...');
      const rSonar = await testCloudCode(token, 'gemini-4-hydrogen-sonar');
      console.log('gemini-4-hydrogen-sonar response status:', rSonar.status);
      console.log('gemini-4-hydrogen-sonar body:', rSonar.body.slice(0, 500));

      console.log('\n2. Probing direct Cloud Code for gemini-4-hydrogen...');
      const rHydro = await testCloudCode(token, 'gemini-4-hydrogen');
      console.log('gemini-4-hydrogen response status:', rHydro.status);
      console.log('gemini-4-hydrogen body:', rHydro.body.slice(0, 500));

      console.log('\n3. Probing direct Cloud Code for gemini-3.8-flash-tiered...');
      const rFlash = await testCloudCode(token, 'gemini-3.8-flash-tiered');
      console.log('gemini-3.8-flash-tiered response status:', rFlash.status);
      console.log('gemini-3.8-flash-tiered body:', rFlash.body.slice(0, 500));

      break;
    } catch(e) {
      console.error(e);
    }
  }

  console.log('\n--- Testing via local Proxy (port 51074) for gemini-4-hydrogen-sonar:');
  const rProxy = await testViaProxy('gemini-4-hydrogen-sonar');
  console.log('Proxy response status:', rProxy.status);
  console.log('Proxy response body:', rProxy.body.slice(0, 500));

  process.exit(0);
})();
