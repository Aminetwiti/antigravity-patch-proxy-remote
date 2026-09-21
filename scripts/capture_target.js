const WebSocket = require('ws');
const fs = require('fs');

const ws = new WebSocket('ws://127.0.0.1:52666/devtools/browser/efd13ada-c754-463c-b8e6-deaa912696b7', {
  headers: { Host: 'localhost:52666' }
});

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Target.attachToTarget',
    params: { targetId: '9F8389411E045EEF2C7ADA9826AB1A69', flatten: true }
  }));
});

let sessionId;
ws.on('message', data => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    sessionId = msg.result.sessionId;
    console.log('Attached with sessionId:', sessionId);
    ws.send(JSON.stringify({
      id: 2,
      sessionId,
      method: 'Page.enable'
    }));
    ws.send(JSON.stringify({
      id: 3,
      sessionId,
      method: 'Page.captureScreenshot',
      params: { format: 'png' }
    }));
  } else if (msg.id === 3) {
    const base64 = msg.result.data;
    fs.writeFileSync('target_screen.png', Buffer.from(base64, 'base64'));
    console.log('Saved target_screen.png! Size:', base64.length);
    process.exit(0);
  }
});
setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 5000);
