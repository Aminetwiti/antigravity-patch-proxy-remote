const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const BROWSER_WS = 'ws://localhost:9222/devtools/browser/cf4755f4-c3ac-4b29-91fa-10dc3cc6d88e';
const ARTIFACTS_DIR = 'C:\\Users\\amine\\.gemini\\antigravity-ide\\brain\\3e9f6861-dc8a-41e3-8873-7855a12314e0';
const SCREENSHOT_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
const AUDIT_DATA_DIR = path.join(ARTIFACTS_DIR, 'audit_data');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!fs.existsSync(AUDIT_DATA_DIR)) fs.mkdirSync(AUDIT_DATA_DIR, { recursive: true });

class CdpAudit {
  constructor() {
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(BROWSER_WS);
    await new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id && this.callbacks.has(msg.id)) {
            const { resolve, reject } = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        } catch (e) {
          console.error('JSON parse error:', e);
        }
      });
    });
    console.log('Connected to Browser CDP WebSocket!');
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async attach(targetId) {
    const res = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return res.sessionId;
  }

  async eval(expr, sessionId) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    return res && res.result ? res.result.value : null;
  }

  async screenshot(name, sessionId) {
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    }, sessionId);
    const buf = Buffer.from(res.data, 'base64');
    const fullPath = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(fullPath, buf);
    console.log(`[Screenshot Captured] ${name} (${Math.round(buf.length / 1024)} KB)`);
    return fullPath;
  }

  async clickCoords(x, y, sessionId) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await new Promise(r => setTimeout(r, 120));
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  }

  async wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runAudit() {
  const audit = new CdpAudit();
  await audit.connect();

  const { targetInfos } = await audit.send('Target.getTargets');
  console.log('Available targets:');
  targetInfos.forEach(t => console.log(`- [${t.type}] "${t.title}" -> ${t.url}`));

  const mainPage = targetInfos.find(t => t.type === 'page' && t.url.startsWith('https://antigravity.google.com/r/'));
  const appIframe = targetInfos.find(t => t.type === 'iframe' && t.url.includes('antigravity.static.usercontent.goog'));

  if (!mainPage) {
    console.error('Antigravity main page not found!');
    console.log('Available targets:');
    targetInfos.forEach(t => console.log(`- [${t.type}] "${t.title}" -> ${t.url}`));
    process.exit(1);
  }

  console.log(`Attaching to main page: ${mainPage.targetId}`);
  const mainSession = await audit.attach(mainPage.targetId);
  await audit.send('Page.enable', {}, mainSession);
  await audit.send('Runtime.enable', {}, mainSession);
  await audit.send('DOM.enable', {}, mainSession);

  let appSession = null;
  if (appIframe) {
    console.log(`Attaching to app iframe: ${appIframe.targetId}`);
    try {
      appSession = await audit.attach(appIframe.targetId);
      await audit.send('Page.enable', {}, appSession);
      await audit.send('Runtime.enable', {}, appSession);
      await audit.send('DOM.enable', {}, appSession);
    } catch (e) {
      console.log('Could not attach separately to iframe:', e.message);
    }
  }

  await audit.wait(1000);

  // 1. Capture initial main screen
  console.log('Capturing screen: 01_initial_remote_view.png');
  await audit.screenshot('01_initial_remote_view.png', mainSession);

  // 2. Extract forensic data from main page
  console.log('Extracting forensic DOM from main page...');
  const mainForensics = await audit.eval(`
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

      // Extract all CSS Variables
      const rootVars = {};
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule.selectorText === ':root' || rule.selectorText === 'html' || rule.selectorText === 'body') {
              const style = rule.style;
              for (let i = 0; i < style.length; i++) {
                const prop = style[i];
                if (prop.startsWith('--')) {
                  rootVars[prop] = style.getPropertyValue(prop).trim();
                }
              }
            }
          }
        } catch (e) {}
      }

      // Query all clickable and interactive elements
      const interactive = Array.from(document.querySelectorAll('button, [role="button"], a, input, textarea, [role="tab"], [role="menuitem"], [aria-haspopup]')).map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          idx: i,
          tag: el.tagName,
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
          ariaLabel: el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
          id: el.id,
          className: el.className,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          visible: r.width > 0 && r.height > 0,
          styles: getStyles(el)
        };
      }).filter(el => el.visible);

      // Extract iframes
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => {
        const r = f.getBoundingClientRect();
        return {
          src: f.src,
          id: f.id,
          name: f.name,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
        };
      });

      return {
        title: document.title,
        url: window.location.href,
        bodyStyles: getStyles(document.body),
        rootVars,
        rootVarsCount: Object.keys(rootVars).length,
        interactiveCount: interactive.length,
        interactive,
        iframes,
        bodyText: document.body.innerText
      };
    })()
  `, mainSession);

  fs.writeFileSync(path.join(AUDIT_DATA_DIR, 'main_forensics.json'), JSON.stringify(mainForensics, null, 2));
  console.log(`Main forensics saved. Title: "${mainForensics.title}", Interactive: ${mainForensics.interactiveCount}, Iframes: ${mainForensics.iframes.length}`);

  // 3. Extract forensic data from app iframe if available
  let iframeForensics = null;
  if (appSession) {
    console.log('Extracting forensic DOM from app iframe...');
    try {
      iframeForensics = await audit.eval(`
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

          const rootVars = {};
          const sheets = Array.from(document.styleSheets);
          for (const sheet of sheets) {
            try {
              const rules = Array.from(sheet.cssRules || []);
              for (const rule of rules) {
                if (rule.selectorText === ':root' || rule.selectorText === 'html' || rule.selectorText === 'body' || rule.selectorText === ':host') {
                  const style = rule.style;
                  for (let i = 0; i < style.length; i++) {
                    const prop = style[i];
                    if (prop.startsWith('--')) {
                      rootVars[prop] = style.getPropertyValue(prop).trim();
                    }
                  }
                }
              }
            } catch (e) {}
          }

          const interactive = Array.from(document.querySelectorAll('button, [role="button"], a, input, textarea, [role="tab"], [role="menuitem"], [aria-haspopup], [tabindex]')).map((el, i) => {
            const r = el.getBoundingClientRect();
            return {
              idx: i,
              tag: el.tagName,
              text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
              ariaLabel: el.getAttribute('aria-label'),
              role: el.getAttribute('role'),
              id: el.id,
              className: typeof el.className === 'string' ? el.className : '',
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              visible: r.width > 0 && r.height > 0,
              styles: getStyles(el)
            };
          }).filter(el => el.visible);

          return {
            title: document.title,
            url: window.location.href,
            bodyStyles: getStyles(document.body),
            rootVars,
            rootVarsCount: Object.keys(rootVars).length,
            interactiveCount: interactive.length,
            interactive,
            bodyText: document.body.innerText
          };
        })()
      `, appSession);

      fs.writeFileSync(path.join(AUDIT_DATA_DIR, 'iframe_forensics.json'), JSON.stringify(iframeForensics, null, 2));
      console.log(`Iframe forensics saved. Interactive: ${iframeForensics.interactiveCount}, Vars: ${iframeForensics.rootVarsCount}`);
    } catch (e) {
      console.error('Error evaluating iframe:', e);
    }
  }

  // 4. Interactive exploration: clicking elements to reveal menus, modals, drawers
  console.log('\n--- STARTING INTERACTIVE CRAWL ---');
  const targetElements = (iframeForensics && iframeForensics.interactive.length > 0)
    ? { session: appSession, items: iframeForensics.interactive }
    : { session: mainSession, items: mainForensics.interactive };

  console.log(`Scanning ${targetElements.items.length} interactive elements for menus/drawers/modals...`);

  let actionCounter = 2;
  for (const item of targetElements.items) {
    const label = (item.text || item.ariaLabel || '').toLowerCase();
    const isTrigger = (
      item.role === 'menuitem' ||
      item.role === 'tab' ||
      item.ariaLabel?.includes('menu') ||
      item.ariaLabel?.includes('sidebar') ||
      item.ariaLabel?.includes('settings') ||
      item.ariaLabel?.includes('paramètres') ||
      item.ariaLabel?.includes('session') ||
      item.ariaLabel?.includes('drawer') ||
      item.ariaLabel?.includes('more') ||
      item.ariaLabel?.includes('options') ||
      item.ariaLabel?.includes('plus') ||
      label.includes('menu') ||
      label.includes('settings') ||
      label.includes('paramètres') ||
      label.includes('session') ||
      label.includes('review') ||
      label.includes('files') ||
      label.includes('terminal') ||
      label.includes('model') ||
      label.includes('agent') ||
      label.includes('artifact') ||
      label.includes('workspace') ||
      label.includes('display') ||
      label.includes('create') ||
      item.tag === 'BUTTON'
    );

    if (isTrigger && item.rect.w > 0 && item.rect.h > 0) {
      const centerX = item.rect.x + Math.round(item.rect.w / 2);
      const centerY = item.rect.y + Math.round(item.rect.h / 2);

      console.log(`\n[Action ${actionCounter}] Clicking: "${item.text || item.ariaLabel || item.tag}" at (${centerX}, ${centerY})`);
      
      try {
        // Dispatch mouse click on mainSession at coordinates
        await audit.clickCoords(centerX, centerY, mainSession);
        // Also trigger DOM click inside appSession if available
        if (targetElements.session) {
          await audit.eval(`(() => {
            const el = document.querySelectorAll('button, [role="button"], a, input, textarea, [role="tab"], [role="menuitem"], [aria-haspopup], [tabindex]')[${item.idx}];
            if (el) el.click();
          })()`, targetElements.session);
        }
        await audit.wait(600);

        const safeLabel = (item.text || item.ariaLabel || 'btn').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        const screenshotName = `${String(actionCounter).padStart(2, '0')}_click_${safeLabel}.png`;
        await audit.screenshot(screenshotName, mainSession);

        // Check if a modal or menu appeared
        const overlayInfo = await audit.eval(`
          (() => {
            const modals = Array.from(document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], .modal, .dialog, .drawer, .popover, .menu')).map(m => {
              const r = m.getBoundingClientRect();
              return {
                tag: m.tagName,
                role: m.getAttribute('role'),
                className: m.className,
                text: m.innerText.substring(0, 300),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                visible: r.width > 0 && r.height > 0
              };
            }).filter(m => m.visible);
            return modals;
          })()
        `, targetElements.session);

        if (overlayInfo && overlayInfo.length > 0) {
          console.log(`  --> OVERLAY/MODAL DETECTED! Count: ${overlayInfo.length}`);
          fs.writeFileSync(
            path.join(AUDIT_DATA_DIR, `overlay_${actionCounter}.json`),
            JSON.stringify(overlayInfo, null, 2)
          );
        }

        actionCounter++;
        if (actionCounter > 20) {
          console.log('Reached 20 interactive screenshot captures.');
          break;
        }
      } catch (err) {
        console.log(`Failed to click element: ${err.message}`);
      }
    }
  }

  console.log('\n--- AUDIT COMPLETED SUCCESSFULLY ---');
  audit.close();
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
