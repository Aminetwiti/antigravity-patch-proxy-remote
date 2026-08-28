#!/usr/bin/env node
// scripts/diag/find-proxy-events.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');

const mainLog = path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
const content = fs.readFileSync(mainLog, 'utf8');
const lines = content.split('\n');

// Find lines with proxy / port / error / fail / cannot
const interesting = lines.filter(l => /\[Proxy\]|startProxy|listen|port 50999|cannot find module|MODULE_NOT_FOUND|FATAL|throw|Error:|ECONNREFUSED|EADDRINUSE/i.test(l));
console.log('=== Proxy-related lines in main.log (last 60) ===');
interesting.slice(-60).forEach(l => console.log('  ' + l.substring(0, 200)));

// Find today's startup
console.log('\n=== Lines from 03:00 onwards (today) ===');
const todayLines = lines.filter(l => l.includes('2026-07-21 0'));
console.log('  total today lines:', todayLines.length);
todayLines.forEach(l => console.log('  ' + l.substring(0, 250)));