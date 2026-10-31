const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', '.gemini', 'antigravity-ide', 'brain', '3e9f6861-dc8a-41e3-8873-7855a12314e0', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function inspectTab() {
  const versionInfo = JSON.parse(execSync('curl.exe -s http://localhost:9222/json/version', { encoding: 'utf8' }));
  const browserWs = versionInfo.webSocketDebuggerUrl;

  const ws = new WebSocket(browserWs);
  let msgId = 0;
  const callbacks = new Map();

  function send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      callbacks.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && callbacks.has(msg.id)) {
        const { resolve, reject } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    });
  });

  const { targetInfos } = await send('Target.getTargets');
  console.log('Target count:', targetInfos.length);
  const authOrRemote = targetInfos.find(t => t.type === 'page' && (t.url.includes('antigravity.google.com') || t.url.includes('accounts.google.com')));

  if (!authOrRemote) {
    console.error('Neither Antigravity nor Google Login tab found!');
    ws.close();
    return;
  }

  console.log(`Found target: [${authOrRemote.type}] "${authOrRemote.title}"`);
  console.log(`URL: ${authOrRemote.url}`);

  const { sessionId } = await send('Target.attachToTarget', {
    targetId: authOrRemote.targetId,
    flatten: true
  });
  console.log(`Attached to target with sessionId: ${sessionId}`);

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  // Take screenshot
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const screenshotPath = path.join(SCREENSHOT_DIR, 'current_chrome_tab.png');
  fs.writeFileSync(screenshotPath, Buffer.from(data, 'base64'));
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Evaluate page status
  const pageEval = await send('Runtime.evaluate', {
    expression: `({
      title: document.title,
      url: window.location.href,
      bodySnippet: document.body.innerText.substring(0, 500)
    })`,
    returnByValue: true
  }, sessionId);

  console.log('Page info:', pageEval.result.value);

  ws.close();
}

inspectTab().catch(console.error);
