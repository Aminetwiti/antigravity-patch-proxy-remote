#!/usr/bin/env node
// scripts/diag/cdp-probe.cjs
// Inspect what the renderer exposes on window, identify a.getState failure.

const WebSocket = require('ws');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 9229;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
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
    // Prefer the https:// page (real Antigravity) over the data: splash
    const page = targets.find((t) => t.type === 'page' && t.url.startsWith('https://'))
      || targets.find((t) => t.type === 'page');
    if (!page) { console.log('No page target'); process.exit(1); }
    console.log('=== Probing target ===');
    console.log('  url:', page.url);
    console.log('  title:', page.title);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new CdpClient(ws);

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Console.enable');

    // Wait for any startup activity to settle.
    await new Promise((r) => setTimeout(r, 5000));

    console.log('\n=== window keys (electron-related) ===');
    const keys = await cdp.eval(`Object.keys(window).filter(k => /^(electron|native|storage|custom|agy|antigravity|api|bridge)/i.test(k))`);
    console.log(JSON.stringify(keys, null, 2));

    console.log('\n=== window.nativeStorage inspection ===');
    const ns = await cdp.eval(`(() => {
      const ns = window.nativeStorage;
      if (!ns) return null;
      return {
        type: typeof ns,
        keys: ns && typeof ns === 'object' ? Object.keys(ns) : null,
        sample: ns && typeof ns === 'object' ? Object.fromEntries(
          Object.keys(ns).slice(0, 10).map(k => [k, typeof ns[k]])
        ) : null,
      };
    })()`);
    console.log(JSON.stringify(ns, null, 2));

    console.log('\n=== window.electron APIs ===');
    const e = await cdp.eval(`(() => {
      const e = window.electron;
      if (!e) return null;
      return {
        type: typeof e,
        keys: typeof e === 'object' ? Object.keys(e) : null,
      };
    })()`);
    console.log(JSON.stringify(e, null, 2));

    console.log('\n=== Try to call window.nativeStorage.getItems ===');
    let nsResult = '<not callable>';
    try {
      nsResult = await cdp.eval(`window.nativeStorage.getItems ? 'CALLABLE' : 'MISSING'`);
    } catch (e) { nsResult = 'ERROR: ' + e.message; }
    console.log('result:', nsResult);

    console.log('\n=== Look for any redux/zustand stores ===');
    const stores = await cdp.eval(`(() => {
      const out = {};
      for (const k of Object.keys(window)) {
        const v = window[k];
        if (v && typeof v === 'object' && typeof v.getState === 'function') {
          out[k] = { hasGetState: true, type: typeof v };
        }
      }
      return out;
    })()`);
    console.log(JSON.stringify(stores, null, 2));

    console.log('\n=== Check if main.js loaded ===');
    const mainLoaded = await cdp.eval(`performance.getEntriesByType('resource').filter(r => r.name.endsWith('main.js')).length`);
    console.log('main.js entries:', mainLoaded);

    console.log('\n=== Errors since startup ===');
    const exEvents = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    for (const e of exEvents) {
      const d = e.params?.exceptionDetails;
      console.log(`[${d?.url}:${d?.lineNumber}] ${d?.exception?.description || d?.text}`);
    }

    console.log('\n=== console.error / console.warn ===');
    const consoleEvents = cdp.events.filter((e) => e.method === 'Console.messageAdded');
    for (const e of consoleEvents) {
      const m = e.params?.message;
      if (!m) continue;
      if (m.level === 'error' || m.level === 'warning') {
        console.log(`[${m.level}] ${m.text}`);
      }
    }

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error('CDP probe failed:', err.stack || err.message);
    process.exit(1);
  }
})();