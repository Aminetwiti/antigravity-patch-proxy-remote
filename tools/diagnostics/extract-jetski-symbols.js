/**
 * Go Symbol Table (pclntab) Extractor for language_server.exe
 * Locates and parses Go pclntab / symtab to dump exact functions, packages, and types.
 */
const fs = require('fs');
const path = require('path');

const BIN_PATH = path.resolve(__dirname, '../remote/tools/antigravity/Antigravity/resources/bin/language_server.exe');
console.log(`[+] Loading binary: ${BIN_PATH}...`);
const buf = fs.readFileSync(BIN_PATH);

console.log(`[+] Binary size: ${(buf.length / (1024 * 1024)).toFixed(2)} MB`);

// Go pclntab magic headers
// Go 1.20+: 0xFFFFFFFA (32-bit) or 0xFFFFFFF1 (64-bit), Go 1.18: 0xFFFFFFF0, Go 1.16: 0xFFFFFFFB
const magics = [
  Buffer.from([0xf1, 0xff, 0xff, 0xff]),
  Buffer.from([0xf0, 0xff, 0xff, 0xff]),
  Buffer.from([0xfa, 0xff, 0xff, 0xff]),
  Buffer.from([0xfb, 0xff, 0xff, 0xff]),
  Buffer.from([0xfc, 0xff, 0xff, 0xff]),
  Buffer.from([0xfd, 0xff, 0xff, 0xff])
];

let pclnOffset = -1;
for (const magic of magics) {
  let idx = 0;
  while ((idx = buf.indexOf(magic, idx)) !== -1) {
    // Verify header structure: ptrSize at offset 7 or 8 (usually 8 for 64-bit)
    if (idx + 16 < buf.length) {
      const ptrSize = buf[idx + 7];
      if (ptrSize === 8 || ptrSize === 4 || buf[idx + 8] === 8) {
        pclnOffset = idx;
        console.log(`[+] Found candidate pclntab at offset 0x${idx.toString(16)} with magic ${magic.toString('hex')}`);
        break;
      }
    }
    idx += 4;
  }
  if (pclnOffset !== -1) break;
}

// Fallback: String scan for all Go symbol paths matching google3/third_party/jetski
console.log(`[+] Performing high-speed regex scan for jetski/cortex symbols...`);
const strBuf = buf.toString('latin1');
const symbolRegex = /google3\/third_party\/jetski\/[a-zA-Z0-9_\/\.\(\)\*]+/g;
const symbols = new Set();
let match;
while ((match = symbolRegex.exec(strBuf)) !== null) {
  symbols.add(match[0]);
}

console.log(`[+] Found ${symbols.size} unique Jetski/Cortex Go symbols.`);

// Categorize symbols into Cortex pillars
const categories = {
  cortex_core: [],
  cortex_state_machine: [],
  tools_dispatcher: [],
  tools_code: [],
  tools_command: [],
  tools_browser: [],
  tools_knowledge: [],
  tools_notebook: [],
  tools_cloud: [],
  approval_permissions: [],
  subagents: [],
  mcp_engine: [],
  sidecars_sandbox: [],
  rag_indexing: [],
  context_assembly: [],
  compaction: [],
  prompts: []
};

for (const sym of symbols) {
  if (sym.includes('/cortex/state') || sym.includes('/cortex/planner') || sym.includes('/cortex/trajectory')) {
    categories.cortex_state_machine.push(sym);
  } else if (sym.includes('/cortex/tools') || sym.includes('/cortex/handlers') || sym.includes('/cortex/dispatch')) {
    if (sym.includes('browser') || sym.includes('cdp')) categories.tools_browser.push(sym);
    else if (sym.includes('code') || sym.includes('edit') || sym.includes('file')) categories.tools_code.push(sym);
    else if (sym.includes('command') || sym.includes('terminal') || sym.includes('pty')) categories.tools_command.push(sym);
    else if (sym.includes('knowledge') || sym.includes('ki')) categories.tools_knowledge.push(sym);
    else if (sym.includes('notebook')) categories.tools_notebook.push(sym);
    else if (sym.includes('cloud') || sym.includes('firebase') || sym.includes('sql')) categories.tools_cloud.push(sym);
    else categories.tools_dispatcher.push(sym);
  } else if (sym.includes('permission') || sym.includes('approval') || sym.includes('allow') || sym.includes('deny') || sym.includes('security')) {
    categories.approval_permissions.push(sym);
  } else if (sym.includes('subagent') || sym.includes('delegate') || sym.includes('spawn')) {
    categories.subagents.push(sym);
  } else if (sym.includes('mcp') || sym.includes('mcpcore')) {
    categories.mcp_engine.push(sym);
  } else if (sym.includes('sidecar') || sym.includes('sandbox') || sym.includes('plugin')) {
    categories.sidecars_sandbox.push(sym);
  } else if (sym.includes('indexing') || sym.includes('code_index') || sym.includes('rag') || sym.includes('search') || sym.includes('bm25') || sym.includes('cosine') || sym.includes('rrf') || sym.includes('fts')) {
    categories.rag_indexing.push(sym);
  } else if (sym.includes('context') || sym.includes('prompt') || sym.includes('template')) {
    categories.context_assembly.push(sym);
  } else if (sym.includes('compact') || sym.includes('truncate') || sym.includes('summariz')) {
    categories.compaction.push(sym);
  } else {
    categories.cortex_core.push(sym);
  }
}

const OUT_PATH = path.resolve(__dirname, '../scratch/jetski_symbols_map.json');
fs.writeFileSync(OUT_PATH, JSON.stringify({ total: symbols.size, categories }, null, 2), 'utf-8');
console.log(`[+] Exported symbols map to ${OUT_PATH}`);

// Summary stats
for (const [k, v] of Object.entries(categories)) {
  console.log(`  - ${k}: ${v.length} symbols`);
}
