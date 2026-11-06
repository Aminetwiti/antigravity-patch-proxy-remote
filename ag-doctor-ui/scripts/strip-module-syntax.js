/**
 * strip-module-syntax.js
 *
 * Post-build step: renderer .ts files use `export` (for vitest imports) and
 * `import` (for cross-file references) but are loaded via plain <script> tags
 * at runtime (no bundler, no ES module loader).
 *
 * This script strips:
 *   - All `import ... from '...';` and `import '...';` statements (single-line & multi-line)
 *   - All `export { ... };` statements (single-line & multi-line)
 *   - `export * from '...';`
 *   - `export default ` prefix
 *   - `export ` prefix from declarations (function, class, const, let, var, async)
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

function stripModuleSyntax(src) {
  return src
    // Multi-line and single-line imports with "from"
    .replace(/(?:^|\r?\n)\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*(?=\r?\n|$)/g, '\n')
    // Side-effect imports like import './styles.css';
    .replace(/(?:^|\r?\n)\s*import\s+['"][^'"]+['"];?\s*(?=\r?\n|$)/g, '\n')
    // Multi-line and single-line export * from '...';
    .replace(/(?:^|\r?\n)\s*export\s*\*\s*from\s*['"][^'"]+['"];?\s*(?=\r?\n|$)/g, '\n')
    // Multi-line and single-line export { ... };
    .replace(/(?:^|\r?\n)\s*export\s*\{[\s\S]*?\}\s*;?\s*(?=\r?\n|$)/g, '\n')
    // export default
    .replace(/(?:^|\r?\n)\s*export\s+default\s+/g, '\n')
    // export const/let/var/function/class/async
    .replace(/(?:^|\r?\n)\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/g, '\n')
    // Any remaining export at start of line
    .replace(/^\s*export\s+/gm, '');
}

for (const fp of getAllJsFiles(dir)) {
  const src = fs.readFileSync(fp, 'utf8');
  const out = stripModuleSyntax(src);

  if (out !== src) {
    fs.writeFileSync(fp, out);
    patched++;
  }
}

console.log(`✓ stripped module syntax from ${patched} renderer file(s)`);
