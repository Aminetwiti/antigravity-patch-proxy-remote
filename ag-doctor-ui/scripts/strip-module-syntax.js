/**
 * strip-module-syntax.js
 *
 * Post-build step: renderer .ts files use `export` (for vitest imports) and
 * `import` (for cross-file references) but are loaded via plain <script> tags
 * at runtime (no bundler, no ES module loader).
 *
 * This script strips:
 *   - `export ` prefix → keeps the declaration as a global
 *   - `import … from '…';` lines → removed (globals available from prior scripts)
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist', 'renderer');
let patched = 0;

function getAllJsFiles(directory) {
  let files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

for (const fp of getAllJsFiles(dir)) {
  const src = fs.readFileSync(fp, 'utf8');
  const out = src
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '') // export { x } → (removed)
    .replace(/^export /gm, '')           // export function foo → function foo
    .replace(/^import .+;\s*$/gm, '');   // import { x } from './y.js'; → (removed)

  if (out !== src) {
    fs.writeFileSync(fp, out);
    patched++;
  }
}

console.log(`✓ stripped module syntax from ${patched} renderer file(s)`);
