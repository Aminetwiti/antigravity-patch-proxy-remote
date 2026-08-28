#!/usr/bin/env node
/**
 * scripts/diag/fix-model-validator.cjs
 * One-off patch: relax the model-name validator in the deployed
 * dist/schemaValidator.js so it also accepts the "models_" prefix
 * produced by modelLoader.js's deterministic id generation.
 *
 * After the custom_models.json migration to the "providers" schema,
 * modelLoader.js generates names like:
 *   `models/MODEL_PLACEHOLDER_M{provider}_{modelId}`  (intended)
 * Then immediately runs `.replace(/[^a-zA-Z0-9_-]/g, '_')` which
 * converts the `/` into `_`, producing:
 *   `models_MODEL_PLACEHOLDER_M{provider}_{modelId}`
 * The schemaValidator then rejects this with "must start with models/"
 * because the `/` was stripped, and the name also does not contain `/`.
 * Result: every custom model is silently skipped.
 *
 * The minimal fix is to teach the validator that "models_..." is also a
 * valid custom-model name. We do this in-place on the deployed asar
 * (faster than a full patch_2_3 rebuild for this one-line validator tweak).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const AG_INSTALL = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity';
const ASAR = path.join(AG_INSTALL, 'resources', 'app.asar');
const TARGET = 'dist\\schemaValidator.js';

// 1. Extract just this one file
const STAGING = path.join(os.tmpdir(), `schema-validator-fix-${Date.now()}`);
fs.mkdirSync(STAGING, { recursive: true });
console.log('[1/4] extracting', TARGET, '→', STAGING);
asar.extractFile(ASAR, TARGET); // returns Buffer

const extractedPath = path.join(STAGING, TARGET.replace(/\\/g, '/'));
fs.mkdirSync(path.dirname(extractedPath), { recursive: true });

// asar.extractFile returns a Buffer; write it to disk for editing
const buf = asar.extractFile(ASAR, TARGET);
fs.writeFileSync(extractedPath, buf);

let src = fs.readFileSync(extractedPath, 'utf8');

// 2. Patch the validator: accept models_ prefix too
const BEFORE = /if \(!name\.startsWith\('models\/'\) && !name\.includes\('\/'\)\) \{[\s\S]*?return \{ valid: false, error: 'Model name must start with "models\/"' \};\s*\}/;
const m = src.match(BEFORE);
if (!m) {
  console.error('PATTERN NOT FOUND in schemaValidator.js — aborting');
  process.exit(1);
}
const OLD = m[0];

// Accept either `models/...` (legacy) or `models_...` (new generated format).
// Also drop the misleading "must start with models/" error message.
const NEW = "if (!name.startsWith('models/') && !name.startsWith('models_') && !name.includes('/')) {\n        return { valid: false, error: 'Model name must start with \"models/\" or \"models_\"' };\n    }";
src = src.replace(OLD, NEW);
fs.writeFileSync(extractedPath, src);
console.log('[2/4] patched dist/schemaValidator.js');

// 3. Repack in-place (asar only needs the changed file).
//    Easiest path: full extract → modify → repack.
const fullExtract = path.join(os.tmpdir(), `asar-repack-${Date.now()}`);
fs.mkdirSync(fullExtract, { recursive: true });
console.log('[3/4] full extract → modify → repack');
asar.extractAll(ASAR, fullExtract);

// overwrite the patched file in the staging
const stagedTarget = path.join(fullExtract, TARGET);
fs.mkdirSync(path.dirname(stagedTarget), { recursive: true });
fs.copyFileSync(extractedPath, stagedTarget);

// backup the live asar
const backup = ASAR + '.pre-validator-fix-' + Date.now() + '.bak';
fs.copyFileSync(ASAR, backup);
console.log('  backed up live asar →', backup);

// repack to a temp file first so we can atomically swap it in place.
const tmpAsar = ASAR + '.new';
asar.createPackage(fullExtract, tmpAsar);
fs.unlinkSync(ASAR);
fs.renameSync(tmpAsar, ASAR);
console.log('[4/4] repack →', ASAR);
console.log('new asar size:', fs.statSync(ASAR).size, 'B');

// cleanup
try { fs.rmSync(STAGING, { recursive: true, force: true }); } catch {}
try { fs.rmSync(fullExtract, { recursive: true, force: true }); } catch {}
console.log('done.');
