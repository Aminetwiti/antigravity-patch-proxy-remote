const https = require('https');
const http = require('http');

let cmd = '';
let ws = process.env.AG_REMOTE_WS || 'antigravity-add-model-main';

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--b64' && process.argv[i + 1]) {
    cmd = Buffer.from(process.argv[i + 1], 'base64').toString('utf-8');
    i++;
  } else if (process.argv[i] === '--ws' && process.argv[i + 1]) {
    ws = process.argv[i + 1];
    i++;
  } else if (!cmd) {
    cmd = process.argv.slice(i).join(' ');
    break;
  }
}

if (!cmd) process.exit(0);

const os = require('os');
const path = require('path');
const fs = require('fs');

let host = process.env.AG_REMOTE_HOST || '';
let token = process.env.AG_REMOTE_TOKEN || '';

if (!host || !token) {
  try {
    const p = path.join(os.homedir(), '.gemini', 'antigravity', 'remote_vps_state.json');
    if (fs.existsSync(p)) {
      const state = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!host && state.host) host = state.host;
      if (!token && state.token) token = state.token;
    }
  } catch (_) {}
}

if (!host) host = 'https://dqlwdgordp4apddvek8gvgn0.ty-dev.site';
if (!token) token = 'antigravity-secret-cloud-2026';

const url = new URL(host + '/v2/terminal/exec?token=' + encodeURIComponent(token));
const transport = url.protocol === 'https:' ? https : http;

const postData = JSON.stringify({ command: cmd, workspaceId: ws });

const req = transport.request(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': 'Bearer ' + token,
    'User-Agent': 'AntigravityRemoteBridge/1.0'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.stdout) process.stdout.write(parsed.stdout);
      if (parsed.stderr) process.stderr.write(parsed.stderr);
      process.exit(parsed.exitCode ?? (parsed.ok ? 0 : 1));
    } catch {
      process.stdout.write(data);
      process.exit(res.statusCode === 200 ? 0 : 1);
    }
  });
});

req.on('error', (err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});

req.write(postData);
req.end();
