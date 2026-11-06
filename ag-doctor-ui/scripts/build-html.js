/**
 * build-html.js
 *
 * Preprocesses index.html by resolving <!-- @include "path/to/partial.html" -->
 * directives into dist/renderer/index.html.
 */
const fs = require('fs');
const path = require('path');

function processHtmlIncludes(inputPath, rendererRootDir) {
  const content = fs.readFileSync(inputPath, 'utf8');

  return content.replace(/<!--\s*@include\s+["']([^"']+)["']\s*-->/g, (match, relPath) => {
    // Always resolve relative to rendererRootDir (src/renderer)
    const fullPath = path.resolve(rendererRootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[build-html] Warning: Included file not found: ${fullPath}`);
      return match;
    }
    // Recursively process nested includes
    return processHtmlIncludes(fullPath, rendererRootDir);
  });
}

function assembleIndexHtml(srcIndex, dstIndex) {
  const rendererRootDir = path.dirname(srcIndex);
  const assembled = processHtmlIncludes(srcIndex, rendererRootDir);
  fs.mkdirSync(path.dirname(dstIndex), { recursive: true });
  fs.writeFileSync(dstIndex, assembled, 'utf8');
  const srcLines = fs.readFileSync(srcIndex, 'utf8').split(/\r?\n/).length;
  const dstLines = assembled.split(/\r?\n/).length;
  console.log(`✓ assembled index.html: ${srcLines} skeleton lines → ${dstLines} built lines`);
}

module.exports = { assembleIndexHtml, processHtmlIncludes };

if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..');
  const src = path.join(ROOT, 'src', 'renderer', 'index.html');
  const dst = path.join(ROOT, 'dist', 'renderer', 'index.html');
  assembleIndexHtml(src, dst);
}
