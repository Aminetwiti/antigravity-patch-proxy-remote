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

cmd = cmd.trim();
if (!cmd) process.exit(0);

try {
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
  if (res.error) {
    console.error(`[remote-exec] Execution failed: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 0);
} catch (err) {
  console.error(`[remote-exec] Process spawn error: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
