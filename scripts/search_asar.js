const fs = require('fs');
const path = require('path');

const targetAsar = 'C:\\Users\\amine\\AppData\\Local\\Programs\\antigravity\\resources\\app.asar';

console.log('Reading asar file...');
const buf = fs.readFileSync(targetAsar);
const str = buf.toString('binary');
const strLower = str.toLowerCase();

const terms = [
  'security notice',
  'get started',
  'interactions data',
  'help improve antigravity',
  'consent',
  'tos',
  'validation_required',
  'acceptterms'
];

terms.forEach(term => {
  let count = 0;
  let idx = 0;
  while ((idx = strLower.indexOf(term, idx)) !== -1) {
    count++;
    if (count <= 3) {
      const slice = buf.slice(Math.max(0, idx - 80), Math.min(buf.length, idx + 120)).toString('utf8').replace(/[\r\n\t]/g, ' ');
      console.log(`[${term}] match #${count} at ${idx}: ${slice}`);
    }
    idx += term.length;
  }
  console.log(`Total occurrences for '${term}': ${count}\n`);
});
