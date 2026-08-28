#!/usr/bin/env node
// scripts/diag/verify-proxy.cjs — Find active proxy port + verify response
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');

console.log('=== Check active_port file ===');
const candidates = [
  path.join(os.homedir(), '.gemini', 'antigravity', 'active_port'),
  path.join(os.homedir(), '.gemini', 'antigravity', 'active-port'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'active_port'),
];
for (const f of candidates) {
  if (fs.existsSync(f)) {
    console.log('  FOUND:', f, '→', fs.readFileSync(f, 'utf8').trim());
  } else {
    console.log('  not found:', f);
  }
}

console.log('\n=== Scan 50995-51015 for listeners ===');
for (let p = 50995; p <= 51015; p++) {
  const sock = new net.Socket();
  sock.setTimeout(500);
  sock.on('connect', () => { console.log('  PORT ' + p + ' OPEN'); sock.destroy(); });
  sock.on('timeout', () => sock.destroy());
  sock.on('error', () => {});
  sock.connect(p, '127.0.0.1');
}

setTimeout(() => {
  console.log('\n=== Test proxy with HTTP request ===');
  // Try common proxy ports
  const tryPorts = [50999, 51000, 51001, 51002, 51003, 51004, 51005];
  let i = 0;
  function tryNext() {
    if (i >= tryPorts.length) { console.log('  No proxy found'); process.exit(0); }
    const p = tryPorts[i++];
    const req = http.get({ host: '127.0.0.1', port: p, path: '/health', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        console.log('  PORT ' + p + ' → /health status=' + res.statusCode + ' body=' + body);
        process.exit(0);
      });
    });
    req.on('error', () => tryNext());
    req.on('timeout', () => { req.destroy(); tryNext(); });
  }
  tryNext();
}, 2000);