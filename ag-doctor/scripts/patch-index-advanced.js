// One-shot script to wire the advanced command into index.ts
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');

// 1) Add import
if (!src.includes("runAdvanced } from './commands/advanced'")) {
  src = src.replace(
    "import { runAntigravity } from './commands/antigravity';\n",
    "import { runAntigravity } from './commands/antigravity';\nimport { runAdvanced } from './commands/advanced';\n",
  );
}

// 2) Add route in switch (after 'antigravity' case)
if (!src.includes("case 'advanced':")) {
  src = src.replace(
    "      case 'antigravity':\n        return await runAntigravity(ctx, [sub, ...rest], rest);\n",
    "      case 'antigravity':\n        return await runAntigravity(ctx, [sub, ...rest], rest);\n      case 'advanced':\n        return await runAdvanced(ctx, sub);\n",
  );
}

// 3) Add to USAGE
if (!src.includes('advanced {report|ns|protocols')) {
  src = src.replace(
    "  antigravity {status|version|launch|kill|restart}\n                          Manage the Antigravity install (version, launch, close)\n",
    "  antigravity {status|version|launch|kill|restart}\n                          Manage the Antigravity install (version, launch, close)\n  advanced {report|ns|protocols|firewall|verify|compat|watch|watchdog|lock-test}\n                          Rare edge-case diagnostics & remediation\n",
  );
}

fs.writeFileSync(file, src);
console.log('Patched', file);
