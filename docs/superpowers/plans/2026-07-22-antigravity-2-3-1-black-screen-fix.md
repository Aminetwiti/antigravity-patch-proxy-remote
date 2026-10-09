# Antigravity 2.3.1 Black-Screen Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Antigravity 2.3.x patch package all required proxy modules, validate the candidate ASAR transactionally, start one proxy on port 50999, and repair the local 2.3.1 installation so its renderer mounts normally.

**Architecture:** Extract small CommonJS helpers from the procedural patcher for recursive JavaScript artifact discovery, structure-preserving copy, ASAR inventory validation, and deterministic runtime-source mutation. Keep `scripts/patch_2_3.js` as the CLI entry point, but gate execution with `require.main === module`; validate the candidate before replacing any installed archive. The standalone runner remains the sole 2.3.x proxy owner because the binary target is fixed to 50999, while the injected language-server source is mutated to consume that port without calling `startProxy()` again.

**Tech Stack:** Node.js CommonJS, `@electron/asar`, TypeScript build output, Vitest 4, Electron CDP diagnostics, Windows PowerShell/batch deployment.

## Global Constraints

- Package the complete compiled `dist/proxy/` JavaScript tree, preserving paths relative to repository `dist/`.
- Do not package declaration files, source maps, tests, or TypeScript sources.
- Require `dist/proxy.js`, `dist/proxy/idGenerator.js`, `dist/proxy/errorClassifier.js`, expected translator JavaScript files, and all replacement compatibility files before patching.
- Validate the candidate ASAR before replacing the installed archive.
- Keep exactly one proxy owner on port `50999`; silently falling back to `51000` is invalid for Antigravity 2.3.x.
- Preserve the native storage bridge expected by the Antigravity 2.3.1 renderer.
- Repair from the known pre-patch backup, not by layering changes onto the incomplete installed archive.
- Preserve unrelated working-tree modifications and all rollback backups.
- Do not refactor provider translation, Custom Models UI, TLS policy, or unrelated runtime code.

---

## File Structure

- Create `scripts/lib/patch-2-3-artifacts.js`: pure filesystem and ASAR-inventory helpers used by the patcher and tests.
- Create `scripts/lib/patch-2-3-source.js`: pure source-to-source mutations for the 2.3.x runtime compatibility layer.
- Create `tests/scripts/patch-2-3-artifacts.test.js`: artifact discovery, copy, and ASAR validation tests.
- Create `tests/scripts/patch-2-3-source.test.js`: source mutation and idempotence tests.
- Modify `scripts/patch_2_3.js`: consume helpers, validate inputs and candidate, and avoid installing invalid archives.
- Modify `scripts/patch-version.js` only if its invocation currently replaces the installed archive before `patch_2_3.js` validation; preserve its CLI contract.
- Use existing `scripts/diag/cdp-renderer-dump.cjs` for runtime verification; do not alter it unless verification reveals missing diagnostics.

### Task 1: Add recursive proxy artifact discovery

**Files:**
- Create: `scripts/lib/patch-2-3-artifacts.js`
- Create: `tests/scripts/patch-2-3-artifacts.test.js`

**Interfaces:**
- Consumes: Node `fs`, `path`.
- Produces: `discoverJavaScriptFiles(rootDir, fsImpl = fs): string[]` returning normalized forward-slash relative paths sorted lexicographically; `assertRequiredArtifacts(repoDir, relativePaths, fsImpl = fs): void`.

- [ ] **Step 1: Write the failing discovery tests**

```js
const { describe, expect, it } = require('vitest');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
} = require('../../scripts/lib/patch-2-3-artifacts');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'patch-2-3-artifacts-'));
}

function write(root, relativePath, content = '') {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('discoverJavaScriptFiles', () => {
  it('finds nested JavaScript files and excludes maps, declarations, and TypeScript', () => {
    const root = tempDir();
    write(root, 'idGenerator.js');
    write(root, 'errorClassifier.js');
    write(root, 'translators/openai.js');
    write(root, 'translators/openai.js.map');
    write(root, 'types.d.ts');
    write(root, 'source.ts');

    expect(discoverJavaScriptFiles(root)).toEqual([
      'errorClassifier.js',
      'idGenerator.js',
      'translators/openai.js',
    ]);
  });
});

describe('assertRequiredArtifacts', () => {
  it('reports every missing required build artifact', () => {
    const repoDir = tempDir();
    write(repoDir, 'dist/proxy.js');

    expect(() => assertRequiredArtifacts(repoDir, [
      'dist/proxy.js',
      'dist/proxy/idGenerator.js',
      'dist/proxy/errorClassifier.js',
    ])).toThrow(
      'Missing required build artifacts: dist/proxy/errorClassifier.js, dist/proxy/idGenerator.js. Run npm run build before patching.',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js
```

Expected: FAIL because `scripts/lib/patch-2-3-artifacts.js` does not exist.

- [ ] **Step 3: Implement discovery and preflight validation**

```js
const fs = require('fs');
const path = require('path');

function discoverJavaScriptFiles(rootDir, fsImpl = fs) {
  const discovered = [];

  function visit(currentDir, prefix) {
    const entries = fsImpl.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        discovered.push(relativePath);
      }
    }
  }

  visit(rootDir, '');
  return discovered.sort();
}

function assertRequiredArtifacts(repoDir, relativePaths, fsImpl = fs) {
  const missing = relativePaths
    .filter((relativePath) => !fsImpl.existsSync(path.join(repoDir, ...relativePath.split('/'))))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `Missing required build artifacts: ${missing.join(', ')}. Run npm run build before patching.`,
    );
  }
}

module.exports = { discoverJavaScriptFiles, assertRequiredArtifacts };
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the artifact discovery unit**

```bash
git add scripts/lib/patch-2-3-artifacts.js tests/scripts/patch-2-3-artifacts.test.js
git commit -m "test: define 2.3 patch artifact discovery"
```

### Task 2: Add structure-preserving copy and candidate inventory validation

**Files:**
- Modify: `scripts/lib/patch-2-3-artifacts.js`
- Modify: `tests/scripts/patch-2-3-artifacts.test.js`

**Interfaces:**
- Consumes: `discoverJavaScriptFiles` from Task 1; an ASAR implementation exposing `listPackage(archivePath): string[]`.
- Produces: `copyRelativeFiles(sourceRoot, destinationRoot, relativePaths, fsImpl = fs): void`; `validateAsarInventory(archivePath, requiredPaths, asarImpl): void`.

- [ ] **Step 1: Add failing copy and validation tests**

Append imports and tests:

```js
const {
  copyRelativeFiles,
  validateAsarInventory,
} = require('../../scripts/lib/patch-2-3-artifacts');

describe('copyRelativeFiles', () => {
  it('preserves nested paths', () => {
    const source = tempDir();
    const destination = tempDir();
    write(source, 'proxy/idGenerator.js', 'id');
    write(source, 'proxy/translators/openai.js', 'openai');

    copyRelativeFiles(source, destination, [
      'proxy/idGenerator.js',
      'proxy/translators/openai.js',
    ]);

    expect(fs.readFileSync(path.join(destination, 'proxy', 'idGenerator.js'), 'utf8')).toBe('id');
    expect(fs.readFileSync(path.join(destination, 'proxy', 'translators', 'openai.js'), 'utf8')).toBe('openai');
  });
});

describe('validateAsarInventory', () => {
  it('rejects a candidate missing selected files', () => {
    const asarImpl = { listPackage: () => ['/dist/proxy.js', '/dist/proxy/idGenerator.js'] };
    expect(() => validateAsarInventory('candidate.asar', [
      'dist/proxy.js',
      'dist/proxy/idGenerator.js',
      'dist/proxy/errorClassifier.js',
    ], asarImpl)).toThrow(
      'Candidate ASAR is incomplete; missing: /dist/proxy/errorClassifier.js',
    );
  });

  it('accepts a complete candidate inventory', () => {
    const asarImpl = {
      listPackage: () => [
        '/dist/proxy.js',
        '/dist/proxy/idGenerator.js',
        '/dist/proxy/errorClassifier.js',
      ],
    };
    expect(() => validateAsarInventory('candidate.asar', [
      'dist/proxy.js',
      'dist/proxy/idGenerator.js',
      'dist/proxy/errorClassifier.js',
    ], asarImpl)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js
```

Expected: FAIL because the two functions are undefined.

- [ ] **Step 3: Implement copy and validation**

Add:

```js
function copyRelativeFiles(sourceRoot, destinationRoot, relativePaths, fsImpl = fs) {
  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/');
    const source = path.join(sourceRoot, ...segments);
    const destination = path.join(destinationRoot, ...segments);
    fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
    fsImpl.copyFileSync(source, destination);
  }
}

function validateAsarInventory(archivePath, requiredPaths, asarImpl) {
  const inventory = new Set(asarImpl.listPackage(archivePath));
  const missing = requiredPaths
    .map((relativePath) => `/${relativePath.replaceAll('\\\\', '/')}`)
    .filter((relativePath) => !inventory.has(relativePath))
    .sort();
  if (missing.length > 0) {
    throw new Error(`Candidate ASAR is incomplete; missing: ${missing.join(', ')}`);
  }
}

module.exports = {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
  copyRelativeFiles,
  validateAsarInventory,
};
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit candidate-validation behavior**

```bash
git add scripts/lib/patch-2-3-artifacts.js tests/scripts/patch-2-3-artifacts.test.js
git commit -m "feat: validate 2.3 patch ASAR contents"
```

### Task 3: Define deterministic 2.3.x runtime-source mutations

**Files:**
- Create: `scripts/lib/patch-2-3-source.js`
- Create: `tests/scripts/patch-2-3-source.test.js`

**Interfaces:**
- Consumes: JavaScript source strings.
- Produces: `stripPreloadLogInitialization(source): string`; `removeLanguageServerProxyStartup(source): string`. Both throw when their expected target is absent and the source is not already patched; both are idempotent.

- [ ] **Step 1: Write failing mutation tests**

```js
const { describe, expect, it } = require('vitest');
const {
  stripPreloadLogInitialization,
  removeLanguageServerProxyStartup,
} = require('../../scripts/lib/patch-2-3-source');

describe('stripPreloadLogInitialization', () => {
  it('removes electron-log preload initialization and is idempotent', () => {
    const source = "log.initialize({ preload: true });\napp.whenReady();\n";
    const once = stripPreloadLogInitialization(source);
    expect(once).not.toContain('log.initialize({ preload: true })');
    expect(stripPreloadLogInitialization(once)).toBe(once);
  });
});

describe('removeLanguageServerProxyStartup', () => {
  const source = `async function startLanguageServer(port, csrf, headless) {
    let proxyPort = 50999;
    try {
      proxyPort = await (0, proxy_1.startProxy)();
    } catch (error) {
      console.warn(error);
    }
    const args = ['--api_server_url', 'http://127.0.0.1:' + proxyPort];
  }`;

  it('keeps fixed port 50999 and removes the second startProxy call', () => {
    const once = removeLanguageServerProxyStartup(source);
    expect(once).toContain('let proxyPort = 50999;');
    expect(once).not.toContain('proxy_1.startProxy');
    expect(once).toContain('2.3.x patch: proxy is owned by proxy-runner.js on port 50999');
    expect(removeLanguageServerProxyStartup(once)).toBe(once);
  });

  it('fails clearly when upstream source shape changes', () => {
    expect(() => removeLanguageServerProxyStartup('function unrelated() {}')).toThrow(
      'Unable to remove language-server proxy startup: expected startProxy block was not found.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-source.test.js
```

Expected: FAIL because the source helper does not exist.

- [ ] **Step 3: Implement exact, idempotent mutations**

```js
const PRELOAD_LOG_MARKER = '// 2.3.x patch: electron-log is initialized by dist/main.js';
const LANGUAGE_SERVER_MARKER = '// 2.3.x patch: proxy is owned by proxy-runner.js on port 50999';

function stripPreloadLogInitialization(source) {
  if (source.includes(PRELOAD_LOG_MARKER)) return source;
  const replaced = source.replace(
    /^[ \t]*log\.initialize\(\{\s*preload:\s*true\s*\}\);[ \t]*$/m,
    PRELOAD_LOG_MARKER,
  );
  if (replaced === source) {
    throw new Error('Unable to strip electron-log preload initialization: expected call was not found.');
  }
  return replaced;
}

function removeLanguageServerProxyStartup(source) {
  if (source.includes(LANGUAGE_SERVER_MARKER)) return source;
  const pattern = /([ \t]*)try \{\r?\n\1[ \t]+(?:console\.log\([^\n]*\);\r?\n\1[ \t]+)?proxyPort = await \(0, proxy_1\.startProxy\)\(\);\r?\n\1\} catch \(error\) \{[\s\S]*?\r?\n\1\}/;
  const replaced = source.replace(pattern, `$1${LANGUAGE_SERVER_MARKER}`);
  if (replaced === source) {
    throw new Error(
      'Unable to remove language-server proxy startup: expected startProxy block was not found.',
    );
  }
  return replaced;
}

module.exports = { stripPreloadLogInitialization, removeLanguageServerProxyStartup };
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-source.test.js
```

Expected: 3 tests PASS.

- [ ] **Step 5: Verify the helper matches the current compiled source**

Run:

```bash
node -e "const fs=require('fs');const h=require('./scripts/lib/patch-2-3-source');const s=fs.readFileSync('./dist/languageServer.js','utf8');const o=h.removeLanguageServerProxyStartup(s);if(o.includes('proxy_1.startProxy'))process.exit(1);console.log('languageServer mutation matched')"
```

Expected: `languageServer mutation matched`.

- [ ] **Step 6: Commit source mutations**

```bash
git add scripts/lib/patch-2-3-source.js tests/scripts/patch-2-3-source.test.js
git commit -m "fix: enforce one proxy owner for 2.3 patches"
```

### Task 4: Integrate full proxy packaging and transactional validation into the patcher

**Files:**
- Modify: `scripts/patch_2_3.js:95-137,178-434`
- Test: `tests/scripts/patch-2-3-artifacts.test.js`
- Test: `tests/scripts/patch-2-3-source.test.js`

**Interfaces:**
- Consumes: all helpers from Tasks 1–3 and `@electron/asar`.
- Produces: unchanged CLI `node scripts/patch_2_3.js [asarIn] [buildDir] [asarOut]`; candidate ASAR validated before output installation; exported `buildPatchManifest(repoDir): string[]` for focused testing.

- [ ] **Step 1: Add a failing manifest test**

Append to `tests/scripts/patch-2-3-artifacts.test.js`:

```js
const { buildPatchManifest } = require('../../scripts/patch_2_3');

describe('buildPatchManifest', () => {
  it('includes the complete compiled proxy tree and critical modules', () => {
    const manifest = buildPatchManifest(path.resolve(__dirname, '../..'));
    expect(manifest).toContain('dist/proxy.js');
    expect(manifest).toContain('dist/proxy/idGenerator.js');
    expect(manifest).toContain('dist/proxy/errorClassifier.js');
    expect(manifest).toContain('dist/proxy/translators/openai.js');
    expect(manifest).toContain('dist/proxy/translators/anthropic.js');
    expect(manifest.some((entry) => entry.endsWith('.js.map'))).toBe(false);
    expect(manifest.some((entry) => entry.endsWith('.d.ts'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify RED without executing the CLI**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js
```

Expected: FAIL because importing `scripts/patch_2_3.js` currently executes `main()` or because `buildPatchManifest` is undefined.

- [ ] **Step 3: Make the patcher import-safe and build the manifest**

At the top, import helpers:

```js
const {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
  copyRelativeFiles,
  validateAsarInventory,
} = require('./lib/patch-2-3-artifacts');
const {
  stripPreloadLogInitialization,
  removeLanguageServerProxyStartup,
} = require('./lib/patch-2-3-source');
```

Define:

```js
const CRITICAL_PATCH_ARTIFACTS = [
  'dist/proxy.js',
  'dist/proxy/idGenerator.js',
  'dist/proxy/errorClassifier.js',
  'dist/proxy/translators/openai.js',
  'dist/proxy/translators/anthropic.js',
  ...OVERWRITE_FILES,
  ...NEW_ROOT_FILES,
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
    ...OVERWRITE_FILES,
    ...NEW_ROOT_FILES,
  ])].sort();
}
```

Replace unconditional CLI execution with:

```js
if (require.main === module) {
  main().catch((error) => die(error && (error.stack || error.message) || error));
}

module.exports = { buildPatchManifest };
```

- [ ] **Step 4: Replace the fixed proxy-module copy loop**

Inside `main()`, before extraction:

```js
const manifest = buildPatchManifest(REPO_DIR);
assertRequiredArtifacts(REPO_DIR, CRITICAL_PATCH_ARTIFACTS);
assertRequiredArtifacts(REPO_DIR, manifest);
```

After extraction, copy compiled compatibility artifacts with preserved paths:

```js
const distManifest = manifest.filter((relativePath) => relativePath.startsWith('dist/'));
copyRelativeFiles(REPO_DIR, BUILD_DIR, distManifest);
```

Keep source mutations after copy:

```js
const languageServerPath = path.join(BUILD_DIR, 'dist', 'languageServer.js');
fs.writeFileSync(
  languageServerPath,
  removeLanguageServerProxyStartup(fs.readFileSync(languageServerPath, 'utf8')),
);

const proxyRunnerPath = path.join(BUILD_DIR, 'proxy-runner.js');
fs.writeFileSync(
  proxyRunnerPath,
  stripPreloadLogInitialization(fs.readFileSync(proxyRunnerPath, 'utf8')),
);
```

Remove the old duplicated `MISSING_JS_MODULES` copy behavior only after the manifest-driven copy covers every old entry.

- [ ] **Step 5: Validate the candidate immediately after repack**

Directly after `await asar.createPackage(BUILD_DIR, ASAR_OUT);`:

```js
validateAsarInventory(ASAR_OUT, manifest, asar);
console.log(`[5/5] Candidate validated: ${manifest.length} required JavaScript files present`);
```

Do not print the final success banner before this call returns.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/scripts/patch-2-3-artifacts.test.js tests/scripts/patch-2-3-source.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Build and run the entire suite**

Run:

```bash
npm run build
npm test
npm run lint
```

Expected: TypeScript build succeeds, all Vitest tests pass, and `tsc --noEmit` succeeds.

- [ ] **Step 8: Commit patcher integration**

```bash
git add scripts/patch_2_3.js scripts/lib/patch-2-3-artifacts.js scripts/lib/patch-2-3-source.js tests/scripts/patch-2-3-artifacts.test.js tests/scripts/patch-2-3-source.test.js
git commit -m "fix: package complete proxy tree in 2.3 patch"
```

### Task 5: Validate a patched ASAR without touching the installation

**Files:**
- Modify only if a discovered defect requires it: `scripts/patch_2_3.js`
- Use: `%LOCALAPPDATA%\\Programs\\Antigravity/resources/app.asar.pre-2.3.1.bak`
- Create temporary output outside the installation: `$TEMP/antigravity-2.3.1-patch-validation/`

**Interfaces:**
- Consumes: validated patcher CLI from Task 4 and the existing original backup.
- Produces: a candidate ASAR whose inventory and source mutations are independently inspected.

- [ ] **Step 1: Confirm the original backup and build artifacts exist**

Run in Git Bash:

```bash
test -f "$LOCALAPPDATA/Programs/Antigravity/resources/app.asar.pre-2.3.1.bak" \
  && test -f "dist/proxy/idGenerator.js" \
  && test -f "dist/proxy/errorClassifier.js"
```

Expected: exit code 0.

- [ ] **Step 2: Build a candidate in a temporary directory**

Run:

```bash
TMP_PATCH_DIR="$TEMP/antigravity-2.3.1-patch-validation"
rm -rf "$TMP_PATCH_DIR"
mkdir -p "$TMP_PATCH_DIR"
node scripts/patch_2_3.js \
  "$LOCALAPPDATA/Programs/Antigravity/resources/app.asar.pre-2.3.1.bak" \
  "$TMP_PATCH_DIR/extracted" \
  "$TMP_PATCH_DIR/app.asar"
```

Expected: patcher reports candidate validation success and exits 0.

- [ ] **Step 3: Inspect critical inventory independently**

Run:

```bash
node -e "const a=require('@electron/asar');const p=process.env.TEMP+'/antigravity-2.3.1-patch-validation/app.asar';const l=new Set(a.listPackage(p));for(const f of ['/dist/proxy.js','/dist/proxy/idGenerator.js','/dist/proxy/errorClassifier.js','/dist/proxy/translators/openai.js','/dist/proxy/translators/anthropic.js']){if(!l.has(f))throw new Error('missing '+f)}console.log('critical ASAR inventory complete')"
```

Expected: `critical ASAR inventory complete`.

- [ ] **Step 4: Inspect runtime ownership independently**

Run:

```bash
node -e "const a=require('@electron/asar');const p=process.env.TEMP+'/antigravity-2.3.1-patch-validation/app.asar';const ls=a.extractFile(p,'dist/languageServer.js').toString();const runner=a.extractFile(p,'proxy-runner.js').toString();if(ls.includes('proxy_1.startProxy'))throw new Error('languageServer still starts proxy');if(!runner.includes('proxyMod.startProxy'))throw new Error('proxy-runner no longer owns proxy');console.log('single proxy ownership verified')"
```

Expected: `single proxy ownership verified`.

- [ ] **Step 5: Run the doctor against available status commands**

Run:

```bash
node ag-doctor/bin/ag-doctor.js check
node ag-doctor/bin/ag-doctor.js doctor
```

Expected: commands complete; record any pre-existing environment warnings separately from candidate-ASAR failures.

- [ ] **Step 6: Commit only if validation required a code correction**

If no correction was needed, do not create an empty commit. If a correction was needed:

```bash
git add scripts/patch_2_3.js scripts/lib tests/scripts
git commit -m "fix: harden 2.3 candidate validation"
```

### Task 6: Repair the local Antigravity 2.3.1 installation transactionally

**Files:**
- Installed archive: `%LOCALAPPDATA%\\Programs\\Antigravity/resources/app.asar`
- Original backup: `%LOCALAPPDATA%\\Programs\\Antigravity/resources/app.asar.pre-2.3.1.bak`
- Validated candidate: `$TEMP/antigravity-2.3.1-patch-validation/app.asar`
- Diagnostic backup to create: `app.asar.black-screen-2026-07-22.bak`

**Interfaces:**
- Consumes: the independently validated candidate from Task 5.
- Produces: repaired installed ASAR with both original and broken-state rollback files retained.

- [ ] **Step 1: Stop Antigravity before replacement**

Run from the Claude prompt so output is captured:

```text
! taskkill /IM Antigravity.exe /F
```

Expected: Antigravity processes stop. If no process exists, continue and record that fact.

- [ ] **Step 2: Preserve the currently broken installed archive**

Run in Git Bash:

```bash
RESOURCES="$LOCALAPPDATA/Programs/Antigravity/resources"
test -f "$RESOURCES/app.asar.pre-2.3.1.bak"
test ! -e "$RESOURCES/app.asar.black-screen-2026-07-22.bak"
cp "$RESOURCES/app.asar" "$RESOURCES/app.asar.black-screen-2026-07-22.bak"
```

Expected: both `app.asar.pre-2.3.1.bak` and the new black-screen backup exist.

- [ ] **Step 3: Atomically install the validated candidate**

Run:

```bash
RESOURCES="$LOCALAPPDATA/Programs/Antigravity/resources"
CANDIDATE="$TEMP/antigravity-2.3.1-patch-validation/app.asar"
cp "$CANDIDATE" "$RESOURCES/app.asar.new"
mv -f "$RESOURCES/app.asar.new" "$RESOURCES/app.asar"
```

Expected: replacement succeeds without deleting either backup.

- [ ] **Step 4: Revalidate the installed archive**

Run:

```bash
node -e "const a=require('@electron/asar');const p=process.env.LOCALAPPDATA+'/Programs/Antigravity/resources/app.asar';const l=new Set(a.listPackage(p));for(const f of ['/dist/proxy/idGenerator.js','/dist/proxy/errorClassifier.js']){if(!l.has(f))throw new Error('installed ASAR missing '+f)}console.log('installed ASAR validated')"
```

Expected: `installed ASAR validated`.

- [ ] **Step 5: Launch Antigravity**

Run from the Claude prompt:

```text
! "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe"
```

Expected: the process starts and opens its window.

### Task 7: Verify the runtime fix before completion

**Files:**
- Use: `scripts/diag/cdp-renderer-dump.cjs`
- Read: `%APPDATA%/Antigravity/logs/main.log`
- Read: `%APPDATA%/Antigravity/logs/language_server.log`

**Interfaces:**
- Consumes: running repaired Antigravity instance.
- Produces: evidence that preload, renderer, bridge, proxy, and language server all work.

- [ ] **Step 1: Inspect the renderer through CDP**

Run:

```bash
node scripts/diag/cdp-renderer-dump.cjs
```

Expected:

- no `Unable to load preload script`;
- no `module not found: ./proxy/idGenerator`;
- no `No native storage bridge found during initialization`;
- `readyState` is `complete`;
- `nativeStorage` is not `undefined`;
- body text or body HTML shows rendered descendants under `#root`.

- [ ] **Step 2: Verify the React root is mounted explicitly**

Run:

```bash
node -e "const fs=require('fs'),http=require('http');const p=fs.readFileSync(process.env.APPDATA+'/Antigravity/DevToolsActivePort','utf8').split(/\r?\n/)[0];http.get('http://127.0.0.1:'+p+'/json/list',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{const pages=JSON.parse(b);const page=pages.find(x=>x.type==='page');console.log(page&&page.url);});});"
```

Expected: the active page URL is the Antigravity local HTTPS UI. Use the CDP dump from Step 1 as the authoritative DOM assertion.

- [ ] **Step 3: Verify one proxy listener**

Run from the Claude prompt:

```text
! powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -In 50999,51000 | Select-Object LocalAddress,LocalPort,OwningProcess,State"
```

Expected: one listener on `50999`; no listener on `51000` created by this Antigravity startup.

- [ ] **Step 4: Check startup logs for regressions**

Run from the Claude prompt:

```text
! powershell -NoProfile -Command "Select-String -Path \"$env:APPDATA\Antigravity\logs\main.log\" -Pattern 'Unable to load preload|module not found|No native storage bridge|EADDRINUSE|render-process-gone|did-fail-load' -Context 2,4 | Select-Object -Last 60"
```

Expected: no new occurrences after the repaired startup. Historical entries must be distinguished by timestamp.

- [ ] **Step 5: Re-run repository verification**

Run:

```bash
npm run build
npm run lint
npm test
```

Expected: all commands pass.

- [ ] **Step 6: Record the verified fix**

If a changelog entry is appropriate under the project’s existing convention, add a concise entry describing full proxy-tree packaging, candidate validation, and single proxy ownership. Then:

```bash
git add CHANGELOG.md
git commit -m "docs: record Antigravity 2.3.1 startup fix"
```

If the project convention does not require an entry, do not create an empty commit.
