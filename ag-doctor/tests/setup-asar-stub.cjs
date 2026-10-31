// Custom test setup: install a fallback factory for *all* modules that
// validate-asar.ts pulls via `require()`. We need this because the SUT is
// CommonJS and uses `require('@electron/asar')`, not an ESM `import`, so
// vitest's `vi.mock(...)` factory hook does not apply to it. Instead we
// patch Node's require cache directly so any subsequent `require()` call
// returns the same spy-bearing object.

const Module = require('module');

// Allow tests to do `require('@electron/asar/foo')` and receive the same
// spies used in the tests. We register the stub on the resolver so vitest's
// transform does not trip on it.
const electronAsarPath = require.resolve('@electron/asar');
const electronAsarReal = require('@electron/asar');

require.cache[electronAsarPath] = {
  id: electronAsarPath,
  filename: electronAsarPath,
  loaded: true,
  exports: {
    ...electronAsarReal,
    listPackage: (...args) => (global.__hoistedAsarSpy__?.listPackage || electronAsarReal.listPackage)(...args),
    extractFile: (...args) => (global.__hoistedAsarSpy__?.extractFile || electronAsarReal.extractFile)(...args),
  },
  children: [],
  paths: [],
};

const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  // Make vitest aware that @electron/asar is bundled so it does not try to
  // re-evaluate it (a re-eval would clear the cache entry above).
  if (request === '@electron/asar' || request.startsWith('@electron/asar/')) {
    return electronAsarPath;
  }
  return _origResolve.call(this, request, parent, ...rest);
};
