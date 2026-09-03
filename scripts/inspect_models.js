const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const BROWSER_WS = 'ws://localhost:9222/devtools/browser/cf4755f4-c3ac-4b29-91fa-10dc3cc6d88e';
const ws = new WebSocket(BROWSER_WS);

let id = 0;
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const i = ++id;
  const p = { id: i, method, params };
  if (sessionId) p.sessionId = sessionId;
  ws.send(JSON.stringify(p));
  const handler = (m) => {
    const res = JSON.parse(m);
    if (res.id === i) {
      ws.off('message', handler);
      if (res.error) reject(res.error);
      else resolve(res.result);
    }
  };
  ws.on('message', handler);
});

async function main() {
  await new Promise(r => ws.on('open', r));
  const { targetInfos } = await send('Target.getTargets');
  const mainPage = targetInfos.find(t => t.type === 'page' && t.url.startsWith('https://antigravity.google.com/r/'));
  const appIframe = targetInfos.find(t => t.type === 'iframe' && t.url.includes('antigravity.static.usercontent.goog'));

  const mainSession = await send('Target.attachToTarget', { targetId: mainPage.targetId, flatten: true }).then(r => r.sessionId);
  const appSession = await send('Target.attachToTarget', { targetId: appIframe.targetId, flatten: true }).then(r => r.sessionId);

  await send('Page.enable', {}, mainSession);
  await send('Runtime.enable', {}, mainSession);
  await send('Runtime.enable', {}, appSession);

  // Click model button
  const clickRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Gemini') || b.innerText.includes('Flash'));
      if (btn) {
        const r = btn.getBoundingClientRect();
        btn.click();
        return { clicked: true, text: btn.innerText, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  }, appSession);

  console.log('Click button result:', clickRes.result.value);

  await new Promise(r => setTimeout(r, 600));

  // Capture screenshot of model popover
  const shot = await send('Page.captureScreenshot', { format: 'png' }, mainSession);
  const shotPath = path.join('C:\\Users\\amine\\.gemini\\antigravity-ide\\brain\\3e9f6861-dc8a-41e3-8873-7855a12314e0\\screenshots', '04_model_picker_open.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved model picker screenshot:', shotPath);

  // Extract all model list items
  const modelItems = await send('Runtime.evaluate', {
    expression: `(() => {
      const all = Array.from(document.querySelectorAll('*')).filter(el => {
        const t = el.innerText || '';
        return (t.includes('Gemini') || t.includes('Claude') || t.includes('GPT')) && el.children.length === 0;
      }).map(el => el.innerText.trim());
      return Array.from(new Set(all));
    })()`,
    returnByValue: true
  }, appSession);

  console.log('Found model items:', modelItems.result.value);

  ws.close();
}

main().catch(console.error);
