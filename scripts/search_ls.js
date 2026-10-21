const fs = require('fs');

const targetBin = 'C:\\Users\\amine\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';

console.log('Searching in language_server.exe (169 MB)...');
const fd = fs.openSync(targetBin, 'r');
const bufferSize = 64 * 1024 * 1024; // 64 MB chunk
const buf = Buffer.alloc(bufferSize);

const terms = [
  'security notice',
  'get started',
  'interactions data',
  'help improve antigravity',
  'terms of service',
  'acceptterm',
  'userconsent',
  'onboarding',
  'cloudcode',
  'daily-cloudcode-pa'
];

let bytesRead = 0;
let fileOffset = 0;
let carryOver = Buffer.alloc(0);

while ((bytesRead = fs.readSync(fd, buf, 0, bufferSize, fileOffset)) > 0) {
  const combined = Buffer.concat([carryOver, buf.slice(0, bytesRead)]);
  const strLower = combined.toString('binary').toLowerCase();
  
  terms.forEach(term => {
    let idx = 0;
    while ((idx = strLower.indexOf(term, idx)) !== -1) {
      const slice = combined.slice(Math.max(0, idx - 100), Math.min(combined.length, idx + 150)).toString('utf8').replace(/[^\x20-\x7E]/g, '.');
      console.log(`Found [${term}] at offset ~${fileOffset + idx}: ${slice}`);
      idx += term.length;
    }
  });

  carryOver = buf.slice(Math.max(0, bytesRead - 4096), bytesRead);
  fileOffset += bytesRead;
}

fs.closeSync(fd);
console.log('Search finished.');
