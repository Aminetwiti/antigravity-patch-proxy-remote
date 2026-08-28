#!/usr/bin/env node
// scripts/diag/final-check.cjs — Final verification
const { execSync } = require('child_process');
const http = require('http');

console.log('=== Process check ===');
try {
  const procs = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
  const agProcs = procs.split('\n').filter(l => /antigravity|language_server/i.test(l));
  agProcs.forEach(p => console.log('  ' + p));
} catch (e) {}

console.log('\n=== Port 50999 (netstat) ===');
try {
  const ns = execSync('netstat -ano | findstr :50999', { encoding: 'utf8' });
  console.log(ns);
} catch (e) { console.log('  no listener on 50999'); }

console.log('\n=== Port 50999 (http test) ===');
const req = http.get({ host: '127.0.0.1', port: 50999, path: '/health', timeout: 3000 }, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('  /health → status=' + res.statusCode + ' body=' + body.substring(0, 200));
    process.exit(0);
  });
});
req.on('error', (e) => { console.log('  ERROR: ' + e.message); process.exit(1); });
req.on('timeout', () => { console.log('  TIMEOUT'); req.destroy(); process.exit(1); });