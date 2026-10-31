const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', '.gemini', 'antigravity-ide', 'brain', '3e9f6861-dc8a-41e3-8873-7855a12314e0', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function getTargets() {
  const stdout = execSync('curl.exe -s http://localhost:9222/json', { encoding: 'utf8' });
  return JSON.parse(stdout);
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { origin: '' });
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        } catch (e) {
          console.error('Error parsing CDP msg:', e);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : null;
  }

  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    const fullPath = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(fullPath, buf);
    console.log(`[Screenshot] Saved ${name} (${Math.round(buf.length / 1024)} KB)`);
    return fullPath;
  }

  async wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  const targets = getTargets();
  console.log(`Targets: ${targets.length}`);
  
  const page = targets.find(t => t.type === 'page' && t.url.includes('antigravity.google.com'));
  if (!page) {
    console.error('Antigravity target not found!');
    process.exit(1);
  }

  console.log(`Connecting to: ${page.title} (${page.url})`);
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('Connected to CDP successfully!');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');

  await cdp.wait(500);

  // Take screenshot 1: Main View
  await cdp.screenshot('01_remote_main.png');

  // Evaluate DOM exploration
  const exploration = await cdp.eval(`
    (() => {
      const getStyles = (el) => {
        const cs = window.getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          color: cs.color,
          font: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          radius: cs.borderRadius,
          border: cs.border,
          boxShadow: cs.boxShadow,
          padding: cs.padding,
          margin: cs.margin,
          display: cs.display
        };
      };

      const interactive = Array.from(document.querySelectorAll('button, [role="button"], a, input, select, textarea, [role="tab"], [role="menuitem"]')).map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().substring(0, 80),
          ariaLabel: el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
          id: el.id,
          className: el.className,
          visible: r.width > 0 && r.height > 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          styles: getStyles(el)
        };
      }).filter(i => i.visible);

      const bodyStyles = getStyles(document.body);
      const rootVars = {};
      try {
        const rootCS = window.getComputedStyle(document.documentElement);
        for (let i = 0; i < rootCS.length; i++) {
          const prop = rootCS[i];
          if (prop.startsWith('--')) {
            rootVars[prop] = rootCS.getPropertyValue(prop).trim();
          }
        }
      } catch (e) {}

      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src,
        id: f.id,
        rect: f.getBoundingClientRect()
      }));

      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText,
        bodyStyles,
        rootVars,
        interactive,
        iframes
      };
    })()
  `);

  console.log('--- EXPLORATION RESULTS ---');
  console.log('Title:', exploration.title);
  console.log('URL:', exploration.url);
  console.log('Body Text Snippet:\n', exploration.bodyText.substring(0, 1000));
  console.log(`CSS Variables count: ${Object.keys(exploration.rootVars).length}`);
  console.log(`Interactive elements count: ${exploration.interactive.length}`);

  const reportPath = path.join(SCREENSHOT_DIR, '..', 'exploration_main.json');
  fs.writeFileSync(reportPath, JSON.stringify(exploration, null, 2));
  console.log(`Report saved to: ${reportPath}`);

  cdp.close();
}

run().catch(e => {
  console.error('Crawler Error:', e);
  process.exit(1);
});
