const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const devToolsPortFile = 'C:\\Users\\amine\\AppData\\Roaming\\Antigravity\\DevToolsActivePort';
if (!fs.existsSync(devToolsPortFile)) {
  console.error('DevToolsActivePort file not found');
  process.exit(1);
}
const port = fs.readFileSync(devToolsPortFile, 'utf8').trim().split('\n')[0].trim();
console.log('DevTools port:', port);

http.get(`http://127.0.0.1:${port}/json`, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const targets = JSON.parse(data);
    const mainTarget = targets.find(t => t.title === 'Antigravity' || (t.url && t.url.includes('127.0.0.1')));
    if (!mainTarget) {
      console.log('No main target found:', targets);
      return;
    }
    console.log('Main target:', mainTarget.id, mainTarget.url, mainTarget.webSocketDebuggerUrl);
    const ws = new WebSocket(mainTarget.webSocketDebuggerUrl, {
      headers: { Host: `localhost:${port}` }
    });

    ws.on('open', () => {
      console.log('Connected to target page!');
      ws.send(JSON.stringify({ id: 1, method: 'Log.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
      ws.send(JSON.stringify({
        id: 4,
        method: 'Runtime.evaluate',
        params: {
          expression: `({
            readyState: document.readyState,
            title: document.title,
            url: location.href,
            root: document.getElementById('root') ? { innerHTML: document.getElementById('root').innerHTML, childCount: document.getElementById('root').children.length } : 'NO ROOT',
            bodyHtmlSnippet: document.body ? document.body.innerHTML.slice(0, 1000) : null,
            bodyChildrenCount: document.body ? document.body.children.length : 0,
            scripts: Array.from(document.querySelectorAll('script')).map(s => s.src || 'inline: ' + s.innerText.slice(0, 80)),
            computedBodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null
          })`,
          returnByValue: true
        }
      }));
    });

    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 4) {
        console.log('--- DOM INFO ---');
        console.log(JSON.stringify(msg.result?.result?.value, null, 2));
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[Console ' + msg.params.type + ']:', msg.params.args.map(a => a.value || a.description).join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[EXCEPTION]:', msg.params.exceptionDetails);
      } else if (msg.method === 'Log.entryAdded') {
        console.log('[Log ' + msg.params.entry.level + ']:', msg.params.entry.text);
      }
    });

    ws.on('error', err => console.error('WS Error:', err));

    setTimeout(() => {
      console.log('Finished listening.');
      ws.close();
      process.exit(0);
    }, 4000);
  });
});
