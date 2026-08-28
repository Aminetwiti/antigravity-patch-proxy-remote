const https = require('https');

const hosts = ['daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com'];
const paths = ['/v1internal:fetchUserInfo', '/v1internal:fetchAvailableModels', '/v1internal:listExperiments'];

function probe(host, path) {
  return new Promise((resolve) => {
    const body = JSON.stringify({});
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Antigravity/2.6.0',
        },
        timeout: 10000,
      },
      (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => {
          console.log(`=== POST ${host}${path} -> ${r.statusCode}, length=${data.length}`);
          console.log(data.slice(0, 300));
          resolve();
        });
      },
    );
    req.on('error', (e) => {
      console.log(`=== POST ${host}${path} -> ERR ${e.message}`);
      resolve();
    });
    req.on('timeout', () => {
      console.log(`=== POST ${host}${path} -> TIMEOUT`);
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const h of hosts) {
    for (const p of paths) await probe(h, p);
  }
})();
