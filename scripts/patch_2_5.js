#!/usr/bin/env node
/**
 * patch_2_5.js — Surgical patcher for Antigravity v2.5.x app.asar.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VERSION DIFFERENCE (the WHY this script exists)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Antigravity 2.0.x / 2.1.0  ───────────────────────────────────────────────
 *   • Full bundle ships with `dist/proxy.js` + `dist/proxy/translators/`
 *   • `proxy-runner.js` lives at the root
 *   • `dist/main.js` has TLS bypass + `require('../proxy-runner')` integrated
 *   • Custom models work out of the box if proxy.js is configured
 *
 * Antigravity 2.2.x (since 2026-06)  ─────────────────────────────────────────
 *   • Google REMOVED `dist/proxy.js` + `dist/proxy/translators/` from the
 *     official bundle. The custom-model proxy code is NOT shipped anymore.
 *   • `proxy-runner.js` still present at the root (kept by Google as a hook)
 *   • `dist/main.js` still has TLS bypass + `require('../proxy-runner')`
 *   • But the proxy implementation is missing → proxy-runner loads
 *     `dist/proxy.js` → MODULE_NOT_FOUND
 *   • Fix: re-inject 3 modules (cryptoStore, customModelStore, schemaValidator)
 *     via `patch_2_2_1.js`.
 *
 * Antigravity 2.5.x (since 2026-07, e.g. 2.5.1)  ────────────────────────────
 *   • Google went MUCH further. They removed:
 *       1. The entire `dist/proxy/*` tree (22 modules)
 *       2. `dist/cryptoStore.js`, `dist/customModelStore.js`,
 *          `dist/schemaValidator.js`
 *       3. `proxy-runner.js` at the asar root
 *       4. ALL proxy integration hooks from `dist/main.js` (TLS bypass,
 *          `require('../proxy-runner')`)
 *       5. ALL `startProxy()` calls from `dist/languageServer.js`
 *       6. ALL custom-model IPC handlers from `dist/ipcHandlers.js`
 *          (file shrank from 34 KB to 9 KB)
 *       7. ALL Custom Models UI from `dist/preload.js`
 *          (file shrank from 75 KB to 5 KB)
 *       8. PROVIDERS list and config from `dist/constants.js`
 *          (file shrank from 9.9 KB to 355 B)
 *
 *   • The binary URL pattern is UNCHANGED: `daily-cloudcode-pa.googleapis.com`
 *     still appears in `language_server.exe` (1 occurrence) → binary patch
 *     still works the same way.
 *
 * What the patch needs to do for 2.5.x  ──────────────────────────────────────
 *   1. Re-inject the 25 missing JS modules (22 in `dist/proxy/*` + cryptoStore,
 *      customModelStore, schemaValidator).
 *   2. Re-create `proxy-runner.js` at the asar root.
 *   3. OVERWRITE 5 stripped files with the repo's v2.2.x-patched versions
 *      (which still have proxy integration hooks baked in):
 *        - dist/main.js            (TLS bypass + require proxy-runner)
 *        - dist/languageServer.js  (startProxy() call)
 *        - dist/ipcHandlers.js     (custom-model IPC handlers)
 *        - dist/preload.js         (Custom Models UI injection)
 *        - dist/constants.js       (PROVIDERS list)
 *
 *   These 5 files are NOT re-implemented; they come from the repo `dist/`
 *   which is the v2.2.x final state with proxy hooks intact. If you ever
 *   upgrade the repo past 2.2.x, ensure the repo files retain their proxy
 *   integration hooks.
 *
 * What the patch does NOT do  ───────────────────────────────────────────────
 *   • Does NOT touch the binary (binary patch is a separate step).
 *   • Does NOT add `dist/__mocks__/*` (would crash Electron module resolution).
 *   • Does NOT include `*.test.js` (test pollution).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node patch_2_5.js <asar-in> <build-dir> <asar-out>
 *
 *   <asar-in>   Path to the existing app.asar (typically the deployed one
 *               under %LOCALAPPDATA%\Programs\Antigravity\resources\)
 *   <build-dir> Staging directory for the patched contents (will be wiped
 *               and recreated — DO NOT point at anything you want to keep)
 *   <asar-out>  Where to write the patched asar
 *
 * Env:
 *   AG_REPO_DIR  Override the project root (default: parent of this script).
 *                The project must contain a built `dist/` and `proxy-runner.js`.
 *
 * Exit codes:
 *   0  Success
 *   1  Bad CLI args, missing input file, missing source modules
 *   2  require('@electron/asar') failed
 *   3  asar.createPackage failed (repack error)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

// v2.4.x patch: Monkey-patch fs.readFileSync to bypass ENOENT on missing unpacked files 
// (e.g. chrome-devtools-mcp which is declared in ASAR header but missing from disk in v2.4.2)
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(pathStr, options) {
  try {
    return originalReadFileSync.apply(this, arguments);
  } catch (err) {
    if (err.code === 'ENOENT' && typeof pathStr === 'string' && pathStr.includes('.unpacked')) {
      return Buffer.alloc(0);
    }
    throw err;
  }
};
const {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
  copyRelativeFiles,
  validateAsarInventory,
} = require('./lib/patch-2-3-artifacts');
const {
  stripPreloadLogInitialization,
  removeLanguageServerProxyStartup,
  removeSandboxedPreloadLocalImports,
  addIdeBridgeToPreload,
  addUpdaterStateBridgeToPreload,
} = require('./lib/patch-2-3-source');
const {
  UNPACKED_LAYOUT,
  assertMitmSourcesExist,
  stageUnpackedFiles,
  moveUnpackedAside,
  restoreUnpackedAfterRepack,
  assertAsarExcludesUnpacked,
  assertUnpackedDeployed,
} = require('./lib/patch-2-3-mitm');

// ─── The 25 modules that v2.5.x dropped and we need to re-inject ───────────
const MISSING_JS_MODULES = [
  // Standalone modules
  'cryptoStore',
  'customModelStore',
  'schemaValidator',
  // New repo modules not present in v2.5.x original asar
  'presets',
  'presets/reasoningEffort',
  'configExchange',
  'logger',
  'metrics',
  'preload/api',
  'preload/doctor-ui',
  'preload/logger',
  'preload/types',
  'gateway/server',
  'gateway/streamBuffer',
  'ipc/index',
  'ipc/handlers/doctorHandler',
  'ipc/handlers/modelHandler',
  'ipc/handlers/settingsHandler',
  'ipc/handlers/systemHandler',
  'main/windowManager',
  'services/cryptoStore',
  'services/modelStore',
  'shared/logger',
  'wellKnown/modelIdUtils',
  // Main proxy entry point
  'proxy',
  // Proxy submodules
  'proxy/agentPool',
  'proxy/backoff',
  'proxy/circuitBreaker',
  'proxy/contextTrimmer',
  'proxy/diagnostics',
  'proxy/dnsResolver',
  'proxy/effortExpander',
  'proxy/emptyStream',
  'proxy/errorClassifier',
  'proxy/httpUtils',
  'proxy/idGenerator',
  'proxy/idleTimeout',
  'proxy/jsonRepair',
  'proxy/logThrottle',
  'proxy/mcpRelay',
  'proxy/metricsRoute',
  'proxy/modelHealthChecker',
  'proxy/modelInjector',
  'proxy/modelLoader',
  'proxy/modelRouter',
  'proxy/modelTimeBudget',
  'proxy/modelUtils',
  'proxy/persistedState',
  'proxy/protoInjector',
  'proxy/protobuf',
  'proxy/providerGate',
  'proxy/recentModelsStore',
  'proxy/registry',
  'proxy/retryBudget',
  'proxy/retryStrategy',
  'proxy/shared',
  'proxy/types',
  'proxy/urlBuilder',
  // Translators
  'proxy/translators/anthropic',
  'proxy/translators/google',
  'proxy/translators/ollama',
  'proxy/translators/openai',
  'proxy/translators/utils',
];

// ─── The 5 files that v2.5.x stripped and need to be OVERWRITTEN ───────────
// These come from the repo dist/ which retains v2.2.x proxy integration hooks.
const OVERWRITE_FILES = [
  'dist/main.js',
  'dist/languageServer.js',
  'dist/ipcHandlers.js',
  'dist/preload.js',
  'dist/constants.js',
  'dist/utils.js',
  'dist/loadingOverlay.js',
  'dist/keybindings.js',
  'dist/menu.js',
  'dist/tray.js',
  'dist/paths.js',
  'dist/storage.js',
  'dist/customScheme.js',
  'dist/updater.js',
  'dist/services/settingsService.js',
  'dist/ideInstall/index.js',
  'dist/ideInstall/constants.js',
  'dist/ideInstall/service.js',
  'dist/ideInstall/wizard.js',
  'dist/ideInstall/wizardHtml.js',
  'dist/ideInstall/wizardPreload.js',
];

// IPC channels that are registered TWICE in the repo's v2.2.x ipcHandlers.js.
// We strip the duplicate (the older, less-feature-complete one) so
// registerIpcHandlers doesn't throw "Attempted to register a second
// handler for <channel>" on startup.
const DUPLICATE_IPC_HANDLERS = [
  'storage:fetch-models',     // registered at L188 and L418 in repo ipcHandlers.js
];

// ─── The 1 root-level file that v2.5.x removed ─────────────────────────────
const NEW_ROOT_FILES = [
  'proxy-runner.js',
];

function buildPatchManifest(repoDir) {
  const proxyRoot = path.join(repoDir, 'dist', 'proxy');
  const proxyFiles = discoverJavaScriptFiles(proxyRoot)
    .map((relativePath) => `dist/proxy/${relativePath}`);
  return [...new Set([
    'dist/proxy.js',
    ...proxyFiles,
    'dist/cryptoStore.js',
    'dist/customModelStore.js',
    'dist/schemaValidator.js',
    'dist/presets.js',
    'dist/presets/reasoningEffort.js',
    'dist/logger.js',
    'dist/configExchange.js',
    'dist/metrics.js',
    'dist/preload/api.js',
    'dist/preload/doctor-ui.js',
    'dist/preload/logger.js',
    'dist/preload/types.js',
    'dist/wellKnown/modelIdUtils.js',
    ...OVERWRITE_FILES,
    ...NEW_ROOT_FILES,
  ])].sort();
}

// Optional sibling files to copy alongside each .js module
const OPTIONAL_SIBLINGS = ['.d.ts', '.js.map', '.d.ts.map'];

function die(msg, code = 1) {
  console.error(`[patch_2_3] ${msg}`);
  process.exit(code);
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function copySiblings(srcBase, dstBase) {
  // copy <name>.d.ts, <name>.js.map, <name>.d.ts.map if present
  const base = srcBase.replace(/\.js$/, '');
  const baseDst = dstBase.replace(/\.js$/, '');
  let count = 0;
  for (const ext of OPTIONAL_SIBLINGS) {
    const src = base + ext;
    const dst = baseDst + ext;
    if (copyFileIfExists(src, dst)) {
      count++;
      console.log(`            + ${path.basename(path.dirname(dst))}/${path.basename(dst)} (${fs.statSync(dst).size} B)`);
    }
  }
  return count;
}

async function main() {
  const [, , asarIn, buildDir, asarOut] = process.argv;
  if (!asarIn || !buildDir || !asarOut) {
    die('usage: node patch_2_5.js <asar-in> <build-dir> <asar-out>');
  }
  if (!fs.existsSync(asarIn)) die(`asar-in not found: ${asarIn}`);

  const repoDir = process.env.AG_REPO_DIR
    || path.resolve(__dirname, '..');
  const repoDist = path.join(repoDir, 'dist');

  if (!fs.existsSync(repoDist)) {
    die(`repo dist/ not found at ${repoDist} — run \`npm run build\` first`);
  }

  const manifest = buildPatchManifest(repoDir);
  assertRequiredArtifacts(repoDir, manifest);

  console.log(`[patch_2_3] asar-in   = ${asarIn}`);
  console.log(`[patch_2_3] build-dir = ${buildDir}`);
  console.log(`[patch_2_3] asar-out  = ${asarOut}`);
  console.log(`[patch_2_3] repo      = ${repoDir}`);

  // Step 1: extract the deployed asar (clean staging dir first)
  console.log('[patch_2_3] step 1/4 — extract');
  rimraf(buildDir);
  ensureDir(buildDir);

  const unpackedForIn = `${asarIn}.unpacked`;
  if (!fs.existsSync(unpackedForIn)) {
    const primaryUnpacked = path.join(path.dirname(asarIn), 'app.asar.unpacked');
    if (fs.existsSync(primaryUnpacked)) {
      fs.cpSync(primaryUnpacked, unpackedForIn, { recursive: true });
      console.log(`[patch_2_3] synced ${primaryUnpacked} -> ${unpackedForIn}`);
    }
  }

  asar.extractAll(asarIn, buildDir);

  // Step 2: inject the 25 missing JS modules
  console.log(`[patch_2_3] step 2/4 — inject ${MISSING_JS_MODULES.length} missing JS modules`);
  const buildDist = path.join(buildDir, 'dist');
  ensureDir(buildDist);

  let totalBytes = 0;
  let filesAdded = 0;
  for (const mod of MISSING_JS_MODULES) {
    const srcJs = path.join(repoDist, `${mod}.js`);
    const dstJs = path.join(buildDist, `${mod}.js`);
    if (!fs.existsSync(srcJs)) {
      die(`required source missing: ${srcJs}\n` +
          `  (you may need to run \`npm run build\` in the repo first)`);
    }
    // Ensure the destination subdirectory exists (e.g. dist/proxy/)
    ensureDir(path.dirname(dstJs));
    fs.copyFileSync(srcJs, dstJs);
    const size = fs.statSync(srcJs).size;
    totalBytes += size;
    filesAdded++;
    console.log(`            + dist/${mod}.js (${size} B)`);
    filesAdded += copySiblings(srcJs, dstJs);
  }
  console.log(`            sub-total: ${filesAdded} files, ${totalBytes} B`);

  // Step 3: OVERWRITE 5 stripped files with repo's patched versions
  console.log(`[patch_2_3] step 3/4 — overwrite ${OVERWRITE_FILES.length} stripped files`);
  let owBytes = 0;
  let owCount = 0;
  for (const rel of OVERWRITE_FILES) {
    const src = path.join(repoDir, rel);
    const dst = path.join(buildDir, rel);
    if (!fs.existsSync(src)) {
      die(`required overwrite source missing: ${src}`);
    }
    ensureDir(path.dirname(dst));
    let content = fs.readFileSync(src, 'utf8');
    // v2.5.x patch: dedupe duplicate IPC handler registrations in ipcHandlers.js.
    //
    // Two safeguards are needed because tsc output varies across builds:
    //   1. Match EITHER single OR double quotes around the channel name.
    //   2. Use a greedy 'g' flag loop instead of String.replace (which by
    //      default replaces only the first match), so we strip every
    //      duplicate instead of just one. We keep the LAST registration
    //      (most feature-complete) and strip all preceding ones.
    if (rel === 'dist/ipcHandlers.js') {
      for (const channel of DUPLICATE_IPC_HANDLERS) {
        // Escape any regex metacharacters in the channel name (defensive).
        const esc = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match ipcMain.handle("channel" ...) OR ipcMain.handle('channel' ...)
        // up to the closing `});` at the end of the callback. The handler
        // body may be a multi-line arrow function, a multi-line function,
        // or an inline expression — so we allow nested braces via the
        // balanced-brace trick: walk the string char-by-char tracking depth.
        const quote = `["']`;
        const handleStart = new RegExp(
          `ipcMain\\.handle\\(${quote}${esc}${quote}\\s*,`,
          'g',
        );
        let totalOccurrences = 0;
        let stripped = 0;
        // First pass: count and collect ALL handler blocks by parsing braces.
        const blocks = [];
        let m;
        while ((m = handleStart.exec(content)) !== null) {
          let startIdx = m.index;
          // Look backwards to capture the 'electron_1.' (or similar) prefix
          // so we don't leave a dangling 'electron_1.' before the comment.
          const before = content.slice(0, startIdx);
          const prefixMatch = before.match(/([A-Za-z_$][A-Za-z0-9_$]*\.)$/);
          if (prefixMatch) {
            startIdx -= prefixMatch[1].length;
          }
          // Walk forward from the ipcMain.handle match tracking brace depth
          // until we close back to depth 0, then consume the closing `);`.
          let depth = 0;
          let i = m.index;
          let opened = false;
          for (; i < content.length; i++) {
            const c = content[i];
            if (c === '{') { depth++; opened = true; }
            else if (c === '}') { depth--; }
            if (opened && depth === 0) {
              // Skip whitespace then expect `);`
              let j = i + 1;
              while (j < content.length && /\s/.test(content[j])) j++;
              if (content[j] === ')' && content[j + 1] === ';') {
                blocks.push({ start: startIdx, end: j + 2 });
                break;
              }
            }
          }
          // Safety: if we never closed, bail to avoid infinite loop.
          if (i >= content.length) break;
        }
        totalOccurrences = blocks.length;
        if (totalOccurrences > 1) {
          // Keep the LAST block (most feature-complete), strip the preceding
          // ones. Build the new content by stitching non-stripped regions.
          const kept = blocks[blocks.length - 1];
          let out = '';
          let cursor = 0;
          for (let k = 0; k < blocks.length - 1; k++) {
            const b = blocks[k];
            out += content.slice(cursor, b.start);
            out += `/* v2.5.x patch: duplicate '${channel}' registration stripped */\n`;
            cursor = b.end;
            stripped++;
          }
          out += content.slice(cursor);
          content = out;
          console.log(`            + stripped ${stripped} duplicate '${channel}' registration(s) (kept last of ${totalOccurrences})`);
        } else {
          console.log(`            = '${channel}' registered ${totalOccurrences}× (no dedupe needed)`);
        }
      }
    }
    // v2.5.x patch: inject require('../proxy-runner') at the top of dist/main.js
    // because 2.5.x removed the proxy-runner hook that 2.2.x relied on.
    // proxy-runner.js is a standalone Electron-app entry that:
    //   1. Waits for app.whenReady()
    //   2. Loads dist/proxy
    //   3. Calls startProxy()
    //   4. Writes port to AGY_BROWSER_ACTIVE_PORT_FILE
    // Without this hook, the patched languageServer.js's startProxy() inside
    // startLanguageServer() is unreliable on 2.5.x (the IDE wizard flow may
    // bypass startAndMonitorLanguageServer entirely).
    if (rel === 'dist/main.js' && !content.includes("require('../proxy-runner')") && !content.includes('require("../proxy-runner")')) {
      // Find a safe insertion point: just after the strict mode + tsHelpers
      const lines = content.split('\n');
      // Insert after the "use strict" line (line 1)
      let insertAt = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('use strict')) { insertAt = i + 1; break; }
      }
      lines.splice(insertAt, 0, "// v2.5.x patch: start the proxy runner as a side-effect import.", "require('../proxy-runner');");
      content = lines.join('\n');
      console.log('            + injected require(\'../proxy-runner\') at line ' + (insertAt + 1));
    }
    // v2.5.x patch: wrap main_1.default.initialize() in try/catch.
    if (rel === 'dist/main.js') {
      const before = content;
      content = content.replace(
        /main_1\.default\.initialize\(\);/,
        'try { main_1.default.initialize(); } catch (e) { /* v2.5.x patch: electron-log already initialised by proxy-runner.js */ main_1.default.warn("[v2.5.x patch] electron-log initialize failed (non-fatal):", e); }',
      );
      if (content !== before) {
        console.log('            + wrapped main_1.default.initialize() in try/catch');
      }
    }
    // v2.5.x patch: skip the IDE install wizard.
    if (rel === 'dist/main.js') {
      const before = content;
      content = content.replace(
        /if \(!HEADLESS\) \{\s*await \(0, ideInstall_1\.maybeShowIdeInstallWizard\)\(storageManager\);\s*\}/,
        '/* v2.5.x patch: IDE wizard skipped (bypass on patched builds) */\n    if (false && !HEADLESS) {\n        await (0, ideInstall_1.maybeShowIdeInstallWizard)(storageManager);\n    }',
      );
      if (content !== before) {
        console.log('            + skipped maybeShowIdeInstallWizard');
      }
    }
    // v2.5.x patch: wrap registerIpcHandlers in try/catch with logging
    // to identify the cause of the IDE window not opening.
    if (rel === 'dist/main.js') {
      const before = content;
      content = content.replace(
        /\(0, ipcHandlers_1\.registerIpcHandlers\)\(storageManager\);/,
        'console.log("[v2.5.x patch] before-registerIpcHandlers"); try { (0, ipcHandlers_1.registerIpcHandlers)(storageManager); console.log("[v2.5.x patch] after-registerIpcHandlers"); } catch (e) { console.error("[v2.5.x patch] registerIpcHandlers FAILED:", e && e.message); throw e; }',
      );
      if (content !== before) {
        console.log('            + wrapped registerIpcHandlers with debug logging');
      }
    }
    // v2.5.x patch: disable GPU acceleration to prevent black screen on Windows.
    // Electron's GPU compositing frequently produces a fully black window on
    // certain Windows/GPU driver combinations.  Calling disableHardwareAcceleration()
    // before the app is ready forces software rendering and eliminates the issue.
    if (rel === 'dist/main.js') {
      const before = content;
      content = content.replace(
        /const gotTheLock = electron_1\.app\.requestSingleInstanceLock\(\);/,
        [
          '// v2.5.x patch: disable GPU acceleration to prevent black screen on Windows',
          'electron_1.app.disableHardwareAcceleration();',
          "electron_1.app.commandLine.appendSwitch('disable-gpu');",
          "electron_1.app.commandLine.appendSwitch('disable-gpu-compositing');",
          'const gotTheLock = electron_1.app.requestSingleInstanceLock();',
        ].join('\n'),
      );
      if (content !== before) {
        console.log('            + disabled GPU acceleration (black screen fix)');
      }
    }
    // v2.5.x patch: deduplicate 'storage:fetch-models' IPC handler.
    // The patched dist/ipcHandlers.js registers this handler TWICE
    // (once via registerModelHandlers + once via registerStorageHandlers).
    // Electron throws "Attempted to register a second handler for
    // 'storage:fetch-models'" which crashes whenReady BEFORE the IDE
    // window can open. Strip every duplicate registration.
    if (rel === 'dist/ipcHandlers.js') {
      const before = content;
      let dupCount = 0;
      content = content.replace(
        /ipcMain\.handle\(\s*['"]storage:fetch-models['"]\s*,[\s\S]*?\);/g,
        (match) => {
          dupCount++;
          if (dupCount === 1) return match;
          return '/* v2.5.x patch: removed duplicate storage:fetch-models registration */';
        },
      );
      if (content !== before) {
        console.log('            + stripped ' + (dupCount - 1) + ' duplicate \'storage:fetch-models\' registration(s)');
      }
    }
    if (rel === 'dist/languageServer.js') {
      content = removeLanguageServerProxyStartup(content);
      console.log('            + removed duplicate language-server proxy startup');
    }
    if (rel === 'dist/preload.js') {
      content = removeSandboxedPreloadLocalImports(content);
      content = addIdeBridgeToPreload(content);
      content = addUpdaterStateBridgeToPreload(content);
      console.log('            + embedded sandbox-safe preload helpers and 2.5.1 bridges');
    }
    fs.writeFileSync(dst, content);
    const size = fs.statSync(dst).size;
    owBytes += size;
    owCount++;
    console.log(`            ~ ${rel} (${size} B)`);
  }
  console.log(`            sub-total: ${owCount} files, ${owBytes} B`);

  // Step 4: add NEW root-level files (proxy-runner.js)
  console.log(`[patch_2_3] step 4/4 — add ${NEW_ROOT_FILES.length} new root file(s)`);
  let nrBytes = 0;
  let nrCount = 0;
  for (const rel of NEW_ROOT_FILES) {
    const src = path.join(repoDir, rel);
    const dst = path.join(buildDir, rel);
    if (!fs.existsSync(src)) {
      die(`required root file missing: ${src}`);
    }
    ensureDir(path.dirname(dst));
    let content = fs.readFileSync(src, 'utf8');
    // v2.5.x patch: strip log.initialize({ preload: true }) from proxy-runner.js.
    // The main process (dist/main.js) also calls log.initialize() in its
    // whenReady callback. electron-log throws on the second call, which
    // breaks whenReady and prevents the IDE window from opening. We just
    // configure the file transport here and let main.js do the initialize.
    if (rel === 'proxy-runner.js') {
      content = stripPreloadLogInitialization(content);
      console.log('            + stripped log.initialize() from proxy-runner.js');
    }
    fs.writeFileSync(dst, content);
    const size = fs.statSync(dst).size;
    nrBytes += size;
    nrCount++;
    console.log(`            + ${rel} (${size} B)`);
  }
  console.log(`            sub-total: ${nrCount} files, ${nrBytes} B`);

  // Step 5: stage MITM files into app.asar.unpacked/ so proxy-runner.js
  // can spawn the MITM HTTPS forwarder on Antigravity startup.
  console.log(`[patch_2_3] step 5/6 — stage ${UNPACKED_LAYOUT.length} MITM files into app.asar.unpacked/`);
  assertMitmSourcesExist(repoDir);
  const staged = stageUnpackedFiles(buildDir, repoDir);
  for (const file of staged.staged) {
    console.log(`            + app.asar.unpacked/${file.relativePath} (${file.size} B)`);
  }
  console.log(`            sub-total: ${staged.staged.length} files, ${staged.totalBytes} B`);

  // Step 6: repack
  // @electron/asar@4.2.0 does NOT honour the `*.unpacked` convention
  // automatically. We move `app.asar.unpacked/` to its final destination
  // NEXT TO asarOut BEFORE createPackage, so the packer never sees those
  // files. After repack we validate that the asar is clean and that the
  // unpacked folder landed where expected.
  // ponytail: write to temp then rename — avoids EBUSY when AV/indexer holds a read lock on asarOut
  const asarTmp = asarOut + '.tmp';
  // Pre-create the asar-out directory if it doesn't exist yet so the
  // move-aside target is valid (moveUnpackedAside renames across the
  // build/asar-out boundary).
  fs.mkdirSync(path.dirname(asarOut), { recursive: true });
  const finalUnpacked = moveUnpackedAside(buildDir, asarOut);
  if (finalUnpacked) {
    console.log(`            > moved app.asar.unpacked/ next to ${path.basename(asarOut)}`);
  }
  try {
    await asar.createPackage(buildDir, asarTmp);
    validateAsarInventory(asarTmp, manifest, asar);
    assertAsarExcludesUnpacked(asarTmp, UNPACKED_LAYOUT, asar);
    // ponytail: copyFileSync uses Windows CopyFile API which can overwrite
    // read-locked files (AV/indexer) where rename/unlink cannot
    fs.copyFileSync(asarTmp, asarOut);
    try { fs.unlinkSync(asarTmp); } catch (_) {}
    console.log(`[patch_2_3] candidate validated: ${manifest.length} required JavaScript files present`);
    console.log('            + asar confirmed free of MITM unpacked paths');
    if (finalUnpacked) {
      assertUnpackedDeployed(asarOut, UNPACKED_LAYOUT);
      console.log(`            + app.asar.unpacked/mitm deployed next to ${path.basename(asarOut)}`);
    }
  } catch (err) {
    try { fs.unlinkSync(asarTmp); } catch (_) {}
    die(`asar.createPackage failed: ${err.stack || err.message}`, 3);
  }

  const inSize = fs.statSync(asarIn).size;
  const outSize = fs.statSync(asarOut).size;
  const delta = outSize - inSize;
  const grandTotal = totalBytes + owBytes + nrBytes + staged.totalBytes;
  console.log(`[patch_2_3] done — ${asarOut}`);
  console.log(`            in:  ${inSize} B`);
  console.log(`            out: ${outSize} B (+${delta} B)`);
  console.log(`            patched: ${filesAdded + owCount + nrCount} files (~${grandTotal} B of source)`);
  // v2.5.x patch is larger than v2.2.x because it replaces 5 large files
  // (preload.js alone is ~75 KB). Expect ~500 KB growth.
  //
  // Note: @electron/asar's createPackage() does NOT apply LZ4 compression,
  // while Electron's official packaging tool does. So our repacked asar is
  // typically ~10x larger than the original (the content is identical, just
  // uncompressed). Electron loads both formats transparently.
  //
  // v2.5.x original (compressed): ~2.1 MB
  // v2.5.x patched (uncompressed): ~21 MB
  // The "growth" here is purely the missing LZ4 layer, not new content.
  if (delta > 50 * 1024 * 1024) {
    console.log(`[patch_2_3] NOTE: output grew by ${(delta / 1024 / 1024).toFixed(1)} MB.`);
    console.log('            Most of this growth is the missing LZ4 compression layer,');
    console.log('            not new content. v2.5.x patch adds ~400 KB of JS source.');
  }
}

if (require.main === module) {
  main().catch((err) => die(err.stack || err.message));
}

module.exports = { buildPatchManifest };