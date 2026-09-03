const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const BROWSER_WS = 'ws://localhost:9222/devtools/browser/cf4755f4-c3ac-4b29-91fa-10dc3cc6d88e';
const ARTIFACTS_DIR = 'C:\\Users\\amine\\.gemini\\antigravity-ide\\brain\\3e9f6861-dc8a-41e3-8873-7855a12314e0';
const SCREENSHOT_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
const AUDIT_DATA_DIR = path.join(ARTIFACTS_DIR, 'audit_data');

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
          console.error(e);
        }
      });
    });
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

  async eval(expr, sessionId) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    return res && res.result ? res.result.value : null;
  }

  async screenshot(name, sessionId) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const buf = Buffer.from(res.data, 'base64');
    const fullPath = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(fullPath, buf);
    console.log(`[Captured] ${name} (${Math.round(buf.length / 1024)} KB)`);
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
  const audit = new CdpAudit();
  await audit.connect();

  const { targetInfos } = await audit.send('Target.getTargets');
  const mainPage = targetInfos.find(t => t.type === 'page' && t.url.startsWith('https://antigravity.google.com/r/'));
  const appIframe = targetInfos.find(t => t.type === 'iframe' && t.url.includes('antigravity.static.usercontent.goog'));

  const mainSession = await audit.send('Target.attachToTarget', { targetId: mainPage.targetId, flatten: true }).then(r => r.sessionId);
  const appSession = await audit.send('Target.attachToTarget', { targetId: appIframe.targetId, flatten: true }).then(r => r.sessionId);

  await audit.send('Page.enable', {}, mainSession);
  await audit.send('Runtime.enable', {}, mainSession);
  await audit.send('Runtime.enable', {}, appSession);

  // 1. Capture current Settings screen
  await audit.screenshot('settings_01_general.png', mainSession);

  // Dump Settings Details
  const settingsDetails = {};

  const categories = ['General', 'Application', 'Appearance', 'Models', 'Customizations', 'Browser', 'Shortcuts'];

  for (const cat of categories) {
    console.log(`\nNavigating to Settings category: ${cat}`);
    
    // Click category in sidebar of modal
    const clicked = await audit.eval(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], a, [role="tab"]'));
        const target = buttons.find(b => b.innerText.trim().toLowerCase() === ${JSON.stringify(cat.toLowerCase())});
        if (target) {
          target.click();
          return true;
        }
        return false;
      })()
    `, appSession);

    await audit.wait(600);

    const safeCat = cat.toLowerCase();
    await audit.screenshot(`settings_tab_${safeCat}.png`, mainSession);

    // Extract all text, labels, inputs, toggles, descriptions in this category
    const catData = await audit.eval(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        
        // Find main content panel
        const inputs = Array.from(dialog.querySelectorAll('input, select, textarea, [role="switch"], [role="checkbox"]')).map(inp => ({
          type: inp.type || inp.getAttribute('role'),
          id: inp.id,
          name: inp.name,
          checked: inp.checked,
          value: inp.value,
          ariaLabel: inp.getAttribute('aria-label'),
          placeholder: inp.placeholder
        }));

        const rows = Array.from(dialog.querySelectorAll('.flex, .grid, [class*="setting"], [class*="item"]')).filter(el => {
          return el.children.length >= 2 && (el.innerText || '').length > 0 && (el.innerText || '').length < 300;
        }).map(r => r.innerText.trim()).slice(0, 30);

        return {
          title: ${JSON.stringify(cat)},
          fullText: dialog.innerText,
          inputs,
          sampleRows: Array.from(new Set(rows)).slice(0, 15)
        };
      })()
    `, appSession);

    if (catData) {
      settingsDetails[cat] = catData;
      console.log(`Captured ${cat}: ${catData.inputs.length} inputs/toggles.`);
    }
  }

  fs.writeFileSync(path.join(AUDIT_DATA_DIR, 'settings_deep_audit.json'), JSON.stringify(settingsDetails, null, 2));

  // 2. Close Settings modal
  console.log('\nClosing Settings modal...');
  await audit.eval(`
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const closeBtn = dialog.querySelector('button[aria-label*="close" i], button[aria-label*="fermer" i], .close-button, button.rounded-full');
        if (closeBtn) closeBtn.click();
        else {
          const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true });
          document.dispatchEvent(esc);
        }
      }
    })()
  `, appSession);

  await audit.wait(800);
  await audit.screenshot('02_after_settings_closed.png', mainSession);

  // 3. Open a real conversation / project
  console.log('\nClicking conversation in project...');
  await audit.eval(`
    (() => {
      const convLinks = Array.from(document.querySelectorAll('a[href*="/c/"], [role="button"]')).filter(el => {
        const text = (el.innerText || '').trim();
        return text.length > 3 && !text.includes('Settings') && !text.includes('New Conversation');
      });
      if (convLinks.length > 0) {
        convLinks[0].click();
        return convLinks[0].innerText;
      }
      return null;
    })()
  `, appSession);

  await audit.wait(1200);
  await audit.screenshot('03_conversation_chat_view.png', mainSession);

  // 4. Extract Chat View forensics (Tabs, Composer, Model Selector, Messages)
  const chatForensics = await audit.eval(`
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
          boxShadow: cs.boxShadow
        };
      };

      const tabs = Array.from(document.querySelectorAll('[role="tab"], button')).filter(b => {
        const t = (b.innerText || '').trim().toLowerCase();
        return ['chat', 'review', 'changes', 'plan', 'terminal', 'files'].includes(t);
      }).map(b => ({ text: b.innerText.trim(), styles: getStyles(b) }));

      const composer = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
      const composerInfo = composer ? {
        tag: composer.tagName,
        placeholder: composer.placeholder || composer.getAttribute('placeholder'),
        styles: getStyles(composer)
      } : null;

      const modelPickers = Array.from(document.querySelectorAll('button, [role="combobox"], [aria-haspopup]')).filter(b => {
        const t = (b.innerText || '').toLowerCase();
        return t.includes('gemini') || t.includes('claude') || t.includes('gpt') || t.includes('flash') || t.includes('pro');
      }).map(b => ({ text: b.innerText.trim(), styles: getStyles(b) }));

      return {
        tabs,
        composerInfo,
        modelPickers,
        pageSnippet: document.body.innerText.substring(0, 2000)
      };
    })()
  `, appSession);

  fs.writeFileSync(path.join(AUDIT_DATA_DIR, 'chat_view_forensics.json'), JSON.stringify(chatForensics, null, 2));
  console.log('Chat forensics captured!');

  // 5. Click Model Picker if found
  console.log('\nChecking Model Picker...');
  const clickedModel = await audit.eval(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const mp = buttons.find(b => {
        const t = (b.innerText || '').toLowerCase();
        return t.includes('gemini') || t.includes('flash') || t.includes('pro') || t.includes('model');
      });
      if (mp) {
        mp.click();
        return mp.innerText;
      }
      return false;
    })()
  `, appSession);

  if (clickedModel) {
    await audit.wait(600);
    await audit.screenshot('04_model_selector_dropdown.png', mainSession);

    const modelMenu = await audit.eval(`
      (() => {
        const menu = document.querySelector('[role="menu"], [role="listbox"], .dropdown-menu');
        return menu ? { text: menu.innerText, className: menu.className } : null;
      })()
    `, appSession);

    fs.writeFileSync(path.join(AUDIT_DATA_DIR, 'model_menu.json'), JSON.stringify(modelMenu, null, 2));
    console.log('Model selector dropdown captured!');
  }

  // 6. Test Review Tab
  console.log('\nSwitching to Review Tab if available...');
  const clickedReview = await audit.eval(`
    (() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], button'));
      const rev = tabs.find(b => (b.innerText || '').trim().toLowerCase() === 'review');
      if (rev) {
        rev.click();
        return true;
      }
      return false;
    })()
  `, appSession);

  if (clickedReview) {
    await audit.wait(800);
    await audit.screenshot('05_review_tab_view.png', mainSession);
    console.log('Review tab view captured!');
  }

  audit.close();
  console.log('\n=== CRAWLER COMPLETED SUCCESSFULLY ===');
}

run().catch(console.error);
