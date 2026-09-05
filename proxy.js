"use strict";
// ─── Constants ─────────────────────────────────────────────────────────────
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProxyErrorEmitter = setProxyErrorEmitter;
exports.buildProxyErrorPayload = buildProxyErrorPayload;
exports.parseRetryAfter = parseRetryAfter;
exports.setupCustomModelsWatcher = setupCustomModelsWatcher;
exports.stopCustomModelsWatcher = stopCustomModelsWatcher;
exports.startProxy = startProxy;
exports.loadPersistedState = loadPersistedState;
exports.flushPersistedState = flushPersistedState;
exports.stopProxy = stopProxy;
exports.getProxyPort = getProxyPort;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const electron_log_1 = __importDefault(require("electron-log"));
const logger_1 = require("./logger");
function traceLog(...args) {
    // ponytail: keeps the 'app' import (and thus the electron require) out of
    // proxy.ts's module graph when tracing is disabled; upgrade path: replace
    // with a real log-level switch if verbose tracing is ever needed.
    if (process.env.AG_PROXY_TRACE === '1') {
        // eslint-disable-next-line no-console
        console.log('[proxy-trace]', ...args);
    }
}
const metrics_1 = require("./metrics");
const crypto_1 = require("crypto");
const constants_1 = require("./constants");
const proxyLog = (0, logger_1.createLogger)('Proxy');
/** 16-char hex request id used for tracing. Cheap, sortable by time. */
function newTraceId() {
    return (0, crypto_1.randomBytes)(8).toString('hex');
}
let server = null;
let proxyPort = 0;
const constants_2 = require("./constants");
// ─── Module Imports ───────────────────────────────────────────────────────
// Shared cross-turn state
const shared_1 = require("./proxy/shared");
// Provider translator registry (auto-discovers translators from proxy/translators/)
const registry = __importStar(require("./proxy/registry"));
// Protobuf injection (extracted from proxy.ts)
const protoInjector_1 = require("./proxy/protoInjector");
// Custom model loading (extracted from proxy.ts)
const modelLoader_1 = require("./proxy/modelLoader");
const modelStore_1 = require("./services/modelStore");
const modelHealthChecker_1 = require("./proxy/modelHealthChecker");
const customModelStore_1 = require("./customModelStore");
const errorClassifier_1 = require("./proxy/errorClassifier");
const retryStrategy_1 = require("./proxy/retryStrategy");
const circuitBreaker_1 = require("./proxy/circuitBreaker");
const idleTimeout_1 = require("./proxy/idleTimeout");
const agentPool_1 = require("./proxy/agentPool");
const emptyStream_1 = require("./proxy/emptyStream");
const retryBudget_1 = require("./proxy/retryBudget");
const diagnostics_1 = require("./proxy/diagnostics");
const persistedState_1 = require("./proxy/persistedState");
const metricsRoute_1 = require("./proxy/metricsRoute");
const circuitBreaker_2 = require("./proxy/circuitBreaker");
function generateGracefulMarkdown(diagnostic) {
    let md = `🚨 **${diagnostic.title}**\n\n${diagnostic.message}\n\n`;
    if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
        md += `**Suggested Actions:**\n`;
        diagnostic.suggestions.forEach(s => md += `- ${s}\n`);
    }
    if (diagnostic.actionUrl) {
        md += `\n🔗 [Manage Billing & Credits](${diagnostic.actionUrl})`;
    }
    md += `\n\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
    return md;
}
// URL construction for custom model requests (extracted from proxy.ts)
const urlBuilder_1 = require("./proxy/urlBuilder");
// ID generation is now strictly in idGenerator.ts
const idGenerator_1 = require("./proxy/idGenerator");
const effortExpander_1 = require("./proxy/effortExpander");
// DNS resolution bypasses the poisoned hosts file (extracted from proxy.ts)
const dnsResolver_1 = require("./proxy/dnsResolver");
// Smart model routing and rate-limit tracking
const modelRouter_1 = require("./proxy/modelRouter");
const contextTrimmer_1 = require("./proxy/contextTrimmer");
const modelHealthChecker_2 = require("./proxy/modelHealthChecker");
const recentModelsStore_1 = require("./proxy/recentModelsStore");
// MCP relay bridge (mobile companion): lists MCP servers configured on the
// desktop session and forwards tool calls to the local MCP runtime.
const mcpRelay_1 = require("./proxy/mcpRelay");
let proxyErrorEmitter = null;
function setProxyErrorEmitter(fn) {
    proxyErrorEmitter = fn;
}
function emitProxyError(p) {
    // 1) In-process fan-out (Electron main → renderer via setProxyErrorEmitter).
    if (proxyErrorEmitter)
        proxyErrorEmitter(p);
    // 2) Mirror to stderr as a single-line JSON payload so the proxy child
    //    spawned by ag-doctor-ui's ProxyManager reaches the same handler.
    //    Pure JSON, no whitespace, so a `line.startsWith('{')` filter in the
    //    consumer can route the structured payload while leaving human logs
    //    alone. Safe to ignore if the host doesn't watch stderr.
    try {
        process.stderr.write(JSON.stringify(p) + '\n');
    }
    catch {
        // stdio might be closed in unit tests — swallow.
    }
}
// Build a payload from a raw error triple + provider. Used at the 6 sites
// in proxy.ts where classifyError() is called and the diagnostic is
// considered "notable" (i.e. surfaced to the user via the response). We
// keep this single function so the emission contract is identical across
// all call sites.
function buildProxyErrorPayload(traceId, status, bodyOrErr, provider, fallbackMessage) {
    const rawText = typeof bodyOrErr === 'string'
        ? bodyOrErr
        : bodyOrErr instanceof Error
            ? bodyOrErr.message
            : fallbackMessage ?? '';
    const diagnostic = (0, errorClassifier_1.classifyError)(status, bodyOrErr, typeof bodyOrErr === 'string' ? bodyOrErr : undefined, provider);
    return {
        traceId,
        provider: provider ?? 'unknown',
        status,
        errorType: diagnostic.errorType,
        rawError: rawText,
        title: diagnostic.title,
        message: diagnostic.message,
        suggestions: diagnostic.suggestions ?? [],
        actionUrl: diagnostic.actionUrl,
    };
}
// ─── Safe Response Helpers ─────────────────────────────────────────────────
const httpUtils_1 = require("./proxy/httpUtils");
const modelInjector_1 = require("./proxy/modelInjector");
// ─── Model Helpers ────────────────────────────────────────────────────────
// generateModelPlaceholderId and toSlug are now in ./proxy/idGenerator.ts (re-exported above)
// ─── Google Proxy ─────────────────────────────────────────────────────────
async function proxyToGoogle(req, res, reqBody) {
    const traceId = newTraceId();
    const isCloudCodeUrl = req.url.includes('v1internal') || req.url.includes('daily-cloudcode');
    const targetHost = isCloudCodeUrl ? constants_1.GOOGLE_HOSTS.CLOUD_CODE : constants_1.GOOGLE_HOSTS.GENERATIVE_LANGUAGE;
    const targetUrl = `https://${targetHost}`;
    const parsedUrl = new URL(req.url, targetUrl);
    const endTimer = (0, metrics_1.startTimer)('proxy_request_ms', { upstream: targetHost });
    proxyLog.debug('req', traceId, req.method, req.url, '→', targetHost);
    try {
        const realIp = await (0, dnsResolver_1.resolveGoogleIp)(targetHost);
        parsedUrl.hostname = realIp;
    }
    catch (e) {
        (0, metrics_1.inc)('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
        const ms = endTimer();
        proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
        electron_log_1.default.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
        if ((0, httpUtils_1.safeWriteHead)(res, 500, { 'Content-Type': 'application/json' })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost, traceId } }));
        }
        return;
    }
    const headers = {
        ...req.headers,
    };
    headers['host'] = targetHost;
    delete headers['connection'];
    delete headers['keep-alive'];
    const isGeneration = req.url.includes('generateContent') || req.url.includes('streamGenerateContent');
    const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;
    if (shouldBufferAndModify) {
        delete headers['accept-encoding'];
    }
    const options = {
        method: req.method,
        headers: headers,
        servername: targetHost,
    };
    // Guard flag to prevent ERR_HTTP_HEADERS_SENT when timeout and response race
    const safeHead = (status, headers) => (0, httpUtils_1.safeWriteHead)(res, status, headers);
    const proxyReq = https.request(parsedUrl, options, (proxyRes) => {
        proxyReq.setTimeout(constants_2.GOOGLE_PROXY_TIMEOUT_MS, () => {
            electron_log_1.default.error(`[Proxy] Google proxy request timed out after ${constants_2.GOOGLE_PROXY_TIMEOUT_MS / 1000}s`);
            proxyReq.destroy();
            if (safeHead(504, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'Google API request timed out' } }));
            }
        });
        if (shouldBufferAndModify) {
            const responseChunks = [];
            proxyRes.on('data', (chunk) => responseChunks.push(chunk));
            proxyRes.on('end', () => {
                if (res.headersSent || res.writableEnded) {
                    electron_log_1.default.debug('[Proxy] Skipping buffered modify: response already terminated');
                    return;
                }
                const fullResBody = Buffer.concat(responseChunks);
                let text;
                const encoding = proxyRes.headers['content-encoding'];
                if (encoding === 'gzip') {
                    try {
                        const zlib = require('zlib');
                        text = zlib.gunzipSync(fullResBody).toString('utf-8');
                    }
                    catch (e) {
                        electron_log_1.default.error('[Proxy] gunzipSync failed:', e);
                        if (safeHead(502, { 'Content-Type': 'application/json' })) {
                            (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: `Failed to decompress upstream response: ${e.message}` } }));
                        }
                        return;
                    }
                }
                else {
                    text = fullResBody.toString('utf-8');
                }
                electron_log_1.default.info(`[Proxy] Response for ${req.url} (status: ${proxyRes.statusCode}, encoding: ${encoding}, length: ${text.length})`);
                // P0-3: Response body content is NOT logged to disk. Only metadata.
                const proxyHost = req.headers.host || 'localhost';
                const proxyProto = proxyHost.endsWith('.googleapis.com') ? 'https:' : 'http:';
                text = text.replace(/https:(\/\/)daily-cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
                text = text.replace(/https:(\/\/)cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
                text = text.replace(/https:(\/\/)generativelanguage\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
                const modifiedHeaders = { ...proxyRes.headers };
                delete modifiedHeaders['content-encoding'];
                delete modifiedHeaders['transfer-encoding'];
                const modifiedBuffer = Buffer.from(text, 'utf-8');
                modifiedHeaders['content-length'] = String(modifiedBuffer.length);
                if ((0, httpUtils_1.safeWriteHead)(res, proxyRes.statusCode || 200, modifiedHeaders)) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuffer);
                }
            });
        }
        else {
            if (safeHead(proxyRes.statusCode || 200, proxyRes.headers)) {
                proxyRes.pipe(res);
            }
        }
    });
    proxyReq.on('error', (err) => {
        (0, metrics_1.inc)('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
        const ms = endTimer();
        proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
        electron_log_1.default.error('[Proxy] Google Forwarding Error:', err);
        if ((0, httpUtils_1.safeWriteHead)(res, 500, { 'Content-Type': 'application/json' })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'Proxy forwarding failed: ' + err.message, traceId } }));
        }
    });
    proxyReq.on('close', () => {
        const ms = endTimer();
        (0, metrics_1.observe)('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
        proxyLog.debug('Upstream request closed traceId=', traceId, 'after', ms, 'ms');
    });
    if (reqBody) {
        proxyReq.write(reqBody);
    }
    proxyReq.end();
}
// ─── File Data Resolver ────────────────────────────────────────────────────
async function resolveFileData(body, reqHeaders) {
    const contents = body.contents;
    if (!contents)
        return;
    const authHeader = (reqHeaders['authorization'] || reqHeaders['Authorization'] || '');
    for (const item of contents) {
        if (!item.parts)
            continue;
        for (let i = 0; i < item.parts.length; i++) {
            const p = item.parts[i];
            const fd = p.fileData;
            if (!fd?.fileUri)
                continue;
            if (fd.mimeType?.startsWith('image/'))
                continue;
            try {
                const uri = fd.fileUri;
                let fileContent = '';
                if (uri.startsWith('file://')) {
                    const fp = uri.replace('file://', '').replace(/\//g, path.sep);
                    try {
                        await fs.promises.access(fp);
                        fileContent = await fs.promises.readFile(fp, 'utf-8');
                    }
                    catch {
                        fileContent = '';
                    }
                }
                else if (authHeader && uri.startsWith('https://')) {
                    fileContent = await downloadFileContent(uri, authHeader);
                }
                if (fileContent) {
                    item.parts[i] = { text: '[File content]:\n\n' + fileContent };
                }
            }
            catch (e) {
                throw new Error(`[Proxy] File resolve failed: ${e.message}`);
            }
        }
    }
}
function downloadFileContent(url, authHeader) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        (u.protocol === 'https:' ? https : http).request({
            hostname: u.hostname, path: u.pathname + u.search,
            method: 'GET', headers: { 'Authorization': authHeader }, timeout: constants_2.FILE_DOWNLOAD_TIMEOUT_MS,
        }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error('HTTP ' + res.statusCode));
                return;
            }
            let d = '';
            let bytes = 0;
            res.on('data', (c) => {
                bytes += c.length;
                if (bytes > 10 * 1024 * 1024) {
                    reject(new Error('File too large'));
                    res.destroy();
                    return;
                }
                d += c.toString();
            });
            res.on('end', () => resolve(d));
        }).on('error', reject).end();
    });
}
/** Shared helper to record failure to both breaker and budget */
function recordModelFailure(model, errorType) {
    (0, circuitBreaker_1.recordFailure)(model, errorType);
    (0, retryBudget_1.getRetryBudget)().recordFailure(model);
}
/** Shared retry dispatcher — schedules a re-dispatch with a jittered delay. */
function scheduleRetry(ctx, retryCount, delayMs, logReason) {
    electron_log_1.default.warn(`[Proxy] ${logReason} for ${ctx.model.name}, retrying (${retryCount + 1}/${ctx.maxRetries})...`);
    setTimeout(() => handleCustomModelRequest(ctx.res, ctx.model, ctx.geminiBody, ctx.isStream, ctx.retryCount + 1), delayMs);
}
/** Helper to log detailed diagnostics for 401 Unauthorized errors */
function log401Diagnostic(model, finalUrlStr, apiRes) {
    const apiKeyInfo = model.apiKey && model.apiKey !== 'none'
        ? `<set, len=${model.apiKey.length > 50 ? '>50' : model.apiKey.length <= 20 ? '≤20' : '21-50'}>`
        : '<empty or none>';
    electron_log_1.default.error(`[Proxy] 401 Unauthorized from ${model.name} (${model.provider})`);
    electron_log_1.default.error(`[Proxy]   URL: ${finalUrlStr}`);
    electron_log_1.default.error(`[Proxy]   API key: ${apiKeyInfo}`);
    electron_log_1.default.error(`[Proxy]   Headers sent: ${Object.keys(registry.getProviderHeaders(model.provider, model.apiKey, model.extraHeaders)).join(', ')}`);
    electron_log_1.default.error(`[Proxy]   Possible causes:`);
    electron_log_1.default.error(`[Proxy]     - Missing or invalid API key (check custom_models.json)`);
    electron_log_1.default.error(`[Proxy]     - Wrong header name for this provider (e.g. 'Authorization' vs 'x-api-key')`);
    electron_log_1.default.error(`[Proxy]     - Expired or revoked token`);
    electron_log_1.default.error(`[Proxy]     - Account suspended or rate-limited`);
    electron_log_1.default.error(`[Proxy]     - Wrong endpoint URL (${finalUrlStr})`);
    electron_log_1.default.error(`[Proxy]   Upstream response: ${JSON.stringify(apiRes.headers).slice(0, 200)}`);
}
/** Upstream response error (mid-stream connection drop) — emits, ends, logs 401 context. */
function handleApiResError(err, apiRes, ctx, finalUrlStr) {
    const { model, res } = ctx;
    electron_log_1.default.error(`[Proxy] Upstream stream error for ${model.name}:`, err.message);
    const diagnostic = (0, errorClassifier_1.classifyError)(500, err, undefined, model.provider);
    emitProxyError(buildProxyErrorPayload(ctx.traceId, 500, err, model.provider));
    if ((0, httpUtils_1.safeWriteHead)(res, 500, {
        'Content-Type': 'application/json',
        'X-AG-Error-Type': diagnostic.errorType,
    })) {
        (0, httpUtils_1.safeEnd)(res, JSON.stringify({
            error: { message: 'Upstream connection error: ' + err.message },
            _agDiagnostic: diagnostic,
        }));
    }
    else if (!res.writableEnded) {
        (0, httpUtils_1.safeEnd)(res);
    }
    // P3: Log 401 errors with detailed diagnostic context to help users
    // understand why their custom endpoint rejected the request.
    // Common causes: missing API key, wrong header name, expired token,
    // wrong endpoint URL, account suspended.
    const status = apiRes.statusCode || 0;
    if (status === 401) {
        log401Diagnostic(model, finalUrlStr, apiRes);
    }
}
/** Stream response branch — SSE translation, idle/empty guards, error envelope. */
function handleStreamResponse(apiRes, request, ctx) {
    const { model, res, provider, traceId } = ctx;
    // Check for API errors BEFORE writing streaming headers
    if (apiRes.statusCode >= 400) {
        let errorBody = '';
        apiRes.on('data', (chunk) => errorBody += chunk.toString());
        apiRes.on('end', () => {
            electron_log_1.default.error(`[Proxy] Stream API error (${apiRes.statusCode}) for ${model.name}: ${errorBody.substring(0, 300)}`);
            const streamDiagnostic = (0, errorClassifier_1.classifyError)(apiRes.statusCode, null, errorBody, model.provider);
            emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode, errorBody, model.provider));
            // Trip the breaker on the first hard failure so subsequent
            // requests short-circuit instead of piling up against a stuck upstream.
            if (streamDiagnostic.errorType === 'server' ||
                streamDiagnostic.errorType === 'rate_limit' ||
                streamDiagnostic.errorType === 'timeout' ||
                streamDiagnostic.errorType === 'network') {
                recordModelFailure(model, streamDiagnostic.errorType);
                if (streamDiagnostic.errorType === 'rate_limit') {
                    (0, modelRouter_1.markProviderRateLimited)(model.apiUrl);
                }
            }
            if ((0, retryStrategy_1.shouldRetryStatus)(apiRes.statusCode, ctx.retryCount, ctx.maxRetries)) {
                const retryAfterMs = parseRetryAfter(apiRes.headers);
                const delay = (0, retryStrategy_1.computeRetryDelay)('rate-limit', ctx.retryCount, retryAfterMs);
                ctx.retry(ctx.retryCount, delay, `Stream error ${apiRes.statusCode} (rate-limit)`);
                return;
            }
            const diagnostic = streamDiagnostic;
            if (ctx.attemptFallback(diagnostic))
                return;
            if (diagnostic.errorType === 'billing' || diagnostic.errorType === 'auth' || diagnostic.errorType === 'forbidden') {
                const errResponse = {
                    response: {
                        candidates: [
                            {
                                content: { parts: [{ text: generateGracefulMarkdown(diagnostic) }], role: 'model' },
                                finishReason: 'STOP',
                                index: 0,
                            },
                        ],
                    },
                    traceId: '',
                    metadata: {},
                    _agDiagnostic: diagnostic,
                };
                if ((0, httpUtils_1.safeWriteHead)(res, 200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-AG-Error-Type': diagnostic.errorType,
                })) {
                    res.write('data: ' + JSON.stringify(errResponse) + '\n\n');
                    (0, httpUtils_1.safeEnd)(res);
                }
                return;
            }
            let responseJson = { error: { message: `Upstream error: ${errorBody}` } };
            try {
                responseJson = JSON.parse(errorBody);
            }
            catch {
                // not JSON
            }
            if (typeof responseJson === 'object' && responseJson !== null) {
                responseJson._agDiagnostic = diagnostic;
            }
            if ((0, httpUtils_1.safeWriteHead)(res, apiRes.statusCode, {
                'Content-Type': 'application/json',
                'X-AG-Error-Type': diagnostic.errorType,
            })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(responseJson));
            }
        });
        return;
    }
    if (apiRes.statusCode === 200) {
        // Any successful response proves the upstream is healthy again;
        // clear the breaker so subsequent requests don't short-circuit.
        (0, circuitBreaker_1.recordSuccess)(model);
    }
    if (!(0, httpUtils_1.safeWriteHead)(res, 200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })) {
        return;
    }
    // Phase 2: Per-chunk idle timeout guard. Vendor pattern from
    // `withIdleTimeout`'s stream wrapper. If no SSE chunk arrives for
    // STREAM_IDLE_TIMEOUT_MS, treat the upstream as stuck and abort.
    const idleGuard = new idleTimeout_1.IdleTimeoutGuard(apiRes, {
        idleTimeoutMs: constants_2.STREAM_IDLE_TIMEOUT_MS,
        label: model.name,
        onTimeout: (err) => {
            electron_log_1.default.warn(`[Proxy] ${err.message} — aborting request for ${model.name}`);
            recordModelFailure(model, 'timeout');
            try {
                request.destroy(err);
            }
            catch { /* already destroyed */ }
        },
    });
    // Phase 4: Empty-stream guard. Track raw chunks + SSE frames so we can
    // detect a 200 OK stream that contains no usable content (e.g. upstream
    // returns `[DONE]` immediately, or only keep-alive comments, or zero
    // non-empty chunks). Vendor pattern: "did we get something useful?" AND
    // gate from `vscode-unify-chat-provider`.
    const emptyGuard = new emptyStream_1.EmptyStreamGuard();
    let buffer = '';
    apiRes.on('data', (chunk) => {
        // Observe first, then forward. The guard splits SSE frames on
        // newlines so a frame that spans two chunks is still counted.
        emptyGuard.observe(chunk);
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            if (trimmed.startsWith('data: ')) {
                const dataStr = trimmed.substring(6).trim();
                if (dataStr === '[DONE]')
                    continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    const mapped = registry.translateStreamChunk(provider, parsed, model.name);
                    if (mapped) {
                        const cloudCodeResponse = {
                            response: { candidates: [mapped] },
                            traceId: '',
                            metadata: {},
                        };
                        res.write(`data: ${JSON.stringify(cloudCodeResponse)}\n\n`);
                    }
                }
                catch (err) {
                    // Partial/invalid JSON chunks are normal during streaming; debug-level only
                    electron_log_1.default.debug(`[Proxy] Stream chunk parse warning for ${model.name}:`, err.message);
                }
            }
        }
    });
    apiRes.on('end', () => {
        idleGuard.dispose();
        emptyGuard.observe(Buffer.from('')); // no-op, but tightens API
        // Phase 4: Detect empty streams BEFORE finalizing the response.
        // An empty stream is a 200 OK response with no SSE data frames.
        // We retry once (unless MAX_RETRIES is already exhausted) to give
        // flaky upstreams a second chance before surfacing an error.
        const verdict = emptyGuard.finalize({ statusCode: apiRes.statusCode ?? 0 });
        if (verdict.isEmpty && ctx.retryCount < ctx.maxRetries) {
            electron_log_1.default.warn(`[Proxy] Empty stream from ${model.name}: ${verdict.reason} ` +
                `(0 frames, ${verdict.bytesReceived}B) — retrying (${ctx.retryCount + 1}/${ctx.maxRetries}).`);
            recordModelFailure(model, 'empty_stream');
            ctx.retry(ctx.retryCount, (0, retryStrategy_1.computeRetryDelay)('stream-error', ctx.retryCount, 0), `Empty stream: ${verdict.reason}`);
            return;
        }
        if (verdict.isEmpty) {
            electron_log_1.default.warn(`[Proxy] Empty stream from ${model.name}: ${verdict.reason} ` +
                `(0 frames, ${verdict.bytesReceived}B) — max retries exhausted.`);
            // Final attempt exhausted: count it as a failure so the budget
            // can downgrade the model's trust on the next request.
            recordModelFailure(model, 'empty_stream');
        }
        if (buffer.trim().startsWith('data: ')) {
            const dataStr = buffer.trim().substring(6).trim();
            if (dataStr !== '[DONE]') {
                try {
                    const parsed = JSON.parse(dataStr);
                    const mapped = registry.translateStreamChunk(provider, parsed, model.name);
                    if (mapped) {
                        const cloudCodeResponse = {
                            response: { candidates: [mapped] },
                            traceId: '',
                            metadata: {},
                        };
                        res.write(`data: ${JSON.stringify(cloudCodeResponse)}\n\n`);
                    }
                }
                catch (e) {
                    electron_log_1.default.debug(`[Proxy] Stream buffer drain parse warning for ${model.name}:`, e.message);
                }
            }
        }
        const finalChunk = {
            response: {
                candidates: [
                    {
                        content: { parts: [], role: 'model' },
                        finishReason: 'STOP',
                        index: 0,
                    },
                ],
            },
            traceId: '',
            metadata: {},
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.end();
        const pId = model.name.includes('-') ? model.name.split('-')[0] : model.provider;
        void (0, customModelStore_1.recordProviderUsage)(pId);
    });
}
/** Non-stream response branch — JSON translate, retry on error status, graceful envelope. */
function handleNonStreamResponse(apiRes, ctx) {
    const { model, res, provider, traceId } = ctx;
    let body = '';
    apiRes.on('data', (chunk) => (body += chunk));
    apiRes.on('end', () => {
        // Retry if eligible based on status code
        if ((0, retryStrategy_1.shouldRetryStatus)(apiRes.statusCode, ctx.retryCount, ctx.maxRetries)) {
            const retryAfterMs = parseRetryAfter(apiRes.headers);
            const delay = (0, retryStrategy_1.computeRetryDelay)('rate-limit', ctx.retryCount, retryAfterMs);
            ctx.retry(ctx.retryCount, delay, `Upstream error status ${apiRes.statusCode}`);
            return;
        }
        if (apiRes.statusCode >= 400) {
            // P0-3: Only log status code and model name, NOT response body content
            electron_log_1.default.error(`[Proxy] API error (${apiRes.statusCode}) for ${model.name}`);
            const diagnostic = (0, errorClassifier_1.classifyError)(apiRes.statusCode, null, body, model.provider);
            emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode, body, model.provider));
            // Trip the breaker on hard failures so subsequent requests
            // short-circuit instead of piling up against a stuck upstream.
            if (diagnostic.errorType === 'server' ||
                diagnostic.errorType === 'rate_limit' ||
                diagnostic.errorType === 'timeout' ||
                diagnostic.errorType === 'network') {
                recordModelFailure(model, diagnostic.errorType);
            }
            if (ctx.attemptFallback(diagnostic))
                return;
            if (diagnostic.errorType === 'billing' || diagnostic.errorType === 'auth' || diagnostic.errorType === 'forbidden') {
                const errResponse = {
                    response: {
                        candidates: [
                            {
                                content: { parts: [{ text: generateGracefulMarkdown(diagnostic) }], role: 'model' },
                                finishReason: 'STOP',
                                index: 0,
                            },
                        ],
                    },
                    traceId: '',
                    metadata: {},
                    _agDiagnostic: diagnostic,
                };
                if ((0, httpUtils_1.safeWriteHead)(res, 200, {
                    'Content-Type': 'application/json',
                    'X-AG-Error-Type': diagnostic.errorType,
                })) {
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify(errResponse));
                }
                return;
            }
            let responseJson = { error: { message: `Upstream error: ${body}` } };
            try {
                responseJson = JSON.parse(body);
            }
            catch {
                // not JSON
            }
            if (typeof responseJson === 'object' && responseJson !== null) {
                responseJson._agDiagnostic = diagnostic;
            }
            if ((0, httpUtils_1.safeWriteHead)(res, apiRes.statusCode, {
                'Content-Type': 'application/json',
                'X-AG-Error-Type': diagnostic.errorType,
            })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(responseJson));
            }
            return;
        }
        try {
            const parsed = JSON.parse(body);
            const reasoning = parsed.choices?.[0]
                ?.message?.reasoning_content ||
                parsed.choices?.[0]
                    ?.message?.reasoning;
            if (reasoning) {
                const modelKey = (0, shared_1.getSessionModelKey)(model.name, ctx.geminiBody?.sessionId || ctx.geminiBody?.conversationId);
                shared_1.modelReasoningContent.set(modelKey, reasoning);
                if (modelKey !== model.name) {
                    shared_1.modelReasoningContent.set(model.name, reasoning);
                }
                (0, shared_1.touchStateTimestamp)(shared_1.stateTimestamps.reasoning, modelKey);
            }
            const providerForResponse = model.provider === 'custom' || model.provider === 'openrouter' ? 'openai' : model.provider;
            const mapped = registry.translateResponse(providerForResponse, parsed, model.name);
            const cloudCodeResponse = {
                response: mapped,
                traceId: '',
                metadata: {},
            };
            // Successful 2xx response — clear breaker for this model.
            (0, circuitBreaker_1.recordSuccess)(model);
            // P5-2: feed the per-model retry budget a success sample so the
            // model's trust score recovers after a hard stretch of failures.
            (0, retryBudget_1.getRetryBudget)().recordSuccess(model);
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(cloudCodeResponse));
            }
        }
        catch (e) {
            electron_log_1.default.error('[Proxy] Failed to map response:', e);
            if (ctx.retryCount < ctx.maxRetries) {
                ctx.retry(ctx.retryCount, (0, retryStrategy_1.computeRetryDelay)('server-error', ctx.retryCount, 0), 'Parse error');
                return;
            }
            const diagnostic = (0, errorClassifier_1.classifyError)(500, e, body, model.provider);
            if (ctx.attemptFallback(diagnostic))
                return;
            if ((0, httpUtils_1.safeWriteHead)(res, 500, {
                'Content-Type': 'application/json',
                'X-AG-Error-Type': diagnostic.errorType,
            })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                    error: { message: 'Failed to translate model response' },
                    _agDiagnostic: diagnostic,
                }));
            }
        }
    });
}
/** Request-level timeout — breaker + budget + retry or 504. */
function handleRequestTimeout(request, ctx) {
    const { model, res } = ctx;
    electron_log_1.default.error(`[Proxy] Request timeout (${(0, urlBuilder_1.resolveRequestTimeout)(model)}ms) for ${model.name}`);
    request.destroy();
    // Trip the breaker immediately on timeout — these are the worst offender
    // in retry storms (the request holds the proxy open for the full timeout).
    recordModelFailure(model, 'timeout');
    if (ctx.retryCount < ctx.maxRetries) {
        ctx.retry(ctx.retryCount, (0, retryStrategy_1.computeRetryDelay)('server-error', ctx.retryCount, 0), 'Timeout');
        return;
    }
    const diagnostic = (0, errorClassifier_1.classifyError)(504, 'ETIMEDOUT', undefined, model.provider);
    if (ctx.attemptFallback(diagnostic))
        return;
    if ((0, httpUtils_1.safeWriteHead)(res, 504, {
        'Content-Type': 'application/json',
        'X-AG-Error-Type': diagnostic.errorType,
    })) {
        (0, httpUtils_1.safeEnd)(res, JSON.stringify({
            error: { message: `Request timeout after ${(0, urlBuilder_1.resolveRequestTimeout)(model) / 1000}s` },
            _agDiagnostic: diagnostic,
        }));
    }
}
/** Request-level network error — breaker + budget + retry or 502 envelope. */
function handleRequestError(err, ctx) {
    const { model, res } = ctx;
    electron_log_1.default.error('[Proxy] Custom Model Request Error:', err);
    // Trip the breaker on network errors so the proxy stops hammering the
    // dead upstream. Use the error's code when present, default to 'network'.
    const code = err.code?.toUpperCase();
    const breakerType = code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ? 'timeout' :
        code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'dns' :
            'network';
    recordModelFailure(model, breakerType);
    if (ctx.retryCount < ctx.maxRetries) {
        ctx.retry(ctx.retryCount, (0, retryStrategy_1.computeRetryDelay)('network', ctx.retryCount, 0), 'Network error');
        return;
    }
    const diagnostic = (0, errorClassifier_1.classifyError)(undefined, err, undefined, model.provider);
    emitProxyError(buildProxyErrorPayload(ctx.traceId, undefined, err, model.provider));
    if (ctx.attemptFallback(diagnostic))
        return;
    if (ctx.isStream) {
        if (!res.headersSent && !res.writableEnded) {
            const errResponse = {
                response: {
                    candidates: [
                        {
                            content: { parts: [{ text: 'Network error: ' + err.message }], role: 'model' },
                            finishReason: 'STOP',
                            index: 0,
                        },
                    ],
                },
                traceId: '',
                metadata: {},
                _agDiagnostic: diagnostic,
            };
            (0, httpUtils_1.safeWriteHead)(res, 502, {
                'Content-Type': 'text/event-stream',
                'X-AG-Error-Type': diagnostic.errorType,
            });
            res.write('data: ' + JSON.stringify(errResponse) + '\n\n');
        }
        (0, httpUtils_1.safeEnd)(res);
    }
    else {
        if ((0, httpUtils_1.safeWriteHead)(res, 502, {
            'Content-Type': 'application/json',
            'X-AG-Error-Type': diagnostic.errorType,
        })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                error: { message: 'Custom model request failed: ' + err.message },
                _agDiagnostic: diagnostic,
            }));
        }
    }
}
// ─── Custom Model Request Handler ─────────────────────────────────────────
/**
 * Parses the Retry-After header from upstream responses (RFC 7231 §7.1.3).
 * Returns delay in milliseconds, or 0 if no valid header is present.
 */
function parseRetryAfter(headers) {
    const val = headers['retry-after'];
    if (!val)
        return 0;
    const raw = Array.isArray(val) ? val[0] : val;
    if (!raw)
        return 0;
    // Try delta-seconds (e.g. "120")
    const seconds = parseInt(raw.trim(), 10);
    if (!isNaN(seconds) && seconds >= 0) {
        return seconds * 1000;
    }
    // Try HTTP-date (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
        const delay = date.getTime() - Date.now();
        return delay > 0 ? delay : 0;
    }
    return 0;
}
function handleCustomModelRequest(res, model, rawGeminiBody, isStream, retryCount = 0, fallbackDepth = 0) {
    const geminiBody = (0, contextTrimmer_1.trimContextPayload)(rawGeminiBody);
    const traceId = geminiBody?.requestId || '';
    // P3-18: Configurable max retries per model (default 1, min 0, max 5).
    // Lowered from 3 to 1 to prevent retry storms saturating the proxy.
    // P5-2: Seed the per-model retry budget from the configured value. The
    // budget then scales that base according to observed trust — flaky models
    // get fewer retries, consistent models get more.
    const CONFIGURED_MAX_RETRIES = (0, urlBuilder_1.resolveMaxRetries)(model);
    const MAX_RETRIES = (0, retryBudget_1.getRetryBudget)().getMaxRetries(model, CONFIGURED_MAX_RETRIES || retryBudget_1.RETRY_BUDGET_BASE);
    const REQUEST_TIMEOUT_MS = (0, urlBuilder_1.resolveRequestTimeout)(model);
    // Circuit breaker: if this model just failed hard, short-circuit before
    // touching the upstream. This keeps the proxy responsive so the rest of
    // the model dropdown (and fetchAvailableModels) keeps working.
    const openBreaker = (0, circuitBreaker_1.getOpenBreaker)(model);
    if (openBreaker && retryCount === 0 && fallbackDepth === 0) {
        const cached = (0, errorClassifier_1.classifyError)(openBreaker.errorType === 'rate_limit' ? 429 : 500, openBreaker.errorType, undefined, model.provider);
        electron_log_1.default.warn(`[Proxy] Circuit OPEN for ${model.name} (${openBreaker.errorType}, tripped ${Math.round((Date.now() - openBreaker.trippedAt) / 1000)}s ago). Short-circuiting request.`);
        if (attemptFallback(cached)) {
            return;
        }
        const statusCode = openBreaker.errorType === 'rate_limit' ? 429 : 503;
        if ((0, httpUtils_1.safeWriteHead)(res, statusCode, {
            'Content-Type': 'application/json',
            'X-AG-Error-Type': cached.errorType,
            'X-AG-Circuit': 'open',
        })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                error: {
                    message: `Model ${model.name} is temporarily unavailable (${cached.title}). Retried shortly.`,
                },
                _agDiagnostic: cached,
            }));
        }
        return;
    }
    // Shared by both the open-breaker short-circuit path and the regular
    // upstream-error paths. It only picks a different model and re-dispatches.
    function attemptFallback(diagnostic) {
        if (fallbackDepth >= 2)
            return false;
        const isEligibleForFallback = diagnostic.errorType === 'rate_limit' ||
            diagnostic.errorType === 'server' ||
            diagnostic.errorType === 'network' ||
            diagnostic.errorType === 'billing' ||
            diagnostic.errorType === 'timeout';
        if (!isEligibleForFallback)
            return false;
        try {
            const allModels = (0, modelLoader_1.loadCustomModels)();
            // If a specific fallback model is configured on the model, prioritize it!
            let orderedModels = allModels;
            if (model.fallbackModel) {
                const preferred = allModels.filter(m => m.name === model.fallbackModel ||
                    m.displayName === model.fallbackModel ||
                    m.externalModelName === model.fallbackModel ||
                    m.name.endsWith(`/${model.fallbackModel}`));
                const rest = allModels.filter(m => !preferred.includes(m));
                orderedModels = [...preferred, ...rest];
            }
            // ponytail: skip same-provider on rate_limit — shared quota, fallback is a no-op
            const sameProviderRateLimit = diagnostic.errorType === 'rate_limit'
                ? new URL(model.apiUrl).hostname
                : null;
            for (const m of orderedModels) {
                if (m.name !== model.name && m.apiKey && !m.apiKey.startsWith('fallback:')) {
                    if (sameProviderRateLimit && new URL(m.apiUrl).hostname === sameProviderRateLimit) {
                        electron_log_1.default.warn(`[Proxy] Auto-fallback: skipping ${m.displayName || m.name} (same provider ${sameProviderRateLimit}, shared quota)`);
                        continue;
                    }
                    const fromName = model.displayName || model.name;
                    const toName = m.displayName || m.name;
                    electron_log_1.default.warn(`[Proxy] Auto-fallback: ${fromName} → ${toName} (reason: ${diagnostic.errorType} — ${diagnostic.title})`);
                    // L-1: Notify the user in the stream so the fallback is transparent.
                    // We send a brief markdown notice as the first SSE event before
                    // delegating to the fallback model handler.
                    if (isStream && !res.headersSent) {
                        if ((0, httpUtils_1.safeWriteHead)(res, 200, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            Connection: 'keep-alive',
                            'X-Accel-Buffering': 'no',
                            'X-AG-Fallback': 'true',
                        })) {
                            const noticeText = `> ⚡ **Smart Proxy Switch**\n> \`Provider Notice\`: \`${fromName}\` is temporarily rate-limited (${diagnostic.errorType}).\n> 🔄 **Rerouted to**: \`${toName}\` (Zero downtime, uninterrupted session)\n\n`;
                            const notice = {
                                response: {
                                    candidates: [{
                                            content: {
                                                parts: [{ text: noticeText }],
                                                role: 'model',
                                            },
                                            finishReason: 'STOP',
                                            index: 0,
                                        }],
                                },
                                traceId: '',
                                metadata: {},
                            };
                            res.write('data: ' + JSON.stringify(notice) + '\n\n');
                        }
                    }
                    handleCustomModelRequest(res, m, geminiBody, isStream, 0, fallbackDepth + 1);
                    return true;
                }
            }
        }
        catch (e) {
            electron_log_1.default.error('[Proxy] Auto-fallback exception:', e);
        }
        return false;
    }
    const provider = (0, urlBuilder_1.resolveProvider)(model);
    const cleanModelName = (0, urlBuilder_1.getBaseModelId)(model.externalModelName);
    const payload = registry.translateRequest(provider, geminiBody, cleanModelName, model.extraBody);
    const headers = registry.getProviderHeaders(provider, model.apiKey, model.extraHeaders);
    if (isStream && registry.supportsStreaming(provider)) {
        payload.stream = true;
    }
    const finalUrlStr = (0, urlBuilder_1.resolveCustomModelUrl)(model, isStream, (apiUrl, externalModelName, stream, translator) => registry.getProviderUrl(apiUrl, externalModelName, stream, translator));
    const url = new URL(finalUrlStr);
    // Phase 3: per-host connection pooling via the agent cache. This avoids
    // a fresh TLS handshake on every chat turn (vendor pattern ported from
    // vscode-unify-chat-provider's `undici.Agent` cache). Default Node
    // globalAgent has keepAlive=false on Node 18+, so we use a stable,
    // keep-alive enabled agent per (scheme, host, port) tuple.
    const { client: pooledClient, agent } = (0, agentPool_1.resolveClientForUrl)(finalUrlStr, !!model.allowUnauthorized);
    const options = {
        method: 'POST',
        headers: headers,
        agent,
    };
    // P0-2: SSL bypass ONLY when user explicitly opts in via allowUnauthorized.
    // Custom providers no longer bypass SSL automatically.
    if (model.allowUnauthorized) {
        electron_log_1.default.warn(`[Proxy] SSL verification DISABLED for ${model.name} (allowUnauthorized=true). Connection is vulnerable to MITM.`);
        options.rejectUnauthorized = false;
    }
    electron_log_1.default.info(`[Proxy] Routing ${model.name} to ${model.provider} (${model.apiUrl}) (isStream: ${!!isStream})${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
    (0, recentModelsStore_1.recordRecentModel)(model.name);
    // Fix 6: dispatch through the extracted SRP helpers. The request-level
    // timeout/error handlers and the pooled request dispatch stay here.
    const ctx = {
        res,
        model,
        geminiBody,
        isStream,
        retryCount,
        maxRetries: MAX_RETRIES,
        provider,
        traceId,
        attemptFallback,
        retry: (rc, delayMs, logReason) => scheduleRetry(ctx, rc, delayMs, logReason),
    };
    const request = pooledClient.request(finalUrlStr, options, (apiRes) => {
        apiRes.on('error', (err) => handleApiResError(err, apiRes, ctx, finalUrlStr));
        const status = apiRes.statusCode || 0;
        // P3: Log 401 errors with detailed diagnostic context to help users
        // understand why their custom endpoint rejected the request.
        // Common causes: missing API key, wrong header name, expired token,
        // wrong endpoint URL, account suspended.
        if (status === 401) {
            // S-2: Never log actual key material — only presence and length bucket.
            const apiKeyInfo = model.apiKey && model.apiKey !== 'none'
                ? `<set, len=${model.apiKey.length > 50 ? '>50' : model.apiKey.length <= 20 ? '≤20' : '21-50'}>`
                : '<empty or none>';
            electron_log_1.default.error(`[Proxy] 401 Unauthorized from ${model.name} (${model.provider})`);
            electron_log_1.default.error(`[Proxy]   URL: ${finalUrlStr}`);
            electron_log_1.default.error(`[Proxy]   API key: ${apiKeyInfo}`);
            electron_log_1.default.error(`[Proxy]   Headers sent: ${Object.keys(headers).join(', ')}`);
            electron_log_1.default.error(`[Proxy]   Possible causes:`);
            electron_log_1.default.error(`[Proxy]     - Missing or invalid API key (check custom_models.json)`);
            electron_log_1.default.error(`[Proxy]     - Wrong header name for this provider (e.g. 'Authorization' vs 'x-api-key')`);
            electron_log_1.default.error(`[Proxy]     - Expired or revoked token`);
            electron_log_1.default.error(`[Proxy]     - Account suspended or rate-limited`);
            electron_log_1.default.error(`[Proxy]     - Wrong endpoint URL (${finalUrlStr})`);
            electron_log_1.default.error(`[Proxy]   Upstream response: ${JSON.stringify(apiRes.headers).slice(0, 200)}`);
        }
        if (isStream) {
            handleStreamResponse(apiRes, request, ctx);
        }
        else {
            handleNonStreamResponse(apiRes, ctx);
        }
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => handleRequestTimeout(request, ctx));
    request.on('error', (err) => handleRequestError(err, ctx));
    request.write(JSON.stringify(payload));
    request.end();
}
// ─── GetAvailableModels Proxy Handler ───────────────────────────────────────
function handleGetAvailableModelsProxy(res, reqBody, lsUrl, reqHeaders) {
    const lsParsed = new URL(lsUrl);
    const client = lsParsed.protocol === 'https:' ? https : http;
    const bodyToSend = reqBody && reqBody.length > 0 ? reqBody : Buffer.from([0, 0, 0, 0, 0]);
    const options = {
        method: 'POST',
        hostname: lsParsed.hostname,
        port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
        path: lsParsed.pathname + lsParsed.search,
        headers: {
            'Content-Type': 'application/grpc-web+proto',
            'Accept': 'application/grpc-web+proto',
            'Content-Length': String(bodyToSend.length),
            ...(reqHeaders['x-codeium-csrf-token'] ? { 'x-codeium-csrf-token': String(reqHeaders['x-codeium-csrf-token']) } : {}),
            ...(reqHeaders['Connect-Protocol-Version'] ? { 'Connect-Protocol-Version': String(reqHeaders['Connect-Protocol-Version']) } : {}),
            ...(reqHeaders['X-Grpc-Web'] ? { 'X-Grpc-Web': String(reqHeaders['X-Grpc-Web']) } : {}),
        },
        rejectUnauthorized: !constants_1.LOOPBACK_HOSTS.includes(lsParsed.hostname),
    };
    const lsReq = client.request(options, (lsRes) => {
        let lsResErrored = false;
        lsRes.on('error', (err) => {
            lsResErrored = true;
            electron_log_1.default.error('[Proxy] LS error for GetAvailableModels:', err.message);
            if (!res.headersSent && !res.writableEnded) {
                (0, httpUtils_1.safeWriteHead)(res, 502, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                });
                (0, httpUtils_1.safeEnd)(res);
            }
        });
        const chunks = [];
        lsRes.on('data', (chunk) => chunks.push(chunk));
        lsRes.on('end', () => {
            // Guard: timeout or error may have already terminated the response
            if (lsResErrored || res.headersSent || res.writableEnded) {
                electron_log_1.default.debug('[Proxy] GetAvailableModels: skipping end handler (response terminated)');
                return;
            }
            const responseBuf = Buffer.concat(chunks);
            const customModels = (0, modelLoader_1.loadCustomModels)();
            // Run concurrent health checks (cached with 30s TTL, max 800ms wait)
            (0, modelHealthChecker_2.checkAllModelsHealth)(customModels).then((healthMap) => {
                const { buffer: modifiedBuf } = (0, protoInjector_1.injectCustomModelsIntoResponse)(responseBuf, customModels, healthMap);
                if ((0, httpUtils_1.safeWriteHead)(res, lsRes.statusCode || 200, {
                    'Content-Type': 'application/grpc-web+proto',
                    'Content-Length': String(modifiedBuf.length),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Expose-Headers': '*',
                })) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuf);
                }
            }).catch(() => {
                const { buffer: modifiedBuf } = (0, protoInjector_1.injectCustomModelsIntoResponse)(responseBuf, customModels);
                if ((0, httpUtils_1.safeWriteHead)(res, lsRes.statusCode || 200, {
                    'Content-Type': 'application/grpc-web+proto',
                    'Content-Length': String(modifiedBuf.length),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Expose-Headers': '*',
                })) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuf);
                }
            });
        });
    });
    lsReq.setTimeout(30000, () => {
        electron_log_1.default.error('[Proxy] GetAvailableModels forward timed out');
        lsReq.destroy();
        if (!res.headersSent && !res.writableEnded) {
            (0, httpUtils_1.safeWriteHead)(res, 504, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            });
            (0, httpUtils_1.safeEnd)(res);
        }
    });
    lsReq.on('error', (err) => {
        electron_log_1.default.error('[Proxy] GetAvailableModels forward error:', err.message);
        if (!res.headersSent && !res.writableEnded) {
            (0, httpUtils_1.safeWriteHead)(res, 502, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            });
            (0, httpUtils_1.safeEnd)(res);
        }
    });
    lsReq.write(bodyToSend);
    lsReq.end();
}
// ─── GetUserStatus Proxy Handler ─────────────────────────────────────────────
function handleGetUserStatusProxy(res, reqBody, lsUrl, reqHeaders) {
    const lsParsed = new URL(lsUrl);
    const client = lsParsed.protocol === 'https:' ? https : http;
    const bodyToSend = reqBody && reqBody.length > 0 ? reqBody : Buffer.from([0, 0, 0, 0, 0]);
    const options = {
        method: 'POST',
        hostname: lsParsed.hostname,
        port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
        path: lsParsed.pathname + lsParsed.search,
        headers: {
            'Content-Type': 'application/grpc-web+proto',
            'Accept': 'application/grpc-web+proto',
            'Content-Length': String(bodyToSend.length),
            ...(reqHeaders['x-codeium-csrf-token'] ? { 'x-codeium-csrf-token': String(reqHeaders['x-codeium-csrf-token']) } : {}),
            ...(reqHeaders['Connect-Protocol-Version'] ? { 'Connect-Protocol-Version': String(reqHeaders['Connect-Protocol-Version']) } : {}),
            ...(reqHeaders['X-Grpc-Web'] ? { 'X-Grpc-Web': String(reqHeaders['X-Grpc-Web']) } : {}),
        },
        rejectUnauthorized: !constants_1.LOOPBACK_HOSTS.includes(lsParsed.hostname),
    };
    const lsReq = client.request(options, (lsRes) => {
        let lsResErrored = false;
        lsRes.on('error', (err) => {
            lsResErrored = true;
            electron_log_1.default.error('[Proxy] LS error for GetUserStatus:', err.message);
            if (!res.headersSent && !res.writableEnded) {
                (0, httpUtils_1.safeWriteHead)(res, 502, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                });
                (0, httpUtils_1.safeEnd)(res);
            }
        });
        const chunks = [];
        lsRes.on('data', (chunk) => chunks.push(chunk));
        lsRes.on('end', () => {
            if (lsResErrored || res.headersSent || res.writableEnded) {
                electron_log_1.default.debug('[Proxy] GetUserStatus: skipping end handler (response terminated)');
                return;
            }
            const responseBuf = Buffer.concat(chunks);
            const customModels = (0, modelLoader_1.loadCustomModels)();
            (0, modelHealthChecker_2.checkAllModelsHealth)(customModels).then((healthMap) => {
                const { buffer: modifiedBuf, injectedCount } = (0, protoInjector_1.injectCustomModelsIntoUserStatus)(responseBuf, customModels, healthMap);
                electron_log_1.default.info(`[Proxy] GetUserStatus injected ${injectedCount} custom models`);
                if ((0, httpUtils_1.safeWriteHead)(res, lsRes.statusCode || 200, {
                    'Content-Type': 'application/grpc-web+proto',
                    'Content-Length': String(modifiedBuf.length),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Expose-Headers': '*',
                })) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuf);
                }
            }).catch(() => {
                const { buffer: modifiedBuf, injectedCount } = (0, protoInjector_1.injectCustomModelsIntoUserStatus)(responseBuf, customModels);
                electron_log_1.default.info(`[Proxy] GetUserStatus injected ${injectedCount} custom models (fallback)`);
                if ((0, httpUtils_1.safeWriteHead)(res, lsRes.statusCode || 200, {
                    'Content-Type': 'application/grpc-web+proto',
                    'Content-Length': String(modifiedBuf.length),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Expose-Headers': '*',
                })) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuf);
                }
            });
        });
    });
    lsReq.setTimeout(30000, () => {
        electron_log_1.default.error('[Proxy] GetUserStatus forward timed out');
        lsReq.destroy();
        if (!res.headersSent && !res.writableEnded) {
            (0, httpUtils_1.safeWriteHead)(res, 504, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            });
            (0, httpUtils_1.safeEnd)(res);
        }
    });
    lsReq.on('error', (err) => {
        electron_log_1.default.error('[Proxy] GetUserStatus forward error:', err.message);
        if (!res.headersSent && !res.writableEnded) {
            (0, httpUtils_1.safeWriteHead)(res, 502, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            });
            (0, httpUtils_1.safeEnd)(res);
        }
    });
    lsReq.write(bodyToSend);
    lsReq.end();
}
// ─── Main Request Handler ─────────────────────────────────────────────────
function isAllowedOrigin(req) {
    const host = (req.headers.host || '').toLowerCase();
    const origin = (req.headers.origin || req.headers.referer || '').toLowerCase();
    // 1. Validate Host header — local loopback or googleapis upstream
    const isHostAllowed = constants_1.LOOPBACK_HOSTS.some((h) => host.startsWith(h)) || host.endsWith('.googleapis.com');
    if (!isHostAllowed)
        return false;
    // 2. Direct requests without Origin/Referer (Language Server Go, internal gRPC/HTTP)
    if (!origin)
        return true;
    // 3. Validate Origin/Referer header against known trusted local and Google origins
    try {
        const parsed = new URL(origin);
        const h = parsed.hostname.toLowerCase();
        return (constants_1.LOOPBACK_HOSTS.includes(h) ||
            h === 'googleapis.com' ||
            h.endsWith('.googleapis.com'));
    }
    catch {
        return false;
    }
}
function handleRequest(req, res) {
    // CSRF / Origin Guard: Reject unauthorized external origins attempting local proxy abuse
    if (!isAllowedOrigin(req)) {
        electron_log_1.default.warn(`[Proxy] Blocked request with unauthorized Host/Origin: host=${req.headers.host} origin=${req.headers.origin}`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Forbidden: Unauthorized origin' } }));
        return;
    }
    // Health check — keep this FIRST so the LS sees a live port even if other
    // initialization (padding strip, model loading, etc.) is delayed or fails.
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
        electron_log_1.default.info(`[Proxy] /health hit from ${req.socket.remoteAddress || 'unknown'}`);
        const memUsage = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            port: proxyPort,
            memory: {
                rssMB: Math.round(memUsage.rss / 1024 / 1024),
                heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            },
            state: {
                activeStreamContexts: shared_1.activeStreamContexts.size,
                modelToolCallIds: shared_1.modelToolCallIds.size,
                translatedToolCalls: shared_1.translatedToolCalls.size,
                modelReasoningContent: shared_1.modelReasoningContent.size,
            },
            timestamp: new Date().toISOString(),
        }));
        return;
    }
    if (req.method === 'GET' && (req.url === '/__diag__' || req.url?.startsWith('/__diag__?'))) {
        try {
            const accept = String(req.headers['accept'] ?? '');
            const snapshot = (0, diagnostics_1.snapshot)();
            if (accept.includes('text/markdown') || accept.includes('text/plain')) {
                res.writeHead(200, {
                    'Content-Type': 'text/markdown; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                res.end((0, diagnostics_1.formatSnapshot)(snapshot));
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(snapshot, null, 2));
            return;
        }
        catch (e) {
            proxyLog.error('Failed to render /__diag__', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'failed to render diagnostics', detail: e.message }));
            return;
        }
    }
    // Phase 7.1: live counter / histogram inspection. Off by default;
    // enable with AG_METRICS_ENABLED=1 when debugging a noisy upstream.
    if (req.method === 'GET' && req.url === '/__metrics__') {
        try {
            if (!(0, metricsRoute_1.metricsEnabled)()) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not enabled. Set AG_METRICS_ENABLED=1 to expose /__metrics__.\n');
                return;
            }
            const accept = req.headers['accept'] ? String(req.headers['accept']) : undefined;
            const ct = (0, metricsRoute_1.negotiateContentType)(accept);
            if (ct === 'text/plain') {
                res.writeHead(200, {
                    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                res.end((0, metricsRoute_1.formatPrometheus)((0, metricsRoute_1.getMetricsSnapshot)()));
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify((0, metricsRoute_1.getMetricsSnapshot)(), null, 2));
            return;
        }
        catch (e) {
            proxyLog.error('Failed to render /__metrics__', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'failed to render metrics', detail: e.message }));
            return;
        }
    }
    // Per-model health status — returns circuit breaker state for each custom
    // model so the renderer dropdown can show live green/red indicators.
    // Reads only in-memory state, no upstream calls, ~1ms response time.
    if (req.method === 'GET' && req.url === '/model-health') {
        const customModels = (0, modelLoader_1.loadCustomModels)();
        const statuses = {};
        for (const m of customModels) {
            const placeholderId = (0, idGenerator_1.generateModelPlaceholderId)(m);
            const breaker = (0, circuitBreaker_1.getOpenBreaker)(m);
            if (breaker) {
                statuses[placeholderId] = {
                    status: 'error',
                    errorType: breaker.errorType,
                    trippedAt: breaker.trippedAt,
                    failures: breaker.failures,
                };
            }
            else {
                statuses[placeholderId] = { status: 'healthy' };
            }
        }
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ models: statuses, timestamp: Date.now() }));
        return;
    }
    // CORS Preflight handler for browser-initiated requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
    }
    req.url = req.url.replace(/^.*\/dummy_path_padding/, '');
    // Strip binary patch padding (from LS hostname replacement)
    req.url = req.url.replace(/\/v1internal\/x{7}/, '');
    // P0-4: Enforce maximum request body size to prevent memory exhaustion DoS
    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    let bodyLength = 0;
    let bodyRejected = false;
    const bodyChunks = [];
    req.on('data', (chunk) => {
        bodyLength += chunk.length;
        if (bodyLength > MAX_BODY_SIZE) {
            if (!bodyRejected) {
                bodyRejected = true;
                electron_log_1.default.warn(`[Proxy] Request body exceeds ${MAX_BODY_SIZE / 1024 / 1024}MB limit (${req.method} ${req.url})`);
                req.destroy();
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: `Request body too large. Maximum: ${MAX_BODY_SIZE / 1024 / 1024}MB` } }));
                }
            }
            return;
        }
        bodyChunks.push(chunk);
    });
    req.on('end', async () => {
        if (bodyRejected)
            return;
        const fullBody = Buffer.concat(bodyChunks);
        const bodyStr = fullBody.toString('utf-8');
        electron_log_1.default.info(`[Proxy] Request: ${req.method} ${req.url}`);
        // MCP relay: the mobile companion asks the desktop session for the list
        // of configured MCP servers (name + tools + status) because the phone
        // holds no credentials or allowlist. The actual MCP runtime is the
        // Antigravity IDE sidecar; we simply delegate and relay its JSON.
        if (req.method === 'GET' && (req.url === '/list_mcp_servers' || req.url === '/mcp_servers')) {
            const listRes = await (0, mcpRelay_1.mcpListServers)();
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(listRes));
            }
            return;
        }
        // MCP tool relay (same shape the daemon sends): serverName, toolName,
        // arguments. The proxy forwards to the MCP runtime and relays the JSON.
        if (req.method === 'POST' && req.url === '/call_mcp_tool') {
            let payload = {};
            try {
                payload = JSON.parse(bodyStr || '{}');
            }
            catch (e) {
                if ((0, httpUtils_1.safeWriteHead)(res, 400, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'Invalid JSON body' } }));
                }
                return;
            }
            const callRes = await (0, mcpRelay_1.mcpCallTool)(payload);
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(callRes));
            }
            return;
        }
        // 0. Intercept GetAvailableModels (redirected from Electron webRequest)
        if (req.url.startsWith('/GetAvailableModels')) {
            const gavParsed = new URL(req.url, `http://${constants_1.LOOPBACK_HOSTS[0]}`);
            const lsUrl = gavParsed.searchParams.get('ls');
            if (lsUrl) {
                handleGetAvailableModelsProxy(res, fullBody, lsUrl, req.headers);
                return;
            }
            if ((0, httpUtils_1.safeWriteHead)(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: 'Missing ls parameter' }));
            }
            return;
        }
        // 0.1. Intercept GetUserStatus (redirected from Electron webRequest for Antigravity 2.5+/2.12+)
        if (req.url.startsWith('/GetUserStatus')) {
            const gusParsed = new URL(req.url, `http://${constants_1.LOOPBACK_HOSTS[0]}`);
            const lsUrl = gusParsed.searchParams.get('ls');
            if (lsUrl) {
                handleGetUserStatusProxy(res, fullBody, lsUrl, req.headers);
                return;
            }
            if ((0, httpUtils_1.safeWriteHead)(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: 'Missing ls parameter' }));
            }
            return;
        }
        // 0.5. Intercept /v1internal:listExperiments
        if (req.url.includes('/v1internal:listExperiments')) {
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ experiments: [] }));
            }
            return;
        }
        // 1. Intercept /v1internal:fetchAvailableModels
        if (req.url.includes('/v1internal:fetchAvailableModels')) {
            electron_log_1.default.info('[Proxy] Intercepting fetchAvailableModels request');
            // Fire async health check (non-blocking)
            const customModelsForHealth = (0, modelLoader_1.loadCustomModels)();
            if (customModelsForHealth.length > 0) {
                (0, modelHealthChecker_2.checkAllModelsHealth)(customModelsForHealth).catch((err) => {
                    electron_log_1.default.error('[Proxy] Background health check failed:', err);
                });
            }
            const targetHost = constants_1.GOOGLE_HOSTS.CLOUD_CODE;
            const targetUrl = `https://${targetHost}`;
            let parsedUrl;
            try {
                const realIp = await (0, dnsResolver_1.resolveGoogleIp)(targetHost);
                parsedUrl = new URL(req.url, targetUrl);
                parsedUrl.hostname = realIp;
            }
            catch (e) {
                electron_log_1.default.warn(`[Proxy] DNS resolution failed for ${targetHost}, serving offline custom models:`, e);
                if (!res.headersSent && !res.writableEnded) {
                    const customModels = (0, modelLoader_1.loadCustomModels)();
                    const mappedCustom = {};
                    customModels.forEach((m) => {
                        const slug = (0, idGenerator_1.toSlug)(m);
                        const pid = (0, idGenerator_1.generateModelPlaceholderId)(m);
                        mappedCustom[slug] = {
                            displayName: m.displayName,
                            maxTokens: 1048576,
                            maxOutputTokens: 4096,
                            model: pid,
                            planModel: pid,
                            requestedModel: pid,
                            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                            modelProvider: 'MODEL_PROVIDER_GOOGLE',
                        };
                    });
                    (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({ models: mappedCustom }));
                }
                return;
            }
            const fwdHeaders = {
                ...req.headers,
            };
            fwdHeaders['host'] = targetHost;
            delete fwdHeaders['connection'];
            delete fwdHeaders['keep-alive'];
            delete fwdHeaders['accept-encoding'];
            const fwdOptions = {
                method: req.method,
                headers: fwdHeaders,
                servername: targetHost,
            };
            const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
                let googleResErrored = false;
                googleRes.on('error', (err) => {
                    googleResErrored = true;
                    electron_log_1.default.error('[Proxy] fetchAvailableModels upstream error:', err.message);
                });
                // P0-5: Timeout for fetchAvailableModels forward request (30s)
                googleReq.setTimeout(30000, () => {
                    electron_log_1.default.error('[Proxy] fetchAvailableModels forward request timed out');
                    googleReq.destroy();
                    if (!res.headersSent && !res.writableEnded) {
                        const customModels = (0, modelLoader_1.loadCustomModels)();
                        const mappedCustom = {};
                        customModels.forEach((m) => {
                            const slug = (0, idGenerator_1.toSlug)(m);
                            const pid = (0, idGenerator_1.generateModelPlaceholderId)(m);
                            mappedCustom[slug] = {
                                displayName: m.displayName,
                                maxTokens: 1048576,
                                maxOutputTokens: 4096,
                                model: pid,
                                planModel: pid,
                                requestedModel: pid,
                                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                                modelProvider: 'MODEL_PROVIDER_GOOGLE',
                            };
                        });
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({ models: mappedCustom }));
                    }
                });
                let googleBody = '';
                googleRes.on('data', (chunk) => (googleBody += chunk));
                googleRes.on('end', () => {
                    // Guard: timeout or upstream error may have already terminated the response
                    if (googleResErrored || res.headersSent || res.writableEnded) {
                        electron_log_1.default.debug('[Proxy] fetchAvailableModels: skipping end handler (response terminated)');
                        return;
                    }
                    try {
                        electron_log_1.default.info(`[Proxy] fetchAvailableModels response status: ${googleRes.statusCode}, body length: ${googleBody.length}`);
                        let googleJson;
                        try {
                            googleJson = JSON.parse(googleBody);
                        }
                        catch {
                            electron_log_1.default.warn(`[Proxy] fetchAvailableModels: non-JSON response from upstream (status: ${googleRes.statusCode}), generating synthetic models map`);
                            googleJson = { models: {} };
                        }
                        // DEBUG: dump raw upstream fetchAvailableModels response for diagnosis
                        fs.promises
                            .writeFile(path.join(os.tmpdir(), 'ag-fetchAvailableModels-dump.json'), JSON.stringify(googleJson, null, 2))
                            .catch(() => { });
                        const customModels = (0, modelLoader_1.loadCustomModels)();
                        electron_log_1.default.info(`[Proxy] Loaded custom models count: ${customModels.length}`);
                        let merged = false;
                        if (googleJson.models) {
                            googleJson.models = (0, modelInjector_1.mergeModels)(googleJson.models, customModels);
                            merged = true;
                        }
                        if (googleJson.availableModels) {
                            googleJson.availableModels = (0, modelInjector_1.mergeModels)(googleJson.availableModels, customModels);
                            merged = true;
                        }
                        if (googleJson.available_models) {
                            googleJson.available_models = (0, modelInjector_1.mergeModels)(googleJson.available_models, customModels);
                            merged = true;
                        }
                        if (!merged) {
                            const modelsMap = {};
                            customModels.forEach((m) => {
                                const slug = (0, idGenerator_1.toSlug)(m);
                                const pid = (0, idGenerator_1.generateModelPlaceholderId)(m);
                                const entry = {
                                    displayName: m.displayName,
                                    recommended: true,
                                    maxTokens: 1048576,
                                    maxOutputTokens: 4096,
                                    tokenizerType: 'LLAMA_WITH_SPECIAL',
                                    model: pid,
                                    planModel: pid,
                                    requestedModel: pid,
                                    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                                    modelProvider: 'MODEL_PROVIDER_GOOGLE',
                                };
                                modelsMap[slug] = entry;
                                modelsMap[pid] = entry;
                                if (m.name && m.name !== pid && m.name !== slug) {
                                    modelsMap[m.name] = entry;
                                }
                                if (m.externalModelName && m.externalModelName !== pid && m.externalModelName !== slug) {
                                    modelsMap[m.externalModelName] = entry;
                                }
                                m._slug = slug;
                            });
                            googleJson.models = modelsMap;
                        }
                        // Inject custom model slugs into agentModelSorts
                        const customSlugs = customModels.map((m) => m._slug).filter(Boolean);
                        if (customSlugs.length > 0) {
                            if (googleJson.agentModelSorts && Array.isArray(googleJson.agentModelSorts)) {
                                googleJson.agentModelSorts.forEach((sort) => {
                                    if (sort.groups && Array.isArray(sort.groups)) {
                                        sort.groups.forEach((group) => {
                                            if (group.modelIds && Array.isArray(group.modelIds)) {
                                                customSlugs.forEach((slug) => {
                                                    if (!group.modelIds.includes(slug)) {
                                                        group.modelIds.push(slug);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                });
                            }
                        }
                        // P1: Strip Google's upstream error from the response. When Google
                        // returns 401/403/etc., the proxy forwards that error object alongside
                        // our injected custom models. The Antigravity frontend treats any
                        // `error` key as a hard failure and hides the entire model list,
                        // even though we successfully injected valid models. Removing the
                        // error key lets the frontend render the merged model list normally.
                        if (googleJson.error) {
                            electron_log_1.default.warn(`[Proxy] fetchAvailableModels: stripping upstream error from response (status: ${googleRes.statusCode})`);
                            delete googleJson.error;
                        }
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify(googleJson));
                    }
                    catch (err) {
                        electron_log_1.default.error('[Proxy] Parsing fetchAvailableModels failed:', err);
                        if (res.headersSent || res.writableEnded)
                            return;
                        const customModels = (0, modelLoader_1.loadCustomModels)();
                        const mappedCustom = {};
                        customModels.forEach((m) => {
                            const slug = (0, idGenerator_1.toSlug)(m);
                            const pid = (0, idGenerator_1.generateModelPlaceholderId)(m);
                            mappedCustom[slug] = {
                                displayName: m.displayName,
                                maxTokens: 1048576,
                                maxOutputTokens: 4096,
                                model: pid,
                                planModel: pid,
                                requestedModel: pid,
                                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                                modelProvider: 'MODEL_PROVIDER_GOOGLE',
                            };
                        });
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({ models: mappedCustom }));
                    }
                });
            });
            googleReq.on('error', (err) => {
                electron_log_1.default.error('[Proxy] Forwarding fetchAvailableModels failed:', err);
                if (!res.headersSent && !res.writableEnded) {
                    const customModels = (0, modelLoader_1.loadCustomModels)();
                    const mappedCustom = {};
                    customModels.forEach((m) => {
                        const slug = (0, idGenerator_1.toSlug)(m);
                        const pid = (0, idGenerator_1.generateModelPlaceholderId)(m);
                        mappedCustom[slug] = {
                            displayName: m.displayName,
                            maxTokens: 1048576,
                            maxOutputTokens: 4096,
                            model: pid,
                            planModel: pid,
                            requestedModel: pid,
                            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                            modelProvider: 'MODEL_PROVIDER_GOOGLE',
                        };
                    });
                    (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({ models: mappedCustom }));
                }
            });
            if (fullBody && fullBody.length > 0) {
                googleReq.write(fullBody);
            }
            googleReq.end();
            return;
        }
        // 2. Intercept /v1beta/models or /v1/models list request
        if (req.method === 'GET' && (req.url.endsWith('/models') || req.url.includes('/models?'))) {
            electron_log_1.default.info('[Proxy] Intercepting models list request');
            const targetHost = constants_1.GOOGLE_HOSTS.GENERATIVE_LANGUAGE;
            const targetUrl = `https://${targetHost}`;
            let parsedUrl;
            try {
                const realIp = await (0, dnsResolver_1.resolveGoogleIp)(targetHost);
                parsedUrl = new URL(req.url, targetUrl);
                parsedUrl.hostname = realIp;
            }
            catch (e) {
                electron_log_1.default.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
                if ((0, httpUtils_1.safeWriteHead)(res, 500, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost } }));
                }
                return;
            }
            const mdlHeaders = {
                ...req.headers,
            };
            mdlHeaders['host'] = targetHost;
            delete mdlHeaders['connection'];
            delete mdlHeaders['accept-encoding'];
            const mdlOptions = {
                method: 'GET',
                headers: mdlHeaders,
                servername: targetHost,
            };
            const googleReq = https.request(parsedUrl, mdlOptions, (googleRes) => {
                let googleResErrored = false;
                googleRes.on('error', (err) => {
                    googleResErrored = true;
                    electron_log_1.default.error('[Proxy] Models list upstream error:', err.message);
                });
                // P0-5: Timeout for models list forward request (30s)
                googleReq.setTimeout(30000, () => {
                    electron_log_1.default.error('[Proxy] Models list forward request timed out');
                    googleReq.destroy();
                    if (!res.headersSent && !res.writableEnded) {
                        const customModels = (0, modelLoader_1.loadCustomModels)();
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                            models: customModels.map((m) => ({
                                name: m.name,
                                displayName: m.displayName,
                                description: m.description,
                                supportedGenerationMethods: ['generateContent'],
                            })),
                        }));
                    }
                });
                let googleBody = '';
                googleRes.on('data', (chunk) => (googleBody += chunk));
                googleRes.on('end', () => {
                    // Guard: timeout or upstream error may have already terminated the response
                    if (googleResErrored || res.headersSent || res.writableEnded) {
                        electron_log_1.default.debug('[Proxy] Models list: skipping end handler (response terminated)');
                        return;
                    }
                    try {
                        const googleJson = JSON.parse(googleBody);
                        const customModels = (0, modelLoader_1.loadCustomModels)();
                        const mappedCustom = customModels.map((m) => ({
                            name: 'models/' + (0, idGenerator_1.generateModelPlaceholderId)(m),
                            version: '1.0',
                            displayName: m.displayName,
                            description: m.description,
                            inputTokenLimit: 1048576,
                            outputTokenLimit: 4096,
                            supportedGenerationMethods: ['generateContent', 'countTokens'],
                            temperature: 0.7,
                            topP: 0.9,
                            topK: 40,
                        }));
                        if (googleJson.models) {
                            googleJson.models = [...mappedCustom, ...googleJson.models];
                        }
                        else {
                            googleJson.models = mappedCustom;
                        }
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify(googleJson));
                    }
                    catch (err) {
                        electron_log_1.default.error('[Proxy] Google list models failed:', err);
                        if (res.headersSent || res.writableEnded)
                            return;
                        (0, httpUtils_1.safeWriteHead)(res, 502, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: `Upstream models parse error: ${err.message}` } }));
                    }
                });
            });
            googleReq.on('error', (err) => {
                electron_log_1.default.error('[Proxy] Google models list request error:', err);
                if (!res.headersSent && !res.writableEnded) {
                    const customModels = (0, modelLoader_1.loadCustomModels)();
                    (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                        models: customModels.map((m) => ({
                            name: m.name,
                            displayName: m.displayName,
                            description: m.description,
                            supportedGenerationMethods: ['generateContent'],
                        })),
                    }));
                }
            });
            googleReq.end();
            return;
        }
        // 3. Intercept Cloud Code generation stream or non-stream requests
        const isCloudCodeStream = req.url.includes('/v1internal:streamGenerateContent') || req.url.includes('/v1internal:generateContent');
        if (req.method === 'POST' && isCloudCodeStream) {
            try {
                const reqJson = JSON.parse(bodyStr);
                const targetReq = (reqJson.request || reqJson);
                const candidateNames = [
                    reqJson.model,
                    reqJson.requestedModel,
                    reqJson.planModel,
                    reqJson.requested_model,
                    reqJson.plan_model,
                    reqJson.modelId,
                    reqJson.model_id,
                    targetReq.model,
                    targetReq.requestedModel,
                    targetReq.planModel,
                    targetReq.requested_model,
                    targetReq.plan_model,
                    targetReq.modelId,
                    targetReq.model_id,
                ].filter((x) => typeof x === 'string' && Boolean(x));
                electron_log_1.default.info(`[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`);
                if (candidateNames.length > 0) {
                    const customModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
                    let matchedCustomModel = customModels.find((m) => {
                        const enumName = (0, idGenerator_1.generateModelPlaceholderId)(m);
                        return candidateNames.some((cn) => m.name === cn ||
                            (0, idGenerator_1.toSlug)(m) === cn ||
                            enumName === cn ||
                            `models/${enumName}` === cn ||
                            cn.endsWith(enumName));
                    });
                    // Fallback: if an older conversation references a legacy placeholder (e.g. M299/M298)
                    if (!matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
                        matchedCustomModel = customModels[0];
                    }
                    if (matchedCustomModel) {
                        electron_log_1.default.info(`[Proxy] Intercepting Cloud Code generation for custom model: ${matchedCustomModel.displayName}`);
                        const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
                        const actualGeminiBody = (reqJson.request || reqJson);
                        // Resolve fileData URIs then route to translator
                        resolveFileData(actualGeminiBody, req.headers).then(() => {
                            handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
                        });
                        return;
                    }
                }
            }
            catch (err) {
                electron_log_1.default.error('[Proxy] Failed to parse Cloud Code stream body:', err);
            }
        }
        // 4. Intercept standard generateContent / streamGenerateContent request
        const generateMatch = req.url.match(/\/(?:v1|v1beta)\/(models\/[^:]+):generateContent/);
        const streamMatch = req.url.match(/\/(?:v1|v1beta)\/(models\/[^:]+):streamGenerateContent/);
        const isGenerate = !!generateMatch;
        const isStandardStream = !!streamMatch;
        if (req.method === 'POST' && (isGenerate || isStandardStream)) {
            const matchedModelName = isGenerate ? generateMatch[1] : streamMatch[1];
            const customModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
            let matchedCustomModel = customModels.find((m) => {
                const enumName = (0, idGenerator_1.generateModelPlaceholderId)(m);
                return (m.name === matchedModelName ||
                    (0, idGenerator_1.toSlug)(m) === matchedModelName ||
                    enumName === matchedModelName ||
                    'models/' + enumName === matchedModelName);
            });
            if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
                matchedCustomModel = customModels[0];
            }
            if (matchedCustomModel) {
                try {
                    const geminiBody = JSON.parse(bodyStr);
                    resolveFileData(geminiBody, req.headers).then(() => {
                        handleCustomModelRequest(res, matchedCustomModel, geminiBody, isStandardStream);
                    });
                    return;
                }
                catch (e) {
                    electron_log_1.default.error('[Proxy] JSON parse error in request body:', e);
                    if ((0, httpUtils_1.safeWriteHead)(res, 400, { 'Content-Type': 'application/json' })) {
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'Invalid JSON request body' } }));
                    }
                    return;
                }
            }
        }
        // 5. Fallback: transparent proxy to Google
        await proxyToGoogle(req, res, fullBody);
    });
}
// ─── File Watcher for custom_models.json ──────────────────────────────────
let customModelsWatcher = null;
let customModelsWatcherDebounce = null;
function setupCustomModelsWatcher() {
    try {
        const customModelsPath = (0, modelLoader_1.getCustomModelsPath)();
        const customModelsDir = path.dirname(customModelsPath);
        if (!fs.existsSync(customModelsDir)) {
            fs.mkdirSync(customModelsDir, { recursive: true });
        }
        if (customModelsWatcher) {
            customModelsWatcher.close();
            customModelsWatcher = null;
        }
        customModelsWatcher = fs.watch(customModelsDir, (_eventType, filename) => {
            if (filename && filename.includes('custom_models.json')) {
                if (customModelsWatcherDebounce)
                    clearTimeout(customModelsWatcherDebounce);
                customModelsWatcherDebounce = setTimeout(() => {
                    electron_log_1.default.info('[Proxy] custom_models.json changed on disk. Invalidating model caches...');
                    (0, modelStore_1.invalidateModelStoreCache)();
                    (0, modelHealthChecker_1.invalidateHealthCache)();
                    try {
                        const models = (0, modelLoader_1.loadCustomModels)();
                        if (models.length > 0) {
                            (0, modelHealthChecker_2.checkAllModelsHealth)(models).catch(() => { });
                        }
                    }
                    catch (err) {
                        electron_log_1.default.warn('[Proxy] Failed to reload/health-check models after file change:', err);
                    }
                }, 200);
            }
        });
    }
    catch (err) {
        electron_log_1.default.warn('[Proxy] Failed to setup custom_models.json watcher:', err);
    }
}
function stopCustomModelsWatcher() {
    if (customModelsWatcherDebounce) {
        clearTimeout(customModelsWatcherDebounce);
        customModelsWatcherDebounce = null;
    }
    if (customModelsWatcher) {
        try {
            customModelsWatcher.close();
        }
        catch { }
        customModelsWatcher = null;
    }
}
// ─── Server Start/Stop ────────────────────────────────────────────────────
function startProxy() {
    return new Promise((resolve, reject) => {
        try {
            server = http.createServer(handleRequest);
            // The Antigravity language server multiplexes many requests over a few
            // keep-alive sockets and pipelines them aggressively (state page updates
            // every ~200ms, back-to-back streamGenerateContent). Node's default
            // keepAliveTimeout (5s) destroys idle sockets under the LS's next write;
            // Windows then aborts that write with WSAECONNABORTED, the Go client
            // retries, and we get a retry flood + CPU burn. Disable all three
            // reaping timeouts: the proxy binds 127.0.0.1 only, and the idle guard
            // on upstream streams handles stuck providers.
            // ponytail: 0 disables reaping → a broken local client could hold
            // sockets open forever. Acceptable on loopback; re-enable with
            // keepAliveTimeout=60_000 if the proxy is ever exposed beyond localhost.
            server.keepAliveTimeout = 0;
            server.headersTimeout = 0;
            server.requestTimeout = 0;
            // P2: Make port/host configurable via env vars so the proxy can be
            // tuned per-machine without recompiling. Defaults preserve legacy behavior.
            const envPort = parseInt(process.env.AG_PROXY_PORT || '', 10);
            const defaultPort = Number.isFinite(envPort) && envPort > 0 ? envPort : constants_1.DEFAULT_PROXY_PORT;
            const defaultHost = process.env.AG_PROXY_HOST || constants_1.LOOPBACK_HOSTS[0];
            let primaryPort = defaultPort;
            let primaryHost = defaultHost;
            const portCandidates = [defaultPort];
            portCandidates.push(0); // 0 = OS-assigned dynamic port (last resort)
            let attemptIdx = 0;
            const tryListen = (port, host) => {
                server.listen(port, host, () => {
                    proxyPort = server.address().port;
                    const isFallback = port !== defaultPort && port !== 0;
                    const isDynamic = port === 0;
                    if (isFallback) {
                        electron_log_1.default.warn(`[Proxy] Default port ${defaultPort} unavailable. Using fallback port ${proxyPort}.`);
                        electron_log_1.default.warn(`[Proxy] Set AG_PROXY_PORT=${proxyPort} in your environment to silence this warning.`);
                    }
                    else if (isDynamic) {
                        electron_log_1.default.warn(`[Proxy] All configured ports in use. Using OS-assigned dynamic port ${proxyPort}.`);
                    }
                    else {
                        electron_log_1.default.info(`[Proxy] Server listening on http://${host}:${proxyPort}`);
                    }
                    // Persist the active port so other processes (ag-doctor-ui, scripts)
                    // can discover which port the proxy is actually bound to.
                    try {
                        const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
                        const portFile = path.join(home, constants_2.ACTIVE_PORT_FILE);
                        fs.mkdirSync(path.dirname(portFile), { recursive: true });
                        fs.writeFileSync(portFile, String(proxyPort), 'utf-8');
                        electron_log_1.default.debug(`[Proxy] Active port persisted to ${portFile}`);
                    }
                    catch (err) {
                        electron_log_1.default.warn('[Proxy] Could not persist active port:', err.message);
                    }
                    // Execute cleanup initialization after the server is already listening
                    // so that failures here don't prevent the port from binding.
                    try {
                        (0, shared_1.startCleanupInterval)();
                        setupCustomModelsWatcher();
                    }
                    catch (err) {
                        electron_log_1.default.error('[Proxy] Failed to start cleanup interval:', err);
                    }
                    resolve(proxyPort);
                });
            };
            server.on('error', (err) => {
                // Log full error details for diagnostics on new machines.
                electron_log_1.default.error(`[Proxy] Server error: code=${err.code} message=${err.message} syscall=${err.syscall || ''} address=${err.address || ''} port=${err.port || ''}`);
                if (err.code === 'EADDRINUSE' && attemptIdx + 1 < portCandidates.length) {
                    const triedPort = portCandidates[attemptIdx];
                    const nextPort = portCandidates[attemptIdx + 1];
                    electron_log_1.default.warn(`[Proxy] Port ${triedPort} is already in use. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
                    attemptIdx += 1;
                    tryListen(nextPort, primaryHost);
                }
                else if (err.code === 'EACCES') {
                    electron_log_1.default.warn(`[Proxy] Permission denied binding to ${primaryHost}:${primaryPort}. Trying fallback ports...`);
                    if (attemptIdx + 1 < portCandidates.length) {
                        const triedPort = portCandidates[attemptIdx];
                        const nextPort = portCandidates[attemptIdx + 1];
                        electron_log_1.default.warn(`[Proxy] Port ${triedPort} access denied. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
                        attemptIdx += 1;
                        tryListen(nextPort, primaryHost);
                    }
                    else {
                        electron_log_1.default.error(`[Proxy] Permission denied binding to ${primaryHost}:${primaryPort}. Try a different port (AG_PROXY_PORT) or run with sufficient privileges.`);
                        reject(err);
                    }
                }
                else {
                    electron_log_1.default.error('[Proxy] Startup failed:', err);
                    reject(err);
                }
            });
            primaryPort = portCandidates[0];
            // Hot-reload persisted state from disk before we start accepting
            // requests. This restores any breakers that were tripped before the
            // last shutdown, so the proxy doesn't immediately re-fail on a
            // model the user already determined was broken.
            loadPersistedState();
            tryListen(primaryPort, primaryHost);
        }
        catch (err) {
            electron_log_1.default.error('[Proxy] Unexpected error during startProxy:', err);
            reject(err);
        }
    });
}
/**
 * Reads the persisted state file and applies it to the live singletons.
 * Called once on startup. Safe to call again — re-loads idempotently.
 */
function loadPersistedState() {
    try {
        const path = (0, persistedState_1.stateFilePath)();
        const file = (0, persistedState_1.loadOrInit)(path);
        const { retryBudgetPatch, breakerPatch } = (0, persistedState_1.fromFile)(file, Date.now(), circuitBreaker_2.CIRCUIT_BREAKER_RESET_MS);
        (0, persistedState_1.applyBudgetPatch)(retryBudgetPatch);
        (0, persistedState_1.applyBreakerPatch)(breakerPatch);
        if (file.recentModels) {
            (0, recentModelsStore_1.restoreRecentModels)(file.recentModels);
        }
        electron_log_1.default.info(`[Proxy] loaded persisted state: budget=${retryBudgetPatch.size} breakers=${breakerPatch.size}`);
    }
    catch (err) {
        electron_log_1.default.warn('[Proxy] could not restore persisted state:', err);
    }
}
/**
 * Persist the current in-memory retry budget + breaker state to disk.
 * Throttled by `MIN_FLUSH_INTERVAL_MS` unless `force` is set.
 */
function flushPersistedState(opts = {}) {
    try {
        const path = (0, persistedState_1.stateFilePath)();
        const file = (0, persistedState_1.gather)();
        const ok = (0, persistedState_1.flush)(path, file);
        if (!ok && !opts.force) {
            // Throttled — that's fine. The next mutation will flush.
            return;
        }
    }
    catch (err) {
        electron_log_1.default.warn('[Proxy] could not persist state:', err);
    }
}
function stopProxy() {
    return new Promise((resolve) => {
        // P1-9: Stop cleanup interval to prevent orphaned timers
        (0, shared_1.stopCleanupInterval)();
        stopCustomModelsWatcher();
        const finish = () => {
            // Phase 6.3: flush any pending persisted state (force, ignore throttle)
            // so the next startProxy() can re-load the same breakers / budgets.
            flushPersistedState({ force: true });
            // Phase 3: close per-host https/http agent pools so file descriptors
            // are released on graceful shutdown (mirrors undici.Agent.close()).
            (0, agentPool_1.disposeAll)()
                .then(() => resolve())
                .catch((err) => {
                electron_log_1.default.warn('[Proxy] Agent pool dispose error (non-fatal):', err);
                resolve();
            });
        };
        if (server) {
            // Forcefully close idle connections to release sockets immediately
            if (typeof server.closeIdleConnections === 'function') {
                server.closeIdleConnections();
            }
            server.close(() => {
                electron_log_1.default.info('[Proxy] Server stopped');
                server = null;
                finish();
            });
        }
        else {
            finish();
        }
    });
}
function getProxyPort() {
    return proxyPort;
}
//# sourceMappingURL=proxy.js.map