#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const activePortFile = path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort');
const port = process.argv[2] || fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0].trim();

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find(t => t.type === 'page') || targets[0];
  if (!page) throw new Error('No CDP page target found');
  console.log('CDP port:', port);
  console.log('Target:', page.title, page.url);
  console.log('WS:', page.webSocketDebuggerUrl);

  const WS = globalThis.WebSocket || (await import('ws')).WebSocket || (await import('ws')).default;
  const ws = new WS(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject, method });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p.resolve(msg);
      } else if (msg.method) {
        events.push(msg);
      }
    } catch (e) {}
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('WS open timeout')), 5000);
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');

  const evals = [
    ['location', 'location.href'],
    ['readyState', 'document.readyState'],
    ['title', 'document.title'],
    ['bodyText', 'document.body ? document.body.innerText.slice(0,1000) : null'],
    ['bodyHTML', 'document.body ? document.body.outerHTML.slice(0,2000) : null'],
    ['scripts', 'Array.from(document.scripts).slice(0,20).map(s => s.src || s.textContent.slice(0,80))'],
    ['styles', 'Array.from(document.styleSheets).length'],
    ['nativeStorage', 'typeof window.nativeStorage'],
    ['keys', 'Object.keys(window).filter(k => /native|electron|storage|agent|log|update/i.test(k)).slice(0,100)'],
  ];
  for (const [name, expression] of evals) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const ro = r.result && r.result.result;
    console.log(`\n=== EVAL ${name} ===`);
    if (r.result && r.result.exceptionDetails) console.log(JSON.stringify(r.result.exceptionDetails, null, 2));
    else console.log(JSON.stringify(ro && (ro.value ?? ro.description), null, 2));
  }

  await send('Runtime.evaluate', { expression: 'console.log("[cdp-renderer-dump] console probe", location.href, document.readyState)' });
  await new Promise(r => setTimeout(r, 2500));

  const interesting = events.filter(e => ['Runtime.exceptionThrown','Runtime.consoleAPICalled','Log.entryAdded','Network.loadingFailed'].includes(e.method));
  console.log(`\n=== EVENTS (${interesting.length}) ===`);
  for (const e of interesting.slice(-80)) console.log(e.method, JSON.stringify(e.params).slice(0, 2000));

  ws.close();
}

main().catch((e) => { console.error(e && (e.stack || e.message) || e); process.exit(1); });
