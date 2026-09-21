const fs = require('fs');
const file = 'C:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/src/rendererHook.js';
let code = fs.readFileSync(file, 'utf-8');

// 1. syncRemoteStateToProxy
const oldSync =   function syncRemoteStateToProxy(active, host, remoteSessions, token) {
    const cfg = getRemoteConfig();
    const finalToken = (token && token !== 'null' && token !== 'undefined' && token.trim().length > 0)
      ? token.trim()
      : cfg.token;
    const finalHost = host || cfg.host;

    if (window.nativeStorage && typeof window.nativeStorage.setRemoteState === 'function') {
      window.nativeStorage.setRemoteState({ active, host: finalHost, token: finalToken, remoteSessions }).catch(() => {});
    }
    try {
      fetch('http://127.0.0.1:51074/api/remote/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, host: finalHost, token: finalToken, remoteSessions }),
      }).catch(() => {});
    } catch (_) {}
  };

const newSync =   function syncRemoteStateToProxy(active, host, remoteSessions, token) {
    const cfg = getRemoteConfig();
    const finalToken = (token && token !== 'null' && token !== 'undefined' && token.trim().length > 0)
      ? token.trim()
      : cfg.token;
    const finalHost = host || cfg.host;

    const payload = { host: finalHost, token: finalToken };
    if (active !== undefined) payload.active = active;
    if (remoteSessions !== undefined) payload.remoteSessions = remoteSessions;

    if (window.nativeStorage && typeof window.nativeStorage.setRemoteState === 'function') {
      window.nativeStorage.setRemoteState(payload).catch(() => {});
    }
    try {
      fetch('http://127.0.0.1:51074/api/remote/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_) {}
  };

if (!code.includes(oldSync)) {
  console.error('Could not find oldSync!');
  process.exit(1);
}
code = code.replace(oldSync, newSync);

// 2. setSessionRemote
const oldSet =       syncRemoteStateToProxy(isRemote, cfg.host, { [cascadeId]: isRemote });;
const newSet =       syncRemoteStateToProxy(undefined, cfg.host, { [cascadeId]: isRemote });;
if (!code.includes(oldSet)) {
  console.error('Could not find oldSet!');
  process.exit(1);
}
code = code.replace(oldSet, newSet);

// 3. Click listener
const oldClick =     const text = item.textContent || '';
    if (text.includes('Local') && !text.includes('Remote')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    } else if (text.includes('New Worktree') || text.includes('New Workspace')) {
      const cid = getActiveSessionId();
      if (cid) setSessionRemote(cid, false);
      else window.__ag_draft_remote = false;
      scheduleUpdate();
    };

const newClick =     const popover = item.closest && item.closest('[role=" menu\], [role=\listbox\], [class*=\popover\], [data-radix-popper-content-wrapper]');
 if (popover) {
 const text = (item.textContent || '').trim();
 if ((text === 'Local' || text.startsWith('Local (')) && !text.includes('Remote')) {
 const cid = getActiveSessionId();
 if (cid) setSessionRemote(cid, false);
 else window.__ag_draft_remote = false;
 scheduleUpdate();
 } else if (text.includes('New Worktree') || text.includes('New Workspace')) {
 const cid = getActiveSessionId();
 if (cid) setSessionRemote(cid, false);
 else window.__ag_draft_remote = false;
 scheduleUpdate();
 }
 };

if (!code.includes(oldClick)) {
 console.error('Could not find oldClick!');
 process.exit(1);
}
code = code.replace(oldClick, newClick);

fs.writeFileSync(file, code, 'utf-8');
console.log('rendererHook.js successfully updated!');
