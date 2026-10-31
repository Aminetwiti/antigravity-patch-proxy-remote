# Antigravity 2.3.1 black-screen patch correction

**Date:** 2026-07-22

## Problem

After applying the 2.3.x patch to Antigravity 2.3.1, Electron opens a window whose document finishes loading but whose React root remains empty.

Runtime CDP evidence identifies the failure chain:

1. `dist/preload.js` attempts to load `./proxy/idGenerator`.
2. `dist/proxy/idGenerator.js` is absent from the installed `app.asar`.
3. Electron aborts the sandboxed preload.
4. The preload never exposes `window.nativeStorage`.
5. The 2.3.1 renderer throws `No native storage bridge found during initialization`.
6. `#root` remains empty and the user sees a black or grey screen.

A secondary confirmed defect starts the proxy twice. The injected `proxy-runner.js` listens on port 50999, while the replacement `languageServer.js` calls `startProxy()` again, receives `EADDRINUSE`, and falls back to 51000. The patched binary still targets 50999.

## Goals

- Ensure every JavaScript module required by the injected preload and proxy is included in the patched ASAR.
- Fail the patch operation before installation if required build artifacts are absent.
- Validate the completed ASAR before replacing the installed archive.
- Start exactly one proxy instance on the expected port.
- Preserve the native storage bridge required by the Antigravity 2.3.1 renderer.
- Repair the existing local Antigravity 2.3.1 installation from its pre-patch backup.
- Verify the repaired application through runtime evidence rather than process startup alone.

## Non-goals

- Refactor the large preload or proxy modules.
- Redesign the Custom Models UI.
- Change provider translation behavior.
- Add support for a new Antigravity release family.
- Relax TLS or Electron sandbox security.

## Chosen approach

The 2.3.x patcher will package the complete compiled `dist/proxy/` JavaScript tree, not only the two imports implicated in the current crash. It will preserve paths relative to the repository `dist/` directory, including `dist/proxy/translators/`.

This is preferred over copying only `idGenerator.js` and `errorClassifier.js` because the proxy has additional direct and transitive dependencies. Packaging the complete compiled tree matches the patcher's stated architecture and prevents the next missing-module failure.

Inlining the two preload helpers is rejected because it duplicates logic and does not make the rest of the proxy bundle complete.

## Components and changes

### 1. Build artifact discovery

The patcher will derive its module list from the compiled output needed by the 2.3.x compatibility layer. It will recursively enumerate JavaScript files under `dist/proxy/` and include the existing top-level support modules required by the injected main, preload, IPC, and proxy code.

The patcher will not copy declaration files, source maps, tests, or TypeScript sources into the ASAR.

Before modifying an extracted archive, it will assert the presence of at least:

- `dist/proxy.js`
- `dist/proxy/idGenerator.js`
- `dist/proxy/errorClassifier.js`
- the translator JavaScript files expected by the registry
- the replacement compatibility files already required by the patcher

A missing artifact will produce an actionable error instructing the operator to run the project build.

### 2. Structure-preserving copy

Each compiled file will be copied to the same relative path in the extracted ASAR. Parent directories will be created recursively.

For example:

```text
repository/dist/proxy/idGenerator.js
    -> extracted-asar/dist/proxy/idGenerator.js

repository/dist/proxy/translators/openai.js
    -> extracted-asar/dist/proxy/translators/openai.js
```

The operation will not flatten module paths.

### 3. Post-repack validation

After creating the candidate ASAR, but before replacing the installed archive, the patcher will reopen the candidate with `@electron/asar` and inspect its inventory.

Validation will require the critical modules and every JavaScript file selected during artifact discovery. Any omission will abort installation and retain the currently installed ASAR.

The patcher will report the missing relative paths. A successful message is allowed only after validation passes.

### 4. Single proxy ownership

The 2.3.x runtime will have one explicit owner for proxy startup. The injected standalone proxy runner will remain the owner because the patched language-server binary targets the fixed local proxy port 50999.

The replacement `languageServer.js` used for 2.3.x will therefore not start a second proxy. It will consume the already-established proxy endpoint instead of invoking `startProxy()` and selecting a fallback port.

Startup must fail visibly if the owned proxy cannot bind to the required endpoint. Silently changing to 51000 is invalid for this patch family because the binary target remains 50999.

### 5. Installation repair

The local installation will be rebuilt from the known pre-2.3.1 backup rather than layering another patch over the incomplete ASAR.

The repair sequence is:

1. Build the repository.
2. Confirm the backup archive exists and is readable.
3. Preserve the currently installed broken archive as a diagnostic backup.
4. Use the original pre-patch archive as patch input.
5. Build and validate a candidate ASAR.
6. Replace the installed ASAR only after validation succeeds.
7. Restart Antigravity.

Any operation that replaces the installed archive must retain a rollback path.

## Error handling and safety

- No installed file is replaced before candidate validation succeeds.
- Missing compilation artifacts abort before ASAR mutation.
- Missing backup aborts automatic repair rather than treating the broken ASAR as an original.
- A proxy bind failure is surfaced instead of selecting a port inconsistent with the binary patch.
- Runtime verification failures are reported as failures; process existence alone is not success.
- Existing unrelated working-tree modifications are preserved.

## Testing

### Automated tests

Tests will cover:

1. Recursive discovery includes nested translator JavaScript files.
2. Discovery excludes source maps and declaration files.
3. Structure-preserving copy places modules at their expected ASAR paths.
4. Missing `idGenerator.js` or `errorClassifier.js` fails with an actionable message.
5. Post-repack validation rejects an incomplete candidate.
6. Post-repack validation accepts a complete candidate.
7. The 2.3.x patched language-server startup path does not create a second proxy.

Where the current patcher is difficult to import because it executes immediately, the smallest pure helpers required for discovery and validation may be extracted into a testable module. This extraction is limited to the patching concern and will not refactor unrelated runtime code.

### Static verification

After building and patching, inspect the candidate ASAR and confirm at least:

```text
/dist/proxy.js
/dist/proxy/idGenerator.js
/dist/proxy/errorClassifier.js
/dist/proxy/translators/openai.js
/dist/proxy/translators/anthropic.js
```

Inspect patched startup code and confirm only one proxy-start path remains.

### Runtime verification

After repairing and launching Antigravity 2.3.1, CDP verification must show:

- no `Unable to load preload script` error;
- no `module not found: ./proxy/idGenerator` error;
- `typeof window.nativeStorage !== "undefined"`;
- `document.querySelector('#root')` has rendered descendants;
- visible renderer text or UI elements are present;
- no `No native storage bridge found during initialization` exception.

Network/process verification must show:

- one expected proxy listener on port 50999;
- no fallback proxy listener on 51000 created by the same startup;
- the language server remains operational;
- custom-model API paths continue responding.

## Success criteria

The correction is complete only when:

1. automated tests pass;
2. TypeScript/build checks pass;
3. the patched ASAR contains the full selected proxy JavaScript tree;
4. the preload loads without a missing-module error;
5. the native storage bridge exists;
6. the Antigravity renderer mounts and the black screen disappears;
7. only one proxy is started on the endpoint targeted by the patched binary;
8. rollback backups remain available.
