const http = require('http');
const req = http.request({ hostname: '127.0.0.1', port: 51074, path: '/__diag__', method: 'GET' }, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log(d.slice(0, 4000));
  });
});
req.on('error', (e) => console.error('ERR', e.message));
req.end();
