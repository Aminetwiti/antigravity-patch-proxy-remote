// remote-exec.js — Local execution fallback (remote VPS mode disabled)
// If this script is invoked, it runs the command locally via child_process.
process.removeAllListeners('warning');
const { spawnSync } = require('child_process');

let cmd = '';
let cwd = process.cwd();

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--b64' && process.argv[i + 1]) {
    cmd = Buffer.from(process.argv[i + 1], 'base64').toString('utf-8');
    i++;
  } else if (process.argv[i] === '--ws' && process.argv[i + 1]) {
    // workspace hint — ignore, run locally
    i++;
  } else if (!cmd) {
    cmd = process.argv.slice(i).join(' ');
    break;
  }
}

if (!cmd) process.exit(0);

// Sanitize fake Linux /data/workspaces prefix or 2>/dev/null redirects
cmd = cmd.replace(/^cd\s+["']?\/data\/workspaces\/[^\s;"']+["']?\s*(?:2>\/dev\/null)?\s*(?:\|\|\s*true)?\s*[;&]\s*/i, '');
cmd = cmd.replace(/2>\/dev\/null/g, '');

const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
process.exit(res.status ?? 1);
