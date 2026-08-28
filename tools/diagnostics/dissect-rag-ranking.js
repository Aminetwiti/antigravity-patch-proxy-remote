/**
 * Detailed RAG Ranking & Code Index Dissection
 * Dissects exact ranking function in google3/third_party/jetski/code_index
 */
const fs = require('fs');
const path = require('path');

const BIN_PATH = path.resolve(__dirname, '../remote/tools/antigravity/Antigravity/resources/bin/language_server.exe');
const buf = fs.readFileSync(BIN_PATH);
const strBuf = buf.toString('latin1');

// Find all symbols under code_index and indexing
const symbols = [];
const regex = /google3\/third_party\/jetski\/(code_index|indexing)\/[a-zA-Z0-9_\/\.\(\)\*]+/g;
let m;
while ((m = regex.exec(strBuf)) !== null) {
  symbols.push(m[0]);
}

console.log(`[+] Found ${symbols.length} symbols in code_index/indexing.`);

// Search for ranking functions and mathematical formulas
const searchTerms = [
  'HybridSearch',
  'Rank',
  'Score',
  'Merge',
  'Fusion',
  'Cosine',
  'BM25',
  'Weight',
  'Distance',
  'Normalize',
  'Reciprocal'
];

const matches = [];
for (const sym of symbols) {
  if (searchTerms.some(t => sym.toLowerCase().includes(t.toLowerCase()))) {
    matches.push(sym);
  }
}

console.log(`[+] Matching ranking symbols:`);
matches.forEach(s => console.log('  ', s));

// Also search around HybridSearch string in binary
let pos = 0;
while ((pos = strBuf.indexOf('HybridSearch', pos)) !== -1) {
  const snippet = strBuf.substring(Math.max(0, pos - 100), Math.min(strBuf.length, pos + 300)).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
  console.log(`\n[+] Snippet near 'HybridSearch' @ 0x${pos.toString(16)}:`);
  console.log(snippet);
  pos += 12;
}
