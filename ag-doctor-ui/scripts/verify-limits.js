/**
 * verify-limits.js
 *
 * Automated Architecture & SOLID Guardrail Checker:
 * 1. Checks that no directory in src/ contains more than 6 direct files.
 * 2. Reports files exceeding the 300-line budget limit.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const MAX_FILES_PER_DIR = 6;
const MAX_LINES_PER_FILE = 300;

let dirViolations = [];
let lineViolations = [];

function checkDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  const subdirs = entries.filter((e) => e.isDirectory());

  const relDir = path.relative(path.resolve(__dirname, '..'), dirPath).replace(/\\/g, '/');

  if (files.length > MAX_FILES_PER_DIR) {
    dirViolations.push({
      dir: relDir,
      count: files.length,
    });
  }

  for (const f of files) {
    if (f.name.endsWith('.ts') || f.name.endsWith('.js')) {
      const full = path.join(dirPath, f.name);
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/).length;
      if (lines > MAX_LINES_PER_FILE) {
        lineViolations.push({
          file: path.join(relDir, f.name).replace(/\\/g, '/'),
          lines,
        });
      }
    }
  }

  for (const d of subdirs) {
    checkDir(path.join(dirPath, d.name));
  }
}

checkDir(SRC_DIR);

console.log('=== Architecture Guardrail Audit Report ===');
console.log(`Directory File Count Limit: max ${MAX_FILES_PER_DIR} files/directory`);
console.log(`File Length Limit: max ${MAX_LINES_PER_FILE} lines/file\n`);

if (dirViolations.length === 0) {
  console.log(`✓ Directory density: ALL directories in src/ have <= ${MAX_FILES_PER_DIR} files.`);
} else {
  console.error(`✗ ${dirViolations.length} directory violation(s) found (> ${MAX_FILES_PER_DIR} files):`);
  for (const v of dirViolations) {
    console.error(`  - ${v.dir} (${v.count} files)`);
  }
}

lineViolations.sort((a, b) => b.lines - a.lines);
console.log(`\nFiles currently tracked for modularization (> ${MAX_LINES_PER_FILE} lines): ${lineViolations.length}`);
for (const v of lineViolations.slice(0, 10)) {
  console.log(`  - ${v.file}: ${v.lines} lines`);
}

if (dirViolations.length > 0) {
  process.exit(1);
} else {
  console.log('\n✓ Guardrail PASS for directory density.');
  process.exit(0);
}
