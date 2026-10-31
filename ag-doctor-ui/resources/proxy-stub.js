const http = require('http');

// Port ${AG_STUB_PORT:-51999} (separate from main proxy on ${AG_PROXY_PORT:-51074}) to avoid conflicts
// when both ag-doctor-ui stub and Antigravity proxy run simultaneously.
const PORT = process.env.AG_STUB_PORT ? parseInt(process.env.AG_STUB_PORT, 10) : 51999;
const HOST = process.env.AG_BIND_HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  console.log(`[Stub] ${req.method} ${req.url}`);

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', stub: true, port: PORT }));
    return;
  }

  // Intercept all other traffic with a 200 OK empty response,
  // preventing Go language server from crashing with ECONNREFUSED
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Proxy-Stub': '1'
  });
  res.end(JSON.stringify({}));
});

server.listen(PORT, HOST, () => {
  console.log(`[Stub] Proxy stub listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('[Stub] Server error:', err);
  process.exit(1);
});
