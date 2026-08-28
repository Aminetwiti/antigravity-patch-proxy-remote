#!/usr/bin/env node
// scripts/diag/cdp-inspect.cjs
// Connect to the Antigravity renderer via Chrome DevTools Protocol (CDP)
// and dump everything useful to diagnose a blank/grey UI.

const WebSocket = require('ws');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 9229;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: HOST, port: PORT, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
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
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (this.events.length > 500) this.events.shift();
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
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      const txt = r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails);
      throw new Error('Eval error: ' + txt);
    }
    return r.result?.value;
  }
  filterEvents(methodFilter) {
    return this.events.filter((e) => e.method === methodFilter);
  }
}

(async () => {
  try {
    const targets = await getJson('/json');
    const page = targets.find((t) => t.type === 'page');
    if (!page) {
      console.log('No page target found.');
      process.exit(1);
    }
    console.log('=== target ===');
    console.log(JSON.stringify({ id: page.id, title: page.title, url: page.url }, null, 2));

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const cdp = new CdpClient(ws);

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    // Wait a bit for any pending console activity.
    await new Promise((r) => setTimeout(r, 4000));

    console.log('\n=== runtime meta ===');
    const ua = await cdp.eval('navigator.userAgent');
    console.log('userAgent:', ua);
    const readyState = await cdp.eval('document.readyState');
    console.log('readyState:', readyState);
    const title = await cdp.eval('document.title');
    console.log('title:', title);
    const url = await cdp.eval('location.href');
    console.log('url:', url);

    console.log('\n=== body stats ===');
    const stats = await cdp.eval(`(() => {
      const b = document.body;
      const h = document.documentElement;
      return {
        bodyHTMLLen: b ? b.innerHTML.length : 0,
        bodyTextPreview: b ? (b.innerText || '').slice(0, 400) : null,
        bodyChildCount: b ? b.children.length : 0,
        docScrollHeight: h ? h.scrollHeight : 0,
        docClientHeight: h ? h.clientHeight : 0,
        docClientWidth: h ? h.clientWidth : 0,
        bgColor: b ? getComputedStyle(b).backgroundColor : null,
        bgImage: b ? getComputedStyle(b).backgroundImage : null,
      };
    })()`);
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n=== first 5 elements under body (tagName + id + className) ===');
    const elements = await cdp.eval(`(() => {
      const arr = [];
      const b = document.body;
      if (!b) return arr;
      for (const el of b.children) {
        arr.push({
          tag: el.tagName,
          id: el.id || null,
          cls: el.className || null,
          childCount: el.children.length,
        });
        if (arr.length >= 5) break;
      }
      return arr;
    })()`);
    console.log(JSON.stringify(elements, null, 2));

    console.log('\n=== look for workbench / app shell ===');
    const workbenchInfo = await cdp.eval(`(() => {
      const selectors = [
        '#workbench',
        '.monaco-workbench',
        '.workbench',
        '#app',
        '#root',
        '.app',
        'main',
        'iframe',
        '.antigravity',
        '.splash-screen',
      ];
      const out = {};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        out[sel] = el ? {
          tag: el.tagName,
          id: el.id || null,
          cls: el.className || null,
          rect: el.getBoundingClientRect().toJSON(),
        } : null;
      }
      return out;
    })()`);
    console.log(JSON.stringify(workbenchInfo, null, 2));

    console.log('\n=== console messages captured ===');
    const consoleEvents = cdp.filterEvents('Console.messageAdded');
    for (const e of consoleEvents) {
      const m = e.params?.message;
      if (!m) continue;
      console.log(`[${m.level}] ${m.text}`);
      for (const f of m.args || []) {
        if (f.value !== undefined) console.log('   arg:', JSON.stringify(f.value).slice(0, 400));
      }
    }

    console.log('\n=== runtime exceptions captured ===');
    const exEvents = cdp.filterEvents('Runtime.exceptionThrown');
    for (const e of exEvents) {
      const d = e.params?.exceptionDetails;
      console.log(`[exception ${d?.url}:${d?.lineNumber}] ${d?.exception?.description || d?.text}`);
    }

    console.log('\n=== log entries (Log.entryAdded) ===');
    const logEvents = cdp.filterEvents('Log.entryAdded');
    for (const e of logEvents) {
      const l = e.params?.entry;
      console.log(`[log ${l?.level}] ${l?.source}: ${l?.text}`);
    }

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error('CDP inspection failed:', err.stack || err.message);
    process.exit(1);
  }
})();