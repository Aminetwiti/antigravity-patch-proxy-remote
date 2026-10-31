import { describe, expect, it } from 'vitest';

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
  const source = `function startLanguageServer(port, csrf, headless) {
    return new Promise(async (resolve, reject) => {
        let proxyPort;
        try {
            electron_log_1.default.info('[LS] before startProxy');
            proxyPort = await (0, proxy_1.startProxy)();
            electron_log_1.default.info('[LS] after startProxy, port: ' + proxyPort);
        }
        catch (err) {
            electron_log_1.default.error('[LS] startProxy failed:', err);
            console.error('[LanguageServer] Failed to start local proxy:', err);
        }
        const apiServerUrl = proxyPort ? \`http://localhost:\${proxyPort}\` : 'https://generativelanguage.googleapis.com';
    });
}`;

  it('defaults to port 51074 when AG_PROXY_PORT is unset and removes the second startProxy call', () => {
    const once = removeLanguageServerProxyStartup(source);
    expect(once).toContain('const proxyPort = 51074;');
    expect(once).not.toContain('proxy_1.startProxy');
    expect(once).toContain('2.3.x patch: proxy is owned by proxy-runner.js on port 51074');
    expect(removeLanguageServerProxyStartup(once)).toBe(once);
  });

  it('uses AG_PROXY_PORT when set and is idempotent', () => {
    const orig = process.env.AG_PROXY_PORT;
    process.env.AG_PROXY_PORT = '51999';
    try {
      const once = removeLanguageServerProxyStartup(source);
      expect(once).toContain('const proxyPort = 51999;');
      expect(once).not.toContain('proxy_1.startProxy');
      expect(once).toContain('2.3.x patch: proxy is owned by proxy-runner.js on port 51999');
      expect(removeLanguageServerProxyStartup(once)).toBe(once);
    } finally {
      process.env.AG_PROXY_PORT = orig;
    }
  });

  it('fails clearly when upstream source shape changes', () => {
    expect(() => removeLanguageServerProxyStartup('function unrelated() {}')).toThrow(
      'Unable to remove language-server proxy startup: expected startProxy block was not found.',
    );
  });
});
