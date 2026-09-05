const PRELOAD_LOG_MARKER = '// 2.3.x patch: electron-log is initialized by dist/main.js';

function stripPreloadLogInitialization(source) {
  if (source.includes(PRELOAD_LOG_MARKER)) return source;
  const replaced = source.replace(
    /^[ \t]*log\.initialize\(\{\s*preload:\s*true\s*\}\);[ \t]*$/m,
    PRELOAD_LOG_MARKER,
  );
  if (replaced === source) {
    throw new Error(
      'Unable to strip electron-log preload initialization: expected call was not found.',
    );
  }
  return replaced;
}

function removeLanguageServerProxyStartup(source) {
  const proxyPort = process.env.AG_PROXY_PORT || '51074';
  const marker = `// 2.3.x patch: proxy is owned by proxy-runner.js on port ${proxyPort}`;
  if (source.includes(marker)) return source;

  const start = source.indexOf('        let proxyPort;');
  const endMarker = "        const apiServerUrl = proxyPort ? `http://localhost:${proxyPort}` : 'https://generativelanguage.googleapis.com';";
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || !source.slice(start, end).includes('proxy_1.startProxy')) {
    throw new Error(
      'Unable to remove language-server proxy startup: expected startProxy block was not found.',
    );
  }

  const replacement = `        ${marker}\n        const proxyPort = ${proxyPort};\n`;
  return source.slice(0, start) + replacement + source.slice(end);
}

const SANDBOXED_PRELOAD_MARKER = '// 2.3.x patch: sandbox-safe local helpers';

const SANDBOXED_PRELOAD_HELPERS = `${SANDBOXED_PRELOAD_MARKER}
function generateModelPlaceholderId(model) {
  const input = \`${'${model.provider}-${model.apiUrl}-${model.externalModelName}-${model.displayName || model.name || \'custom-model\'}'}\`.toLowerCase();
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash &= hash;
  }
  return \`MODEL_PLACEHOLDER_M${'${400 + (Math.abs(hash) % 200)}'}\`;
}
function toSlug(model) {
  const provider = (model.provider || 'custom').toLowerCase();
  const input = \`${'${provider}-${model.apiUrl}-${model.externalModelName || model.name}'}\`
    .replace(/^models\\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return \`custom-${'${input}'}\`;
}
function classifyError(status, errorObj, responseBody, provider) {
  let bodyJson = null;
  try { bodyJson = responseBody ? JSON.parse(responseBody) : null; } catch (_) {}
  const bodyText = responseBody ? responseBody.toLowerCase() : '';
  const errorMsg = errorObj && errorObj.message ? String(errorObj.message).toLowerCase() : '';
  const errorCode = typeof errorObj === 'string' ? errorObj.toUpperCase() : errorObj && errorObj.code ? String(errorObj.code).toUpperCase() : '';
  const result = (errorType, title, message, suggestions, retryable, severity, actionUrl) => ({ errorType, title, message, suggestions, retryable, severity, ...(actionUrl ? { actionUrl } : {}) });
  if (status === 402 || bodyText.includes('billing_error') || bodyText.includes('insufficient tokens') || bodyText.includes('insufficient credits') || bodyText.includes('insufficient_quota') || bodyText.includes('quota exceeded') || bodyText.includes('credit limit') || (bodyJson && bodyJson.error && (bodyJson.error.type === 'billing_error' || bodyJson.error.code === 'insufficient_quota'))) {
    const urls = { openai: 'https://platform.openai.com/billing', anthropic: 'https://console.anthropic.com/settings/billing', openrouter: 'https://openrouter.ai/credits', mistral: 'https://console.mistral.ai/billing/', groq: 'https://console.groq.com/billing', deepseek: 'https://platform.deepseek.com/top_up' };
    return result('billing', 'Insufficient Credits', 'The model provider returned a billing or quota error (402/insufficient tokens).', ['Check your provider billing dashboard to ensure you have active credits.', 'Verify if a usage limit set on your API key has been exceeded.', 'Consider switching to a different model or provider.'], false, 'error', urls[String(provider || '').toLowerCase()]);
  }
  if (status === 401 || bodyText.includes('invalid_api_key') || bodyText.includes('authentication failed') || (status !== 403 && bodyText.includes('unauthorized')) || bodyText.includes('incorrect api key') || bodyText.includes('invalid api key') || (status !== 403 && errorMsg.includes('unauthorized')) || (bodyJson && bodyJson.error && bodyJson.error.code === 'invalid_api_key')) return result('auth', 'Authentication Failed', 'The API key or credentials provided are invalid (401 Unauthorized).', ['Open Custom Models Settings and verify your API key for this model.', 'Ensure the key has not expired, been deleted, or restricted.', 'Make sure you did not copy extra spaces or prefix/suffix characters.'], false, 'error');
  if (status === 403 || bodyText.includes('permission_denied') || bodyText.includes('forbidden') || bodyText.includes('not allowed') || bodyText.includes('access_denied') || errorMsg.includes('forbidden')) return result('forbidden', 'Access Denied', 'Access to the model or resource was denied by the provider (403 Forbidden).', ['Check if your API key has permissions/access to this specific model.', 'Verify if this model is in a restricted region or tier.', "Ensure your IP address is not blocked by the provider's firewall."], false, 'error');
  if (status === 429 || bodyText.includes('rate_limit_exceeded') || bodyText.includes('too_many_requests') || bodyText.includes('requests per minute') || bodyText.includes('tokens per minute') || bodyText.includes('rate limit')) return result('rate_limit', 'Rate Limited', 'The provider rate limit has been exceeded (429 Too Many Requests).', ['Wait a moment before retrying the operation.', 'Reduce request frequency or context size if sending large payloads.', 'Upgrade your provider tier to increase rate limits.'], true, 'warning');
  if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN' || errorMsg.includes('dns resolution failed') || errorMsg.includes('getaddrinfo') || errorMsg.includes('enotfound')) return result('dns', 'DNS Resolution Failed', 'Could not resolve the host address of the API endpoint.', ['Check your internet connection and active DNS servers.', 'Verify the API URL is typed correctly in Custom Models.', 'If behind a corporate VPN or proxy, verify it is properly configured.'], false, 'error');
  if (status === 504 || errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT' || errorMsg.includes('timeout') || errorMsg.includes('timed out')) return result('timeout', 'Request Timeout', 'The request to the model provider timed out.', ['The provider server might be overloaded or slow. Try again in a moment.', 'Increase the request timeout setting in the custom model configuration.', 'Reduce the size of the conversation or prompt being sent.'], true, 'warning');
  if (errorCode === 'ECONNREFUSED' || errorCode === 'ECONNRESET' || errorCode === 'EHOSTUNREACH' || errorCode === 'ENETUNREACH' || errorMsg.includes('connrefused') || errorMsg.includes('connect econn') || errorMsg.includes('connection refused') || errorMsg.includes('connection reset') || errorMsg.includes('network')) return result('network', 'Network Connection Failed', 'Could not establish a connection to the API server.', ["Verify if the provider's API server is running (especially for local providers like Ollama/LM Studio).", 'Check that the port and host address are correct.', 'Ensure firewall or antivirus software is not blocking the connection.'], true, 'error');
  if (status && status >= 500 && status < 600) return result('server', 'Provider Server Error', \`The upstream server encountered an error (HTTP ${'${status}'}).\`, ["Try again later or check the model provider's service status page.", 'If using a custom or local server, check its log output for details.', "Contact the model provider's support if this error persists."], true, 'error');
  return result('unknown', 'Unexpected Error', status ? \`Request failed with status code HTTP ${'${status}'}.\` : \`An unexpected request error occurred: ${'${errorMsg || errorCode || \'Unknown error\'}'}\`, ['Check the application logs for a full stack trace or debugging information.', 'Check your Custom Models configuration settings.', 'Retry the request or try a different model.'], false, 'error');
}
`;

function removeSandboxedPreloadLocalImports(source) {
  if (source.includes(SANDBOXED_PRELOAD_MARKER) || !/require\(["']\.\/proxy\//.test(source)) return source;
  let patched = source
    .replace(/^const idGenerator_1 = require\(["']\.\/proxy\/idGenerator["']\);\r?\n/m, '')
    .replace(/^const errorClassifier_1 = require\(["']\.\/proxy\/errorClassifier["']\);\r?\n/m, '')
    .replace(/\(0, idGenerator_1\.generateModelPlaceholderId\)\(/g, 'generateModelPlaceholderId(')
    .replace(/idGenerator_1\.generateModelPlaceholderId\(/g, 'generateModelPlaceholderId(')
    .replace(/\(0, idGenerator_1\.toSlug\)\(/g, 'toSlug(')
    .replace(/idGenerator_1\.toSlug\(/g, 'toSlug(')
    .replace(/\(0, errorClassifier_1\.classifyError\)\(/g, 'classifyError(')
    .replace(/errorClassifier_1\.classifyError\(/g, 'classifyError(');
  if (patched === source || /require\(["']\.\/proxy\//.test(patched)) {
    throw new Error('Unable to make preload sandbox-safe: expected local proxy imports were not removed.');
  }
  const strictEnd = patched.indexOf('\n', patched.indexOf('"use strict"'));
  patched = patched.slice(0, strictEnd + 1) + SANDBOXED_PRELOAD_HELPERS + patched.slice(strictEnd + 1);
  return patched;
}

function addIdeBridgeToPreload(source) {
  if (source.includes("exposeInMainWorld('ide', ideAPI)")) return source;
  const anchor = "electron_1.contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);";
  if (!source.includes(anchor)) {
    throw new Error('Unable to add 2.3.1 IDE bridge: electronNative exposure was not found.');
  }
  const bridge = "const ideAPI = { isInstalled: () => electron_1.ipcRenderer.invoke('ide:is-installed') };\n" +
    "electron_1.contextBridge.exposeInMainWorld('ide', ideAPI);";
  return source.replace(anchor, `${anchor}\n${bridge}`);
}

function addUpdaterStateBridgeToPreload(source) {
  if (source.includes("getState: () => electron_1.ipcRenderer.invoke('updater:get-state')")) return source;
  const anchor = "    checkForUpdates: () => electron_1.ipcRenderer.invoke('updater:check-for-updates'),";
  if (!source.includes(anchor)) {
    throw new Error('Unable to add updater state bridge: checkForUpdates was not found.');
  }
  return source.replace(
    anchor,
    `${anchor}\n    getState: () => electron_1.ipcRenderer.invoke('updater:get-state'),`,
  );
}

module.exports = { stripPreloadLogInitialization, removeLanguageServerProxyStartup, removeSandboxedPreloadLocalImports, addIdeBridgeToPreload, addUpdaterStateBridgeToPreload };
