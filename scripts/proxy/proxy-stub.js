// Minimal HTTP stub — emergency fallback when the real proxy crashes.
// Default port comes from STUB_PORT_DEFAULT; override with AG_PROXY_STUB_PORT.
//
// Usage:  node proxy-stub.js [port]
// Env:    AG_PROXY_STUB_PORT (default STUB_PORT_DEFAULT)
//         AG_PROXY_STUB_HOST (default from AG_BIND_HOST or 127.0.0.1)
//         AG_PROXY_STUB_LOG  (default os.tmpdir()/ag-proxy-stub.log)

'use strict';

const http  = require('http');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const dns   = require('dns');

// Force IPv4 to avoid [::1] vs 127.0.0.1 mismatch on dual-stack hosts.
dns.setDefaultResultOrder('ipv4first');

const LOG  = process.env.AG_PROXY_STUB_LOG  || path.join(os.tmpdir(), 'ag-proxy-stub.log');
const PORT = parseInt(process.argv[2] || process.env.AG_PROXY_STUB_PORT || '51999', 10);
const HOST = process.env.AG_PROXY_STUB_HOST || process.env.AG_BIND_HOST || '127.0.0.1';

function log(line) {
  const ts = new Date().toISOString();
  const msg = '[' + ts + '] ' + line + '\n';
  try { fs.appendFileSync(LOG, msg); } catch (_) {}
  try { process.stdout.write(msg); } catch (_) {}
}

try { fs.writeFileSync(LOG, ''); } catch (_) {}
log('proxy-stub starting on ' + HOST + ':' + PORT + ' (log=' + LOG + ')');

const server = http.createServer((req, res) => {
  log(req.method + ' ' + req.url + ' from ' + (req.socket.remoteAddress || '?'));

  if (req.url === '/health' || req.url.startsWith('/health?')) {
    const body = JSON.stringify({
      status: 'ok', stub: true, port: PORT,
      uptime: process.uptime(), pid: process.pid,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Proxy-Stub': '1',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  let bodyLen = 0;
  req.on('data', (c) => { bodyLen += c.length; });
  req.on('end', () => {
    log('  -> body bytes=' + bodyLen + ', returning empty 200');
    const body = '{}';
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Proxy-Stub': '1',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  req.on('error', (e) => log('req error: ' + e.message));
});

server.on('error', (err) => {
  log('server error: ' + err.code + ' ' + err.message);
  if (err.code === 'EADDRINUSE') {
    log('Port ' + PORT + ' already in use â€” another instance is running');
    process.exit(2);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log('listening on http://' + HOST + ':' + PORT + ' (pid=' + process.pid + ')');
});

function shutdown(signal) {
  log(signal + ', closing');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => log('uncaught: ' + (e.stack || e)));
process.on('unhandledRejection', (reason) => log('unhandled: ' + reason));