#!/usr/bin/env node
// Fetch the renderer main.js bundle from the local Antigravity page
// and print lines around a given line number.

const https = require('https');
const url = process.argv[2] || 'https://127.0.0.1:59521/main.js';
const targetLine = parseInt(process.argv[3] || '11214', 10);
const context = parseInt(process.argv[4] || '8', 10);

https.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'curl' } }, (res) => {
  let buf = [];
  res.on('data', (c) => buf.push(c));
  res.on('end', () => {
    const text = Buffer.concat(buf).toString('utf8');
    const lines = text.split('\n');
    console.log('Total lines:', lines.length);
    console.log('--- around line', targetLine, '---');
    const start = Math.max(0, targetLine - context - 1);
    const end = Math.min(lines.length, targetLine + context);
    for (let i = start; i < end; i++) {
      console.log(`L${i + 1}: ${lines[i].slice(0, 400)}`);
    }
  });
}).on('error', (e) => console.error(e));