#!/usr/bin/env node
// scripts/diag/cdp-trace.cjs
// Connect to the Antigravity renderer via CDP, find the line that crashes,
// and dump surrounding source from the V8 script.

const WebSocket = require('ws');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 9229;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      const txt = r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails);
      throw new Error('Eval error: ' + txt);
    }
    return r.result?.value;
  }
}

(async () => {
  try {
    const targets = await getJson('/json');
    const page = targets.find((t) => t.type === 'page' && t.url.startsWith('https://'))
      || targets.find((t) => t.type === 'page');
    if (!page) { console.log('No page target'); process.exit(1); }
    console.log('=== Probing target ===');
    console.log('  url:', page.url);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new CdpClient(ws);

    await cdp.send('Runtime.enable');
    await cdp.send('Debugger.enable');
    await cdp.send('Log.enable');
    await cdp.send('Console.enable');

    // Capture exception details with full stack including script source positions
    const exEvents = [];
    cdp.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.method === 'Runtime.exceptionThrown') exEvents.push(msg);
    });

    await new Promise((r) => setTimeout(r, 6000));

    console.log('\n=== Uncaught exceptions (with URL/line/col) ===');
    for (const e of exEvents) {
      const d = e.params?.exceptionDetails;
      console.log(`[${d?.url}]`);
      console.log(`  line=${d?.lineNumber} col=${d?.columnNumber}`);
      console.log(`  text: ${d?.text}`);
      console.log(`  desc: ${d?.exception?.description?.slice(0, 400)}`);
    }

    // Wrap zrb / global error handler to capture stack traces with names
    console.log('\n=== Stack of last uncaught error (with function names) ===');
    const stackInfo = await cdp.eval(`
      (() => {
        // Try to inspect the failing function's stack from recent errors
        // We can't access already-thrown errors, but we can install a global handler
        if (!window.__errCaptureInstalled) {
          window.__lastError = null;
          window.addEventListener('error', (e) => {
            window.__lastError = {
              message: e.message,
              filename: e.filename,
              lineno: e.lineno,
              colno: e.colno,
              stack: e.error && e.error.stack,
            };
          });
          window.addEventListener('unhandledrejection', (e) => {
            window.__lastError = {
              message: 'Unhandled rejection: ' + (e.reason && (e.reason.message || e.reason.toString())),
              stack: e.reason && e.reason.stack,
            };
          });
          window.__errCaptureInstalled = true;
        }
        return window.__lastError ? JSON.stringify(window.__lastError, null, 2) : 'NO_ERROR_CAPTURED';
      })()
    `);
    console.log(stackInfo);

    // Get the script source from Debugger domain
    console.log('\n=== Find scripts via Debugger domain ===');
    const scripts = await cdp.send('Debugger.getScriptSource', { scriptId: undefined }).catch(() => null);
    // We'll instead just fetch the source via Runtime by reading the bundle as a string

    // Re-trigger by navigating or simply wait
    await new Promise((r) => setTimeout(r, 3000));
    const ex2 = await cdp.eval(`window.__lastError ? JSON.stringify(window.__lastError, null, 2) : 'NO_ERROR_CAPTURED'`);
    console.log('\n=== Error captured by global handler ===');
    console.log(ex2);

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error('CDP trace failed:', err.stack || err.message);
    process.exit(1);
  }
})();