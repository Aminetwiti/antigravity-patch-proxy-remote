#!/usr/bin/env node
// scripts/diag/cdp-summary.cjs — quick UI status snapshot via CDP
const WebSocket = require('ws');
const http = require('http');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9229, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  try {
    const targets = await getJson('/json');
    const page = targets.find((t) => t.type === 'page');
    if (!page) { console.log('NO PAGE TARGET'); process.exit(1); }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    let id = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      const handler = (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.id === i) {
          ws.off('message', handler);
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Console.enable');

    await new Promise((r) => setTimeout(r, 3000));

    const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    const url = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const summary = await send('Runtime.evaluate', {
      expression: `(() => {
        const b = document.body;
        const r = b ? b.getBoundingClientRect() : null;
        return {
          readyState: document.readyState,
          bodyHeight: r ? r.height : 0,
          bodyWidth: r ? r.width : 0,
          childCount: b ? b.children.length : 0,
          textPreview: (b ? (b.innerText || '').slice(0, 250) : '').replace(/\\s+/g,' ').trim(),
        };
      })()`,
      returnByValue: true,
    });

    console.log('=== UI SUMMARY ===');
    console.log('CDP target title :', page.title);
    console.log('document.title    :', title.result.value);
    console.log('location.href     :', url.result.value);
    console.log('readyState        :', summary.result.value.readyState);
    console.log('body size         :', summary.result.value.bodyWidth + 'x' + summary.result.value.bodyHeight);
    console.log('body children     :', summary.result.value.childCount);
    console.log('text preview      :', summary.result.value.textPreview || '(empty)');

    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();