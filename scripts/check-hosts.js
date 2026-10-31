const https = require('https');
const dns = require('dns');

const hosts = ['daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com'];

function checkHost(h) {
  return new Promise((resolve) => {
    dns.lookup(h, (e, a) => {
      console.log('DNS', h, '=>', a || 'ERR ' + (e ? e.code : '?'));
    });
    const req = https.request({ hostname: h, path: '/', method: 'GET', timeout: 8000 }, (r) => {
      console.log('HTTP', h, r.statusCode);
      resolve();
    });
    req.on('error', (e) => {
      console.log('HTTP', h, 'ERR', e.message);
      resolve();
    });
    req.on('timeout', () => {
      console.log('HTTP', h, 'TIMEOUT');
      req.destroy();
      resolve();
    });
    req.end();
  });
}

(async () => {
  for (const h of hosts) await checkHost(h);
})();
