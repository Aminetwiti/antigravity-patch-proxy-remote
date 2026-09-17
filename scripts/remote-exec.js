// remote-exec.js — Local execution fallback (remote VPS mode disabled)
// If anything still calls this script, it executes the command locally.
const { spawnSync } = require('child_process');

let cmd = '';
let cwd = process.cwd();

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--b64' && process.argv[i + 1]) {
    cmd = Buffer.from(process.argv[i + 1], 'base64').toString('utf-8');
    i++;
  } else if (process.argv[i] === '--ws' && process.argv[i + 1]) {
    // --ws is ignored in local mode
    i++;
  } else if (process.argv[i] === '--cwd' && process.argv[i + 1]) {
    cwd = process.argv[i + 1];
    i++;
  } else if (!cmd) {
    cmd = process.argv.slice(i).join(' ');
    break;
  }
}

if (!cmd) process.exit(0);

const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
process.exit(res.status ?? 1);
