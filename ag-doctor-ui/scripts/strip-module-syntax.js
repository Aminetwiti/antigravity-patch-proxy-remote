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

for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const fp = path.join(dir, f);
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
