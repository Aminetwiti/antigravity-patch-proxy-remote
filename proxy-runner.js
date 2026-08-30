// Standalone proxy runner — loaded by Antigravity.exe (electron) to start
// the local proxy (dist/proxy.js) on 127.0.0.1:${AG_PROXY_PORT:-51074}.
//
// v2.3.x patch: also auto-launches the MITM HTTPS forwarder on port 443
// so the patched binary can talk to the local proxy over TLS. The MITM
// files live in `app.asar.unpacked/mitm/` (external to the asar so
// Node.js can read them). Elevation is requested via a single UAC prompt
// through Start-Process -Verb RunAs; user clicks "Yes" and the MITM
// starts silently in the background.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const constants_1 = require('./constants');

const MITM_443_PROBE_TIMEOUT_MS = 500;

// Portable log paths — derived from OS conventions, never hardcoded.
// Override via AG_PROXY_RUNNER_LOG / AG_PROXY_RUNNER_PORT_FILE env vars.
const LOG_PATH = process.env.AG_PROXY_RUNNER_LOG || path.join(os.tmpdir(), 'ag-proxy-runner.log');
const PORT_FILE = process.env.AG_PROXY_RUNNER_PORT_FILE || path.join(os.tmpdir(), 'ag-proxy-runner.port');

function w(line) {
  try {
    fs.appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + line + '\n');
  } catch (e) {
    // last-resort: try writing to CWD
    try { fs.appendFileSync('ag-proxy-runner.log', line + '\n'); } catch (_) {}
  }
}
// Clear previous log
try { fs.writeFileSync(LOG_PATH, ''); } catch (_) {}
w('runner: top of file, node=' + process.version + ' pid=' + process.pid);
w('runner: log=' + LOG_PATH + ' port_file=' + PORT_FILE);

// v2.3.x patch: MITM-443 auto-launch
// Probe port 443. If something already listens (user ran Start Antigravity
// MITM.bat separately, or this is the second Electron instance), skip.
// Otherwise, spawn an elevated PowerShell that imports the Antigravity
// MITM CA into LocalMachine\Root + CurrentUser\Root and runs mitm_443.js.
// The elevated PowerShell exits after spawning mitm_443.js; the MITM
// keeps running as a detached Node process.
function spawnAntigravityMitm443() {
  try {
    // app.getAppPath() returns the path INSIDE app.asar (e.g. .../resources/app.asar).
    // app.asar.unpacked lives next to it (e.g. .../resources/app.asar.unpacked/).
    const asarDir = path.dirname(app.getAppPath());
    const mitmDir = path.join(asarDir, 'app.asar.unpacked', 'mitm');
    const ps1 = path.join(mitmDir, 'start_mitm_443.ps1');
    if (!fs.existsSync(ps1)) {
      w('runner: MITM-443 script missing at ' + ps1 + ' — skipping (re-run npm run patch:2.3)');
      return;
    }
    // Probe ${constants_1.DEFAULT_BIND_HOST}:443 with a short timeout. If a server answers, MITM is up.
    const probe = net.connect({ host: constants_1.DEFAULT_BIND_HOST, port: 443 });
    let decided = false;
    const skip = (reason) => {
      if (decided) return;
      decided = true;
      probe.destroy();
      w('runner: MITM-443 already listening on ' + constants_1.DEFAULT_BIND_HOST + ':443 (' + reason + '), skipping spawn');
    };
    const spawnElevated = () => {
      if (decided) return;
      decided = true;
      probe.destroy();
      // Escape single quotes for PowerShell single-quoted literal.
      const escaped = ps1.replace(/'/g, "''");
      const psCommand =
        "Start-Process powershell -Verb RunAs -ArgumentList " +
        "'-NoProfile','-ExecutionPolicy','Bypass','-File','" + escaped + "'";
      try {
        const ps = spawn('powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
          { detached: true, stdio: 'ignore', windowsHide: true },
        );
        ps.on('error', (err) => {
          w('runner: MITM-443 elevated launcher spawn error: ' + err.message);
        });
        ps.unref();
        w('runner: MITM-443 elevated launcher dispatched (UAC prompt expected): ' + ps1);
      } catch (e) {
        w('runner: MITM-443 elevated launcher spawn threw: ' + (e && e.stack || e));
      }
    };
    probe.setTimeout(MITM_443_PROBE_TIMEOUT_MS);
    probe.once('connect', () => skip('connect ok'));
    probe.once('timeout', () => spawnElevated());
    probe.once('error', (err) => {
      // ECONNREFUSED => nothing on 443, safe to spawn.
      if (err && err.code === 'ECONNREFUSED') spawnElevated();
      else skip(err.code || err.message);
    });
  } catch (e) {
    w('runner: MITM-443 auto-launch threw: ' + (e && e.stack || e));
  }
}

let app;
try {
  ({ app } = require('electron'));
  w('runner: electron require OK, app.isReady=' + app.isReady());
} catch (e) {
  w('runner: FATAL electron require failed: ' + e.message);
  process.exit(2);
}

app.setName('Antigravity');
w('runner: setName(Antigravity), getName=' + app.getName());

// Configure electron-log to write to our portable file
let log;
try {
  log = require('electron-log');
  log.transports.file.file = LOG_PATH;
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  log.initialize({ preload: true });
  w('runner: electron-log initialised, file=' + log.transports.file.file);
} catch (e) {
  w('runner: electron-log init failed (continuing with fs log): ' + e.message);
}

process.on('uncaughtException', (e) => w('runner: uncaughtException: ' + (e && e.stack || e)));
process.on('unhandledRejection', (e) => w('runner: unhandledRejection: ' + (e && e.stack || e)));

let home = '?', userData = '?';
try { home = app.getPath('home'); } catch (e) { w('runner: getPath(home) failed: ' + e.message); }
try { userData = app.getPath('userData'); } catch (e) { w('runner: getPath(userData) failed: ' + e.message); }
w('runner: home=' + home + ' userData=' + userData + ' isPackaged=' + app.isPackaged);

app.whenReady().then(async () => {
  w('runner: app ready');
  // v2.3.x patch: MITM-443 auto-launch — fire-and-forget UAC prompt.
  try { spawnAntigravityMitm443(); } catch (e) { w('runner: MITM-443 dispatch threw: ' + (e && e.stack || e)); }
  try {
    const proxyMod = require('./dist/proxy');
    w('runner: proxy module loaded; calling startProxy()');
    const port = await proxyMod.startProxy();
    w('runner: Proxy listening on http://' + constants_1.DEFAULT_BIND_HOST + ':' + port);
    try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {}
  } catch (e) {
    w('runner: startProxy FAILED: ' + (e && e.stack || e));
    setTimeout(() => app.exit(3), 500);
  }
}).catch((e) => w('runner: whenReady error: ' + (e && e.stack || e)));

app.on('window-all-closed', () => { /* keep alive */ });
w('runner: listeners registered, awaiting app ready...');
