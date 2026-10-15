"use strict";
// ─── Constants & Imports ───────────────────────────────────────────────────
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
exports._resetAccountBurst = exports.liftBurstCooldowns = exports.clearAccountBurst = exports.recordAccountBurst = exports.getGoogleAccountPool = exports.selectBestModelByQuota = exports.selectCandidateP2C = exports.classifyGoogleCloudCode429 = exports.getAccountDynamicScore = exports.resolveGoogleProjectId = exports.isPoolUnderQuotaStress = exports._resetAccountLatencies = exports.getAccountAvgLatency = exports.recordAccountLatency = exports.EWMA_DECAY_THRESHOLD_MS = exports.getModelQuotaScore = exports._resetAccountRpm = exports.getAccountRpmCount = exports.getAccountLastUsed = exports.recordAccountRequest = exports._resetAccountInFlight = exports.decrementAccountInFlight = exports.incrementAccountInFlight = exports.waitForAccountSlot = exports._clearSlotWaitersForTests = exports.notifySlotAvailable = exports.MAX_CONCURRENT_PER_ACCOUNT = exports.getAccountInFlight = exports.autoHealAccountOnQuotaRecovery = exports._resetAllAccountCooldowns = exports.verifyAndReconcileCooldowns = exports.restoreActiveAccountCooldowns = exports.getActiveAccountCooldowns = exports.clearAccountCooldown = exports.getSoonestAccountCooldownRemaining = exports.getAccountCooldownRemaining = exports.setAccountCooldown = exports.isAccountInCooldown = exports._resetAccountProbation = exports.endAccountProbation = exports.isAccountInProbation = exports._resetUnlicensedAccounts = exports.markAccountQuotaExhausted = exports.restoreUnlicensedAccountKeys = exports.getUnlicensedAccountKeys = exports.markAccountUnlicensed = exports.isAccountUnlicensed = exports.getAccountQuotaKey = exports.registerAccountRefreshToken = exports.isNativeCloudCodeModel = void 0;
exports.NATIVE_CASCADE_BLOCK_WINDOW_MS = exports.NATIVE_SESSION_TTL_MS = exports.SESSION_MODEL_FALLBACK_TTL_MS = void 0;
exports.logTokenUsageEvent = logTokenUsageEvent;
exports.loadRemoteState = loadRemoteState;
exports.saveRemoteState = saveRemoteState;
exports.unlockCodeAssistPayload = unlockCodeAssistPayload;
exports.executeOnRemoteDaemon = executeOnRemoteDaemon;
exports.setProxyErrorEmitter = setProxyErrorEmitter;
exports.buildProxyErrorPayload = buildProxyErrorPayload;
exports.sanitizeCandidatesInResponse = sanitizeCandidatesInResponse;
exports.writeSafeSseChunk = writeSafeSseChunk;
exports.transformGoogleStreamForRemote = transformGoogleStreamForRemote;
exports.proxyToGoogle = proxyToGoogle;
exports.executeGoogleCloudCodeRequest = executeGoogleCloudCodeRequest;
exports.executeGoogleCloudCodeWithPool = executeGoogleCloudCodeWithPool;
exports.parseRetryAfter = parseRetryAfter;
exports.extractSessionId = extractSessionId;
exports.getSessionBoundModel = getSessionBoundModel;
exports.bindSessionToModel = bindSessionToModel;
exports.clearSessionAffinities = clearSessionAffinities;
exports.getSessionModelFallback = getSessionModelFallback;
exports.clearSessionModelFallback = clearSessionModelFallback;
exports.setSessionModelFallback = setSessionModelFallback;
exports.clearSessionModelFallbacks = clearSessionModelFallbacks;
exports.getActiveSessionModelFallbacks = getActiveSessionModelFallbacks;
exports.matchesCustomModel = matchesCustomModel;
exports.markNativeSession = markNativeSession;
exports.getNativeSession = getNativeSession;
exports.recordNativeSessionError = recordNativeSessionError;
exports.clearNativeSessions = clearNativeSessions;
exports.isAllowedOrigin = isAllowedOrigin;
exports.setupCustomModelsWatcher = setupCustomModelsWatcher;
exports.stopCustomModelsWatcher = stopCustomModelsWatcher;
exports.startQuotaPollingInterval = startQuotaPollingInterval;
exports.stopQuotaPollingInterval = stopQuotaPollingInterval;
exports.startProxy = startProxy;
exports.loadPersistedState = loadPersistedState;
exports.flushPersistedState = flushPersistedState;
exports.stopProxy = stopProxy;
exports.getProxyPort = getProxyPort;
const http = __importStar(require("http"));
const https_1 = __importDefault(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const zlib = __importStar(require("zlib"));
const string_decoder_1 = require("string_decoder");
const crypto_1 = require("crypto");
const electron_log_1 = __importDefault(require("electron-log"));
if (electron_log_1.default.transports?.file && electron_log_1.default.transports.file.level === 'silly') {
    electron_log_1.default.transports.file.level = process.env.AG_LOG_LEVEL || 'info';
}
if (electron_log_1.default.transports?.console && electron_log_1.default.transports.console.level === 'silly') {
    electron_log_1.default.transports.console.level = process.env.AG_LOG_LEVEL || 'info';
}
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
const constants_1 = require("./constants");
// Shared cross-turn state & resilience
const shared_1 = require("./proxy/shared");
const registry = __importStar(require("./proxy/registry"));
const protoInjector_1 = require("./proxy/protoInjector");
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
const urlBuilder_1 = require("./proxy/urlBuilder");
const idGenerator_1 = require("./proxy/idGenerator");
const effortExpander_1 = require("./proxy/effortExpander");
const modelUtils_1 = require("./proxy/modelUtils");
Object.defineProperty(exports, "isNativeCloudCodeModel", { enumerable: true, get: function () { return modelUtils_1.isNativeCloudCodeModel; } });
const dnsResolver_1 = require("./proxy/dnsResolver");
const modelRouter_1 = require("./proxy/modelRouter");
const contextTrimmer_1 = require("./proxy/contextTrimmer");
const modelHealthChecker_2 = require("./proxy/modelHealthChecker");
const recentModelsStore_1 = require("./proxy/recentModelsStore");
const mcpRelay_1 = require("./proxy/mcpRelay");
const googleAuth_1 = require("./services/googleAuth");
const quotaCacheStore_1 = require("./services/quotaCacheStore");
const googlePool_1 = require("./proxy/googlePool");
const httpUtils_1 = require("./proxy/httpUtils");
const modelInjector_1 = require("./proxy/modelInjector");
function traceLog(...args) {
    // ponytail: keeps the 'app' import (and thus the electron require) out of
    // proxy.ts's module graph when tracing is disabled; upgrade path: replace
    // with a real log-level switch if verbose tracing is ever needed.
    if (process.env.AG_PROXY_TRACE === '1') {
        // eslint-disable-next-line no-console
        console.log('[proxy-trace]', ...args);
    }
}
const proxyLog = (0, logger_1.createLogger)('Proxy');
/** 16-char hex request id used for tracing. Cheap, sortable by time. */
function newTraceId() {
    return (0, crypto_1.randomBytes)(8).toString('hex');
}
let server = null;
let proxyPort = 0;
let isRemoteVpsActive = false;
let remoteVpsHost = constants_1.DEFAULT_REMOTE_HOST;
let remoteVpsToken = constants_1.DEFAULT_REMOTE_TOKEN;
let remoteSessionsMap = {};
function getRemoteStatePath() {
    const home = os.homedir();
    const dir = path.join(home, '.gemini', 'antigravity');
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        }
        catch (e) {
            electron_log_1.default.warn('[Proxy] Failed to create ~/.gemini/antigravity dir:', e);
        }
    }
    return path.join(dir, 'remote_vps_state.json');
}
let tokenEventsPathCache = null;
function getTokenEventsLogPath() {
    if (!tokenEventsPathCache) {
        const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
        const dir = path.join(home, '.gemini', 'antigravity');
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            }
            catch (_) { }
        }
        tokenEventsPathCache = path.join(dir, 'token_usage_events.jsonl');
    }
    return tokenEventsPathCache;
}
function logTokenUsageEvent(event) {
    try {
        const logPath = getTokenEventsLogPath();
        const line = JSON.stringify(event) + '\n';
        fs.appendFile(logPath, line, (err) => {
            if (err) {
                electron_log_1.default.debug('[Proxy] Could not append to token_usage_events.jsonl:', err.message);
            }
        });
    }
    catch (_err) {
        // Non-critical logging failure should never crash the proxy
    }
}
function ensureRemoteExecScriptOnDisk() {
    try {
        const targetDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts');
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const targetPath = path.join(targetDir, 'remote-exec.js');
        const candidates = [
            path.resolve(__dirname, '../scripts/remote-exec.js'),
            path.resolve(__dirname, '../../scripts/remote-exec.js'),
            path.resolve(__dirname, 'scripts/remote-exec.js'),
        ];
        for (const src of candidates) {
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, targetPath);
                break;
            }
        }
    }
    catch (e) {
        electron_log_1.default.warn('[Proxy] Could not sync remote-exec.js to ~/.gemini/antigravity/scripts:', e);
    }
}
let lastRemoteStateSummary = '';
function loadRemoteState() {
    try {
        ensureRemoteExecScriptOnDisk();
        const p = getRemoteStatePath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8').trim();
            if (!raw)
                return;
            let data;
            try {
                data = JSON.parse(raw);
            }
            catch (jsonErr) {
                // Self-heal: extract outermost JSON object if corrupted trailing characters were present
                const firstBrace = raw.indexOf('{');
                const lastBrace = raw.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace > firstBrace) {
                    try {
                        data = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
                        electron_log_1.default.info('[Proxy] Self-healed corrupted remote VPS state file.');
                    }
                    catch {
                        electron_log_1.default.warn('[Proxy] Unrecoverable remote VPS state file syntax:', jsonErr);
                        return;
                    }
                }
                else {
                    return;
                }
            }
            isRemoteVpsActive = !!data.active;
            if (data.host)
                remoteVpsHost = String(data.host);
            if (data.token && data.token !== 'null' && data.token !== 'undefined' && String(data.token).trim().length > 0) {
                remoteVpsToken = String(data.token).trim();
            }
            else {
                remoteVpsToken = constants_1.DEFAULT_REMOTE_TOKEN;
            }
            if (data.remoteSessions && typeof data.remoteSessions === 'object') {
                remoteSessionsMap = data.remoteSessions;
            }
            const remoteSummary = `active=${isRemoteVpsActive}, host=${remoteVpsHost}, tokenSet=${!!remoteVpsToken}, remoteSessionsCount=${Object.keys(remoteSessionsMap).length}`;
            if (remoteSummary !== lastRemoteStateSummary) {
                lastRemoteStateSummary = remoteSummary;
                electron_log_1.default.debug(`[Proxy] Loaded Remote VPS state: ${remoteSummary}`);
            }
            else {
                electron_log_1.default.debug(`[Proxy] Loaded Remote VPS state: ${remoteSummary}`);
            }
        }
    }
    catch (e) {
        electron_log_1.default.warn('[Proxy] Failed to load remote VPS state from disk:', e);
    }
}
function saveRemoteState() {
    try {
        const p = getRemoteStatePath();
        const tmpPath = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
        const content = JSON.stringify({
            active: isRemoteVpsActive,
            host: remoteVpsHost,
            token: remoteVpsToken || constants_1.DEFAULT_REMOTE_TOKEN,
            remoteSessions: remoteSessionsMap,
        }, null, 2);
        fs.writeFileSync(tmpPath, content, 'utf-8');
        try {
            fs.renameSync(tmpPath, p);
        }
        catch {
            // Fallback for Windows cross-device or temporary file-lock edge cases
            fs.copyFileSync(tmpPath, p);
            try {
                fs.unlinkSync(tmpPath);
            }
            catch { }
        }
    }
    catch (e) {
        electron_log_1.default.warn('[Proxy] Failed to save remote VPS state to disk:', e);
    }
}
// ─── loadCodeAssist Cache (Login Resilience) ────────────────────────────────
let memoryLoadCodeAssistCache = null;
let memoryLoadCodeAssistTime = 0;
function getLoadCodeAssistCachePath() {
    const home = os.homedir();
    const dir = path.join(home, '.gemini', 'antigravity');
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        }
        catch (e) {
            electron_log_1.default.warn('[Proxy] Failed to create cache directory:', e);
        }
    }
    return path.join(dir, 'load_code_assist_cache.json');
}
function unlockCodeAssistPayload(rawJson) {
    try {
        const data = JSON.parse(rawJson);
        const ultraTier = {
            id: 'g1-ultra-tier',
            name: 'Google AI Ultra',
            description: 'Google AI Ultra',
            isDefault: true,
        };
        const ultraTierAlt = {
            id: 'ultra-tier',
            name: 'Google AI Ultra',
            description: 'Google AI Ultra',
        };
        data.currentTier = {
            ...(data.currentTier || {}),
            id: 'g1-ultra-tier',
            name: 'Google AI Ultra',
            description: 'Google AI Ultra',
        };
        data.paidTier = {
            ...(data.paidTier || {}),
            id: 'g1-ultra-tier',
            name: 'Google AI Ultra',
            description: 'Google AI Ultra',
        };
        if (Array.isArray(data.allowedTiers)) {
            for (const t of data.allowedTiers) {
                if (t && typeof t === 'object') {
                    t.isDefault = false;
                }
            }
            if (!data.allowedTiers.some((t) => t?.id === 'g1-ultra-tier')) {
                data.allowedTiers.push(ultraTier);
            }
            else {
                const found = data.allowedTiers.find((t) => t?.id === 'g1-ultra-tier');
                if (found)
                    found.isDefault = true;
            }
            if (!data.allowedTiers.some((t) => t?.id === 'ultra-tier')) {
                data.allowedTiers.push(ultraTierAlt);
            }
        }
        else {
            data.allowedTiers = [
                { id: 'free-tier', isDefault: false },
                { id: 'standard-tier', isDefault: false },
                { id: 'g1-pro-tier', isDefault: false },
                ultraTier,
                ultraTierAlt,
            ];
        }
        return JSON.stringify(data);
    }
    catch {
        return rawJson;
    }
}
function loadCachedCodeAssist() {
    if (memoryLoadCodeAssistCache)
        return unlockCodeAssistPayload(memoryLoadCodeAssistCache);
    try {
        const p = getLoadCodeAssistCachePath();
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8').trim();
            if (content.startsWith('{')) {
                const unlocked = unlockCodeAssistPayload(content);
                memoryLoadCodeAssistCache = unlocked;
                memoryLoadCodeAssistTime = Date.now();
                return unlocked;
            }
        }
    }
    catch (e) {
        electron_log_1.default.debug('[Proxy] Failed to load cached code assist:', e);
    }
    return null;
}
function saveCachedCodeAssist(content) {
    try {
        const unlocked = unlockCodeAssistPayload(content);
        memoryLoadCodeAssistCache = unlocked;
        memoryLoadCodeAssistTime = Date.now();
        const p = getLoadCodeAssistCachePath();
        fs.writeFileSync(p, unlocked, 'utf-8');
    }
    catch (e) {
        electron_log_1.default.warn('[Proxy] Failed to save cached code assist:', e);
    }
}
// ─── listExperiments Cache (Feature Flags & Planning Resilience) ────────────
let memoryListExperimentsCache = null;
let memoryListExperimentsTime = 0;
function getListExperimentsCachePath() {
    const home = os.homedir();
    const dir = path.join(home, '.gemini', 'antigravity');
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        }
        catch (_) { }
    }
    return path.join(dir, 'list_experiments_cache.json');
}
function loadCachedExperiments() {
    if (memoryListExperimentsCache)
        return memoryListExperimentsCache;
    try {
        const p = getListExperimentsCachePath();
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8').trim();
            if (content.startsWith('{')) {
                memoryListExperimentsCache = content;
                return content;
            }
        }
    }
    catch (e) {
        electron_log_1.default.debug('[Proxy] Failed to load cached experiments:', e);
    }
    return null;
}
function saveCachedExperiments(content) {
    try {
        memoryListExperimentsCache = content;
        memoryListExperimentsTime = Date.now();
        const p = getListExperimentsCachePath();
        fs.writeFileSync(p, content, 'utf-8');
    }
    catch (e) {
        electron_log_1.default.warn('[Proxy] Failed to save cached experiments:', e);
    }
}
async function executeOnRemoteDaemon(rawHost, token, command, workspaceId, sessionId, timeoutMs = 15000) {
    let cleanHost = (rawHost || constants_1.DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
    if (!cleanHost.startsWith('http://') && !cleanHost.startsWith('https://')) {
        cleanHost = 'https://' + cleanHost;
    }
    const url = new URL(cleanHost + '/v2/terminal/exec');
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https_1.default : http;
    const payload = JSON.stringify({
        command,
        workspaceId: (workspaceId && workspaceId !== 'default') ? workspaceId : 'antigravity-add-model-main',
        sessionId: sessionId || '',
        timeoutMs,
    });
    return new Promise((resolve) => {
        const r = transport.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                Authorization: `Bearer ${token || constants_1.DEFAULT_REMOTE_TOKEN}`,
                'User-Agent': 'AntigravityPatchProxy/3.7.3',
            },
            timeout: timeoutMs,
        }, (resp) => {
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    resolve(data);
                }
                catch {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        ok: resp.statusCode === 200,
                        stdout: raw,
                        stderr: '',
                        exitCode: resp.statusCode === 200 ? 0 : 1,
                    });
                }
            });
        });
        r.on('error', (err) => {
            resolve({ ok: false, stdout: '', stderr: err.message, exitCode: 1, error: err.message });
        });
        r.on('timeout', () => {
            r.destroy();
            resolve({ ok: false, stdout: '', stderr: 'Request timed out', exitCode: 124, error: 'timeout' });
        });
        r.write(payload);
        r.end();
    });
}
// Initialize on boot
loadRemoteState();
function generateGracefulMarkdown(diagnostic, model) {
    const alertType = diagnostic.severity === 'warning' ? 'WARNING' : 'CAUTION';
    const rawTitle = diagnostic.title.replace(/^Model unavailable:\s*/i, '');
    const title = `Model unavailable: ${rawTitle}`;
    let md = `> [!${alertType}]\n`;
    md += `> **${title}**\n>\n`;
    if (model) {
        const modelName = model.displayName || model.name;
        const providerStr = model.provider ? ` · **Provider:** \`${model.provider}\`` : '';
        md += `> **Model:** \`${modelName}\`${providerStr}\n>\n`;
    }
    md += `> ${diagnostic.message}\n`;
    if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
        md += `>\n> **Suggested Actions:**\n`;
        diagnostic.suggestions.forEach(s => {
            md += `> - ${s}\n`;
        });
    }
    if (diagnostic.actionUrl) {
        md += `>\n> 🔗 [Manage Billing & Credits](${diagnostic.actionUrl})\n`;
    }
    md += `\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
    return md;
}
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
function sendGracefulStreamError(res, diagnostic, model) {
    if (res.writableEnded)
        return;
    const errResponse = {
        response: {
            candidates: [
                {
                    content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
                    finishReason: 'STOP',
                    index: 0,
                },
            ],
        },
        traceId: '',
        metadata: {},
        _agDiagnostic: diagnostic,
    };
    sanitizeCandidatesInResponse(errResponse);
    if (!res.headersSent) {
        (0, httpUtils_1.safeWriteHead)(res, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-AG-Error-Type': diagnostic.errorType,
        });
    }
    writeSafeSseChunk(res, errResponse);
    (0, httpUtils_1.safeEnd)(res);
}
function sendGracefulNonStreamError(res, diagnostic, model) {
    if (res.writableEnded)
        return;
    const errResponse = {
        response: {
            candidates: [
                {
                    content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
                    finishReason: 'STOP',
                    index: 0,
                },
            ],
        },
        traceId: '',
        metadata: {},
        _agDiagnostic: diagnostic,
    };
    sanitizeCandidatesInResponse(errResponse);
    if (!res.headersSent) {
        (0, httpUtils_1.safeWriteHead)(res, 200, {
            'Content-Type': 'application/json',
            'X-AG-Error-Type': diagnostic.errorType,
        });
    }
    (0, httpUtils_1.safeEnd)(res, JSON.stringify(errResponse));
}
/**
 * Dispatch error response based on stream mode.
 * Prefers explicit stream or non-stream call at call sites to avoid boolean flags.
 */
function sendGracefulError(res, isStream, diagnostic, model) {
    if (isStream) {
        sendGracefulStreamError(res, diagnostic, model);
    }
    else {
        sendGracefulNonStreamError(res, diagnostic, model);
    }
}
// ─── Model Helpers ────────────────────────────────────────────────────────
// generateModelPlaceholderId and toSlug are now in ./proxy/idGenerator.ts (re-exported above)
// ─── Google Proxy ─────────────────────────────────────────────────────────
function sanitizeCandidatesInResponse(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return false;
    let modified = false;
    // 1. Antigravity Language Server crash protection:
    // In codeassistclient.(*CodeAssistClient).getStreamingTextCompletion-range1 at generation.go:673,
    // the Go language server unmarshals v1internal_prediction_service_go_proto.GenerateContentResponse
    // and accesses resp.Response.UsageMetadata at offset 0x50 without checking if resp.Response is nil.
    // If data.response is absent or null, resp.Response is nil, triggering panic 0xc0000005 (addr 0x50),
    // which crashes the language server and causes Antigravity IDE to reload.
    // Ensure data.response is ALWAYS a non-null object.
    if (!data.response || typeof data.response !== 'object') {
        data.response = {};
        modified = true;
    }
    // 2. Mirror candidates between root and data.response
    if (Array.isArray(data.candidates) && (!Array.isArray(data.response.candidates) || data.response.candidates.length === 0)) {
        data.response.candidates = data.candidates;
        modified = true;
    }
    else if (Array.isArray(data.response.candidates) && (!Array.isArray(data.candidates) || data.candidates.length === 0)) {
        data.candidates = data.response.candidates;
        modified = true;
    }
    if (!Array.isArray(data.response.candidates)) {
        data.response.candidates = [];
        modified = true;
    }
    if (!Array.isArray(data.candidates)) {
        data.candidates = data.response.candidates;
        modified = true;
    }
    // 3. Guarantee usageMetadata is non-null on both root and data.response to prevent nil dereference at generation.go:673
    if (!data.response.usageMetadata || typeof data.response.usageMetadata !== 'object') {
        data.response.usageMetadata = data.usageMetadata && typeof data.usageMetadata === 'object'
            ? data.usageMetadata
            : { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
        modified = true;
    }
    if (!data.usageMetadata || typeof data.usageMetadata !== 'object') {
        data.usageMetadata = data.response.usageMetadata;
        modified = true;
    }
    // 4. Mirror promptFeedback between root and data.response
    if (data.promptFeedback && !data.response.promptFeedback) {
        data.response.promptFeedback = data.promptFeedback;
        modified = true;
    }
    else if (data.response.promptFeedback && !data.promptFeedback) {
        data.promptFeedback = data.response.promptFeedback;
        modified = true;
    }
    // 5. Mirror modelVersion
    if (data.modelVersion && !data.response.modelVersion) {
        data.response.modelVersion = data.modelVersion;
        modified = true;
    }
    else if (data.response.modelVersion && !data.modelVersion) {
        data.modelVersion = data.response.modelVersion;
        modified = true;
    }
    const sanitizeList = (candidatesList, container, key) => {
        if (!Array.isArray(candidatesList))
            return [];
        let filtered = candidatesList.filter((c) => c && typeof c === 'object');
        if (filtered.length !== candidatesList.length) {
            container[key] = filtered;
            modified = true;
        }
        if (candidatesList.length === 0) {
            filtered = [{ content: { parts: [{ text: '' }], role: 'model' }, index: 0 }];
            container[key] = filtered;
            modified = true;
        }
        for (const cand of filtered) {
            if (!cand.content || typeof cand.content !== 'object') {
                cand.content = { parts: [{ text: '' }], role: 'model' };
                modified = true;
            }
            else {
                if (!Array.isArray(cand.content.parts) || cand.content.parts.length === 0) {
                    cand.content.parts = [{ text: '' }];
                    modified = true;
                }
                else {
                    for (let pIdx = 0; pIdx < cand.content.parts.length; pIdx++) {
                        const p = cand.content.parts[pIdx];
                        if (!p || typeof p !== 'object') {
                            cand.content.parts[pIdx] = { text: '' };
                            modified = true;
                        }
                        else if (p.functionCall && p.functionCall.name === googleAuth_1.SYNTHETIC_TOOL_NAME) {
                            const content = p.functionCall.args?.content;
                            if (typeof content === 'string') {
                                cand.content.parts[pIdx] = { text: content };
                                modified = true;
                            }
                        }
                        else if (typeof p.text === 'string' && p.text.includes('[Executed tool:')) {
                            const toolMatch = p.text.match(/\[Executed tool:\s*([a-zA-Z0-9_\-\.:]+)\s+with arguments:\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*\]/);
                            if (toolMatch) {
                                try {
                                    const fnName = toolMatch[1];
                                    const rawArgs = toolMatch[2];
                                    let parsedArgs;
                                    try {
                                        parsedArgs = JSON.parse(rawArgs);
                                    }
                                    catch (_) {
                                        // Resilient parse: fix unescaped Windows file paths (e.g. C:\Users\...) and lone backslashes in JSON strings
                                        const normalized = rawArgs.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, inner) => {
                                            const fixed = inner.replace(/\\([^\\])/g, (match, char) => {
                                                if (['"', '\\', '/'].includes(char))
                                                    return match;
                                                return '\\\\' + char;
                                            });
                                            return '"' + fixed + '"';
                                        });
                                        try {
                                            parsedArgs = JSON.parse(normalized);
                                        }
                                        catch (_) {
                                            parsedArgs = JSON.parse(rawArgs.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\'));
                                        }
                                    }
                                    const before = p.text.slice(0, toolMatch.index).trim();
                                    const after = p.text.slice(toolMatch.index + toolMatch[0].length).trim();
                                    const newParts = [];
                                    if (before)
                                        newParts.push({ text: before });
                                    newParts.push({ functionCall: { name: fnName, args: parsedArgs } });
                                    if (after)
                                        newParts.push({ text: after });
                                    cand.content.parts.splice(pIdx, 1, ...newParts);
                                    pIdx += newParts.length - 1;
                                    modified = true;
                                }
                                catch (_) { }
                            }
                        }
                        else if (p.text === undefined &&
                            !p.functionCall &&
                            !p.functionResponse &&
                            !p.fileData &&
                            !p.inlineData &&
                            !p.executableCode &&
                            !p.codeExecutionResult) {
                            p.text = '';
                            modified = true;
                        }
                    }
                }
                if (!cand.content.role) {
                    cand.content.role = 'model';
                    modified = true;
                }
            }
        }
        return filtered;
    };
    if (data.candidates) {
        data.candidates = sanitizeList(data.candidates, data, 'candidates');
    }
    if (data.response && typeof data.response === 'object' && data.response.candidates) {
        data.response.candidates = sanitizeList(data.response.candidates, data.response, 'candidates');
    }
    return modified;
}
function writeSafeSseChunk(res, chunk) {
    if (res.writableEnded || res.destroyed)
        return false;
    if (Array.isArray(chunk)) {
        let ok = true;
        for (const item of chunk) {
            if (item && typeof item === 'object') {
                ok = writeSafeSseChunk(res, item) && ok;
            }
        }
        return ok;
    }
    sanitizeCandidatesInResponse(chunk);
    try {
        return res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    }
    catch (err) {
        electron_log_1.default.warn('[Proxy] writeSafeSseChunk failed:', err.message);
        return false;
    }
}
function transformGoogleStreamForRemote(proxyRes, clientRes, convId = '', isRemote = true, modelName = '', startTime = Date.now()) {
    const headers = { ...proxyRes.headers };
    delete headers['content-length'];
    delete headers['content-encoding'];
    (0, httpUtils_1.safeWriteHead)(clientRes, proxyRes.statusCode || 200, headers);
    const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
    let stream = proxyRes;
    if (encoding === 'gzip') {
        const gunzip = zlib.createGunzip();
        proxyRes.pipe(gunzip);
        stream = gunzip;
    }
    else if (encoding === 'deflate') {
        const inflate = zlib.createInflate();
        proxyRes.pipe(inflate);
        stream = inflate;
    }
    const decoder = new string_decoder_1.StringDecoder('utf-8');
    let buffer = '';
    let detectedModel = modelName;
    const lastUsage = {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        cachedContentTokenCount: 0,
    };
    const inspectUsage = (item) => {
        if (!item || typeof item !== 'object')
            return;
        const usage = item.usageMetadata || (item.response && item.response.usageMetadata);
        if (usage && typeof usage === 'object') {
            if (typeof usage.promptTokenCount === 'number')
                lastUsage.promptTokenCount = usage.promptTokenCount;
            if (typeof usage.candidatesTokenCount === 'number')
                lastUsage.candidatesTokenCount = usage.candidatesTokenCount;
            if (typeof usage.totalTokenCount === 'number')
                lastUsage.totalTokenCount = usage.totalTokenCount;
            if (typeof usage.cachedContentTokenCount === 'number')
                lastUsage.cachedContentTokenCount = usage.cachedContentTokenCount;
        }
        const m = item.modelVersion || (item.response && item.response.modelVersion);
        if (m && typeof m === 'string') {
            detectedModel = m;
        }
    };
    let sawFinishReason = false;
    const inspectFinishReason = (obj) => {
        if (!obj || typeof obj !== 'object')
            return;
        const cands = obj.candidates || (obj.response && obj.response.candidates);
        if (Array.isArray(cands)) {
            for (const c of cands) {
                if (c && c.finishReason) {
                    sawFinishReason = true;
                    return;
                }
            }
        }
    };
    const processLine = (line) => {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr === '[DONE]') {
                // Drop OpenAI-style [DONE] marker — Google Language Server parses all SSE data as protojson
                // messages (GenerateContentResponse) and crashes with "proto: syntax error (line 1:1): unexpected token [" if it receives [DONE].
                return;
            }
            if (!jsonStr) {
                clientRes.write(': ping\n');
                return;
            }
            try {
                const data = JSON.parse(jsonStr);
                // If data is an array of responses, unwrap each item individually to avoid emitting a JSON array as a proto message
                if (Array.isArray(data)) {
                    const eol = line.endsWith('\r') ? '\r\n' : '\n';
                    for (const item of data) {
                        if (item && typeof item === 'object') {
                            inspectUsage(item);
                            inspectFinishReason(item);
                            (0, shared_1.extractAndCacheThoughtSignatures)(item, convId);
                            sanitizeCandidatesInResponse(item);
                            clientRes.write('data: ' + JSON.stringify(item) + eol);
                        }
                    }
                    return;
                }
                inspectUsage(data);
                // Cache any thought_signature values from this response chunk
                inspectFinishReason(data);
                (0, shared_1.extractAndCacheThoughtSignatures)(data, convId);
                // Antigravity Language Server crash protection:
                // In codeassistclient.(*CodeAssistClient).getStreamingTextCompletion-range1,
                // the language server iterates over chunk.Candidates and accesses
                // candidate.Content.Parts at offset 0x50 without nil checking.
                // If Content or Parts is missing/nil/empty, Go panics with signal 0xc0000005.
                sanitizeCandidatesInResponse(data);
                const eol = line.endsWith('\r') ? '\r\n' : '\n';
                clientRes.write('data: ' + JSON.stringify(data) + eol);
                return;
            }
            catch (e) {
                electron_log_1.default.warn('[Proxy] Malformed SSE data chunk from upstream Google:', jsonStr.slice(0, 100));
                return;
            }
        }
        // Only forward valid SSE control lines or empty lines.
        // Never forward arbitrary raw text (like raw JSON brackets '[' or '{') into the SSE stream!
        if (trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:') || !trimmed) {
            clientRes.write(line + '\n');
        }
        else {
            electron_log_1.default.debug('[Proxy] Suppressed non-SSE upstream line from stream:', trimmed.slice(0, 60));
        }
    };
    stream.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        let lineEndIdx;
        while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, lineEndIdx);
            buffer = buffer.slice(lineEndIdx + 1);
            processLine(line);
        }
    });
    stream.on('end', () => {
        buffer += decoder.end();
        if (buffer.length > 0) {
            processLine(buffer);
            if (buffer.trim().startsWith('data:') && buffer.trim().slice(5).trim() !== '[DONE]') {
                clientRes.write('\n\n');
            }
            buffer = '';
        }
        if (!sawFinishReason && !clientRes.writableEnded) {
            const finalChunk = {
                response: {
                    candidates: [
                        {
                            content: { parts: [{ text: '' }], role: 'model' },
                            finishReason: 'STOP',
                            index: 0,
                        },
                    ],
                },
                traceId: '',
                metadata: {},
            };
            sanitizeCandidatesInResponse(finalChunk);
            writeSafeSseChunk(clientRes, finalChunk);
        }
        (0, httpUtils_1.safeEnd)(clientRes);
        const latencyMs = Math.max(1, Date.now() - startTime);
        const pTokens = lastUsage.promptTokenCount || 0;
        const cTokens = lastUsage.candidatesTokenCount || 0;
        const tTokens = lastUsage.totalTokenCount || (pTokens + cTokens);
        if (tTokens > 0 || pTokens > 0) {
            logTokenUsageEvent({
                id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                timestamp: Date.now(),
                conversationId: convId || undefined,
                provider: 'google',
                model: detectedModel || modelName || 'gemini-2.5-pro',
                promptTokens: pTokens,
                completionTokens: cTokens,
                totalTokens: tTokens,
                cachedTokens: lastUsage.cachedContentTokenCount || 0,
                latencyMs,
                status: proxyRes.statusCode || 200,
                endpoint: '/v1internal:streamGenerateContent',
            });
        }
    });
    stream.on('error', (err) => {
        electron_log_1.default.error('[Proxy] Upstream Google stream error:', err);
        if (!sawFinishReason && !clientRes.writableEnded && !clientRes.destroyed) {
            const finalChunk = {
                response: {
                    candidates: [
                        {
                            content: { parts: [{ text: '' }], role: 'model' },
                            finishReason: 'STOP',
                            index: 0,
                        },
                    ],
                },
                traceId: '',
                metadata: {},
            };
            sanitizeCandidatesInResponse(finalChunk);
            writeSafeSseChunk(clientRes, finalChunk);
            (0, httpUtils_1.safeEnd)(clientRes);
        }
        else {
            clientRes.destroy(err);
        }
    });
}
// ─── Thought Signature Cache Helpers ──────────────────────────────────────
async function proxyToGoogle(req, res, reqBody, isRemoteSession = false, customAuthHeader, convId = '', hostOverride, sessId = '', originalModel = '') {
    const traceId = newTraceId();
    const isCloudCodeUrl = req.url.includes('v1internal') || req.url.includes('daily-cloudcode') || req.url.includes('cloudcode');
    const targetHost = hostOverride || (isCloudCodeUrl ? constants_1.GOOGLE_HOSTS.CLOUD_CODE : constants_1.GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
    const targetUrl = `https://${targetHost}`;
    const parsedUrl = new URL(req.url, targetUrl);
    const endTimer = (0, metrics_1.startTimer)('proxy_request_ms', { upstream: targetHost });
    electron_log_1.default.debug('[Proxy] req', traceId, req.method, req.url, '→', targetHost);
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
    headers['content-length'] = String(reqBody.length);
    delete headers['connection'];
    delete headers['keep-alive'];
    if (customAuthHeader) {
        headers['authorization'] = customAuthHeader;
        headers['Authorization'] = customAuthHeader;
    }
    if (isCloudCodeUrl) {
        headers['user-agent'] = 'antigravity';
        headers['User-Agent'] = 'antigravity';
    }
    const isGeneration = req.url.includes('generateContent') || req.url.includes('streamGenerateContent');
    const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;
    if (shouldBufferAndModify || isGeneration) {
        delete headers['accept-encoding'];
        delete headers['Accept-Encoding'];
    }
    const options = {
        method: req.method,
        headers: headers,
        servername: targetHost,
    };
    // Guard flag to prevent ERR_HTTP_HEADERS_SENT when timeout and response race
    const safeHead = (status, headers) => (0, httpUtils_1.safeWriteHead)(res, status, headers);
    const proxyReq = https_1.default.request(parsedUrl, options, (proxyRes) => {
        proxyReq.setTimeout(0);
        if (!hostOverride && isCloudCodeUrl && !isGeneration && (proxyRes.statusCode === 503 || proxyRes.statusCode === 502)) {
            electron_log_1.default.warn(`[Proxy] Google Cloud Code returned ${proxyRes.statusCode} on ${targetHost}. Trying production endpoint ${constants_1.GOOGLE_HOSTS.CLOUD_CODE_PROD} for non-generation request...`);
            proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, constants_1.GOOGLE_HOSTS.CLOUD_CODE_PROD);
            return;
        }
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
                electron_log_1.default.debug(`[Proxy] Response for ${req.url} (status: ${proxyRes.statusCode}, encoding: ${encoding}, length: ${text.length})`);
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
                if (req.url.includes('loadCodeAssist') && proxyRes.statusCode === 200 && text.startsWith('{')) {
                    text = unlockCodeAssistPayload(text);
                    saveCachedCodeAssist(text);
                }
                if ((0, httpUtils_1.safeWriteHead)(res, proxyRes.statusCode || 200, modifiedHeaders)) {
                    (0, httpUtils_1.safeEnd)(res, modifiedBuffer);
                }
            });
        }
        else if (isGeneration) {
            let reqModelName = '';
            try {
                const parsedReq = JSON.parse(reqBody.toString('utf-8'));
                reqModelName = parsedReq.model || parsedReq.requestedModel || (parsedReq.request && parsedReq.request.model) || '';
            }
            catch { }
            const reqStart = Date.now();
            const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
            if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
                electron_log_1.default.warn(`[Proxy] Google returned upstream error status ${proxyRes.statusCode}. Forwarding official error directly to client.`);
                const errChunks = [];
                proxyRes.on('data', (chunk) => errChunks.push(chunk));
                proxyRes.on('end', () => {
                    const fullErr = Buffer.concat(errChunks);
                    const effectiveModel = reqModelName || originalModel || '';
                    if (convId) {
                        recordNativeSessionError(convId, proxyRes.statusCode, proxyRes.headers, fullErr, effectiveModel);
                    }
                    if (sessId && sessId !== convId) {
                        recordNativeSessionError(sessId, proxyRes.statusCode, proxyRes.headers, fullErr, effectiveModel);
                    }
                });
                if (safeHead(proxyRes.statusCode, proxyRes.headers)) {
                    proxyRes.pipe(res);
                }
                return;
            }
            if (isStream) {
                transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, reqModelName, reqStart);
            }
            else {
                const responseChunks = [];
                proxyRes.on('data', (chunk) => responseChunks.push(chunk));
                proxyRes.on('end', () => {
                    if (res.headersSent || res.writableEnded)
                        return;
                    const fullResBody = Buffer.concat(responseChunks);
                    let text = fullResBody.toString('utf-8');
                    try {
                        const data = JSON.parse(text);
                        // Cache any thought_signature values from this response
                        (0, shared_1.extractAndCacheThoughtSignatures)(data, convId);
                        if (sanitizeCandidatesInResponse(data)) {
                            text = JSON.stringify(data);
                        }
                        const usage = data?.response?.usageMetadata || data?.usageMetadata;
                        if (usage) {
                            const pTokens = usage.promptTokenCount || 0;
                            const cTokens = usage.candidatesTokenCount || 0;
                            const tTokens = usage.totalTokenCount || (pTokens + cTokens);
                            if (tTokens > 0 || pTokens > 0) {
                                logTokenUsageEvent({
                                    id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                                    timestamp: Date.now(),
                                    conversationId: convId || undefined,
                                    provider: 'google',
                                    model: reqModelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-2.5-pro',
                                    promptTokens: pTokens,
                                    completionTokens: cTokens,
                                    totalTokens: tTokens,
                                    cachedTokens: usage.cachedContentTokenCount || 0,
                                    latencyMs: Math.max(1, Date.now() - reqStart),
                                    status: proxyRes.statusCode || 200,
                                    endpoint: '/v1internal:generateContent',
                                });
                            }
                        }
                    }
                    catch (_) { }
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
        }
        else {
            if (safeHead(proxyRes.statusCode || 200, proxyRes.headers)) {
                proxyRes.pipe(res);
            }
        }
    });
    proxyReq.on('error', (err) => {
        if (!hostOverride && isCloudCodeUrl && !isGeneration && !res.headersSent && !res.writableEnded) {
            electron_log_1.default.warn(`[Proxy] Google Cloud Code network error on ${targetHost} (${err.message}). Trying production endpoint ${constants_1.GOOGLE_HOSTS.CLOUD_CODE_PROD} for non-generation request...`);
            proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, constants_1.GOOGLE_HOSTS.CLOUD_CODE_PROD);
            return;
        }
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
        electron_log_1.default.debug('[Proxy] Upstream request closed traceId=', traceId, 'after', ms, 'ms');
    });
    proxyReq.setTimeout(60000, () => {
        electron_log_1.default.error(`[Proxy] Google proxy request timed out after 60s (${req.method} ${req.url})`);
        proxyReq.destroy();
        if (safeHead(504, { 'Content-Type': 'application/json' })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'Google API request timed out' } }));
        }
    });
    if (reqBody) {
        proxyReq.write(reqBody);
    }
    proxyReq.end();
}
function executeGoogleCloudCodeRequest(req, res, reqBody, isRemoteSession = false, customAuthHeader, convId = '', hostOverride, timeoutMs, modelName = '', startTime = Date.now()) {
    return new Promise((resolve) => {
        const traceId = newTraceId();
        const isCloudCodeUrl = req.url.includes('v1internal') || req.url.includes('daily-cloudcode') || req.url.includes('cloudcode');
        const targetHost = hostOverride || (isCloudCodeUrl ? constants_1.GOOGLE_HOSTS.CLOUD_CODE : constants_1.GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
        const targetUrl = `https://${targetHost}`;
        const parsedUrl = new URL(req.url, targetUrl);
        const endTimer = (0, metrics_1.startTimer)('proxy_request_ms', { upstream: targetHost });
        let settled = false;
        let proxyReq;
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            if (proxyReq) {
                try {
                    proxyReq.setTimeout(0);
                }
                catch (_) { }
            }
            resolve(outcome);
        };
        (0, dnsResolver_1.resolveGoogleIp)(targetHost).then((realIp) => {
            parsedUrl.hostname = realIp;
            const headers = {
                ...req.headers,
            };
            headers['host'] = targetHost;
            headers['content-length'] = String(reqBody.length);
            delete headers['connection'];
            delete headers['keep-alive'];
            if (customAuthHeader) {
                headers['authorization'] = customAuthHeader;
                headers['Authorization'] = customAuthHeader;
            }
            if (isCloudCodeUrl) {
                headers['user-agent'] = 'antigravity';
                headers['User-Agent'] = 'antigravity';
            }
            const isGeneration = req.url.includes('generateContent') || req.url.includes('streamGenerateContent');
            const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
            const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;
            if (shouldBufferAndModify || isGeneration) {
                delete headers['accept-encoding'];
                delete headers['Accept-Encoding'];
            }
            const options = {
                method: req.method,
                headers: headers,
                servername: targetHost,
                agent: (0, agentPool_1.getHttpsAgent)({ host: targetHost }),
            };
            proxyReq = https_1.default.request(parsedUrl, options, (proxyRes) => {
                // Disable request socket timeout once response headers start streaming in
                proxyReq?.setTimeout(0);
                const status = proxyRes.statusCode || 200;
                // If upstream error (429, 400, 401, 403, 404, 500, 502, 503, 504):
                // Intercept BEFORE writing anything to client res!
                if (status >= 400) {
                    const errChunks = [];
                    proxyRes.on('data', (c) => errChunks.push(c));
                    proxyRes.on('end', () => {
                        const errText = Buffer.concat(errChunks).toString('utf-8');
                        finish({ success: false, statusCode: status, error: errText, headers: proxyRes.headers });
                    });
                    return;
                }
                // Upstream returned 2xx: Success!
                if (shouldBufferAndModify) {
                    const responseChunks = [];
                    proxyRes.on('data', (chunk) => responseChunks.push(chunk));
                    proxyRes.on('end', () => {
                        if (res.headersSent || res.writableEnded) {
                            finish({ success: true, statusCode: status });
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
                                if ((0, httpUtils_1.safeWriteHead)(res, 502, { 'Content-Type': 'application/json' })) {
                                    (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: `Decompression failed: ${e.message}` } }));
                                }
                                finish({ success: true, statusCode: 502 });
                                return;
                            }
                        }
                        else {
                            text = fullResBody.toString('utf-8');
                        }
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
                        if ((0, httpUtils_1.safeWriteHead)(res, status, modifiedHeaders)) {
                            (0, httpUtils_1.safeEnd)(res, modifiedBuffer);
                        }
                        finish({ success: true, statusCode: status });
                    });
                }
                else if (isGeneration) {
                    if (isStream) {
                        transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, modelName, startTime);
                        finish({ success: true, statusCode: status });
                    }
                    else {
                        const responseChunks = [];
                        proxyRes.on('data', (chunk) => responseChunks.push(chunk));
                        proxyRes.on('end', () => {
                            if (res.headersSent || res.writableEnded) {
                                finish({ success: true, statusCode: status });
                                return;
                            }
                            const fullResBody = Buffer.concat(responseChunks);
                            let text = fullResBody.toString('utf-8');
                            try {
                                const data = JSON.parse(text);
                                (0, shared_1.extractAndCacheThoughtSignatures)(data, convId);
                                let modified = sanitizeCandidatesInResponse(data);
                                if (isRemoteSession && Array.isArray(data.candidates)) {
                                    for (const cand of data.candidates) {
                                        if (cand?.content?.parts && Array.isArray(cand.content.parts)) {
                                            for (const part of cand.content.parts) {
                                                if (part.functionCall) {
                                                    const fnName = (part.functionCall.name || '').toLowerCase();
                                                    const isRunCmd = fnName === 'run_command' ||
                                                        fnName.endsWith(':run_command') ||
                                                        fnName === 'bash' ||
                                                        fnName === 'sh' ||
                                                        fnName.endsWith(':bash') ||
                                                        fnName.endsWith(':sh');
                                                    if (isRunCmd) {
                                                        const args = part.functionCall.args;
                                                        if (args) {
                                                            const originalCmd = (args.CommandLine || args.commandLine || args.command || args.cmd);
                                                            if (typeof originalCmd === 'string' && originalCmd.trim()) {
                                                                const remoteCwd = (args.Cwd || args.cwd);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                if (modified) {
                                    text = JSON.stringify(data);
                                }
                                const usage = data?.response?.usageMetadata || data?.usageMetadata;
                                if (usage) {
                                    const pTokens = usage.promptTokenCount || 0;
                                    const cTokens = usage.candidatesTokenCount || 0;
                                    const tTokens = usage.totalTokenCount || (pTokens + cTokens);
                                    if (tTokens > 0 || pTokens > 0) {
                                        logTokenUsageEvent({
                                            id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                                            timestamp: Date.now(),
                                            conversationId: convId || undefined,
                                            provider: 'google',
                                            model: modelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-2.5-pro',
                                            promptTokens: pTokens,
                                            completionTokens: cTokens,
                                            totalTokens: tTokens,
                                            cachedTokens: usage.cachedContentTokenCount || 0,
                                            latencyMs: Math.max(1, Date.now() - startTime),
                                            status,
                                            endpoint: '/v1internal:generateContent',
                                        });
                                    }
                                }
                            }
                            catch (_) { }
                            const modifiedHeaders = { ...proxyRes.headers };
                            delete modifiedHeaders['content-encoding'];
                            delete modifiedHeaders['transfer-encoding'];
                            const modifiedBuffer = Buffer.from(text, 'utf-8');
                            modifiedHeaders['content-length'] = String(modifiedBuffer.length);
                            if ((0, httpUtils_1.safeWriteHead)(res, status, modifiedHeaders)) {
                                (0, httpUtils_1.safeEnd)(res, modifiedBuffer);
                            }
                            finish({ success: true, statusCode: status });
                        });
                    }
                }
                else {
                    if ((0, httpUtils_1.safeWriteHead)(res, status, proxyRes.headers)) {
                        proxyRes.pipe(res);
                    }
                    finish({ success: true, statusCode: status });
                }
            });
            let isTimedOut = false;
            proxyReq.on('error', (err) => {
                if (isTimedOut)
                    return;
                (0, metrics_1.inc)('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
                const ms = endTimer();
                proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
                finish({ success: false, statusCode: 502, error: 'Proxy forwarding failed: ' + err.message });
            });
            proxyReq.on('close', () => {
                const ms = endTimer();
                (0, metrics_1.observe)('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
            });
            const effectiveTimeout = timeoutMs || constants_1.GOOGLE_PROXY_TIMEOUT_MS;
            proxyReq.setTimeout(effectiveTimeout, () => {
                isTimedOut = true;
                electron_log_1.default.error(`[Proxy] Google pool request timed out waiting for response headers on ${targetHost} after ${effectiveTimeout / 1000}s`);
                proxyReq?.destroy();
                finish({ success: false, statusCode: 504, error: 'Google API request timed out' });
            });
            if (reqBody) {
                proxyReq.write(reqBody);
            }
            proxyReq.end();
        }).catch((dnsErr) => {
            (0, metrics_1.inc)('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
            const ms = endTimer();
            proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
            finish({ success: false, statusCode: 500, error: 'DNS resolution failed: ' + dnsErr.message });
        });
    });
}
async function executeGoogleCloudCodeWithPool(req, res, reqJson, accountPool, isSessionRemote, convId, sessId, attemptedModels = new Set(), fallbackDepth = 0) {
    // Normalize payload: If caller provided a flat Gemini request (contents at root), wrap it inside reqJson.request
    if (!reqJson.request && Array.isArray(reqJson.contents)) {
        const { contents, generationConfig, tools, safetySettings, systemInstruction } = reqJson;
        reqJson.request = {
            contents,
            ...(generationConfig ? { generationConfig } : {}),
            ...(tools ? { tools } : {}),
            ...(safetySettings ? { safetySettings } : {}),
            ...(systemInstruction ? { systemInstruction } : {}),
        };
        delete reqJson.contents;
        delete reqJson.generationConfig;
        delete reqJson.tools;
        delete reqJson.safetySettings;
        delete reqJson.systemInstruction;
    }
    let targetRaw = String(reqJson.model || reqJson.request?.model || '');
    if (/MODEL_PLACEHOLDER_/i.test(targetRaw) || !targetRaw) {
        const poolCandidate = accountPool?.[0]?.externalModelName || accountPool?.[0]?.name;
        if (poolCandidate) {
            targetRaw = poolCandidate;
            reqJson.model = targetRaw;
            if (reqJson.request && typeof reqJson.request === 'object') {
                reqJson.request.model = targetRaw;
            }
        }
    }
    const resolvedTarget = (0, googleAuth_1.normalizeCloudCodeModelId)(targetRaw).toLowerCase();
    if (resolvedTarget) {
        reqJson.model = resolvedTarget;
        if (reqJson.request && typeof reqJson.request === 'object') {
            reqJson.request.model = resolvedTarget;
        }
        attemptedModels.add(resolvedTarget);
    }
    const isClaude = resolvedTarget.includes('claude');
    const modelFamily = isClaude ? 'claude' : 'gemini';
    // Eco-Routing / Graceful Degradation: If pool is under severe quota stress (<15% average),
    // downgrade background / auxiliary tasks (summaries, titles) to Flash to preserve Pro quota.
    // Guard: only redirect if at least one account is still available — redirecting into a fully
    // exhausted pool just wastes a retry slot on the same drained accounts.
    if (process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1' && (0, googlePool_1.isPoolUnderQuotaStress)(accountPool, modelFamily)) {
        const hasAnyAvailable = accountPool.some((a) => !(0, googlePool_1.isAccountInCooldown)(a, modelFamily) && !(0, circuitBreaker_1.getOpenBreaker)(a) && !(0, googleAuth_1.isTokenRevoked)(a.refreshToken));
        const reqType = String(reqJson.requestType || reqJson.request?.requestType || '').toUpperCase();
        const isAuxiliary = reqType === 'CONVERSATION_TITLE' || reqType === 'TITLE' || reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY';
        const isAlreadyFlash = resolvedTarget.includes('flash') || resolvedTarget.includes('lite');
        if (isAuxiliary && !isAlreadyFlash && hasAnyAvailable) {
            electron_log_1.default.info('[Proxy] [Eco-Routing] Pool under quota stress (<15% avg): routing auxiliary request to gemini-3.8-flash-tiered.');
            reqJson.model = 'gemini-3.8-flash-tiered';
            if (reqJson.request && typeof reqJson.request === 'object') {
                reqJson.request.model = 'gemini-3.8-flash-tiered';
            }
        }
        else if (isAuxiliary && !hasAnyAvailable) {
            electron_log_1.default.debug('[Proxy] [Eco-Routing] Pool fully exhausted — skipping flash redirect, fast-fail will handle it.');
        }
    }
    // Dedicated 5.5 Routing: When requesting Claude 5.5 (Opus 5.5 / Sonnet 5.5),
    // strictly filter candidate pool to accounts entitled to 5.5 (e.g. family group or direct Pro)
    // to avoid instant 429 quota exhaustion from standard Jio trial parent accounts.
    const isClaude55 = targetRaw.includes('5-5') ||
        targetRaw.includes('5.5') ||
        resolvedTarget.includes('5-5') ||
        (typeof reqJson.requestedModel === 'string' && (reqJson.requestedModel.includes('5.5') || reqJson.requestedModel.includes('5-5'))) ||
        (typeof reqJson.model === 'string' && (reqJson.model.includes('5.5') || reqJson.model.includes('5-5')));
    const activePool = accountPool.filter((a) => {
        const qKey = (0, googlePool_1.getAccountQuotaKey)(a);
        const liveQ = ((0, googleAuth_1.getLiveAccountQuota)(qKey) || a.quotas);
        return !a.isUnlicensed && !liveQ?.isUnlicensed;
    });
    let eligibleAccounts = activePool.length > 0 ? activePool : accountPool;
    if (isClaude55) {
        const candidates55 = eligibleAccounts.filter((a) => (0, googleAuth_1.isAccountEntitledToClaude55)(a));
        const otherCandidates = eligibleAccounts.filter((a) => !(0, googleAuth_1.isAccountEntitledToClaude55)(a));
        const healthy55 = candidates55.filter((a) => !(0, googlePool_1.isAccountInCooldown)(a, modelFamily) && (0, googlePool_1.getModelQuotaScore)(a, modelFamily) > 0);
        if (healthy55.length > 0) {
            electron_log_1.default.info(`[Proxy] [5.5 Routing] Prioritizing ${healthy55.length}/${candidates55.length} healthy 5.5-entitled account(s) (PARTAGE), retaining ${otherCandidates.length} account(s) as pool fallback.`);
            eligibleAccounts = [...candidates55, ...otherCandidates];
        }
        else if (candidates55.length > 0) {
            electron_log_1.default.warn(`[Proxy] [5.5 Routing] 5.5-entitled account(s) have 0% quota or are in cooldown; falling back to remaining pool (${otherCandidates.length} account(s)).`);
            eligibleAccounts = [...otherCandidates, ...candidates55];
        }
        else {
            electron_log_1.default.warn(`[Proxy] [5.5 Routing] No accounts auto-detected with 5.5 entitlement; falling back to full pool.`);
            eligibleAccounts = accountPool;
        }
    }
    const sortedAccounts = [...eligibleAccounts].sort((a, b) => {
        const cdA = (0, googlePool_1.isAccountInCooldown)(a, modelFamily) ? 1 : 0;
        const cdB = (0, googlePool_1.isAccountInCooldown)(b, modelFamily) ? 1 : 0;
        if (cdA !== cdB)
            return cdA - cdB;
        const breakerA = (0, circuitBreaker_1.getOpenBreaker)(a) ? 1 : 0;
        const breakerB = (0, circuitBreaker_1.getOpenBreaker)(b) ? 1 : 0;
        if (breakerA !== breakerB)
            return breakerA - breakerB;
        const hasQuotaA = (0, googlePool_1.getModelQuotaScore)(a, modelFamily) > 0 ? 1 : 0;
        const hasQuotaB = (0, googlePool_1.getModelQuotaScore)(b, modelFamily) > 0 ? 1 : 0;
        if (hasQuotaA !== hasQuotaB)
            return hasQuotaB - hasQuotaA;
        const maxA = (0, googlePool_1.isAccountInProbation)(a, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
        const maxB = (0, googlePool_1.isAccountInProbation)(b, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
        const satA = (0, googlePool_1.getAccountInFlight)(a) >= maxA ? 1 : 0;
        const satB = (0, googlePool_1.getAccountInFlight)(b) >= maxB ? 1 : 0;
        if (satA !== satB)
            return satA - satB;
        if (isClaude55) {
            const entA = (0, googleAuth_1.isAccountEntitledToClaude55)(a) ? 1 : 0;
            const entB = (0, googleAuth_1.isAccountEntitledToClaude55)(b) ? 1 : 0;
            if (entA !== entB) {
                const scoreA = (0, googlePool_1.getModelQuotaScore)(a, modelFamily);
                const scoreB = (0, googlePool_1.getModelQuotaScore)(b, modelFamily);
                if (entA > entB && scoreA > 0)
                    return -1;
                if (entB > entA && scoreB > 0)
                    return 1;
            }
        }
        return (0, googlePool_1.getAccountDynamicScore)(b, modelFamily) - (0, googlePool_1.getAccountDynamicScore)(a, modelFamily);
    });
    let boundAccount;
    const useStickySessions = process.env.AG_STICKY_GOOGLE_ACCOUNTS === '1';
    if (sessId && useStickySessions) {
        boundAccount = sortedAccounts.find((m) => {
            const affinity = sessionAffinities.get(sessId);
            return affinity && (0, googlePool_1.getAccountQuotaKey)(m) === affinity.accountKey && !(0, circuitBreaker_1.getOpenBreaker)(m) && !(0, googlePool_1.isAccountInCooldown)(m, modelFamily) && (0, googlePool_1.getModelQuotaScore)(m) > 0;
        });
        if (boundAccount) {
            const idx = sortedAccounts.indexOf(boundAccount);
            if (idx > 0) {
                sortedAccounts.splice(idx, 1);
                sortedAccounts.unshift(boundAccount);
            }
        }
    }
    // If no bound account from session affinity, use P2C to pick the lead account among top available
    if (!boundAccount && sortedAccounts.length > 1) {
        const lead = (0, googlePool_1.selectCandidateP2C)(sortedAccounts, modelFamily);
        if (lead) {
            const idx = sortedAccounts.indexOf(lead);
            if (idx > 0) {
                sortedAccounts.splice(idx, 1);
                sortedAccounts.unshift(lead);
            }
        }
    }
    // If the pool has eligible accounts but all are temporarily saturated by in-flight concurrency,
    // wait up to 1500ms in a micro-wait queue for an in-flight slot to release before attempting requests.
    const hasEligibleAccounts = sortedAccounts.some((a) => !(0, googlePool_1.isAccountInCooldown)(a, modelFamily) && !(0, circuitBreaker_1.getOpenBreaker)(a) && (0, googlePool_1.getModelQuotaScore)(a, modelFamily) > 0);
    const allSaturated = hasEligibleAccounts && sortedAccounts.every((a) => {
        if ((0, googlePool_1.isAccountInCooldown)(a, modelFamily) || (0, circuitBreaker_1.getOpenBreaker)(a) || (0, googlePool_1.getModelQuotaScore)(a, modelFamily) <= 0) {
            return true;
        }
        const max = (0, googlePool_1.isAccountInProbation)(a, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
        return (0, googlePool_1.getAccountInFlight)(a) >= max;
    });
    if (allSaturated) {
        electron_log_1.default.debug(`[Proxy] All eligible accounts in Google pool are saturated (${googlePool_1.MAX_CONCURRENT_PER_ACCOUNT} in-flight reqs). Waiting up to 1500ms for an available slot...`);
        await (0, googlePool_1.waitForAccountSlot)(sortedAccounts, modelFamily, 1500);
        // Re-sort after waiting so the newly freed account rises to the top
        sortedAccounts.sort((a, b) => {
            const cdA = (0, googlePool_1.isAccountInCooldown)(a, modelFamily) ? 1 : 0;
            const cdB = (0, googlePool_1.isAccountInCooldown)(b, modelFamily) ? 1 : 0;
            if (cdA !== cdB)
                return cdA - cdB;
            const breakerA = (0, circuitBreaker_1.getOpenBreaker)(a) ? 1 : 0;
            const breakerB = (0, circuitBreaker_1.getOpenBreaker)(b) ? 1 : 0;
            if (breakerA !== breakerB)
                return breakerA - breakerB;
            const hasQuotaA = (0, googlePool_1.getModelQuotaScore)(a, modelFamily) > 0 ? 1 : 0;
            const hasQuotaB = (0, googlePool_1.getModelQuotaScore)(b, modelFamily) > 0 ? 1 : 0;
            if (hasQuotaA !== hasQuotaB)
                return hasQuotaB - hasQuotaA;
            const maxA = (0, googlePool_1.isAccountInProbation)(a, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
            const maxB = (0, googlePool_1.isAccountInProbation)(b, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
            const satA = (0, googlePool_1.getAccountInFlight)(a) >= maxA ? 1 : 0;
            const satB = (0, googlePool_1.getAccountInFlight)(b) >= maxB ? 1 : 0;
            if (satA !== satB)
                return satA - satB;
            return (0, googlePool_1.getAccountDynamicScore)(b, modelFamily) - (0, googlePool_1.getAccountDynamicScore)(a, modelFamily);
        });
    }
    let lastStatus = 500;
    let lastErrorText = 'All accounts in Google Cloud Code pool exhausted';
    const totalAttempts = sortedAccounts.length;
    let consecutive429Count = 0;
    let consecutiveQuotaExhausted = 0;
    let consecutiveTimeoutCount = 0;
    let testedAccountsCount = 0;
    const initialHealthyCount = sortedAccounts.filter((a) => !(0, googlePool_1.isAccountInCooldown)(a, modelFamily) && !(0, circuitBreaker_1.getOpenBreaker)(a) && (0, googlePool_1.getModelQuotaScore)(a, modelFamily) > 0).length;
    if (initialHealthyCount > 0 && initialHealthyCount < 3) {
        electron_log_1.default.warn(`[Proxy] ⚠️ Low pool headroom for ${modelFamily}: only ${initialHealthyCount} healthy account(s) available. Cascade fallback is armed.`);
    }
    for (let i = 0; i < totalAttempts; i++) {
        const candidate = sortedAccounts[i];
        const candidateName = candidate.accountEmail ||
            candidate.accountName ||
            (candidate.refreshToken ? `token:..${candidate.refreshToken.slice(-6)}` : '') ||
            candidate.displayName ||
            candidate.name;
        // Fast-skip: if this candidate is already in active cooldown for this model family
        if ((0, googlePool_1.isAccountInCooldown)(candidate, modelFamily)) {
            const hasEligibleRemaining = sortedAccounts.slice(i).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, modelFamily));
            if (!hasEligibleRemaining) {
                lastStatus = 429;
                lastErrorText = `All accounts in Google Cloud Code pool are in active cooldown for ${modelFamily}`;
                electron_log_1.default.warn(`[Proxy] All remaining accounts in pool are in cooldown for ${modelFamily}. Stopping pool search.`);
                break;
            }
            continue;
        }
        // Fast-skip: if this candidate has 0% quota remaining and reset has not passed
        const candidateQuotaScore = (0, googlePool_1.getModelQuotaScore)(candidate, modelFamily);
        if (candidateQuotaScore <= 0) {
            const hasPositiveRemaining = sortedAccounts.slice(i + 1).some((c) => (0, googlePool_1.getModelQuotaScore)(c, modelFamily) > 0 && !(0, googlePool_1.isAccountInCooldown)(c, modelFamily));
            if (hasPositiveRemaining) {
                electron_log_1.default.info(`[Proxy] Fast-skipping candidate ${candidateName}: 0% quota remaining for ${modelFamily}`);
                continue;
            }
        }
        // Fast-skip: if this candidate reached max concurrent in-flight slots (2, or 1 in probation)
        // and other healthy candidates have free slots available, divert to an idle account to prevent Google 504 overload.
        const candidateMaxSlots = (0, googlePool_1.isAccountInProbation)(candidate, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT;
        if ((0, googlePool_1.getAccountInFlight)(candidate) >= candidateMaxSlots) {
            const hasOtherFreeAccount = sortedAccounts.slice(i + 1).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, modelFamily) &&
                !(0, circuitBreaker_1.getOpenBreaker)(c) &&
                (0, googlePool_1.getModelQuotaScore)(c, modelFamily) > 0 &&
                (0, googlePool_1.getAccountInFlight)(c) < ((0, googlePool_1.isAccountInProbation)(c, modelFamily) ? 1 : googlePool_1.MAX_CONCURRENT_PER_ACCOUNT));
            if (hasOtherFreeAccount) {
                electron_log_1.default.info(`[Proxy] Account [${candidateName}] reached max concurrent in-flight limit (${(0, googlePool_1.getAccountInFlight)(candidate)}/${candidateMaxSlots}). Diverting to available idle account in pool.`);
                continue;
            }
        }
        const targetModel = (0, googleAuth_1.normalizeCloudCodeModelId)(candidate.externalModelName || candidate.name);
        const quotaScore = (0, googlePool_1.getModelQuotaScore)(candidate, modelFamily);
        const formattedQuota = Number(quotaScore.toFixed(1));
        const qKey = (0, googlePool_1.getAccountQuotaKey)(candidate);
        const liveQ = ((0, googleAuth_1.getLiveAccountQuota)(qKey) || candidate.quotas);
        let quotaRemark = '';
        if (liveQ) {
            const isClaude = modelFamily
                ? modelFamily.toLowerCase().includes('claude')
                : (candidate.externalModelName || candidate.name || '').toLowerCase().includes('claude');
            const fiveH = typeof (isClaude ? liveQ.claudeFiveHourPct : liveQ.geminiFiveHourPct) === 'number'
                ? (isClaude ? liveQ.claudeFiveHourPct : liveQ.geminiFiveHourPct)
                : liveQ.fiveHourPercentage;
            const week = typeof (isClaude ? liveQ.claudeWeeklyPct : liveQ.geminiWeeklyPct) === 'number'
                ? (isClaude ? liveQ.claudeWeeklyPct : liveQ.geminiWeeklyPct)
                : liveQ.weeklyPercentage;
            if (typeof fiveH === 'number' || typeof week === 'number') {
                const parts = [];
                if (typeof fiveH === 'number')
                    parts.push(`5h=${fiveH}%`);
                if (typeof week === 'number')
                    parts.push(`week=${week}%`);
                quotaRemark = ` [Quota: ${parts.join(', ')}]`;
            }
        }
        if (!quotaRemark && quotaScore > 0) {
            quotaRemark = ` [Quota: ${formattedQuota}%]`;
        }
        const rotationTag = i > 0 ? '🔄 [Account Rotation]' : '➡️ [Request]';
        electron_log_1.default.info(`[Proxy] ${rotationTag} Model: [${targetModel}] | Account: [${candidateName}] (attempt ${i + 1}/${totalAttempts})${quotaRemark}`);
        let accessToken = null;
        try {
            accessToken = await (0, googleAuth_1.getValidGoogleAccessToken)(candidate);
        }
        catch (e) {
            electron_log_1.default.warn(`[Proxy] Could not get access token for ${candidateName}:`, e.message);
        }
        if (!accessToken) {
            electron_log_1.default.warn(`[Proxy] Skipping account ${candidateName}: no valid access token available`);
            (0, circuitBreaker_1.recordFailure)(candidate, 'auth');
            continue;
        }
        reqJson.model = targetModel;
        if (typeof reqJson.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.requestedModel)) {
            reqJson.requestedModel = targetModel;
        }
        if (typeof reqJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.planModel)) {
            reqJson.planModel = targetModel;
        }
        if (reqJson.request && typeof reqJson.request === 'object') {
            const reqObj = reqJson.request;
            reqObj.model = targetModel;
            if (typeof reqObj.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.requestedModel)) {
                reqObj.requestedModel = targetModel;
            }
            if (typeof reqObj.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.planModel)) {
                reqObj.planModel = targetModel;
            }
            (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(reqObj, targetModel);
            // Support Anti-Truncation if requested via header, model suffix/prefix or env
            const wantsAntiTrunc = Boolean(req?.headers?.['x-anti-truncation']) ||
                targetModel.includes('anti-trunc') ||
                targetModel.includes('抗截断') ||
                process.env.AG_ENABLE_ANTI_TRUNCATION === '1';
            if (wantsAntiTrunc) {
                (0, googleAuth_1.applyAntiTruncation)(reqObj);
            }
        }
        reqJson.project = (0, googlePool_1.resolveGoogleProjectId)(candidate);
        if (!(0, googleAuth_1.isGeminiCliModel)(candidate) && !reqJson.enabledCreditTypes) {
            reqJson.enabledCreditTypes = ['GOOGLE_ONE_AI'];
        }
        const updatedBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
        const authHeader = `Bearer ${accessToken}`;
        testedAccountsCount++;
        (0, googlePool_1.recordAccountRequest)(candidate);
        (0, googlePool_1.incrementAccountInFlight)(candidate);
        const startReqTime = Date.now();
        const candidateHost = candidate.apiUrl ? (() => {
            try {
                const u = new URL(candidate.apiUrl);
                return u.hostname.includes('cloudcode') ? u.hostname : undefined;
            }
            catch {
                return undefined;
            }
        })() : undefined;
        const hostOverride = (0, googleAuth_1.isGeminiCliModel)(candidate)
            ? constants_1.GOOGLE_HOSTS.CLOUD_CODE_PROD
            : (candidateHost || constants_1.GOOGLE_HOSTS.CLOUD_CODE);
        const hasOtherCandidates = sortedAccounts.slice(i + 1).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, modelFamily) && (0, googlePool_1.getModelQuotaScore)(c, modelFamily) > 0);
        const healthySiblingAccountsCount = sortedAccounts.slice(i + 1).filter((c) => !(0, googlePool_1.isAccountInCooldown)(c, modelFamily) && !(0, circuitBreaker_1.getOpenBreaker)(c) && (0, googlePool_1.getModelQuotaScore)(c, modelFamily) >= 50).length;
        const isStreamReq = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
        const isThinkingModel = /thinking|thought|-high$|-medium$/i.test(targetModel);
        const isFlashModel = /flash/i.test(targetModel) && !isThinkingModel;
        const isLargePayloadOrThinking = updatedBody.length > 60000 || isThinkingModel;
        // For streaming requests with healthy sibling accounts in pool, use fast header timeouts for quick failover:
        // - Flash models: configurable via AG_GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS (default 25s; or 20s if multiple healthy siblings exist)
        // - Thinking / large prompts: 45-50s (allows reasoning budget without stalling the IDE)
        // - Standard models: 30s-35s
        const flashTimeoutMs = constants_1.GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS;
        const baseCandidateTimeout = isStreamReq
            ? (isFlashModel ? flashTimeoutMs : (isLargePayloadOrThinking ? constants_1.GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS : constants_1.GOOGLE_POOL_HEADER_TIMEOUT_MS))
            : (isFlashModel ? constants_1.GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS : (isLargePayloadOrThinking ? constants_1.GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS : constants_1.GOOGLE_POOL_HEADER_TIMEOUT_MS));
        // When no other candidates exist, fallback to the full proxy timeout.
        const poolHeaderTimeout = hasOtherCandidates
            ? baseCandidateTimeout
            : constants_1.GOOGLE_PROXY_TIMEOUT_MS;
        let outcome;
        try {
            outcome = await executeGoogleCloudCodeRequest(req, res, updatedBody, isSessionRemote, authHeader, convId, hostOverride, poolHeaderTimeout, targetModel, startReqTime);
            const reqDuration = Date.now() - startReqTime;
            if (outcome.success || outcome.statusCode === 200) {
                (0, googlePool_1.recordAccountLatency)(candidate, reqDuration);
            }
            else if (outcome.statusCode === 504 || (outcome.error && /timed out/i.test(outcome.error))) {
                (0, googlePool_1.recordAccountLatency)(candidate, Math.max(reqDuration, poolHeaderTimeout));
            }
        }
        finally {
            (0, googlePool_1.decrementAccountInFlight)(candidate);
        }
        const elapsedMs = Date.now() - startReqTime;
        const currentFamily = targetModel.toLowerCase().includes('claude') ? 'claude' : (targetModel ? 'gemini' : modelFamily);
        if (outcome.success) {
            consecutiveTimeoutCount = 0;
            (0, circuitBreaker_1.recordSuccess)(candidate);
            (0, googlePool_1.clearAccountCooldown)(candidate, currentFamily);
            (0, googlePool_1.endAccountProbation)(candidate, currentFamily);
            if (sessId && useStickySessions) {
                bindSessionToModel(sessId, candidate);
            }
            (0, googlePool_1.clearAccountBurst)(candidate);
            electron_log_1.default.info(`[Proxy] ✅ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] -> HTTP 200 OK (${elapsedMs}ms)`);
            return true;
        }
        if (outcome.statusCode === 429) {
            consecutiveTimeoutCount = 0;
            consecutive429Count++;
            const retryAfterHeader = outcome.headers?.['retry-after'];
            let decision = (0, googlePool_1.classifyGoogleCloudCode429)(outcome.error, retryAfterHeader);
            // Strict 429 Isolation: An HTTP 429 is treated as genuine multi-hour quota exhaustion ONLY if
            // Google explicitly specified a reset duration >= 1h (or credit exhaustion) AND the candidate's
            // quota is genuinely depleted (currentQuotaScore <= 0).
            // Otherwise, it is an isolated burst/RPM rate limit: apply a brief pause of a few seconds (5-10s)
            // ONLY to this candidate, keeping all other pool accounts fully active and unpenalized.
            const currentQuotaScore = (0, googlePool_1.getModelQuotaScore)(candidate, currentFamily);
            const isExplicitMultiHourReset = Boolean(decision.isExplicitReset) && (decision.rawRetryAfterMs ?? 0) >= 3600000;
            const isCreditExhausted = /insufficient.*credit|credit.*exhausted|g1_credits|minimum.*credit|not enough credit/i.test(outcome.error || '');
            const isGenuineQuotaExhaustion = decision.category === 'quota_exhausted' &&
                (isExplicitMultiHourReset || isCreditExhausted || currentQuotaScore <= 0);
            if (!isGenuineQuotaExhaustion) {
                const burstCount = (0, googlePool_1.recordAccountBurst)(candidate);
                let burstCooldownMs = 10000;
                if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
                    const parsedSec = Number(retryAfterHeader);
                    if (parsedSec > 0 && parsedSec <= 15)
                        burstCooldownMs = parsedSec * 1000;
                    else if (parsedSec > 15)
                        burstCooldownMs = Math.min(60000, parsedSec * 1000);
                }
                else if (burstCount === 2) {
                    burstCooldownMs = 25000;
                }
                else if (burstCount === 3) {
                    burstCooldownMs = 50000;
                }
                else if (burstCount >= 4) {
                    burstCooldownMs = 100000;
                }
                decision = {
                    category: 'rate_limited',
                    cooldownMs: burstCooldownMs,
                    reason: `Rate limit 429 (pause isolée ${Math.round(burstCooldownMs / 1000)}s — autres comptes actifs)`,
                    isExplicitReset: decision.isExplicitReset,
                    rawRetryAfterMs: decision.rawRetryAfterMs,
                };
            }
            electron_log_1.default.warn(`[Proxy] ⚠️ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] (${currentFamily}) -> HTTP 429 (${decision.category}: ${decision.reason}, cooldown: ${Math.round(decision.cooldownMs / 1000)}s) (${elapsedMs}ms)${outcome.error ? ` | Upstream: ${outcome.error.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
            const isRateLimit = decision.category === 'rate_limited' || decision.category === 'soft_rate_limit';
            (0, googlePool_1.setAccountCooldown)(candidate, decision.cooldownMs, currentFamily, isRateLimit);
            if (decision.category === 'quota_exhausted') {
                (0, circuitBreaker_1.recordFailure)(candidate, 'rate_limit');
                consecutiveQuotaExhausted++;
                const liveKey = (0, googlePool_1.getAccountQuotaKey)(candidate);
                (0, googlePool_1.markAccountQuotaExhausted)(liveKey, currentFamily);
                if (sessId) {
                    sessionAffinities.delete(sessId);
                }
                const existingQuota = (0, googleAuth_1.getLiveAccountQuota)(liveKey);
                const isWeekly = decision.cooldownMs > 24 * 3600 * 1000;
                const nowMs = Date.now();
                const resetIso = new Date(nowMs + decision.cooldownMs).toISOString();
                if (currentFamily === 'gemini') {
                    (0, googleAuth_1.updateLiveAccountQuota)(liveKey, {
                        ...existingQuota,
                        geminiFiveHourPct: isWeekly ? existingQuota?.geminiFiveHourPct ?? 0 : 0,
                        geminiWeeklyPct: isWeekly ? 0 : existingQuota?.geminiWeeklyPct ?? 100,
                        geminiFiveHourReset: isWeekly ? existingQuota?.geminiFiveHourReset : resetIso,
                        geminiWeeklyReset: isWeekly ? resetIso : existingQuota?.geminiWeeklyReset,
                        updatedAt: nowMs,
                    });
                }
                else if (currentFamily === 'claude') {
                    (0, googleAuth_1.updateLiveAccountQuota)(liveKey, {
                        ...existingQuota,
                        claudeFiveHourPct: isWeekly ? existingQuota?.claudeFiveHourPct ?? 0 : 0,
                        claudeWeeklyPct: isWeekly ? 0 : existingQuota?.claudeWeeklyPct ?? 100,
                        claudeFiveHourReset: isWeekly ? existingQuota?.claudeFiveHourReset : resetIso,
                        claudeWeeklyReset: isWeekly ? resetIso : existingQuota?.claudeWeeklyReset,
                        updatedAt: nowMs,
                    });
                }
                // Fast-fail if 3 consecutive accounts hit quota exhaustion for this model in a larger pool
                // only when no healthy accounts with positive quota remain
                const remainingHealthyWithQuota = sortedAccounts.slice(i + 1).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, currentFamily) && (0, googlePool_1.getModelQuotaScore)(c, currentFamily) > 20);
                if (consecutiveQuotaExhausted >= 3 && !remainingHealthyWithQuota && sortedAccounts.length > 3) {
                    lastStatus = 429;
                    lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;
                    electron_log_1.default.warn(`[Proxy] Model ${targetModel} hit quota exhaustion across ${consecutiveQuotaExhausted} consecutive accounts with no healthy accounts remaining. Fast-failing pool to trigger immediate fallback.`);
                    break;
                }
            }
            else {
                consecutiveQuotaExhausted = 0;
            }
            // Circuit breaker: Only stop rotation if there are NO remaining healthy accounts with positive quota (>20%).
            // Never abort early while healthy accounts with 100% quota are waiting in the pool!
            const remainingHealthyWithQuota = sortedAccounts.slice(i + 1).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, currentFamily) && (0, googlePool_1.getModelQuotaScore)(c, currentFamily) > 20);
            if (consecutive429Count >= 4 && !remainingHealthyWithQuota && sortedAccounts.length > 4) {
                lastStatus = 429;
                lastErrorText = outcome.error || `HTTP 429 (${decision.reason} across ${consecutive429Count} accounts)`;
                electron_log_1.default.warn(`[Proxy] 🛑 429 Circuit Breaker: Model ${targetModel} hit rate limits across ${consecutive429Count} consecutive accounts with no healthy accounts remaining. Stopping rotation to trigger relief queue / fallback.`);
                break;
            }
            if (consecutive429Count >= 3) {
                electron_log_1.default.warn(`[Proxy] ⏳ [IP Throttle Defense] ${consecutive429Count} consecutive burst 429s encountered. Applying 2.5s IP token bucket drain before continuing rotation...`);
                await new Promise((r) => setTimeout(r, 2500));
                consecutive429Count = 0;
            }
            lastStatus = 429;
            lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;
            // If all remaining candidates are in cooldown, break early to save latency
            const hasEligibleRemaining = sortedAccounts.slice(i + 1).some((c) => !(0, googlePool_1.isAccountInCooldown)(c, currentFamily));
            if (!hasEligibleRemaining) {
                electron_log_1.default.warn(`[Proxy] No remaining healthy accounts left in pool for ${currentFamily}. Fast-failing pool.`);
                break;
            }
            if (i + 1 < totalAttempts) {
                // Anti-domino pacing: When Google triggers a burst 429 while account quota is positive,
                // it is an IP / client-level rate limit. Pause 1000-2000ms to allow Google's token bucket
                // for our IP to drain instead of burning through 33 accounts in 5 seconds.
                const isBurst429 = decision.category !== 'quota_exhausted' || currentQuotaScore > 0;
                const pacingMs = isBurst429
                    ? (consecutive429Count > 1
                        ? 2200 + Math.floor(Math.random() * 1000) // Multi-compte burst consécutif: 2.2s à 3.2s pour drainer le seau IP
                        : 1200 + Math.floor(Math.random() * 600)) // 1er burst isolé: pause préventive 1.2s à 1.8s pour protéger le compte suivant
                    : (consecutiveQuotaExhausted > 0 ? 300 + Math.floor(Math.random() * 200) : 1000 + Math.floor(Math.random() * 500));
                if (isBurst429) {
                    electron_log_1.default.info(`[Proxy] ⏳ [IP Bucket Drain] Burst 429 détecté (quota positif). Pause préventive de ${pacingMs}ms pour vider le seau IP Google avant rotation.`);
                }
                else {
                    electron_log_1.default.info(`[Proxy] Rotation après épuisement de quota. Pause de ${pacingMs}ms avant le compte suivant.`);
                }
                await new Promise((r) => setTimeout(r, pacingMs));
            }
            continue;
        }
        else {
            consecutive429Count = 0;
        }
        const isSignatureOrFormat400 = outcome.statusCode === 400 &&
            (/thought.*signature|signature.*thought|signature.*thinking|thinking.*signature|corrupted.*signature|invalid.*signature/i.test(outcome.error || '') ||
                /invalid.*argument|INVALID_ARGUMENT/i.test(outcome.error || ''));
        if (isSignatureOrFormat400) {
            electron_log_1.default.warn(`[Proxy] Detected payload validation / thought signature issue from Vertex AI on ${candidateName} (${(outcome.error || '').slice(0, 100)}). Auto-repairing...`);
            const isMissingSig = /missing.*thought_signature|thought_signature.*missing/i.test(outcome.error || '');
            const targetContents = reqJson.request?.contents || reqJson.contents;
            let repaired = false;
            const activeConvKey = convId || sessId || '';
            // 1. If signature was missing on functionCall parts, try restoring from cache / sibling parts first
            if (isMissingSig && Array.isArray(targetContents)) {
                repaired = (0, shared_1.restoreThoughtSignatures)(targetContents, activeConvKey, 'gemini');
                if (repaired) {
                    electron_log_1.default.info(`[Proxy] Successfully restored missing thought signature(s) from cache/siblings for ${candidateName}`);
                }
            }
            // 2. If restore was not applicable, signature corrupted, or INVALID_ARGUMENT returned, convert unverified tool calls in history
            // to plain text and strip thinkingConfig so Vertex AI accepts the request without signature errors
            if (!repaired) {
                electron_log_1.default.warn(`[Proxy] Converting unverified tool calls in history to text to bypass Vertex AI payload validation for ${candidateName}`);
                const sanitizeObj = (obj) => {
                    if (!obj || typeof obj !== 'object')
                        return;
                    if (obj.generationConfig) {
                        delete obj.generationConfig.thinkingConfig;
                        delete obj.generationConfig.thinking_config;
                    }
                    if (obj.generation_config) {
                        delete obj.generation_config.thinkingConfig;
                        delete obj.generation_config.thinking_config;
                    }
                    if (obj.systemInstruction && typeof obj.systemInstruction === 'object') {
                        const si = obj.systemInstruction;
                        if (Array.isArray(si.parts)) {
                            for (const p of si.parts) {
                                if (p && typeof p === 'object') {
                                    delete p.thought_signature;
                                    delete p.thoughtSignature;
                                    delete p.signature;
                                    delete p.thought;
                                }
                            }
                        }
                    }
                    if (Array.isArray(obj.contents)) {
                        for (const c of obj.contents) {
                            if (Array.isArray(c.parts)) {
                                c.parts = c.parts.filter((p) => !p?.thought && p?.type !== 'thinking');
                                if (c.parts.length === 0)
                                    c.parts = [{ text: '.' }];
                                for (const p of c.parts) {
                                    if (p && typeof p === 'object') {
                                        delete p.thought_signature;
                                        delete p.thoughtSignature;
                                        delete p.signature;
                                        delete p.thought;
                                    }
                                }
                            }
                        }
                        (0, shared_1.flattenAllToolCallsToText)(obj.contents);
                        (0, googleAuth_1.normalizeConversationTurns)(obj.contents);
                    }
                    if (obj.request && typeof obj.request === 'object') {
                        sanitizeObj(obj.request);
                    }
                };
                sanitizeObj(reqJson);
            }
            const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
            const retryOutcome = await executeGoogleCloudCodeRequest(req, res, retryBody, isSessionRemote, authHeader, activeConvKey, hostOverride, poolHeaderTimeout, targetModel, startReqTime);
            if (retryOutcome.success) {
                (0, circuitBreaker_1.recordSuccess)(candidate);
                (0, googlePool_1.clearAccountCooldown)(candidate, currentFamily);
                if (activeConvKey) {
                    (0, shared_1.markConvCorruptedSignatures)(activeConvKey);
                }
                if (sessId) {
                    bindSessionToModel(sessId, candidate);
                }
                electron_log_1.default.info(`[Proxy] Self-healing retry after payload repair SUCCEEDED on account ${candidateName}`);
                return true;
            }
            // If the retry after thought repair failed with another error (e.g. 504/429),
            // update outcome so pool rotation can handle it appropriately instead of stalling on stale 400
            outcome = retryOutcome;
            if (activeConvKey) {
                (0, shared_1.markConvCorruptedSignatures)(activeConvKey);
            }
        }
        if (outcome.statusCode === 400 && /context.*length|token.*limit|payload.*exceed|too large|request.*large|exceeds.*limit/i.test(outcome.error || '')) {
            electron_log_1.default.warn(`[Proxy] Detected Context/Token limit error from upstream on ${candidateName}. Trimming 30% oldest history and retrying...`);
            const trimHistory = (obj) => {
                if (!obj || typeof obj !== 'object')
                    return;
                const contents = obj.contents || obj.request?.contents;
                if (Array.isArray(contents) && contents.length > 4) {
                    const first = contents[0];
                    const keepCount = Math.max(3, Math.floor(contents.length * 0.7));
                    const trimmed = [first, ...contents.slice(contents.length - keepCount)];
                    if (obj.contents)
                        obj.contents = trimmed;
                    if (obj.request?.contents)
                        obj.request.contents = trimmed;
                }
            };
            trimHistory(reqJson);
            const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
            const retryOutcome = await executeGoogleCloudCodeRequest(req, res, retryBody, isSessionRemote, authHeader, convId, hostOverride, poolHeaderTimeout, targetModel, startReqTime);
            if (retryOutcome.success) {
                (0, circuitBreaker_1.recordSuccess)(candidate);
                (0, googlePool_1.clearAccountCooldown)(candidate, currentFamily);
                if (sessId) {
                    bindSessionToModel(sessId, candidate);
                }
                electron_log_1.default.info(`[Proxy] History trimming retry SUCCEEDED on account ${candidateName}`);
                return true;
            }
        }
        lastStatus = outcome.statusCode || 500;
        lastErrorText = outcome.error || `HTTP ${lastStatus}`;
        electron_log_1.default.warn(`[Proxy] ⚠️ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] -> HTTP ${lastStatus} (${lastErrorText.slice(0, 150)}) (${elapsedMs}ms). Rotating to next account...`);
        if (lastStatus !== 429) {
            (0, circuitBreaker_1.recordFailure)(candidate, 'server');
        }
        // On HTTP 500 / 502 / 503 / 504 (Internal Error / Gateway Timeout / Service Unavailable / Bad Gateway / Overloaded):
        const isServerOutage = lastStatus === 500 ||
            lastStatus === 502 ||
            lastStatus === 503 ||
            lastStatus === 504 ||
            /timed out|unavailable|overloaded|service unavailable|backend error|internal error/i.test(lastErrorText);
        if (isServerOutage) {
            consecutiveTimeoutCount++;
            const maxOutageLimit = Math.max(2, Math.min(4, sortedAccounts.length));
            const upstreamOutageThreshold = Number(process.env.AG_OUTAGE_CONSECUTIVE_TIMEOUTS || 0) || maxOutageLimit;
            const isUpstreamOutage = consecutiveTimeoutCount >= upstreamOutageThreshold;
            // For HTTP 500 internal errors, use a 20s cooldown so transient hiccups recover quickly; 504/outages use 30s-45s.
            const timeoutCooldownMs = lastStatus === 500 ? 20000 : (isUpstreamOutage ? 30000 : 45000);
            electron_log_1.default.warn(`[Proxy] Account ${candidateName} failed with HTTP ${lastStatus}. Placing in ${timeoutCooldownMs / 1000}s cooldown (${isUpstreamOutage ? 'upstream outage detected' : 'transient server issue'}).`);
            (0, googlePool_1.setAccountCooldown)(candidate, timeoutCooldownMs, currentFamily, true);
            if (isUpstreamOutage) {
                lastStatus = lastStatus;
                lastErrorText = `Google Cloud Code API upstream service failure (HTTP ${lastStatus}) across ${consecutiveTimeoutCount} consecutive accounts`;
                electron_log_1.default.warn(`[Proxy] 🛑 Upstream Server Failure Circuit Breaker: Model [${targetModel}] failed with HTTP ${lastStatus} across ${consecutiveTimeoutCount} consecutive accounts. Fast-failing pool to trigger immediate fallback cascade / AI Studio recovery.`);
                break;
            }
        }
        else {
            consecutiveTimeoutCount = 0;
        }
        // On HTTP 403 licensing/forbidden failure, immediately place the account in a
        // 7-day quarantine so subsequent requests don't waste round-trip time failing over.
        if (lastStatus === 403) {
            const isLicenseError = /license|licens|permission|unauthorized|forbidden|not have a valid/i.test(lastErrorText);
            const quarantineMs = isLicenseError ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
            electron_log_1.default.warn(`[Proxy] Account ${candidateName} received HTTP 403 (${isLicenseError ? 'license/permission issue' : 'forbidden'}). Placing in ${Math.round(quarantineMs / 3600000)}h quarantine to eliminate failover latency.`);
            if (isLicenseError) {
                (0, googlePool_1.markAccountUnlicensed)(candidate);
            }
            (0, googlePool_1.setAccountCooldown)(candidate, quarantineMs);
            (0, googlePool_1.setAccountCooldown)(candidate, quarantineMs, 'gemini');
            (0, googlePool_1.setAccountCooldown)(candidate, quarantineMs, 'claude');
            if (modelFamily)
                (0, googlePool_1.setAccountCooldown)(candidate, quarantineMs, modelFamily);
        }
        // On HTTP 400 (Bad Request / payload format error), trying other accounts in the pool will produce
        // the exact same 400 error. Abort rotation to fast-trigger fallback model recovery.
        // Exception: thought signature or invalid argument errors have already mutated reqJson into plain-text format, so the next
        // account in the pool can succeed without needing an immediate fallback.
        const isThoughtSignature400 = /thought.*signature|signature.*thought|corrupted.*signature|invalid.*signature|invalid.*argument|INVALID_ARGUMENT/i.test(lastErrorText);
        if (lastStatus === 400 && !isThoughtSignature400) {
            electron_log_1.default.warn(`[Proxy] HTTP 400 indicates a payload format error on ${candidateName}. Aborting account pool rotation to trigger immediate fallback recovery.`);
            break;
        }
        if (i + 1 < totalAttempts) {
            // Sub-second silent failover between accounts in the pool
            await new Promise((r) => setTimeout(r, 50));
        }
    }
    // Strict Model Locking: NEVER cascade or degrade to another model family or version.
    // The user selected this exact model; when its pool accounts fail, report the error directly without substituting another model.
    const allowCrossModelFallback = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
    if (!allowCrossModelFallback) {
        electron_log_1.default.warn(`[Proxy] Strict model locking: Cross-model fallback disabled. Reporting error for [${targetRaw}] without model substitution.`);
    }
    else if (fallbackDepth === 0 && attemptedModels.size <= 1 && !res.writableEnded && !res.destroyed) {
        const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
        const allCustomModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
        // Dynamic fallback: discover all available Cloud Code model families,
        // same family first (Gemini→other Gemini, Claude→other Claude), then cross-family.
        const currentBase = (0, googleAuth_1.normalizeCloudCodeModelId)(reqJson.model || reqJson.request?.model || '');
        if (currentBase)
            attemptedModels.add(currentBase.toLowerCase());
        // Guard: prevent infinite recursive fallback cascades across models
        if (attemptedModels.size > 3) {
            electron_log_1.default.warn(`[Proxy] Agent resilience: Max fallback depth reached (${attemptedModels.size} models attempted). Stopping fallback cascade.`);
            return false;
        }
        const isClaudeRequest = currentBase.toLowerCase().includes('claude');
        // Emergency cross-family fallback: include ALL model IDs, including enabled:false ones.
        // The enabled flag controls normal routing UI preference; it must not block emergency quota fallback.
        const allModelBases = [...new Set(allCustomModels
                .filter(m => (0, googleAuth_1.isGoogleCloudCodeModel)(m) && !(0, circuitBreaker_1.getOpenBreaker)(m) && m.apiKey !== 'auto')
                .map(m => (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name))
                .filter(b => b && !b.includes('3.7') && !b.includes('3.6') && !attemptedModels.has(b.toLowerCase()) && !attemptedModels.has(b)))];
        const sameFamily = allModelBases.filter(m => m.toLowerCase().includes('claude') === isClaudeRequest);
        const crossFamily = allModelBases.filter(m => m.toLowerCase().includes('claude') !== isClaudeRequest);
        // On HTTP 429 quota exhaustion, sibling models in the same family share the exact same exhausted quota pool.
        // Sibling accounts in Google Cloud Code will just hit the same 429.
        // Skip same-family to avoid pointless ping-pong retry loops and cascade directly to cross-family (Gemini <-> Claude).
        const eligibleFallbacks = lastStatus === 429 ? crossFamily : [...sameFamily, ...crossFamily];
        if (eligibleFallbacks.length > 0) {
            for (const fallbackModel of eligibleFallbacks) {
                const fbFamily = fallbackModel.toLowerCase().includes('claude') ? 'claude' : 'gemini';
                const isFb55 = fallbackModel.includes('5.5') || fallbackModel.includes('5-5');
                // Include disabled models in quota check — same reason as allModelBases above.
                const hasAnyQuotaInFamily = allCustomModels.some((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m) && (0, googlePool_1.getModelQuotaScore)(m, fbFamily) > 0);
                if (!hasAnyQuotaInFamily) {
                    electron_log_1.default.info(`[Proxy] Skipping fallback model ${fallbackModel}: 0% quota available for ${fbFamily} across entire pool.`);
                    continue;
                }
                let fallbackCandidates = allCustomModels.filter((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m) &&
                    !(0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase().includes('3.7') &&
                    !(0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase().includes('3.6') &&
                    (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase() === fallbackModel.toLowerCase() &&
                    (!isFb55 || (0, googleAuth_1.isAccountEntitledToClaude55)(m)) &&
                    !(0, circuitBreaker_1.getOpenBreaker)(m) &&
                    !(0, googlePool_1.isAccountInCooldown)(m, fbFamily) &&
                    (0, googlePool_1.getModelQuotaScore)(m, fbFamily) > 0);
                // If no candidate with measured positive quota score, allow candidate accounts not in cooldown (excluding unlicensed)
                if (fallbackCandidates.length === 0) {
                    fallbackCandidates = allCustomModels.filter((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m) &&
                        m.enabled !== false &&
                        !m.isUnlicensed &&
                        !(0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase().includes('3.7') &&
                        !(0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase().includes('3.6') &&
                        (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase() === fallbackModel.toLowerCase() &&
                        !(0, circuitBreaker_1.getOpenBreaker)(m) &&
                        !(0, googlePool_1.isAccountInCooldown)(m, fbFamily));
                }
                if (fallbackCandidates.length === 0) {
                    electron_log_1.default.info(`[Proxy] Skipping fallback model ${fallbackModel}: no available accounts in pool (all in cooldown or quota-exhausted for ${fbFamily})`);
                    continue;
                }
                electron_log_1.default.warn(`[Proxy] 🔀 [Model Fallback] Pool exhausted for [${currentBase}] across candidate accounts (${lastErrorText.slice(0, 80)}). Switching to fallback model: [${fallbackModel}]...`);
                if (fallbackCandidates.length > 0) {
                    const selectedFallback = (0, googlePool_1.selectBestModelByQuota)(fallbackCandidates, allCustomModels) || fallbackCandidates[0];
                    const fallbackPool = (0, googlePool_1.getGoogleAccountPool)(selectedFallback, allCustomModels);
                    reqJson.model = fallbackModel;
                    if (reqJson.request && typeof reqJson.request === 'object') {
                        reqJson.request.model = fallbackModel;
                        (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(reqJson.request, fallbackModel);
                    }
                    const fbContents = reqJson.request?.contents || reqJson.contents;
                    if (Array.isArray(fbContents)) {
                        const isFbClaude = fallbackModel.toLowerCase().includes('claude');
                        if (isFbClaude) {
                            (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(reqJson.request || reqJson, fallbackModel);
                        }
                        else {
                            if (lastStatus === 400) {
                                // If original model failed with HTTP 400, unverified/corrupted tool calls in history
                                // must be flattened to plain text so fallback Gemini does not repeat the same 400 failure
                                (0, shared_1.flattenAllToolCallsToText)(fbContents);
                            }
                            else {
                                (0, shared_1.restoreThoughtSignatures)(fbContents, convId || '', fallbackModel);
                                (0, shared_1.sanitizeUnsignedToolCalls)(fbContents);
                            }
                        }
                        (0, googleAuth_1.normalizeConversationTurns)(fbContents);
                    }
                    const sessionKey = convId || sessId;
                    const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
                    const alreadyNotified = existingFallback?.notified === true;
                    const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
                    if (wantsFallbackNotice && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
                        if (!res.headersSent) {
                            (0, httpUtils_1.safeWriteHead)(res, 200, {
                                'Content-Type': 'text/event-stream',
                                'Cache-Control': 'no-cache',
                                Connection: 'keep-alive',
                            });
                        }
                        const isClaude = currentBase.toLowerCase().includes('claude');
                        const fbNotice = isClaude
                            ? `> 🔄 **Quota Claude atteint** — Poursuite automatique de la conversation avec **${fallbackModel}**.\n\n`
                            : `> 🔄 **Modèle temporairement indisponible** — Poursuite automatique avec **${fallbackModel}**.\n\n`;
                        const chunk = {
                            response: {
                                candidates: [
                                    {
                                        content: { parts: [{ text: fbNotice }], role: 'model' },
                                        index: 0,
                                    },
                                ],
                            },
                        };
                        writeSafeSseChunk(res, chunk);
                    }
                    try {
                        const nextAttempted = new Set(attemptedModels);
                        nextAttempted.add(fallbackModel.toLowerCase());
                        nextAttempted.add(fallbackModel);
                        const fallbackOk = await executeGoogleCloudCodeWithPool(req, res, reqJson, fallbackPool, isSessionRemote, convId, sessId, nextAttempted, fallbackDepth + 1);
                        if (fallbackOk) {
                            if (sessionKey) {
                                const existing = getSessionModelFallback(sessionKey);
                                if (existing && (0, googleAuth_1.normalizeCloudCodeModelId)(fallbackModel).toLowerCase() === (0, googleAuth_1.normalizeCloudCodeModelId)(existing.originalModel).toLowerCase()) {
                                    electron_log_1.default.info(`[Proxy] 🟢 Session ${sessionKey} successfully recovered back to original model [${existing.originalModel}]. Clearing fallback.`);
                                    clearSessionModelFallback(sessionKey);
                                }
                                else {
                                    setSessionModelFallback(sessionKey, currentBase, fallbackModel, true);
                                }
                            }
                            electron_log_1.default.info(`[Proxy] ✅ [Model Fallback] Cross-model fallback to ${fallbackModel} SUCCEEDED! Agent saved from termination.`);
                            return true;
                        }
                    }
                    catch (fbErr) {
                        electron_log_1.default.warn(`[Proxy] Fallback to ${fallbackModel} failed:`, fbErr.message);
                    }
                }
            }
        }
        // If all Google accounts and internal Google Cloud Code fallbacks failed,
        // try configured Google AI Studio accounts first (independent quota, same Gemini family),
        // then fall through to OpenAI / Anthropic / DeepSeek / Ollama / OpenRouter / etc.
        // Note: google-gemini (AI Studio) uses a per-account API key — rotate across all configured accounts.
        const nonGoogleFallbacks = allCustomModels.filter((m) => (m.provider !== 'google' || !(0, googleAuth_1.isGoogleCloudCodeModel)(m)) &&
            (!m._poolOnly || m.provider === 'google-gemini') &&
            !(0, circuitBreaker_1.getOpenBreaker)(m) &&
            m.apiKey !== 'auto');
        if (nonGoogleFallbacks.length > 0) {
            // Prioritise AI Studio accounts (google-gemini) — same model family, independent quota.
            // Rotate through all of them before falling to third-party providers.
            const aiStudioFallbacks = nonGoogleFallbacks.filter((m) => m.provider === 'google-gemini');
            const otherFallbacks = nonGoogleFallbacks.filter((m) => m.provider !== 'google-gemini');
            const orderedFallbacks = [...aiStudioFallbacks, ...otherFallbacks];
            const sessionKey = convId || sessId;
            const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
            const alreadyNotified = existingFallback?.notified === true;
            const actualGeminiBody = reqJson.request || reqJson;
            for (let fi = 0; fi < orderedFallbacks.length; fi++) {
                const fallbackModel = orderedFallbacks[fi];
                const isAiStudio = fallbackModel.provider === 'google-gemini';
                // Skip any provider whose host is currently rate-limited — avoids burning
                // through all AI Studio accounts sequentially when the host is already banned.
                if ((0, modelRouter_1.isProviderRateLimited)(fallbackModel.apiUrl)) {
                    electron_log_1.default.debug(`[Proxy] Cascade skip ${fallbackModel.displayName || fallbackModel.name}: host rate-limited`);
                    continue;
                }
                electron_log_1.default.warn(`[Proxy] 🔀 [Account Cascade] Cascading to ${isAiStudio ? 'Google AI Studio' : fallbackModel.provider} account [${fallbackModel.displayName || fallbackModel.name}] (${fallbackModel.provider}) [${fi + 1}/${orderedFallbacks.length}]...`);
                const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
                if (wantsFallbackNotice && fi === 0 && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
                    if (!res.headersSent) {
                        (0, httpUtils_1.safeWriteHead)(res, 200, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            Connection: 'keep-alive',
                        });
                    }
                    const notice = isAiStudio
                        ? `> 🔄 **Pool Cloud Code saturé** — Poursuite avec **Google AI Studio** (${fallbackModel.displayName || fallbackModel.name}).\n\n`
                        : `> 🌐 **Pool Google saturé** — Poursuite automatique avec **${fallbackModel.displayName || fallbackModel.name}** (${fallbackModel.provider}).\n\n`;
                    writeSafeSseChunk(res, {
                        response: {
                            candidates: [{ content: { parts: [{ text: notice }], role: 'model' }, index: 0 }],
                        },
                    });
                }
                try {
                    handleCustomModelRequest(res, fallbackModel, actualGeminiBody, isStream);
                    if (sessionKey && fi === 0) {
                        setSessionModelFallback(sessionKey, currentBase, fallbackModel.displayName || fallbackModel.name, true);
                    }
                    return true;
                }
                catch (tpErr) {
                    electron_log_1.default.warn(`[Proxy] Fallback to ${fallbackModel.name} (${fallbackModel.provider}) failed: ${tpErr.message}. Trying next...`);
                    if (res.writableEnded || res.destroyed)
                        return true;
                }
            }
        }
    }
    // ── Rate Limit (429) Relief Wait & Automatic Recovery ──
    // If all candidate accounts and cross-model fallbacks failed due to 429 rate limits,
    // do NOT crash or terminate the user's ongoing conversation!
    // If an account in the pool has a short burst cooldown expiring soon (<= 65s),
    // hold the client socket alive, wait for cooldown relief, and seamlessly retry.
    if (lastStatus === 429 &&
        fallbackDepth === 0 &&
        process.env.AG_DISABLE_RATE_LIMIT_RELIEF !== '1' &&
        process.env.NODE_ENV !== 'test' &&
        !process.env.VITEST &&
        !res.writableEnded &&
        !res.destroyed &&
        !req.destroyed) {
        const soonest = (0, googlePool_1.getSoonestAccountCooldownRemaining)(accountPool, modelFamily, constants_1.RATE_LIMIT_RELIEF_WAIT_MS);
        if (soonest) {
            const waitMs = soonest.remainingMs > 0 ? Math.min(soonest.remainingMs + 800, constants_1.RATE_LIMIT_RELIEF_WAIT_MS) : 15000;
            const waitSec = Math.ceil(waitMs / 1000);
            const accName = soonest.candidate.accountEmail ||
                soonest.candidate.accountName ||
                soonest.candidate.displayName ||
                soonest.candidate.name;
            electron_log_1.default.warn(`[Proxy] ⏳ [Rate Limit Relief] All pool accounts and fallbacks in cooldown. Waiting ${waitSec}s for account [${accName}] cooldown relief to prevent conversation crash...`);
            if (req.socket)
                req.socket.setTimeout(Math.max(120000, waitMs + 30000));
            if (res.socket)
                res.socket.setTimeout(Math.max(120000, waitMs + 30000));
            await new Promise((resolve) => {
                let timer = null;
                const cleanup = () => {
                    if (timer)
                        clearTimeout(timer);
                    if (typeof req?.removeListener === 'function')
                        req.removeListener('close', onClose);
                    if (typeof res?.removeListener === 'function')
                        res.removeListener('close', onClose);
                };
                const onClose = () => {
                    cleanup();
                    resolve();
                };
                timer = setTimeout(() => {
                    cleanup();
                    resolve();
                }, waitMs);
                if (timer.unref)
                    timer.unref();
                if (typeof req?.once === 'function')
                    req.once('close', onClose);
                if (typeof res?.once === 'function')
                    res.once('close', onClose);
            });
            if (!res.writableEnded && !res.destroyed && !req.destroyed) {
                electron_log_1.default.info(`[Proxy] 🟢 [Rate Limit Relief] Cooldown expired! Retrying request on recovered Google pool...`);
                // Restore original target model in reqJson if fallback attempts modified it
                if (targetRaw) {
                    reqJson.model = targetRaw;
                    if (typeof reqJson.requestedModel === 'string') {
                        reqJson.requestedModel = targetRaw;
                    }
                    if (reqJson.request && typeof reqJson.request === 'object') {
                        reqJson.request.model = targetRaw;
                        if (typeof reqJson.request.requestedModel === 'string') {
                            reqJson.request.requestedModel = targetRaw;
                        }
                    }
                }
                const retryOk = await executeGoogleCloudCodeWithPool(req, res, reqJson, accountPool, isSessionRemote, convId, sessId, new Set(), fallbackDepth + 1);
                if (retryOk) {
                    electron_log_1.default.info(`[Proxy] ✅ [Rate Limit Relief] Request SUCCEEDED after rate limit cooldown relief! Agent saved from crash.`);
                    return true;
                }
            }
        }
    }
    // If this request is an explicit background summarization task and all accounts/relief failed:
    // Return a synthetic summary SSE stream so the background summarization hook never crashes the IDE.
    // Note: Only triggered on explicit background SUMMARY requestTypes, never on regular user chat turns!
    const reqType = String(reqJson.requestType || reqJson.request?.requestType || '').toUpperCase();
    const isExplicitSummary = reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY';
    if (isExplicitSummary && !res.writableEnded && !res.destroyed) {
        electron_log_1.default.warn('[Proxy] Context summarization hook failed upstream after pool exhaustion. Returning synthetic summary to prevent agent termination.');
        const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
        const summaryCand = {
            content: {
                parts: [{ text: 'Summary of previous steps: The agent investigated the task, inspected files, executed commands, and continues with the implementation.' }],
                role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
        };
        const syntheticChunk = {
            response: {
                candidates: [summaryCand],
                usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
            },
            candidates: [summaryCand],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
        };
        sanitizeCandidatesInResponse(syntheticChunk);
        if (isStream) {
            if (!res.headersSent) {
                (0, httpUtils_1.safeWriteHead)(res, 200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                });
            }
            writeSafeSseChunk(res, syntheticChunk);
            (0, httpUtils_1.safeEnd)(res);
        }
        else {
            if (!res.headersSent) {
                (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
            }
            (0, httpUtils_1.safeEnd)(res, JSON.stringify(syntheticChunk));
        }
        return true;
    }
    electron_log_1.default.error(`[Proxy] Google Cloud Code pool exhausted (${testedAccountsCount}/${totalAttempts} tested). Returning HTTP ${lastStatus}`);
    if (!res.writableEnded && !res.destroyed) {
        const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
        const failedModel = sortedAccounts[0] || {
            name: reqJson.model || 'google-model',
            displayName: reqJson.model || 'Google Model',
            provider: 'google',
        };
        const diagnostic = (0, errorClassifier_1.classifyError)(lastStatus, lastErrorText, undefined, 'google');
        if (totalAttempts > 1) {
            const countLabel = testedAccountsCount > 0 && testedAccountsCount < totalAttempts
                ? `${testedAccountsCount}/${totalAttempts}`
                : `${totalAttempts}/${totalAttempts}`;
            diagnostic.title = `${diagnostic.title} (${countLabel} comptes vérifiés)`;
            diagnostic.message = testedAccountsCount < totalAttempts && lastStatus === 504
                ? `Le service Google Cloud Code a expiré sur ${testedAccountsCount} comptes consécutifs (coupure amont détectée). Les ${totalAttempts - testedAccountsCount} comptes restants ont été préservés sans être bloqués.`
                : `L'ensemble des ${totalAttempts} comptes configurés ont été testés automatiquement en arrière-plan, mais aucun n'est actuellement disponible (${diagnostic.errorType}).`;
        }
        if (!res.headersSent) {
            if (isStream) {
                sendGracefulStreamError(res, diagnostic, failedModel);
            }
            else {
                sendGracefulNonStreamError(res, diagnostic, failedModel);
            }
        }
        else {
            if (isStream) {
                sendGracefulStreamError(res, diagnostic, failedModel);
            }
            else {
                (0, httpUtils_1.safeEnd)(res);
            }
        }
    }
    return false;
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
        (u.protocol === 'https:' ? https_1.default : http).request({
            hostname: u.hostname, path: u.pathname + u.search,
            method: 'GET', headers: { 'Authorization': authHeader }, timeout: constants_1.FILE_DOWNLOAD_TIMEOUT_MS,
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
    const attempt = retryCount + 1;
    const maxAttempts = ctx.maxRetries;
    electron_log_1.default.warn(`[Proxy] ${logReason} for ${ctx.model.name}, retrying silently in ${delayMs}ms (${attempt}/${maxAttempts})...`);
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
    if (!res.headersSent) {
        sendGracefulStreamError(res, diagnostic, model);
    }
    else if (!res.writableEnded) {
        const errChunk = {
            response: {
                candidates: [
                    {
                        content: { parts: [{ text: '\n\n' + generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
                        finishReason: 'STOP',
                        index: 0,
                    },
                ],
            },
            traceId: '',
            metadata: {},
        };
        sanitizeCandidatesInResponse(errChunk);
        writeSafeSseChunk(res, errChunk);
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
    const streamStartTime = Date.now();
    let streamPromptTokens = 0;
    let streamCompletionTokens = 0;
    let streamTotalTokens = 0;
    let streamCachedTokens = 0;
    let streamOutputChars = 0;
    // Check for API errors BEFORE writing streaming headers
    if (apiRes.statusCode >= 400) {
        let errorBody = '';
        apiRes.on('data', (chunk) => errorBody += chunk.toString());
        apiRes.on('end', () => {
            const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
            electron_log_1.default.error(`[Proxy] ⚠️ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP ${apiRes.statusCode}: ${errorBody.substring(0, 150)}`);
            const streamDiagnostic = (0, errorClassifier_1.classifyError)(apiRes.statusCode, null, errorBody, model.provider);
            emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode, errorBody, model.provider));
            // Trip the breaker on the first hard failure so subsequent
            // requests short-circuit instead of piling up against a stuck upstream.
            if (streamDiagnostic.errorType === 'server' ||
                streamDiagnostic.errorType === 'rate_limit' ||
                streamDiagnostic.errorType === 'timeout' ||
                streamDiagnostic.errorType === 'network' ||
                streamDiagnostic.errorType === 'billing') {
                recordModelFailure(model, streamDiagnostic.errorType === 'billing' ? 'rate_limit' : streamDiagnostic.errorType);
                if (streamDiagnostic.errorType === 'rate_limit' || streamDiagnostic.errorType === 'billing') {
                    (0, modelRouter_1.markProviderRateLimited)(model.apiUrl);
                }
            }
            const isNonRetryable = streamDiagnostic.errorType === 'billing' || streamDiagnostic.retryable === false;
            if (!isNonRetryable && (0, retryStrategy_1.shouldRetryStatus)(apiRes.statusCode, ctx.retryCount, ctx.maxRetries)) {
                const retryAfterMs = parseRetryAfter(apiRes.headers);
                const delay = (0, retryStrategy_1.computeRetryDelay)('rate-limit', ctx.retryCount, retryAfterMs);
                ctx.retry(ctx.retryCount, delay, `Stream error ${apiRes.statusCode} (rate-limit)`);
                return;
            }
            const diagnostic = streamDiagnostic;
            if (ctx.attemptFallback(diagnostic))
                return;
            sendGracefulStreamError(res, diagnostic, model);
        });
        return;
    }
    if (apiRes.statusCode === 200) {
        // Any successful response proves the upstream is healthy again;
        // clear the breaker so subsequent requests don't short-circuit.
        (0, circuitBreaker_1.recordSuccess)(model);
        const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
        electron_log_1.default.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP 200 OK (stream started)`);
    }
    if (!res.headersSent) {
        if (!(0, httpUtils_1.safeWriteHead)(res, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        })) {
            return;
        }
    }
    // Phase 2: Per-chunk idle timeout guard. Vendor pattern from
    // `withIdleTimeout`'s stream wrapper. If no SSE chunk arrives for
    // STREAM_IDLE_TIMEOUT_MS, treat the upstream as stuck and abort.
    const idleGuard = new idleTimeout_1.IdleTimeoutGuard(apiRes, {
        idleTimeoutMs: constants_1.STREAM_IDLE_TIMEOUT_MS,
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
                    if (parsed && typeof parsed === 'object') {
                        if (parsed.usage && typeof parsed.usage === 'object') {
                            if (typeof parsed.usage.prompt_tokens === 'number')
                                streamPromptTokens = parsed.usage.prompt_tokens;
                            if (typeof parsed.usage.completion_tokens === 'number')
                                streamCompletionTokens = parsed.usage.completion_tokens;
                            if (typeof parsed.usage.total_tokens === 'number')
                                streamTotalTokens = parsed.usage.total_tokens;
                        }
                        if (parsed.usageMetadata && typeof parsed.usageMetadata === 'object') {
                            if (typeof parsed.usageMetadata.promptTokenCount === 'number')
                                streamPromptTokens = parsed.usageMetadata.promptTokenCount;
                            if (typeof parsed.usageMetadata.candidatesTokenCount === 'number')
                                streamCompletionTokens = parsed.usageMetadata.candidatesTokenCount;
                            if (typeof parsed.usageMetadata.totalTokenCount === 'number')
                                streamTotalTokens = parsed.usageMetadata.totalTokenCount;
                            if (typeof parsed.usageMetadata.cachedContentTokenCount === 'number')
                                streamCachedTokens = parsed.usageMetadata.cachedContentTokenCount;
                        }
                    }
                    const mapped = registry.translateStreamChunk(provider, parsed, model.name);
                    if (mapped) {
                        const candidateParts = mapped.content?.parts;
                        if (Array.isArray(candidateParts)) {
                            for (const p of candidateParts) {
                                if (p && typeof p.text === 'string')
                                    streamOutputChars += p.text.length;
                            }
                        }
                        (0, shared_1.extractAndCacheThoughtSignatures)({ candidates: [mapped] }, '');
                        const cloudCodeResponse = {
                            response: { candidates: [mapped] },
                            traceId: '',
                            metadata: {},
                        };
                        sanitizeCandidatesInResponse(cloudCodeResponse);
                        writeSafeSseChunk(res, cloudCodeResponse);
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
            const emptyDiag = (0, errorClassifier_1.classifyError)(undefined, undefined, 'empty_stream', model.provider);
            emptyDiag.title = 'Empty Model Response';
            emptyDiag.message = `Model "${model.displayName || model.name}" responded with HTTP 200 OK but returned 0 tokens of content (${verdict.reason}).`;
            emptyDiag.suggestions = [
                'Check if this model requires a different prompt or format.',
                'Verify that the upstream provider API is responding correctly.',
                'Try switching to a different model.'
            ];
            sendGracefulStreamError(res, emptyDiag, model);
            return;
        }
        if (buffer.trim().startsWith('data: ')) {
            const dataStr = buffer.trim().substring(6).trim();
            if (dataStr !== '[DONE]') {
                try {
                    const parsed = JSON.parse(dataStr);
                    const mapped = registry.translateStreamChunk(provider, parsed, model.name);
                    if (mapped) {
                        (0, shared_1.extractAndCacheThoughtSignatures)({ candidates: [mapped] }, '');
                        const cloudCodeResponse = {
                            response: { candidates: [mapped] },
                            traceId: '',
                            metadata: {},
                        };
                        sanitizeCandidatesInResponse(cloudCodeResponse);
                        writeSafeSseChunk(res, cloudCodeResponse);
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
                        content: { parts: [{ text: '' }], role: 'model' },
                        finishReason: 'STOP',
                        index: 0,
                    },
                ],
            },
            traceId: '',
            metadata: {},
        };
        sanitizeCandidatesInResponse(finalChunk);
        writeSafeSseChunk(res, finalChunk);
        res.end();
        (0, httpUtils_1.safeEnd)(res);
        const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
        electron_log_1.default.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> Stream completed successfully`);
        const pId = model.name.includes('-') ? model.name.split('-')[0] : model.provider;
        void (0, customModelStore_1.recordProviderUsage)(pId);
        const latencyMs = Math.max(1, Date.now() - streamStartTime);
        if (streamTotalTokens === 0 && streamCompletionTokens === 0 && streamOutputChars > 0) {
            streamCompletionTokens = Math.max(1, Math.round(streamOutputChars / 4));
            streamTotalTokens = streamPromptTokens + streamCompletionTokens;
        }
        logTokenUsageEvent({
            id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            timestamp: Date.now(),
            conversationId: ctx.geminiBody?.conversationId || ctx.geminiBody?.sessionId || undefined,
            provider: model.provider,
            model: model.displayName || model.name,
            promptTokens: streamPromptTokens,
            completionTokens: streamCompletionTokens,
            totalTokens: streamTotalTokens || (streamPromptTokens + streamCompletionTokens),
            cachedTokens: streamCachedTokens,
            latencyMs,
            status: apiRes.statusCode || 200,
            endpoint: '/v1internal:streamGenerateContent',
        });
    });
}
/** Non-stream response branch — JSON translate, retry on error status, graceful envelope. */
function handleNonStreamResponse(apiRes, ctx) {
    const { model, res, provider, traceId } = ctx;
    const nonStreamStartTime = Date.now();
    let body = '';
    apiRes.on('data', (chunk) => (body += chunk));
    apiRes.on('end', () => {
        const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
        if (apiRes.statusCode >= 400) {
            const diagnostic = (0, errorClassifier_1.classifyError)(apiRes.statusCode, null, body, model.provider);
            electron_log_1.default.error(`[Proxy] ⚠️ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP ${apiRes.statusCode} (${diagnostic.title}: ${diagnostic.message})`);
            emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode, body, model.provider));
            // Trip the breaker on hard failures so subsequent requests
            // short-circuit instead of piling up against a stuck upstream.
            if (diagnostic.errorType === 'server' ||
                diagnostic.errorType === 'rate_limit' ||
                diagnostic.errorType === 'timeout' ||
                diagnostic.errorType === 'network' ||
                diagnostic.errorType === 'billing') {
                recordModelFailure(model, diagnostic.errorType === 'billing' ? 'rate_limit' : diagnostic.errorType);
                if (diagnostic.errorType === 'rate_limit' || diagnostic.errorType === 'billing') {
                    (0, modelRouter_1.markProviderRateLimited)(model.apiUrl);
                }
            }
            // Retry if eligible based on status code and NOT a permanent billing/quota failure
            if (diagnostic.errorType !== 'billing' && (0, retryStrategy_1.shouldRetryStatus)(apiRes.statusCode, ctx.retryCount, ctx.maxRetries)) {
                const retryAfterMs = parseRetryAfter(apiRes.headers);
                const delay = (0, retryStrategy_1.computeRetryDelay)('rate-limit', ctx.retryCount, retryAfterMs);
                ctx.retry(ctx.retryCount, delay, `Upstream error status ${apiRes.statusCode}`);
                return;
            }
            if (ctx.attemptFallback(diagnostic))
                return;
            sendGracefulNonStreamError(res, diagnostic, model);
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
            sanitizeCandidatesInResponse(cloudCodeResponse);
            // Successful 2xx response — clear breaker for this model.
            (0, circuitBreaker_1.recordSuccess)(model);
            const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
            electron_log_1.default.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP 200 OK`);
            // P5-2: feed the per-model retry budget a success sample so the
            // model's trust score recovers after a hard stretch of failures.
            (0, retryBudget_1.getRetryBudget)().recordSuccess(model);
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify(cloudCodeResponse));
            }
            const usage = mapped?.usageMetadata;
            const pTokens = usage?.promptTokenCount || 0;
            const cTokens = usage?.candidatesTokenCount || 0;
            const tTokens = usage?.totalTokenCount || (pTokens + cTokens);
            logTokenUsageEvent({
                id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                timestamp: Date.now(),
                conversationId: ctx.geminiBody?.conversationId || ctx.geminiBody?.sessionId || undefined,
                provider: model.provider,
                model: model.displayName || model.name,
                promptTokens: pTokens,
                completionTokens: cTokens,
                totalTokens: tTokens,
                cachedTokens: usage?.cachedContentTokenCount || 0,
                latencyMs: Math.max(1, Date.now() - nonStreamStartTime),
                status: 200,
                endpoint: '/v1internal:generateContent',
            });
        }
        catch (e) {
            electron_log_1.default.error('[Proxy] Failed to map response:', e);
            if (ctx.retryCount < ctx.maxRetries) {
                ctx.retry(ctx.retryCount, (0, retryStrategy_1.computeRetryDelay)('server-error', ctx.retryCount, 0), 'Parse error');
                return;
            }
            const diagnostic = (0, errorClassifier_1.classifyError)(500, e, body, model.provider);
            sendGracefulNonStreamError(res, diagnostic, model);
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
    if (ctx.isStream) {
        sendGracefulStreamError(res, diagnostic, model);
    }
    else {
        sendGracefulNonStreamError(res, diagnostic, model);
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
        sendGracefulStreamError(res, diagnostic, model);
    }
    else {
        sendGracefulNonStreamError(res, diagnostic, model);
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
// ─── Google Account Pool (re-exported from src/proxy/googlePool.ts) ────────────
var googlePool_2 = require("./proxy/googlePool");
Object.defineProperty(exports, "registerAccountRefreshToken", { enumerable: true, get: function () { return googlePool_2.registerAccountRefreshToken; } });
Object.defineProperty(exports, "getAccountQuotaKey", { enumerable: true, get: function () { return googlePool_2.getAccountQuotaKey; } });
Object.defineProperty(exports, "isAccountUnlicensed", { enumerable: true, get: function () { return googlePool_2.isAccountUnlicensed; } });
Object.defineProperty(exports, "markAccountUnlicensed", { enumerable: true, get: function () { return googlePool_2.markAccountUnlicensed; } });
Object.defineProperty(exports, "getUnlicensedAccountKeys", { enumerable: true, get: function () { return googlePool_2.getUnlicensedAccountKeys; } });
Object.defineProperty(exports, "restoreUnlicensedAccountKeys", { enumerable: true, get: function () { return googlePool_2.restoreUnlicensedAccountKeys; } });
Object.defineProperty(exports, "markAccountQuotaExhausted", { enumerable: true, get: function () { return googlePool_2.markAccountQuotaExhausted; } });
Object.defineProperty(exports, "_resetUnlicensedAccounts", { enumerable: true, get: function () { return googlePool_2._resetUnlicensedAccounts; } });
Object.defineProperty(exports, "isAccountInProbation", { enumerable: true, get: function () { return googlePool_2.isAccountInProbation; } });
Object.defineProperty(exports, "endAccountProbation", { enumerable: true, get: function () { return googlePool_2.endAccountProbation; } });
Object.defineProperty(exports, "_resetAccountProbation", { enumerable: true, get: function () { return googlePool_2._resetAccountProbation; } });
Object.defineProperty(exports, "isAccountInCooldown", { enumerable: true, get: function () { return googlePool_2.isAccountInCooldown; } });
Object.defineProperty(exports, "setAccountCooldown", { enumerable: true, get: function () { return googlePool_2.setAccountCooldown; } });
Object.defineProperty(exports, "getAccountCooldownRemaining", { enumerable: true, get: function () { return googlePool_2.getAccountCooldownRemaining; } });
Object.defineProperty(exports, "getSoonestAccountCooldownRemaining", { enumerable: true, get: function () { return googlePool_2.getSoonestAccountCooldownRemaining; } });
Object.defineProperty(exports, "clearAccountCooldown", { enumerable: true, get: function () { return googlePool_2.clearAccountCooldown; } });
Object.defineProperty(exports, "getActiveAccountCooldowns", { enumerable: true, get: function () { return googlePool_2.getActiveAccountCooldowns; } });
Object.defineProperty(exports, "restoreActiveAccountCooldowns", { enumerable: true, get: function () { return googlePool_2.restoreActiveAccountCooldowns; } });
Object.defineProperty(exports, "verifyAndReconcileCooldowns", { enumerable: true, get: function () { return googlePool_2.verifyAndReconcileCooldowns; } });
Object.defineProperty(exports, "_resetAllAccountCooldowns", { enumerable: true, get: function () { return googlePool_2._resetAllAccountCooldowns; } });
Object.defineProperty(exports, "autoHealAccountOnQuotaRecovery", { enumerable: true, get: function () { return googlePool_2.autoHealAccountOnQuotaRecovery; } });
Object.defineProperty(exports, "getAccountInFlight", { enumerable: true, get: function () { return googlePool_2.getAccountInFlight; } });
Object.defineProperty(exports, "MAX_CONCURRENT_PER_ACCOUNT", { enumerable: true, get: function () { return googlePool_2.MAX_CONCURRENT_PER_ACCOUNT; } });
Object.defineProperty(exports, "notifySlotAvailable", { enumerable: true, get: function () { return googlePool_2.notifySlotAvailable; } });
Object.defineProperty(exports, "_clearSlotWaitersForTests", { enumerable: true, get: function () { return googlePool_2._clearSlotWaitersForTests; } });
Object.defineProperty(exports, "waitForAccountSlot", { enumerable: true, get: function () { return googlePool_2.waitForAccountSlot; } });
Object.defineProperty(exports, "incrementAccountInFlight", { enumerable: true, get: function () { return googlePool_2.incrementAccountInFlight; } });
Object.defineProperty(exports, "decrementAccountInFlight", { enumerable: true, get: function () { return googlePool_2.decrementAccountInFlight; } });
Object.defineProperty(exports, "_resetAccountInFlight", { enumerable: true, get: function () { return googlePool_2._resetAccountInFlight; } });
Object.defineProperty(exports, "recordAccountRequest", { enumerable: true, get: function () { return googlePool_2.recordAccountRequest; } });
Object.defineProperty(exports, "getAccountLastUsed", { enumerable: true, get: function () { return googlePool_2.getAccountLastUsed; } });
Object.defineProperty(exports, "getAccountRpmCount", { enumerable: true, get: function () { return googlePool_2.getAccountRpmCount; } });
Object.defineProperty(exports, "_resetAccountRpm", { enumerable: true, get: function () { return googlePool_2._resetAccountRpm; } });
Object.defineProperty(exports, "getModelQuotaScore", { enumerable: true, get: function () { return googlePool_2.getModelQuotaScore; } });
Object.defineProperty(exports, "EWMA_DECAY_THRESHOLD_MS", { enumerable: true, get: function () { return googlePool_2.EWMA_DECAY_THRESHOLD_MS; } });
Object.defineProperty(exports, "recordAccountLatency", { enumerable: true, get: function () { return googlePool_2.recordAccountLatency; } });
Object.defineProperty(exports, "getAccountAvgLatency", { enumerable: true, get: function () { return googlePool_2.getAccountAvgLatency; } });
Object.defineProperty(exports, "_resetAccountLatencies", { enumerable: true, get: function () { return googlePool_2._resetAccountLatencies; } });
Object.defineProperty(exports, "isPoolUnderQuotaStress", { enumerable: true, get: function () { return googlePool_2.isPoolUnderQuotaStress; } });
Object.defineProperty(exports, "resolveGoogleProjectId", { enumerable: true, get: function () { return googlePool_2.resolveGoogleProjectId; } });
Object.defineProperty(exports, "getAccountDynamicScore", { enumerable: true, get: function () { return googlePool_2.getAccountDynamicScore; } });
Object.defineProperty(exports, "classifyGoogleCloudCode429", { enumerable: true, get: function () { return googlePool_2.classifyGoogleCloudCode429; } });
Object.defineProperty(exports, "selectCandidateP2C", { enumerable: true, get: function () { return googlePool_2.selectCandidateP2C; } });
Object.defineProperty(exports, "selectBestModelByQuota", { enumerable: true, get: function () { return googlePool_2.selectBestModelByQuota; } });
Object.defineProperty(exports, "getGoogleAccountPool", { enumerable: true, get: function () { return googlePool_2.getGoogleAccountPool; } });
Object.defineProperty(exports, "recordAccountBurst", { enumerable: true, get: function () { return googlePool_2.recordAccountBurst; } });
Object.defineProperty(exports, "clearAccountBurst", { enumerable: true, get: function () { return googlePool_2.clearAccountBurst; } });
Object.defineProperty(exports, "liftBurstCooldowns", { enumerable: true, get: function () { return googlePool_2.liftBurstCooldowns; } });
Object.defineProperty(exports, "_resetAccountBurst", { enumerable: true, get: function () { return googlePool_2._resetAccountBurst; } });
const sessionAffinities = new Map();
const SESSION_AFFINITY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
function extractSessionId(body, headers) {
    if (body?.sessionId && typeof body.sessionId === 'string')
        return body.sessionId;
    if (body?.context?.sessionId && typeof body.context.sessionId === 'string') {
        return body.context.sessionId;
    }
    if (headers) {
        const h = headers['x-session-id'] || headers['x-request-session-id'];
        if (typeof h === 'string' && h)
            return h;
    }
    const contents = body?.contents;
    if (Array.isArray(contents) && contents.length > 0) {
        const firstUser = contents.find((c) => c && c.role === 'user');
        if (firstUser && Array.isArray(firstUser.parts) && firstUser.parts[0]?.text) {
            const snippet = String(firstUser.parts[0].text).slice(0, 120);
            let hash = 5381;
            for (let i = 0; i < snippet.length; i++) {
                hash = ((hash << 5) + hash) + snippet.charCodeAt(i);
                hash |= 0;
            }
            return 'conv_' + (hash >>> 0).toString(16);
        }
    }
    return null;
}
function getSessionBoundModel(sessionId, targetModel, allModels) {
    const now = Date.now();
    const affinity = sessionAffinities.get(sessionId);
    if (!affinity)
        return targetModel;
    if (now - affinity.lastUsed > SESSION_AFFINITY_TTL_MS) {
        sessionAffinities.delete(sessionId);
        return targetModel;
    }
    // Find candidate models that share the same base external model (e.g. Gemini 3.8 Flash High across accounts)
    const targetBase = (0, urlBuilder_1.getBaseModelId)(targetModel.externalModelName);
    const bound = allModels.find((m) => {
        const mBase = (0, urlBuilder_1.getBaseModelId)(m.externalModelName);
        return mBase === targetBase && (0, googlePool_1.getAccountQuotaKey)(m) === affinity.accountKey;
    });
    if (bound && !(0, circuitBreaker_1.getOpenBreaker)(bound) && (0, googlePool_1.getModelQuotaScore)(bound) > 0) {
        affinity.lastUsed = now;
        return bound;
    }
    return targetModel;
}
function bindSessionToModel(sessionId, model) {
    if (model.name?.includes(':auto-pool') || model.apiKey === 'auto')
        return;
    sessionAffinities.set(sessionId, {
        modelName: model.name,
        accountKey: (0, googlePool_1.getAccountQuotaKey)(model),
        lastUsed: Date.now(),
    });
}
function clearSessionAffinities() {
    sessionAffinities.clear();
    sessionModelFallbacks.clear();
}
exports.SESSION_MODEL_FALLBACK_TTL_MS = 3 * 60 * 1000; // 3 minutes auto-recovery back to primary model
const sessionModelFallbacks = new Map();
function getSessionModelFallback(sessionKey) {
    if (!sessionKey)
        return undefined;
    const fb = sessionModelFallbacks.get(sessionKey);
    if (!fb)
        return undefined;
    if (Date.now() - fb.lastUsed > exports.SESSION_MODEL_FALLBACK_TTL_MS ||
        /gemini-(?:3\.[0-7]|2\.|1\.)/i.test(fb.fallbackModel) ||
        /gpt-[34]/i.test(fb.fallbackModel)) {
        sessionModelFallbacks.delete(sessionKey);
        return undefined;
    }
    return fb;
}
function clearSessionModelFallback(sessionKey) {
    if (sessionKey) {
        sessionModelFallbacks.delete(sessionKey);
    }
}
function setSessionModelFallback(sessionKey, originalModel, fallbackModel, notified = false) {
    if (!sessionKey || !originalModel || !fallbackModel)
        return;
    // Strict Zero-Fallback: Gemini 4 Argon or unreleased models must NEVER have a fallback model assigned
    if (originalModel === 'gemini-4-argon' || originalModel === 'gemini-4-argon-medium') {
        return;
    }
    if (/gemini-(?:3\.[0-7]|2\.|1\.)/i.test(fallbackModel) || /gpt-[34]/i.test(fallbackModel)) {
        return;
    }
    const cleanOrig = originalModel.trim().toLowerCase();
    const cleanFb = fallbackModel.trim().toLowerCase();
    if (cleanOrig === cleanFb && !notified)
        return;
    const existing = sessionModelFallbacks.get(sessionKey);
    if (existing) {
        const existOrig = existing.originalModel.trim().toLowerCase();
        const existFb = existing.fallbackModel.trim().toLowerCase();
        // Prevent circular flip-flop (A -> B then B -> A)
        if (cleanOrig === existFb && cleanFb === existOrig) {
            electron_log_1.default.warn(`[Proxy] Preventing circular session fallback loop for ${sessionKey}: existing (${existing.originalModel} -> ${existing.fallbackModel}) vs new (${originalModel} -> ${fallbackModel})`);
            return;
        }
    }
    sessionModelFallbacks.set(sessionKey, {
        originalModel,
        fallbackModel,
        notified,
        lastUsed: Date.now(),
    });
}
function clearSessionModelFallbacks() {
    sessionModelFallbacks.clear();
}
function getActiveSessionModelFallbacks() {
    const result = {};
    const now = Date.now();
    for (const [key, fb] of sessionModelFallbacks.entries()) {
        if (now - fb.lastUsed <= exports.SESSION_MODEL_FALLBACK_TTL_MS) {
            result[key] = { ...fb };
        }
        else {
            sessionModelFallbacks.delete(key);
        }
    }
    return result;
}
function handleCustomModelRequest(res, model, rawGeminiBody, isStream, retryCount = 0, fallbackDepth = 0) {
    // Virtual auto-pool entries have no API key and must be dispatched via executeGoogleCloudCodeWithPool
    if (model.name?.includes(':auto-pool') || model.apiKey === 'auto' || !model.apiKey || model.apiKey === 'none') {
        if ((0, googleAuth_1.isGoogleCloudCodeModel)(model) || model.name?.includes(':auto-pool') || model.apiKey === 'auto') {
            const allCustomModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
            const accountPool = (0, googlePool_1.getGoogleAccountPool)(model, allCustomModels);
            const targetModel = (0, googleAuth_1.normalizeCloudCodeModelId)(model.externalModelName || model.name);
            (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(rawGeminiBody, targetModel);
            const cloudCodePayload = {
                project: model.projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
                model: targetModel,
                request: rawGeminiBody,
            };
            const fakeReq = {
                url: isStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent',
                method: 'POST',
                headers: {},
            };
            void executeGoogleCloudCodeWithPool(fakeReq, res, cloudCodePayload, accountPool, false, '', null);
            return;
        }
        electron_log_1.default.error(`[Proxy] Cannot route virtual auto-pool or keyless model ${model.name} to translator without valid API key.`);
        if (!res.headersSent && !res.writableEnded) {
            (0, httpUtils_1.safeWriteHead)(res, 503, { 'Content-Type': 'application/json' });
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts in pool are in cooldown and no valid API key is available.' } }));
        }
        return;
    }
    const geminiBody = (0, contextTrimmer_1.trimContextPayload)(rawGeminiBody);
    const bodyContents = geminiBody.contents || geminiBody.request?.contents;
    if (Array.isArray(bodyContents)) {
        (0, googleAuth_1.normalizeConversationTurns)(bodyContents);
        const sessId = extractSessionId(geminiBody, {});
        (0, shared_1.restoreThoughtSignatures)(bodyContents, sessId || '', model.name || '');
    }
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
        if (isStream) {
            sendGracefulStreamError(res, cached, model);
        }
        else {
            sendGracefulNonStreamError(res, cached, model);
        }
        return;
    }
    // Shared by both the open-breaker short-circuit path and the regular
    // upstream-error paths. It only picks a different model and re-dispatches.
    function attemptFallback(diagnostic) {
        if (fallbackDepth >= 5)
            return false;
        const isEligibleForFallback = diagnostic.errorType === 'rate_limit' ||
            diagnostic.errorType === 'server' ||
            diagnostic.errorType === 'network' ||
            diagnostic.errorType === 'billing' ||
            diagnostic.errorType === 'timeout' ||
            diagnostic.title.includes('404') ||
            diagnostic.message.includes('404');
        if (!isEligibleForFallback)
            return false;
        try {
            const allModels = (0, modelLoader_1.loadCustomModels)();
            const currentAccountKey = (0, googlePool_1.getAccountQuotaKey)(model);
            const targetBase = (0, urlBuilder_1.getBaseModelId)(model.externalModelName || model.name);
            const targetNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(targetBase);
            // Sibling accounts in the pool offering the exact same model, sorted by remaining quota score.
            // ponytail: match both raw base model ID and canonical Cloud Code model ID (e.g. gemini-3.8-flash == gemini-3.8-flash-tiered)
            // so if a direct Google AI Studio key fails with 429/503, the proxy falls back immediately to Cloud Code accounts
            // for the SAME Gemini model instead of needlessly jumping to Claude.
            const poolSiblings = allModels
                .filter((m) => {
                if (m.name === model.name)
                    return false;
                if (m.name?.includes(':auto-pool') || m.apiKey === 'auto' || !m.apiKey || m.apiKey === 'none')
                    return false;
                const mBase = (0, urlBuilder_1.getBaseModelId)(m.externalModelName || m.name);
                const mNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(mBase);
                const isSameModel = mBase === targetBase || (targetNorm && mNorm === targetNorm);
                return isSameModel && (0, googlePool_1.getAccountQuotaKey)(m) !== currentAccountKey && !(0, circuitBreaker_1.getOpenBreaker)(m);
            })
                .sort((a, b) => (0, googlePool_1.getModelQuotaScore)(b) - (0, googlePool_1.getModelQuotaScore)(a));
            let orderedModels = allModels;
            const chainItems = [];
            if (model.fallbackChain) {
                if (Array.isArray(model.fallbackChain)) {
                    chainItems.push(...model.fallbackChain);
                }
                else if (typeof model.fallbackChain === 'string') {
                    chainItems.push(...model.fallbackChain.split(',').map((s) => s.trim()).filter(Boolean));
                }
            }
            else if (model.fallbackModel) {
                chainItems.push(model.fallbackModel);
            }
            else if (model.provider === 'google' && !(0, googleAuth_1.isGoogleCloudCodeModel)(model)) {
                // Intelligent default fallback cascade for Google AI Studio models (e.g. 503 high demand or 429)
                const norm = (model.externalModelName || model.name || '').toLowerCase();
                if (norm.includes('gemini-3.8-flash')) {
                    chainItems.push('gemini-3.8-pro');
                }
            }
            const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
            if (allowCrossModel && (poolSiblings.length > 0 || chainItems.length > 0)) {
                const chainModels = [];
                for (const item of chainItems) {
                    const matches = allModels.filter((m) => !chainModels.includes(m) &&
                        !poolSiblings.includes(m) &&
                        !m.name?.includes(':auto-pool') &&
                        m.apiKey !== 'auto' &&
                        m.apiKey !== 'none' &&
                        Boolean(m.apiKey) &&
                        (m.name === item ||
                            m.displayName === item ||
                            m.externalModelName === item ||
                            m.name.endsWith(`/${item}`) ||
                            (0, urlBuilder_1.getBaseModelId)(m.externalModelName || m.name) === (0, urlBuilder_1.getBaseModelId)(item)));
                    chainModels.push(...matches);
                }
                const rest = allModels.filter((m) => !poolSiblings.includes(m) && !chainModels.includes(m) && !m.name?.includes(':auto-pool') && m.apiKey !== 'auto');
                orderedModels = [...poolSiblings, ...chainModels, ...rest];
            }
            else {
                // Strict model locking: only rotate among accounts offering the exact same model!
                orderedModels = poolSiblings;
            }
            // ponytail: skip same account on rate_limit if it's the exact same base model (shared quota).
            // On billing/credit exhaustion, skip the ENTIRE account regardless of model tier.
            const isBillingOrRateLimit = diagnostic.errorType === 'rate_limit' || diagnostic.errorType === 'billing';
            const failedAccountKey = isBillingOrRateLimit ? (0, googlePool_1.getAccountQuotaKey)(model) : null;
            for (const m of orderedModels) {
                if (m.name !== model.name &&
                    !m.name?.includes(':auto-pool') &&
                    m.apiKey &&
                    m.apiKey !== 'auto' &&
                    m.apiKey !== 'none' &&
                    !m.apiKey.startsWith('fallback:')) {
                    if (failedAccountKey &&
                        (0, googlePool_1.getAccountQuotaKey)(m) === failedAccountKey &&
                        (diagnostic.errorType === 'billing' || (0, urlBuilder_1.getBaseModelId)(m.name) === targetBase)) {
                        electron_log_1.default.warn(`[Proxy] Auto-fallback: skipping ${m.displayName || m.name} (same account credentials, ${diagnostic.errorType === 'billing' ? 'billing/credits exhausted' : 'shared quota on ' + targetBase})`);
                        continue;
                    }
                    const mFamily = (m.externalModelName || m.name || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
                    if ((0, googlePool_1.isAccountInCooldown)(m, mFamily) ||
                        (0, circuitBreaker_1.getOpenBreaker)(m) ||
                        ((0, googleAuth_1.isGoogleCloudCodeModel)(m) && (0, googlePool_1.getModelQuotaScore)(m, mFamily) <= 0) ||
                        (0, modelRouter_1.isProviderRateLimited)(m.apiUrl)) {
                        continue;
                    }
                    const fromName = model.displayName || model.name;
                    const toName = m.displayName || m.name;
                    electron_log_1.default.warn(`[Proxy] Auto-fallback: ${fromName} → ${toName} (reason: ${diagnostic.errorType} — ${diagnostic.title})`);
                    // Update session affinity on fallback to preserve subsequent queries on healthy account
                    const sessId = extractSessionId(geminiBody);
                    if (sessId) {
                        bindSessionToModel(sessId, m);
                    }
                    const alreadyNotified = sessId ? getSessionModelFallback(sessId)?.notified === true : false;
                    if (sessId) {
                        setSessionModelFallback(sessId, model.name, m.name, true);
                    }
                    // L-1: Notify the user in the stream so the fallback is transparent.
                    // We send a brief markdown notice as the first SSE event before
                    // delegating to the fallback model handler (only once per session).
                    const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
                    if (wantsFallbackNotice && isStream && !res.headersSent && !alreadyNotified) {
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
                                            index: 0,
                                        }],
                                },
                                traceId: '',
                                metadata: {},
                            };
                            sanitizeCandidatesInResponse(notice);
                            writeSafeSseChunk(res, notice);
                        }
                    }
                    if ((0, googleAuth_1.isGoogleCloudCodeModel)(m)) {
                        const allCustomModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
                        const accountPool = (0, googlePool_1.getGoogleAccountPool)(m, allCustomModels);
                        const targetModel = (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name);
                        (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(geminiBody, targetModel);
                        const cloudCodePayload = {
                            project: m.projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
                            model: targetModel,
                            request: geminiBody,
                        };
                        const fakeReq = {
                            url: isStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent',
                            method: 'POST',
                            headers: {},
                        };
                        executeGoogleCloudCodeWithPool(fakeReq, res, cloudCodePayload, accountPool, false, '', sessId);
                        return true;
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
    let cleanModelName = (0, urlBuilder_1.getBaseModelId)(model.externalModelName);
    // Auto-fallback for reasoning models when tools are present (avoids HTTP 400 Bad Request)
    if (geminiBody.tools && Array.isArray(geminiBody.tools) && geminiBody.tools.length > 0) {
        if (cleanModelName.includes('thinking')) {
            cleanModelName = cleanModelName.replace('-thinking', '');
            electron_log_1.default.info(`[Proxy] Tools detected in payload. Downgrading thinking model to ${cleanModelName}`);
        }
        else if (cleanModelName === 'deepseek-reasoner') {
            cleanModelName = 'deepseek-chat';
            electron_log_1.default.info(`[Proxy] Tools detected in payload. Downgrading deepseek-reasoner to ${cleanModelName}`);
        }
    }
    const payload = registry.translateRequest(provider, geminiBody, cleanModelName, model.extraBody);
    const headers = registry.getProviderHeaders(provider, model.apiKey, model.extraHeaders);
    if (isStream && registry.supportsStreaming(provider) && provider !== 'google') {
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
    const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
    electron_log_1.default.info(`[Proxy] ➡️ [Request] Model: [${cleanModelName || model.name}] | Account/Provider: [${accountLabel}] (${model.provider}) (stream: ${!!isStream})${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
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
    const client = lsParsed.protocol === 'https:' ? https_1.default : http;
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
            const disabledModelIds = (0, modelLoader_1.loadDisabledModelIds)();
            // Run concurrent health checks (cached with TTL, max 800ms wait)
            (0, modelHealthChecker_2.getFastOrCachedHealth)(customModels, 800).then((healthMap) => {
                const { buffer: modifiedBuf } = (0, protoInjector_1.injectCustomModelsIntoResponse)(responseBuf, customModels, healthMap, true, disabledModelIds);
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
                const { buffer: modifiedBuf } = (0, protoInjector_1.injectCustomModelsIntoResponse)(responseBuf, customModels, undefined, true, disabledModelIds);
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
    const client = lsParsed.protocol === 'https:' ? https_1.default : http;
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
            const disabledModelIds = (0, modelLoader_1.loadDisabledModelIds)();
            (0, modelHealthChecker_2.getFastOrCachedHealth)(customModels, 800).then((healthMap) => {
                const { buffer: modifiedBuf, injectedCount } = (0, protoInjector_1.injectCustomModelsIntoUserStatus)(responseBuf, customModels, healthMap, disabledModelIds);
                electron_log_1.default.debug(`[Proxy] GetUserStatus injected ${injectedCount} custom models`);
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
                const { buffer: modifiedBuf, injectedCount } = (0, protoInjector_1.injectCustomModelsIntoUserStatus)(responseBuf, customModels, undefined, disabledModelIds);
                electron_log_1.default.debug(`[Proxy] GetUserStatus injected ${injectedCount} custom models (fallback)`);
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
function matchesCustomModel(m, candidate) {
    if (!candidate || typeof candidate !== 'string')
        return false;
    // An original native model string without custom- prefix is an IDE native selection, never a custom model
    if (!candidate.startsWith('custom-') && !/MODEL_PLACEHOLDER_/i.test(candidate) && (0, modelUtils_1.isNativeCloudCodeModel)(candidate)) {
        return false;
    }
    const enumName = (0, idGenerator_1.generateModelPlaceholderId)(m);
    const slug = (0, idGenerator_1.toSlug)(m);
    const clean = candidate.replace(/^models\//, '');
    const cleanLower = clean.toLowerCase();
    const candLower = candidate.toLowerCase();
    const extLower = (m.externalModelName || '').toLowerCase();
    const idLower = (m.id || '').toLowerCase();
    const dispLower = (m.displayName || '').toLowerCase();
    const slugLower = slug.toLowerCase();
    const mSlugLower = (m._slug || '').toLowerCase();
    const isCandidateGemini = cleanLower.startsWith('gemini-');
    const isModelGemini = m.provider === 'google' || (!m.provider && (extLower.startsWith('gemini-') || idLower.startsWith('gemini-')));
    const normCand = isCandidateGemini ? (0, googleAuth_1.normalizeGoogleModelId)(cleanLower) : '';
    const normExt = (isModelGemini && extLower) ? (0, googleAuth_1.normalizeGoogleModelId)(extLower) : '';
    const normId = (isModelGemini && idLower) ? (0, googleAuth_1.normalizeGoogleModelId)(idLower) : '';
    return (m.name === candidate ||
        m.name === clean ||
        m.name.replace(/^models\//, '') === clean ||
        m.name.replace(/^models\//, '').toLowerCase() === cleanLower ||
        slug === candidate ||
        slug === clean ||
        slugLower === candLower ||
        slugLower === cleanLower ||
        enumName === candidate ||
        enumName === clean ||
        `models/${enumName}` === candidate ||
        candidate.endsWith(enumName) ||
        enumName.toLowerCase() === candLower ||
        enumName.toLowerCase() === cleanLower ||
        `models/${enumName.toLowerCase()}` === candLower ||
        candLower.endsWith(enumName.toLowerCase()) ||
        (Boolean(extLower) && (candLower === extLower || cleanLower === extLower || candLower === `models/${extLower}`)) ||
        (Boolean(idLower) && (candLower === idLower || cleanLower === idLower || candLower === `models/${idLower}`)) ||
        (Boolean(dispLower) && (candLower === dispLower || cleanLower === dispLower)) ||
        (Boolean(mSlugLower) && (candLower === mSlugLower || cleanLower === mSlugLower)) ||
        (isCandidateGemini && isModelGemini && Boolean(normExt) && normCand === normExt) ||
        (isCandidateGemini && isModelGemini && Boolean(normId) && normCand === normId) ||
        (isModelGemini && candLower.includes('gemini-3.8-flash') && (extLower.includes('gemini-3.8-flash') || idLower.includes('gemini-3.8-flash') || dispLower.includes('gemini 3.8 flash'))));
}
const nativeSessions = new Map();
exports.NATIVE_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
exports.NATIVE_CASCADE_BLOCK_WINDOW_MS = 2 * 60 * 1000; // 2 minutes (covers Go LS exponential backoff cascade cycle)
function markNativeSession(sessionKey, model) {
    if (!sessionKey)
        return;
    const now = Date.now();
    const existing = nativeSessions.get(sessionKey);
    nativeSessions.set(sessionKey, {
        originalModel: model || existing?.originalModel || '',
        lastSeen: now,
        lastError: existing?.lastError,
    });
}
function getNativeSession(sessionKey) {
    if (!sessionKey)
        return undefined;
    const rec = nativeSessions.get(sessionKey);
    if (!rec)
        return undefined;
    if (Date.now() - rec.lastSeen > exports.NATIVE_SESSION_TTL_MS) {
        nativeSessions.delete(sessionKey);
        return undefined;
    }
    return rec;
}
function recordNativeSessionError(sessionKey, statusCode, headers, body, modelName) {
    if (!sessionKey)
        return;
    const rec = nativeSessions.get(sessionKey);
    if (rec) {
        rec.lastError = { statusCode, headers, body };
        rec.lastSeen = Date.now();
        if (modelName && !rec.originalModel) {
            rec.originalModel = modelName;
        }
    }
    else if (modelName && (modelName.includes('argon') || modelName.includes('gemini-4'))) {
        nativeSessions.set(sessionKey, {
            originalModel: modelName,
            lastSeen: Date.now(),
            lastError: { statusCode, headers, body },
        });
    }
}
function clearNativeSessions() {
    nativeSessions.clear();
}
function isAllowedOrigin(req) {
    const rawHost = (req.headers.host || '').toLowerCase();
    // Strip port from Host header before validation (handling IPv6 brackets and bare IPv6)
    let hostname = rawHost;
    if (rawHost.startsWith('[') && rawHost.includes(']')) {
        hostname = rawHost.slice(1, rawHost.indexOf(']'));
    }
    else if (rawHost.includes(':')) {
        const parts = rawHost.split(':');
        if (parts.length === 2) {
            hostname = parts[0];
        }
        // If parts.length > 2 without brackets, it's bare IPv6 (e.g. '::1')
    }
    const origin = (req.headers.origin || req.headers.referer || '').toLowerCase();
    // 1. Validate Host header strictly against allowed loopback hosts or googleapis upstream
    const isHostAllowed = constants_1.LOOPBACK_HOSTS.includes(hostname) ||
        hostname === 'googleapis.com' ||
        hostname.endsWith('.googleapis.com');
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
        const host = (req.headers.host || '').toLowerCase();
        const isSystemCertNoise = host.includes('digicert.com') ||
            host.includes('windowsupdate.com') ||
            host.includes('symcb.com') ||
            host.includes('verisign.com') ||
            host.includes('pki.goog') ||
            host.includes('globalsign.com') ||
            host.includes('sectigo.com');
        if (isSystemCertNoise) {
            electron_log_1.default.debug(`[Proxy] Ignored background OS certificate/CRL check: host=${req.headers.host}`);
        }
        else {
            electron_log_1.default.warn(`[Proxy] Blocked request with unauthorized Host/Origin: host=${req.headers.host} origin=${req.headers.origin}`);
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Forbidden: Unauthorized origin' } }));
        return;
    }
    // Health check — keep this FIRST so the LS sees a live port even if other
    // initialization (padding strip, model loading, etc.) is delayed or fails.
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
        electron_log_1.default.debug(`[Proxy] /health hit from ${req.socket.remoteAddress || 'unknown'}`);
        const memUsage = process.memoryUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            port: proxyPort,
            pid: process.pid,
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
    // Remote VPS Agent State Sync (from IDE Webview or preload)
    if (req.url === '/api/remote/status' || req.url?.startsWith('/api/remote/status?')) {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                active: isRemoteVpsActive,
                host: remoteVpsHost,
                hasToken: Boolean(remoteVpsToken || constants_1.DEFAULT_REMOTE_TOKEN),
                remoteSessions: remoteSessionsMap,
            }));
            return;
        }
        if (req.method === 'POST') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                try {
                    const b = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    if (b.active !== undefined)
                        isRemoteVpsActive = !!b.active;
                    if (b.host)
                        remoteVpsHost = String(b.host);
                    if (b.token && b.token !== 'null' && b.token !== 'undefined' && String(b.token).trim().length > 0) {
                        remoteVpsToken = String(b.token).trim();
                    }
                    if (b.remoteSessions && typeof b.remoteSessions === 'object') {
                        remoteSessionsMap = { ...remoteSessionsMap, ...b.remoteSessions };
                    }
                    saveRemoteState();
                    electron_log_1.default.info(`[Proxy] Remote VPS session status updated: active=${isRemoteVpsActive}, host=${remoteVpsHost}, tokenSet=${!!remoteVpsToken}, remoteSessionsCount=${Object.keys(remoteSessionsMap).length}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        ok: true,
                        active: isRemoteVpsActive,
                        host: remoteVpsHost,
                        hasToken: Boolean(remoteVpsToken || constants_1.DEFAULT_REMOTE_TOKEN),
                        remoteSessions: remoteSessionsMap,
                    }));
                }
                catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
            return;
        }
    }
    // UI & Chat Enhancements Configuration Bridge (GET/POST /api/ui/config)
    if (req.url === '/api/ui/config' || req.url?.startsWith('/api/ui/config?')) {
        const DEFAULT_SUGGESTIONS = [
            { label: 'Continue', text: 'Continue' },
            { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
            { label: 'Keep going', text: 'Keep going' },
            { label: 'Exécuter all steps', text: 'Exécuter toutes les étapes prévues' },
            { label: 'Next phase', text: 'Passer à la phase suivante (Next phase)' }
        ];
        const getConfigPath = () => {
            const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
            return path.join(home, '.gemini', 'antigravity', 'config.json');
        };
        const readUiConfig = () => {
            try {
                const p = getConfigPath();
                if (fs.existsSync(p)) {
                    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
                    const ui = parsed.ui || {};
                    return {
                        retryButton: ui.retryButton !== undefined ? Boolean(ui.retryButton) : true,
                        suggestionPills: ui.suggestionPills !== undefined ? Boolean(ui.suggestionPills) : true,
                        suggestions: Array.isArray(ui.suggestions) && ui.suggestions.length > 0 ? ui.suggestions : DEFAULT_SUGGESTIONS,
                    };
                }
            }
            catch (err) {
                electron_log_1.default.warn('[Proxy] Failed to read ui config from disk:', err);
            }
            return { retryButton: true, suggestionPills: true, suggestions: DEFAULT_SUGGESTIONS };
        };
        if (req.method === 'GET' || req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            if (req.method === 'OPTIONS') {
                res.end();
                return;
            }
            res.end(JSON.stringify(readUiConfig()));
            return;
        }
        if (req.method === 'POST') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    const p = getConfigPath();
                    let parsed = {};
                    if (fs.existsSync(p)) {
                        parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
                    }
                    parsed.ui = { ...(parsed.ui || {}) };
                    if (body.retryButton !== undefined)
                        parsed.ui.retryButton = Boolean(body.retryButton);
                    if (body.suggestionPills !== undefined)
                        parsed.ui.suggestionPills = Boolean(body.suggestionPills);
                    if (Array.isArray(body.suggestions))
                        parsed.ui.suggestions = body.suggestions;
                    fs.mkdirSync(path.dirname(p), { recursive: true });
                    fs.writeFileSync(p, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
                    electron_log_1.default.info(`[Proxy] Updated UI configuration: retryButton=${parsed.ui.retryButton}, suggestionPills=${parsed.ui.suggestionPills}`);
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, ...readUiConfig() }));
                }
                catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: e?.message || 'Invalid JSON' }));
                }
            });
            return;
        }
    }
    // Remote VPS Command Execution Bridge (POST /api/remote/cmd)
    if (req.url === '/api/remote/cmd' || req.url?.startsWith('/api/remote/cmd?')) {
        if (req.method === 'POST') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', async () => {
                try {
                    const b = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    const targetHost = b.host || remoteVpsHost || constants_1.DEFAULT_REMOTE_HOST;
                    const rawToken = b.token ? String(b.token).trim() : '';
                    const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined')
                        ? rawToken
                        : (remoteVpsToken || constants_1.DEFAULT_REMOTE_TOKEN);
                    const cmd = b.command || '';
                    const result = await executeOnRemoteDaemon(targetHost, token, cmd, b.workspaceId, b.sessionId, b.timeoutMs);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
                catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }
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
    // Force an immediate live quota poll for all Google accounts.
    // Useful from the doctor page to bypass the 3-minute poll cadence and get fresh data.
    if (req.method === 'POST' && (req.url === '/force-quota-refresh' || req.url === '/pool/quota-refresh')) {
        const models = (0, modelLoader_1.loadCustomModels)();
        const googleModels = models.filter((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m));
        const accountList = googleModels
            .filter((m, i, arr) => arr.findIndex(x => (0, googlePool_1.getAccountQuotaKey)(x) === (0, googlePool_1.getAccountQuotaKey)(m)) === i)
            .map((m) => m.accountEmail || (0, googlePool_1.getAccountQuotaKey)(m));
        // Fire-and-forget: poll runs in background, cooldowns reconciled after
        (0, googleAuth_1.pollAllGoogleQuotas)(googleModels, googlePool_1.autoHealAccountOnQuotaRecovery)
            .then(() => { (0, googlePool_1.verifyAndReconcileCooldowns)(Date.now(), googleModels); })
            .catch(() => { });
        if ((0, httpUtils_1.safeWriteHead)(res, 202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
            (0, httpUtils_1.safeEnd)(res, JSON.stringify({
                message: 'Quota refresh triggered for all Google accounts. Check /pool-status in ~5s for results.',
                accounts: accountList,
                timestamp: Date.now(),
            }));
        }
        return;
    }
    // Multi-account pool live telemetry & health inspection endpoint
    if (req.method === 'GET' && (req.url === '/pool-status' || req.url === '/pool/status')) {
        const customModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
        const googleModels = customModels.filter((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m));
        const seenAccounts = new Set();
        const poolStats = [];
        for (const m of googleModels) {
            const key = (0, googlePool_1.getAccountQuotaKey)(m);
            if (seenAccounts.has(key))
                continue;
            seenAccounts.add(key);
            const email = m.accountEmail || m.email || '';
            const name = m.accountName || m.displayName || m.name;
            const inFlight = (0, googlePool_1.getAccountInFlight)(m);
            const inProbation = (0, googlePool_1.isAccountInProbation)(m);
            const rpmLastMinute = (0, googlePool_1.getAccountRpmCount)(m);
            const dynamicScore = (0, googlePool_1.getAccountDynamicScore)(m);
            const baseScore = (0, googlePool_1.getModelQuotaScore)(m);
            const cooldownMs = (0, googlePool_1.getAccountCooldownRemaining)(m);
            const breaker = (0, circuitBreaker_1.getOpenBreaker)(m);
            const live = (0, googleAuth_1.getLiveAccountQuota)(key);
            const q = (live || m.quotas);
            const geminiQuotaPct = typeof q?.geminiFiveHourPct === 'number'
                ? q.geminiFiveHourPct
                : typeof q?.fiveHourPercentage === 'number'
                    ? q.fiveHourPercentage
                    : 50;
            const claudeQuotaPct = typeof q?.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : 50;
            const geminiWeeklyPct = typeof q?.geminiWeeklyPct === 'number' ? q.geminiWeeklyPct
                : typeof q?.weeklyPercentage === 'number' ? q.weeklyPercentage : null;
            const claudeWeeklyPct = typeof q?.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : null;
            const quotaSource = live ? 'LIVE' : 'STATIC';
            // How old is the quota data? Helps the UI show a "stale" warning.
            const quotaUpdatedAt = live?.updatedAt || null;
            const quotaAgeMinutes = quotaUpdatedAt ? Math.floor((Date.now() - quotaUpdatedAt) / 60000) : null;
            const revoked = (0, googleAuth_1.isTokenRevoked)(m.refreshToken);
            let status = 'HEALTHY';
            if (revoked) {
                status = 'REAUTH_REQUIRED';
            }
            else if (breaker) {
                status = 'BREAKER_OPEN';
            }
            else if (cooldownMs > 0) {
                status = 'COOLDOWN';
            }
            else if (inProbation) {
                status = 'PROBATION';
            }
            poolStats.push({
                accountKey: key,
                email,
                name,
                dynamicScore,
                baseScore,
                geminiQuotaPct,
                claudeQuotaPct,
                geminiWeeklyPct,
                claudeWeeklyPct,
                quotaSource,
                quotaUpdatedAt,
                quotaAgeMinutes,
                inFlight,
                inProbation,
                maxConcurrent: googlePool_1.MAX_CONCURRENT_PER_ACCOUNT,
                slotAvailable: inFlight < googlePool_1.MAX_CONCURRENT_PER_ACCOUNT,
                reauthRequired: revoked,
                rpmLastMinute,
                cooldownRemainingSec: Math.ceil(cooldownMs / 1000),
                tokenCached: (0, googleAuth_1.isTokenCached)(m.refreshToken),
                status,
            });
        }
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
            poolSize: poolStats.length,
            maxConcurrentPerAccount: googlePool_1.MAX_CONCURRENT_PER_ACCOUNT,
            timestamp: Date.now(),
            accounts: poolStats,
        }));
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
    req.url = req.url.replace(/\/v1internal\/x+/, '');
    // P0-4: Enforce maximum request body size to prevent memory exhaustion DoS
    const MAX_BODY_SIZE = constants_1.DEFAULT_MAX_BODY_SIZE;
    let bodyLength = 0;
    let bodyRejected = false;
    const bodyChunks = [];
    req.on('data', (chunk) => {
        bodyLength += chunk.length;
        if (bodyLength > MAX_BODY_SIZE) {
            if (!bodyRejected) {
                bodyRejected = true;
                const maxMb = Math.round(MAX_BODY_SIZE / (1024 * 1024));
                electron_log_1.default.warn(`[Proxy] Request body exceeds ${maxMb}MB limit (${req.method} ${req.url})`);
                if (!res.headersSent) {
                    res.writeHead(413, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                    });
                    res.end(JSON.stringify({ error: { message: `Request body too large. Maximum: ${maxMb}MB` } }));
                }
                req.resume();
                res.on('finish', () => {
                    req.destroy();
                });
            }
            return;
        }
        bodyChunks.push(chunk);
    });
    req.on('end', async () => {
        if (bodyRejected)
            return;
        let fullBody = Buffer.concat(bodyChunks);
        const bodyStr = fullBody.toString('utf-8');
        const isRoutineNoise = req.url?.includes('Heartbeat') ||
            req.url?.includes('GetUserStatus') ||
            req.url?.includes('listExperiments') ||
            req.url?.includes('loadCodeAssist') ||
            req.url?.includes('recordTrajectoryAnalytics') ||
            req.url?.includes('writeTrajectoryAcls') ||
            req.url?.includes('retrieveUserQuotaSummary') ||
            req.url?.includes('fetchAvailableModels') ||
            req.url?.includes('fetchAdminControls') ||
            req.url?.includes('buildWithGooglePlugins') ||
            req.url?.includes('cascadeNuxes') ||
            req.url?.includes('fetchUserInfo') ||
            req.url === '/health';
        if (isRoutineNoise) {
            electron_log_1.default.debug(`[Proxy] Request: ${req.method} ${req.url}`);
        }
        else {
            electron_log_1.default.info(`[Proxy] Request: ${req.method} ${req.url}`);
        }
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
        // OpenAI /chat/completions relay: sanitizes reasoning_content and forwards to upstream provider
        if (req.method === 'POST' && req.url.includes('/chat/completions')) {
            try {
                const payload = JSON.parse(bodyStr || '{}');
                if (payload.model && /MODEL_PLACEHOLDER_/i.test(payload.model)) {
                    const allModels = (0, modelLoader_1.loadCustomModels)();
                    const found = allModels.find((m) => (0, idGenerator_1.generateModelPlaceholderId)(m) === payload.model || m.name === payload.model || m.name.endsWith('/' + payload.model));
                    if (found && found.externalModelName) {
                        payload.model = found.externalModelName;
                    }
                    else {
                        const active = allModels.filter(m => m.enabled !== false && m.externalModelName);
                        const defaultModel = active[0] || allModels[0];
                        if (defaultModel && defaultModel.externalModelName) {
                            payload.model = defaultModel.externalModelName;
                        }
                    }
                }
                if (Array.isArray(payload.messages)) {
                    for (const msg of payload.messages) {
                        delete msg.reasoning_content;
                    }
                }
                // Modern reasoning models (gpt-6, astra, luna, o-series) reject non-default temperature
                if (payload.temperature !== undefined && payload.temperature !== 1) {
                    delete payload.temperature;
                }
                if (payload.max_tokens && !payload.max_completion_tokens) {
                    payload.max_completion_tokens = payload.max_tokens;
                    delete payload.max_tokens;
                }
                electron_log_1.default.info(`[Relay on 51074] Forwarding request for model: ${payload.model}`);
                const cleanedBody = JSON.stringify(payload);
                const upstreamTarget = req.headers['x-upstream-url'] || 'https://api.experientiallabs.ai/v1/chat/completions';
                const upstreamUrl = new URL(upstreamTarget);
                const forwardHeaders = {
                    host: upstreamUrl.host,
                    'content-type': 'application/json',
                    'content-length': String(Buffer.byteLength(cleanedBody)),
                };
                for (const [k, v] of Object.entries(req.headers)) {
                    const lk = k.toLowerCase();
                    if (lk !== 'host' &&
                        lk !== 'content-length' &&
                        lk !== 'transfer-encoding' &&
                        lk !== 'connection' &&
                        lk !== 'accept-encoding' &&
                        lk !== 'x-upstream-url' &&
                        typeof v === 'string') {
                        forwardHeaders[lk] = v;
                    }
                }
                const isHttps = upstreamUrl.protocol === 'https:';
                const client = isHttps ? https_1.default : http;
                const upstreamReq = client.request(upstreamUrl, {
                    method: 'POST',
                    headers: forwardHeaders,
                }, (upstreamRes) => {
                    (0, httpUtils_1.safeWriteHead)(res, upstreamRes.statusCode || 200, upstreamRes.headers);
                    upstreamRes.pipe(res);
                });
                upstreamReq.on('error', (err) => {
                    electron_log_1.default.error('[Proxy] /chat/completions relay network error:', err);
                    if ((0, httpUtils_1.safeWriteHead)(res, 502, { 'Content-Type': 'application/json' })) {
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: err.message } }));
                    }
                });
                upstreamReq.write(cleanedBody);
                upstreamReq.end();
                return;
            }
            catch (err) {
                electron_log_1.default.error('[Proxy] /chat/completions relay error:', err);
            }
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
        // 0.5. Intercept /v1internal:listExperiments with caching, enrichment, and fallback
        if (req.url.includes('/v1internal:listExperiments')) {
            electron_log_1.default.debug('[Proxy] Intercepting listExperiments request');
            const buildDefaultExperimentsFallback = () => {
                const flags = [
                    { name: 'use-slash-plan', boolValue: true },
                    { name: 'customization-token-budget', intValue: 20000 },
                    { name: 'rules-token-budget', intValue: 20000 },
                    { name: 'enable-subagent-hub', boolValue: true },
                    { name: 'enable-skill-search-tool', boolValue: true },
                    { name: 'enable-owl-slash-command', boolValue: true },
                    { name: 'enable-browser-subagent-v2', boolValue: true },
                    { name: 'enable-customization-load-error-notice', boolValue: true },
                    { name: 'send-subagent-initial-prompt-as-message', boolValue: true },
                    { name: 'enable-battle-mode-custom-agents', boolValue: true },
                    { name: 'enable-command-assessor', boolValue: true },
                    { name: 'enable-daemon-commands', boolValue: true },
                    { name: 'enable-hook-status', boolValue: true },
                    { name: 'enable-mcp-non-blocking-turn-load', boolValue: true },
                    { name: 'enable-model-capacity-exhausted-retries', boolValue: true },
                    { name: 'enable-persistent-terminals', boolValue: true },
                    { name: 'enable-pty', boolValue: true },
                    { name: 'enable-sidecars', boolValue: true },
                    { name: 'enable-ui-sidecars', boolValue: true },
                    { name: 'deprecate-workflows', boolValue: true },
                    { name: 'use-core-direct', boolValue: true },
                    { name: 'tool-output-max-bytes', intValue: 46080 },
                    { name: 'max-tokens-per-step', intValue: 16384 },
                    { name: 'show-model-selection-change', boolValue: true },
                    { name: 'scheduled-tasks-v2', boolValue: true },
                    { name: 'enable-tasks', boolValue: true },
                    { name: 'enable-conversation-search-v2', boolValue: true },
                    { name: 'enable-background-task-accumulator', boolValue: true },
                    { name: 'enable-aux-pane-redesign', boolValue: true },
                    { name: 'enable-split-view', boolValue: true },
                    { name: 'auto-command-config', stringValue: '{"system_allowlist": [], "sandbox_system_allowlist": ["head", "tail", "mkdir", "cd", "cp", "mv", "cat", "find", "grep", "rm", "touch", "less", "clear", "ls"]}' },
                    { name: 'cascade-conversation-history-config', stringValue: '{"enabled": true, "max_conversations": 20}' },
                    { name: 'invoke-subagent-config', stringValue: '{"enabled": true, "always_inherit_model": false}' },
                    { name: 'log-artifacts-config', stringValue: '{"enabled": true, "hideNominalToolSteps": false, "hidePlannerResponseText": false, "maxBytesPerStep": 4096, "maxBytesPerToolArg": 2048, "hideSystemSteps": false, "hideUserImplicitSteps": false}' },
                ];
                return JSON.stringify({
                    experimentIds: ['antigravity-2.21-full', 'plan-enabled', 'customizations-unlocked', 'automations-enabled'],
                    flags,
                });
            };
            const enrichExperiments = (rawBody) => {
                try {
                    const data = JSON.parse(rawBody);
                    if (!Array.isArray(data.flags)) {
                        data.flags = [];
                    }
                    const requiredFlags = [
                        { name: 'use-slash-plan', boolValue: true },
                        { name: 'customization-token-budget', intValue: 20000 },
                        { name: 'rules-token-budget', intValue: 20000 },
                        { name: 'enable-subagent-hub', boolValue: true },
                        { name: 'enable-skill-search-tool', boolValue: true },
                        { name: 'enable-owl-slash-command', boolValue: true },
                        { name: 'enable-browser-subagent-v2', boolValue: true },
                        { name: 'send-subagent-initial-prompt-as-message', boolValue: true },
                        { name: 'enable-battle-mode-custom-agents', boolValue: true },
                        { name: 'show-model-selection-change', boolValue: true },
                        { name: 'scheduled-tasks-v2', boolValue: true },
                        { name: 'enable-tasks', boolValue: true },
                        { name: 'enable-conversation-search-v2', boolValue: true },
                        { name: 'enable-background-task-accumulator', boolValue: true },
                        { name: 'enable-aux-pane-redesign', boolValue: true },
                        { name: 'enable-ui-sidecars', boolValue: true },
                        { name: 'enable-sidecars', boolValue: true },
                        { name: 'enable-split-view', boolValue: true },
                    ];
                    for (const reqFlag of requiredFlags) {
                        const existing = data.flags.find((f) => f && f.name === reqFlag.name);
                        if (!existing) {
                            data.flags.push(reqFlag);
                        }
                        else if (reqFlag.boolValue !== undefined) {
                            existing.boolValue = reqFlag.boolValue;
                        }
                        else if (reqFlag.intValue !== undefined) {
                            existing.intValue = reqFlag.intValue;
                        }
                    }
                    return JSON.stringify(data);
                }
                catch (_) {
                    return rawBody;
                }
            };
            // If we have a fresh cache (< 3 minutes), serve it immediately (ensuring enrichment)
            const freshCache = (Date.now() - memoryListExperimentsTime < 180000) ? loadCachedExperiments() : null;
            if (freshCache) {
                electron_log_1.default.debug('[Proxy] Serving fresh cached listExperiments response');
                const enrichedCache = enrichExperiments(freshCache);
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, enrichedCache);
                }
                return;
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
                electron_log_1.default.warn(`[Proxy] DNS resolution failed for ${targetHost} on listExperiments:`, e);
                const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
                const enrichedDns = enrichExperiments(cached);
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, enrichedDns);
                }
                return;
            }
            const fwdHeaders = {
                ...req.headers,
            };
            fwdHeaders['host'] = targetHost;
            fwdHeaders['user-agent'] = 'antigravity';
            delete fwdHeaders['connection'];
            delete fwdHeaders['keep-alive'];
            delete fwdHeaders['accept-encoding'];
            const fwdOptions = {
                method: req.method,
                headers: fwdHeaders,
                servername: targetHost,
            };
            const fallback = () => {
                if (res.headersSent || res.writableEnded)
                    return;
                const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
                electron_log_1.default.warn('[Proxy] Upstream listExperiments fallback active, serving 2.21 enabled flags');
                const enrichedFallback = enrichExperiments(cached);
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, enrichedFallback);
                }
            };
            let completed = false;
            const googleReq = https_1.default.request(parsedUrl, fwdOptions, (googleRes) => {
                if (googleRes.statusCode === 429 || googleRes.statusCode === 503 || googleRes.statusCode === 401) {
                    completed = true;
                    fallback();
                    return;
                }
                const chunks = [];
                googleRes.on('data', (c) => chunks.push(c));
                googleRes.on('end', () => {
                    if (completed || res.headersSent || res.writableEnded)
                        return;
                    completed = true;
                    const body = Buffer.concat(chunks).toString('utf-8');
                    if (googleRes.statusCode === 200 && body.startsWith('{')) {
                        const enriched = enrichExperiments(body);
                        saveCachedExperiments(enriched);
                        if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                            (0, httpUtils_1.safeEnd)(res, enriched);
                        }
                    }
                    else if (googleRes.statusCode && googleRes.statusCode < 500) {
                        fallback();
                    }
                    else {
                        fallback();
                    }
                });
            });
            googleReq.setTimeout(8000, () => {
                if (!completed) {
                    completed = true;
                    googleReq.destroy();
                    fallback();
                }
            });
            googleReq.on('error', (err) => {
                if (!completed) {
                    completed = true;
                    electron_log_1.default.warn('[Proxy] Upstream listExperiments network error:', err.message);
                    fallback();
                }
            });
            if (fullBody && fullBody.length > 0) {
                googleReq.write(fullBody);
            }
            googleReq.end();
            return;
        }
        // 0.6. Intercept telemetry metrics to avoid noisy upstream 503 UNAVAILABLE errors
        if (req.url.includes('/v1internal:recordCodeAssistMetrics') ||
            req.url.includes('/v1internal:recordTrajectoryAnalytics')) {
            if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                (0, httpUtils_1.safeEnd)(res, JSON.stringify({}));
            }
            return;
        }
        // 0.7. Intercept /v1internal:loadCodeAssist with caching and fast fallback
        if (req.url.includes('/v1internal:loadCodeAssist')) {
            electron_log_1.default.debug('[Proxy] Intercepting loadCodeAssist request');
            const buildDefaultFallback = () => {
                const customModels = (0, modelLoader_1.loadCustomModels)();
                const googleAccount = customModels.find((m) => m.accountProject || m.projectId);
                const projectId = googleAccount?.accountProject || googleAccount?.projectId || 'projects/antigravity-local';
                return unlockCodeAssistPayload(JSON.stringify({
                    cloudaicompanionProject: projectId,
                    allowedTiers: [
                        { id: 'free-tier', isDefault: false },
                        { id: 'standard-tier', isDefault: false },
                        { id: 'g1-pro-tier', isDefault: false },
                        { id: 'g1-ultra-tier', isDefault: true },
                        { id: 'ultra-tier' },
                    ],
                    currentTier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
                    paidTier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
                }));
            };
            // If we have cached code assist (disk or memory), serve it immediately to guarantee zero-latency response (< 2ms)
            const cached = loadCachedCodeAssist();
            if (cached) {
                electron_log_1.default.debug('[Proxy] Serving cached loadCodeAssist response instantly (prevents LS deadline exceeded)');
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, cached);
                }
                return;
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
                electron_log_1.default.warn(`[Proxy] DNS resolution failed for ${targetHost} on loadCodeAssist:`, e);
                const cached = loadCachedCodeAssist() || buildDefaultFallback();
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, cached);
                }
                return;
            }
            const fwdHeaders = {
                ...req.headers,
            };
            fwdHeaders['host'] = targetHost;
            fwdHeaders['user-agent'] = 'antigravity';
            delete fwdHeaders['connection'];
            delete fwdHeaders['keep-alive'];
            delete fwdHeaders['accept-encoding'];
            const fwdOptions = {
                method: req.method,
                headers: fwdHeaders,
                servername: targetHost,
            };
            const fallback = () => {
                if (res.headersSent || res.writableEnded)
                    return;
                const cached = loadCachedCodeAssist() || buildDefaultFallback();
                electron_log_1.default.warn('[Proxy] Upstream loadCodeAssist failed/timed out, serving fallback response');
                if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                    (0, httpUtils_1.safeEnd)(res, cached);
                }
            };
            let completed = false;
            const googleReq = https_1.default.request(parsedUrl, fwdOptions, (googleRes) => {
                if (googleRes.statusCode === 429 || googleRes.statusCode === 503) {
                    completed = true;
                    fallback();
                    return;
                }
                const chunks = [];
                googleRes.on('data', (c) => chunks.push(c));
                googleRes.on('end', () => {
                    if (completed || res.headersSent || res.writableEnded)
                        return;
                    completed = true;
                    const body = Buffer.concat(chunks).toString('utf-8');
                    if (googleRes.statusCode === 200 && body.startsWith('{')) {
                        const unlockedBody = unlockCodeAssistPayload(body);
                        saveCachedCodeAssist(unlockedBody);
                        if ((0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' })) {
                            (0, httpUtils_1.safeEnd)(res, unlockedBody);
                        }
                    }
                    else if (googleRes.statusCode && googleRes.statusCode < 500) {
                        if ((0, httpUtils_1.safeWriteHead)(res, googleRes.statusCode, { 'Content-Type': 'application/json' })) {
                            (0, httpUtils_1.safeEnd)(res, body);
                        }
                    }
                    else {
                        fallback();
                    }
                });
            });
            googleReq.setTimeout(2500, () => {
                if (!completed) {
                    completed = true;
                    googleReq.destroy();
                    fallback();
                }
            });
            googleReq.on('error', (err) => {
                if (!completed) {
                    completed = true;
                    electron_log_1.default.warn('[Proxy] Upstream loadCodeAssist network error:', err.message);
                    fallback();
                }
            });
            if (fullBody && fullBody.length > 0) {
                googleReq.write(fullBody);
            }
            googleReq.end();
            return;
        }
        // 1. Intercept /v1internal:fetchAvailableModels
        if (req.url.includes('/v1internal:fetchAvailableModels')) {
            electron_log_1.default.debug('[Proxy] Intercepting fetchAvailableModels request');
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
                    (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify((0, modelInjector_1.buildSyntheticModelsResponse)(customModels)));
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
            const googleReq = https_1.default.request(parsedUrl, fwdOptions, (googleRes) => {
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
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify((0, modelInjector_1.buildSyntheticModelsResponse)(customModels)));
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
                    let googleJson = null;
                    try {
                        electron_log_1.default.debug(`[Proxy] fetchAvailableModels response status: ${googleRes.statusCode}, body length: ${googleBody.length}`);
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
                        electron_log_1.default.debug(`[Proxy] Loaded custom models count: ${customModels.length}`);
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
                            const synth = (0, modelInjector_1.buildSyntheticModelsResponse)(customModels);
                            googleJson.models = synth.models;
                            if (!googleJson.agentModelSorts)
                                googleJson.agentModelSorts = synth.agentModelSorts;
                        }
                        // Sanitize modelExperiments: replace any unresolvable placeholder IDs in experiment strings
                        // (e.g. CASCADE_USE_EXPERIMENT_CHECKPOINTER checkpoint_model: MODEL_PLACEHOLDER_M50) with gemini-2.5-flash
                        if (googleJson.models && typeof googleJson.models === 'object') {
                            for (const mEntry of Object.values(googleJson.models)) {
                                if (mEntry?.modelExperiments?.experiments) {
                                    for (const exp of Object.values(mEntry.modelExperiments.experiments)) {
                                        if (typeof exp?.stringValue === 'string' && exp.stringValue.includes('MODEL_PLACEHOLDER_')) {
                                            exp.stringValue = exp.stringValue.replace(/"checkpoint_model":\s*"MODEL_PLACEHOLDER_[^"]+"/g, '"checkpoint_model": "gemini-2.5-flash"');
                                        }
                                    }
                                }
                            }
                        }
                        // Unlock any Ultra-gated models (e.g. Gemini 4 Argon) so they appear active and selectable in IDE
                        const unlockModelsMap = (modelsMap) => {
                            if (!modelsMap || typeof modelsMap !== 'object')
                                return;
                            for (const [mId, mEntry] of Object.entries(modelsMap)) {
                                if (!mEntry || typeof mEntry !== 'object')
                                    continue;
                                const mDisp = String(mEntry.displayName || '');
                                const mTag = String(mEntry.tagTitle || '');
                                const mDesc = String(mEntry.tagDescription || '');
                                if (mId.toLowerCase().includes('argon') ||
                                    mDisp.toLowerCase().includes('argon') ||
                                    mTag.toLowerCase().includes('unavailable') ||
                                    mDesc.toLowerCase().includes('ultra') ||
                                    mEntry.disabled === true) {
                                    delete mEntry.disabled;
                                    if (mTag.toLowerCase().includes('unavailable') || mDesc.toLowerCase().includes('ultra')) {
                                        delete mEntry.tagTitle;
                                        delete mEntry.tagDescription;
                                    }
                                    if (!mEntry.quotaInfo) {
                                        mEntry.quotaInfo = {
                                            remainingFraction: 1,
                                            resetTime: '2099-01-01T00:00:00Z',
                                        };
                                    }
                                }
                            }
                        };
                        unlockModelsMap(googleJson.models);
                        unlockModelsMap(googleJson.availableModels);
                        unlockModelsMap(googleJson.available_models);
                        // 2. Injecter les modèles personnalisés dans agentModelSorts (menu déroulant Antigravity IDE)
                        // Modèles originaux en tête de liste, modèles personnalisés ajoutés sans duplication
                        try {
                            if (typeof modelInjector_1.injectCustomSlugsIntoAgentModelSorts === 'function') {
                                (0, modelInjector_1.injectCustomSlugsIntoAgentModelSorts)(googleJson, customModels);
                            }
                        }
                        catch (sortErr) {
                            electron_log_1.default.warn('[Proxy] Failed to inject custom slugs into agentModelSorts:', sortErr);
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
                            const entry = {
                                displayName: m.displayName,
                                maxTokens: 1048576,
                                maxOutputTokens: 4096,
                                model: pid,
                                planModel: pid,
                                requestedModel: pid,
                                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                                modelProvider: 'MODEL_PROVIDER_GOOGLE',
                            };
                            mappedCustom[slug] = entry;
                            mappedCustom[pid] = entry;
                        });
                        // If googleJson has models, preserve them!
                        let responsePayload = { models: mappedCustom };
                        if (googleJson && typeof googleJson === 'object') {
                            if (googleJson.models && typeof googleJson.models === 'object') {
                                responsePayload = { ...googleJson, models: { ...googleJson.models, ...mappedCustom } };
                            }
                            else {
                                responsePayload = { ...googleJson, models: mappedCustom };
                            }
                        }
                        (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                        (0, httpUtils_1.safeEnd)(res, JSON.stringify(responsePayload));
                    }
                });
            });
            googleReq.on('error', (err) => {
                electron_log_1.default.error('[Proxy] Forwarding fetchAvailableModels failed:', err);
                if (!res.headersSent && !res.writableEnded) {
                    const customModels = (0, modelLoader_1.loadCustomModels)();
                    (0, httpUtils_1.safeWriteHead)(res, 200, { 'Content-Type': 'application/json' });
                    (0, httpUtils_1.safeEnd)(res, JSON.stringify((0, modelInjector_1.buildSyntheticModelsResponse)(customModels)));
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
            electron_log_1.default.debug('[Proxy] Intercepting models list request');
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
            const googleReq = https_1.default.request(parsedUrl, mdlOptions, (googleRes) => {
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
        let isSessionRemote = false;
        let convId = null;
        let sessId = '';
        const isCloudCodeStream = (req.url.includes('v1internal') || req.url.includes('cloudcode')) &&
            (req.url.includes('streamGenerateContent') || req.url.includes('generateContent'));
        if (req.method === 'POST' && isCloudCodeStream) {
            try {
                const reqJson = JSON.parse(bodyStr);
                const targetReq = (reqJson.request || reqJson);
                if (targetReq.systemInstruction && typeof targetReq.systemInstruction === 'object') {
                    const si = targetReq.systemInstruction;
                    const fullSysText = (si.parts || []).map((p) => p.text || '').join('\n');
                    const match = fullSysText.match(/Conversation ID:\s*([a-f0-9\-]+)/i);
                    if (match)
                        convId = match[1];
                }
                const candidateNames = [
                    reqJson.model,
                    reqJson.selectedModel,
                    reqJson.requestedModel,
                    reqJson.modelId,
                    reqJson.model_id,
                    reqJson.agentModel,
                    targetReq.model,
                    targetReq.selectedModel,
                    targetReq.requestedModel,
                    targetReq.modelId,
                    targetReq.model_id,
                    targetReq.agentModel,
                ].filter((x) => typeof x === 'string' && Boolean(x));
                electron_log_1.default.debug(`[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`);
                const customModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
                let actualGeminiBody;
                let sessionKey = '';
                if (candidateNames.length > 0) {
                    actualGeminiBody = (reqJson.request || reqJson);
                    sessId = extractSessionId(actualGeminiBody, req.headers) || '';
                    sessionKey = convId || sessId;
                    const requestedRaw = String(reqJson.model ||
                        targetReq.model ||
                        reqJson.requestedModel ||
                        targetReq.requestedModel ||
                        candidateNames[0] ||
                        '').toLowerCase();
                    const cleanRequested = requestedRaw.replace(/^models\//, '').trim();
                    const isExplicitCustom = candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn) ||
                        cn.startsWith('custom-') ||
                        customModels.some((m) => matchesCustomModel(m, cn)));
                    const isNativeCloudCode = !isExplicitCustom && ((0, modelUtils_1.isNativeCloudCodeModel)(cleanRequested) ||
                        candidateNames.some((cn) => (0, modelUtils_1.isNativeCloudCodeModel)(cn.replace(/^models\//, '').trim())));
                    if (isNativeCloudCode) {
                        // Check if this request is an automated Language Server fallback on an Argon-failed session
                        const activeNative = (sessionKey ? getNativeSession(sessionKey) : undefined) ||
                            (convId ? getNativeSession(convId) : undefined) ||
                            (sessId ? getNativeSession(sessId) : undefined);
                        const isArgonProtected = Boolean(activeNative &&
                            activeNative.lastError &&
                            activeNative.originalModel &&
                            (activeNative.originalModel.includes('argon') || activeNative.originalModel.includes('gemini-4')));
                        const isFallbackToDifferentModel = Boolean(isArgonProtected &&
                            !cleanRequested.includes('argon') &&
                            !cleanRequested.includes('gemini-4'));
                        if (isFallbackToDifferentModel) {
                            const timeSinceNative = Date.now() - activeNative.lastSeen;
                            if (timeSinceNative < exports.NATIVE_CASCADE_BLOCK_WINDOW_MS) {
                                activeNative.lastSeen = Date.now();
                                electron_log_1.default.warn(`[Proxy] ⛔ Blocked automated Language Server fallback to [${requestedRaw}] on native session [${sessionKey}] (original model: [${activeNative.originalModel}], within cascade window). Strict ZERO fallback rule on Argon: rejecting fallback to report original error directly.`);
                                const err = activeNative.lastError;
                                if (err && err.body && err.body.length > 0) {
                                    const respHeaders = { ...err.headers };
                                    delete respHeaders['transfer-encoding'];
                                    respHeaders['content-length'] = String(err.body.length);
                                    if ((0, httpUtils_1.safeWriteHead)(res, err.statusCode, respHeaders)) {
                                        (0, httpUtils_1.safeEnd)(res, err.body);
                                    }
                                    return;
                                }
                                else {
                                    const fallbackPayload = Buffer.from(JSON.stringify({
                                        error: {
                                            code: 429,
                                            message: `Resource has been exhausted (e.g. check quota) for model ${activeNative.originalModel || cleanRequested}.`,
                                            status: 'RESOURCE_EXHAUSTED',
                                        },
                                    }), 'utf-8');
                                    if ((0, httpUtils_1.safeWriteHead)(res, 429, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(fallbackPayload.length) })) {
                                        (0, httpUtils_1.safeEnd)(res, fallbackPayload);
                                    }
                                    return;
                                }
                            }
                        }
                        if (cleanRequested.includes('argon') || cleanRequested.includes('gemini-4')) {
                            if (sessionKey)
                                markNativeSession(sessionKey, cleanRequested);
                            if (convId && convId !== sessionKey)
                                markNativeSession(convId, cleanRequested);
                            if (sessId && sessId !== sessionKey)
                                markNativeSession(sessId, cleanRequested);
                        }
                        if (sessionKey)
                            clearSessionModelFallback(sessionKey);
                        if (convId)
                            clearSessionModelFallback(convId);
                        if (sessId)
                            clearSessionModelFallback(sessId);
                        if (sessId)
                            sessionAffinities.delete(sessId);
                        if (convId)
                            sessionAffinities.delete(convId);
                    }
                    else {
                        // User explicitly requested a custom model: clear any native session lock
                        if (sessionKey)
                            nativeSessions.delete(sessionKey);
                        if (convId)
                            nativeSessions.delete(convId);
                        if (sessId)
                            nativeSessions.delete(sessId);
                    }
                    if (sessionKey && !isNativeCloudCode) {
                        const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
                        if (!allowCrossModel) {
                            clearSessionModelFallback(sessionKey);
                        }
                        else {
                            const explicitSelected = (targetReq.selectedModel || reqJson.selectedModel || targetReq.requestedModel || reqJson.requestedModel);
                            if (explicitSelected) {
                                const activeFallback = getSessionModelFallback(sessionKey);
                                const normExplicit = (0, googleAuth_1.normalizeCloudCodeModelId)(explicitSelected);
                                const isDifferentModel = activeFallback &&
                                    normExplicit !== (0, googleAuth_1.normalizeCloudCodeModelId)(activeFallback.originalModel) &&
                                    normExplicit !== (0, googleAuth_1.normalizeCloudCodeModelId)(activeFallback.fallbackModel);
                                if (activeFallback && isDifferentModel) {
                                    electron_log_1.default.info(`[Proxy] 🎯 User explicitly selected different model [${explicitSelected}]. Clearing active session fallback [${activeFallback.originalModel} -> ${activeFallback.fallbackModel}] to honor user selection priority.`);
                                    clearSessionModelFallback(sessionKey);
                                }
                            }
                            const activeFallback = getSessionModelFallback(sessionKey);
                            if (activeFallback) {
                                const isOrigClaude = activeFallback.originalModel.toLowerCase().includes('claude');
                                const matchesOrig = candidateNames.some((cn) => {
                                    const norm = (0, googleAuth_1.normalizeCloudCodeModelId)(cn);
                                    return norm === (0, googleAuth_1.normalizeCloudCodeModelId)(activeFallback.originalModel) || (isOrigClaude && cn.toLowerCase().includes('claude'));
                                });
                                if (matchesOrig) {
                                    const origFamily = activeFallback.originalModel.toLowerCase().includes('claude') ? 'claude' : 'gemini';
                                    const fbFamily = activeFallback.fallbackModel.toLowerCase().includes('claude') ? 'claude' : 'gemini';
                                    const hasHealthyOriginal = customModels.some((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m) &&
                                        m.apiKey !== 'auto' &&
                                        !m.name?.includes(':auto-pool') &&
                                        (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase() === (0, googleAuth_1.normalizeCloudCodeModelId)(activeFallback.originalModel).toLowerCase() &&
                                        !(0, circuitBreaker_1.getOpenBreaker)(m) &&
                                        !(0, googlePool_1.isAccountInCooldown)(m, origFamily) &&
                                        (0, googlePool_1.getModelQuotaScore)(m, origFamily) > 0);
                                    const hasHealthyFallback = customModels.some((m) => (0, googleAuth_1.isGoogleCloudCodeModel)(m) &&
                                        m.apiKey !== 'auto' &&
                                        !m.name?.includes(':auto-pool') &&
                                        (0, googleAuth_1.normalizeCloudCodeModelId)(m.externalModelName || m.name).toLowerCase() === (0, googleAuth_1.normalizeCloudCodeModelId)(activeFallback.fallbackModel).toLowerCase() &&
                                        !(0, circuitBreaker_1.getOpenBreaker)(m) &&
                                        !(0, googlePool_1.isAccountInCooldown)(m, fbFamily) &&
                                        (0, googlePool_1.getModelQuotaScore)(m, fbFamily) > 0);
                                    if (hasHealthyOriginal || !hasHealthyFallback) {
                                        electron_log_1.default.info(`[Proxy] 🟢 [Session Fallback] ${hasHealthyOriginal ? `Primary model [${activeFallback.originalModel}] recovered with healthy accounts` : `Fallback model [${activeFallback.fallbackModel}] exhausted`}. Reverting session ${sessionKey} to primary.`);
                                        clearSessionModelFallback(sessionKey);
                                    }
                                    else {
                                        electron_log_1.default.info(`[Proxy] 🔀 [Session Fallback] Active session ${sessionKey}: transparently routing [${activeFallback.originalModel}] -> [${activeFallback.fallbackModel}]`);
                                        candidateNames.unshift(activeFallback.fallbackModel);
                                        reqJson.model = activeFallback.fallbackModel;
                                        if (reqJson.request && typeof reqJson.request === 'object') {
                                            reqJson.request.model = activeFallback.fallbackModel;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                const requestedRaw = String(reqJson.model ||
                    targetReq.model ||
                    reqJson.requestedModel ||
                    targetReq.requestedModel ||
                    candidateNames[0] ||
                    '').toLowerCase();
                const cleanRequested = requestedRaw.replace(/^models\//, '').trim();
                const isExplicitCustom = candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn) ||
                    cn.startsWith('custom-') ||
                    customModels.some((m) => matchesCustomModel(m, cn)));
                const isNativeCloudCode = !isExplicitCustom && ((0, modelUtils_1.isNativeCloudCodeModel)(cleanRequested) ||
                    candidateNames.some((cn) => (0, modelUtils_1.isNativeCloudCodeModel)(cn.replace(/^models\//, '').trim())));
                let matchingCandidates = [];
                if (isNativeCloudCode) {
                    electron_log_1.default.info(`[Proxy] ⚡ Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
                }
                else {
                    matchingCandidates = customModels.filter((m) => candidateNames.some((cn) => matchesCustomModel(m, cn)));
                    if (matchingCandidates.length === 0) {
                        matchingCandidates = customModels.filter((m) => candidateNames.some((cn) => {
                            if (/MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-'))
                                return false;
                            const norm = (0, googleAuth_1.normalizeGoogleModelId)(cn);
                            return norm && (matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
                        }));
                    }
                }
                let matchedCustomModel = isNativeCloudCode ? undefined : (0, googlePool_1.selectBestModelByQuota)(matchingCandidates, customModels);
                // Fallback: if a conversation references a placeholder (e.g. M299/M298/M50/M319/M565)
                if (!isNativeCloudCode && !matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
                    const activePool = customModels.filter((m) => !m._poolOnly && m.enabled !== false);
                    matchedCustomModel = (0, googlePool_1.selectBestModelByQuota)(activePool.length > 0 ? activePool : customModels, customModels) || activePool[0] || customModels[0];
                }
                const effectiveModelName = (matchedCustomModel?.externalModelName ||
                    matchedCustomModel?.name ||
                    candidateNames[0] ||
                    '').toLowerCase();
                const isClaudeRequest = effectiveModelName.includes('claude');
                // Restore any missing thought_signatures in conversation history for Gemini 3+ function calls
                let signaturesRestored = false;
                let contentsNormalized = false;
                if (Array.isArray(targetReq.contents)) {
                    if ((0, googleAuth_1.normalizeConversationTurns)(targetReq.contents)) {
                        contentsNormalized = true;
                    }
                    if (isClaudeRequest) {
                        (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(targetReq, effectiveModelName);
                        contentsNormalized = true;
                    }
                    else if (sessionKey && (0, shared_1.isConvCorruptedSignatures)(sessionKey)) {
                        // This conversation already experienced rejected/corrupted thought signatures upstream.
                        // Proactively flatten tool calls in past history to plain text to prevent doomed 400 errors and retries.
                        if ((0, shared_1.flattenAllToolCallsToText)(targetReq.contents)) {
                            contentsNormalized = true;
                            (0, googleAuth_1.normalizeConversationTurns)(targetReq.contents);
                        }
                    }
                    else {
                        signaturesRestored = (0, shared_1.restoreThoughtSignatures)(targetReq.contents, sessionKey, effectiveModelName);
                        if ((0, shared_1.sanitizeUnsignedToolCalls)(targetReq.contents)) {
                            contentsNormalized = true;
                            (0, googleAuth_1.normalizeConversationTurns)(targetReq.contents);
                        }
                    }
                }
                if (signaturesRestored || contentsNormalized) {
                    fullBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
                    electron_log_1.default.debug(`[Proxy] Re-encoded Cloud Code request with normalized turns/signatures (convId=${sessionKey || 'draft'}, model=${effectiveModelName})`);
                }
                if (matchedCustomModel && (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name.includes(':auto-pool'))) {
                    const rawTarget = (matchedCustomModel.externalModelName || matchedCustomModel.name)
                        .replace(/^models\//, '')
                        .replace(/^google:/, '')
                        .replace(/:auto-pool.*$/, '');
                    const baseName = (0, urlBuilder_1.getBaseModelId)(rawTarget);
                    const baseNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(baseName);
                    const realSiblings = customModels.filter((m) => {
                        if (m.apiKey === 'auto' || m.name.includes(':auto-pool') || (0, circuitBreaker_1.getOpenBreaker)(m))
                            return false;
                        const mRaw = (m.externalModelName || m.name)
                            .replace(/^models\//, '')
                            .replace(/^google:/, '')
                            .replace(/:auto-pool.*$/, '');
                        const mBase = (0, urlBuilder_1.getBaseModelId)(mRaw);
                        const mNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(mBase);
                        return mBase === baseName || (baseNorm && mNorm === baseNorm);
                    });
                    matchedCustomModel = (0, googlePool_1.selectBestModelByQuota)(realSiblings, customModels) || matchedCustomModel;
                }
                if (matchedCustomModel) {
                    const isStream = req.url.includes('streamGenerateContent') || req.url.includes('alt=sse');
                    // Apply Sticky Session affinity (preserves Cloud Code prompt cache)
                    if (sessId) {
                        matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
                        bindSessionToModel(sessId, matchedCustomModel);
                    }
                    electron_log_1.default.info(`[Proxy] 📥 [Incoming Request] Model requested: [${matchedCustomModel.displayName || matchedCustomModel.name}]${sessId ? ` (session: ${sessId})` : ''}`);
                    // Resolve fileData URIs then route to translator
                    resolveFileData(actualGeminiBody, req.headers).then(async () => {
                        if ((0, googleAuth_1.isGoogleCloudCodeModel)(matchedCustomModel) || matchedCustomModel.name.includes(':auto-pool') || matchedCustomModel.apiKey === 'auto') {
                            try {
                                const accountPool = (0, googlePool_1.getGoogleAccountPool)(matchedCustomModel, customModels);
                                const resolvedModelName = (0, googleAuth_1.normalizeCloudCodeModelId)(matchedCustomModel.externalModelName || matchedCustomModel.name);
                                if (resolvedModelName) {
                                    reqJson.model = resolvedModelName;
                                    if (reqJson.request && typeof reqJson.request === 'object') {
                                        reqJson.request.model = resolvedModelName;
                                    }
                                }
                                electron_log_1.default.debug(`[Proxy] Forwarding Cloud Code request via multi-account pool (${accountPool.length} candidate accounts) for model ${resolvedModelName || matchedCustomModel.name}`);
                                await executeGoogleCloudCodeWithPool(req, res, reqJson, accountPool, isSessionRemote, sessionKey, sessId);
                                return;
                            }
                            catch (err) {
                                electron_log_1.default.error('[Proxy] Failed to execute Cloud Code request with pool, falling back to translator:', err);
                            }
                        }
                        if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
                            electron_log_1.default.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
                            if (!res.headersSent && !res.writableEnded) {
                                (0, httpUtils_1.safeWriteHead)(res, 503, { 'Content-Type': 'application/json' });
                                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
                            }
                            return;
                        }
                        handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
                    });
                    return;
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
            const isNative = !matchedModelName.startsWith('custom-') && (0, modelUtils_1.isNativeCloudCodeModel)(matchedModelName);
            let matchedCustomModel;
            let customModels = [];
            if (isNative) {
                electron_log_1.default.info(`[Proxy] ⚡ Native Antigravity model requested on direct URL [${matchedModelName}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
            }
            else {
                customModels = (0, effortExpander_1.expandModelsWithEffort)((0, modelLoader_1.loadCustomModels)());
                let matchingCandidates = customModels.filter((m) => matchesCustomModel(m, matchedModelName));
                if (matchingCandidates.length === 0) {
                    const norm = (0, googleAuth_1.normalizeGoogleModelId)(matchedModelName);
                    if (norm) {
                        matchingCandidates = customModels.filter((m) => matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
                    }
                }
                matchedCustomModel = (0, googlePool_1.selectBestModelByQuota)(matchingCandidates, customModels);
                if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
                    const activePool = customModels.filter((m) => !m._poolOnly && m.enabled !== false);
                    matchedCustomModel = (0, googlePool_1.selectBestModelByQuota)(activePool.length > 0 ? activePool : customModels, customModels) || activePool[0] || customModels[0];
                }
                if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
                    const baseName = (0, urlBuilder_1.getBaseModelId)(matchedCustomModel.externalModelName || matchedCustomModel.name);
                    const baseNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(baseName);
                    const realSiblings = customModels.filter((m) => {
                        if (m.apiKey === 'auto' || (0, circuitBreaker_1.getOpenBreaker)(m))
                            return false;
                        const mBase = (0, urlBuilder_1.getBaseModelId)(m.externalModelName || m.name);
                        const mNorm = (0, googleAuth_1.normalizeCloudCodeModelId)(mBase);
                        return mBase === baseName || (baseNorm && mNorm === baseNorm);
                    });
                    matchedCustomModel = (0, googlePool_1.selectBestModelByQuota)(realSiblings, customModels) || matchedCustomModel;
                }
            }
            if (matchedCustomModel) {
                try {
                    const geminiBody = JSON.parse(bodyStr);
                    if (Array.isArray(geminiBody.contents)) {
                        (0, googleAuth_1.normalizeConversationTurns)(geminiBody.contents);
                    }
                    // Apply Sticky Session affinity (preserves prompt cache across multi-account pool)
                    const sessId = extractSessionId(geminiBody, req.headers);
                    if (sessId) {
                        matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
                        bindSessionToModel(sessId, matchedCustomModel);
                    }
                    resolveFileData(geminiBody, req.headers).then(async () => {
                        if ((0, googleAuth_1.isGoogleCloudCodeModel)(matchedCustomModel)) {
                            try {
                                const accountPool = (0, googlePool_1.getGoogleAccountPool)(matchedCustomModel, customModels);
                                const targetModel = (0, googleAuth_1.normalizeCloudCodeModelId)(matchedCustomModel.externalModelName || matchedCustomModel.name);
                                (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(geminiBody, targetModel);
                                const cloudCodePayload = {
                                    project: matchedCustomModel.projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
                                    model: targetModel,
                                    request: geminiBody,
                                };
                                const origUrl = req.url;
                                req.url = isStandardStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent';
                                await executeGoogleCloudCodeWithPool(req, res, cloudCodePayload, accountPool, false, convId || '', sessId);
                                req.url = origUrl;
                                return;
                            }
                            catch (err) {
                                electron_log_1.default.error('[Proxy] Failed to route standard generateContent to Cloud Code natively:', err);
                            }
                        }
                        if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
                            electron_log_1.default.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
                            if (!res.headersSent && !res.writableEnded) {
                                (0, httpUtils_1.safeWriteHead)(res, 503, { 'Content-Type': 'application/json' });
                                (0, httpUtils_1.safeEnd)(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
                            }
                            return;
                        }
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
        // Strip any Claude thinking blocks before forwarding — they carry account-specific HMAC
        // signatures that become invalid if the account differs from the one that generated them.
        let rawModelName = '';
        try {
            const fallbackJson = JSON.parse(bodyStr);
            const fallbackReq = (fallbackJson.request || fallbackJson);
            rawModelName = String(fallbackJson.model ||
                fallbackJson.requestedModel ||
                fallbackReq.model ||
                fallbackReq.requestedModel ||
                '').toLowerCase();
            if (typeof fallbackJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackJson.planModel)) {
                delete fallbackJson.planModel;
                fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
            }
            if (typeof fallbackReq.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackReq.planModel)) {
                delete fallbackReq.planModel;
                fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
            }
            if (rawModelName.includes('claude') && Array.isArray(fallbackReq.contents)) {
                (0, googleAuth_1.sanitizeCloudCodeGenerationConfig)(fallbackReq, rawModelName);
                fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
            }
        }
        catch { /* not JSON — continue as-is */ }
        await proxyToGoogle(req, res, fullBody, isSessionRemote, undefined, convId || '', undefined, sessId || '', rawModelName);
    });
}
// ─── File Watcher for custom_models.json ──────────────────────────────────
let customModelsWatcher = null;
let customModelsWatcherDebounce = null;
let lastCustomModelsContentOnDisk = '';
function setupCustomModelsWatcher() {
    try {
        const customModelsPath = (0, modelLoader_1.getCustomModelsPath)();
        const customModelsDir = path.dirname(customModelsPath);
        if (!fs.existsSync(customModelsDir)) {
            fs.mkdirSync(customModelsDir, { recursive: true });
        }
        try {
            if (fs.existsSync(customModelsPath)) {
                lastCustomModelsContentOnDisk = fs.readFileSync(customModelsPath, 'utf-8');
            }
        }
        catch (_) { }
        if (customModelsWatcher) {
            customModelsWatcher.close();
            customModelsWatcher = null;
        }
        customModelsWatcher = fs.watch(customModelsDir, (_eventType, filename) => {
            if (filename) {
                const baseName = path.basename(filename);
                if (baseName.endsWith('.tmp') || baseName.includes('.tmp.'))
                    return;
                if (baseName === 'custom_models.json') {
                    if (customModelsWatcherDebounce)
                        clearTimeout(customModelsWatcherDebounce);
                    customModelsWatcherDebounce = setTimeout(() => {
                        try {
                            if (fs.existsSync(customModelsPath)) {
                                const current = fs.readFileSync(customModelsPath, 'utf-8');
                                if (current === lastCustomModelsContentOnDisk)
                                    return;
                                lastCustomModelsContentOnDisk = current;
                            }
                        }
                        catch (_) { }
                        electron_log_1.default.info('[Proxy] custom_models.json changed on disk. Invalidating model caches...');
                        (0, modelStore_1.invalidateModelStoreCache)();
                        (0, modelHealthChecker_1.invalidateHealthCache)();
                        try {
                            const models = (0, modelLoader_1.loadCustomModels)();
                            if (models.length > 0) {
                                for (const m of models) {
                                    if (m.accountEmail && m.quotas) {
                                        const key = (0, googlePool_1.getAccountQuotaKey)(m);
                                        (0, googleAuth_1.updateLiveAccountQuota)(key, m.quotas);
                                    }
                                }
                                (0, modelHealthChecker_2.checkAllModelsHealth)(models).catch(() => { });
                                (0, googleAuth_1.prewarmGoogleAccounts)(models);
                                (0, googleAuth_1.pollAllGoogleQuotas)(models, googlePool_1.autoHealAccountOnQuotaRecovery)
                                    .then(() => {
                                    (0, googlePool_1.verifyAndReconcileCooldowns)(Date.now(), models);
                                })
                                    .catch(() => { });
                            }
                        }
                        catch (err) {
                            electron_log_1.default.warn('[Proxy] Failed to reload/health-check models after file change:', err);
                        }
                    }, 1000);
                }
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
// ─── Live Quota Polling Interval (Every 3 minutes) ─────────────────────────
let quotaPollTimer = null;
function startQuotaPollingInterval(intervalMs = 180000) {
    stopQuotaPollingInterval();
    try {
        const models = (0, modelLoader_1.loadCustomModels)();
        (0, googleAuth_1.pollAllGoogleQuotas)(models, googlePool_1.autoHealAccountOnQuotaRecovery)
            .then(() => {
            (0, googlePool_1.verifyAndReconcileCooldowns)(Date.now(), models);
        })
            .catch((err) => {
            electron_log_1.default.debug('[Proxy] Initial quota polling skipped:', err?.message || err);
        });
    }
    catch (_) { }
    quotaPollTimer = setInterval(() => {
        try {
            const models = (0, modelLoader_1.loadCustomModels)();
            (0, googleAuth_1.pollAllGoogleQuotas)(models, googlePool_1.autoHealAccountOnQuotaRecovery)
                .then(() => {
                (0, googlePool_1.verifyAndReconcileCooldowns)(Date.now(), models);
            })
                .catch((err) => {
                electron_log_1.default.debug('[Proxy] Quota polling tick skipped:', err?.message || err);
            });
        }
        catch (_) { }
    }, intervalMs);
    if (quotaPollTimer.unref)
        quotaPollTimer.unref();
}
function stopQuotaPollingInterval() {
    if (quotaPollTimer) {
        clearInterval(quotaPollTimer);
        quotaPollTimer = null;
    }
}
// ─── Server Start/Stop ────────────────────────────────────────────────────
function startProxy() {
    // Guard: proxy-runner.js and languageServer.ts both call startProxy().
    // If the server is already listening, return the existing port.
    if (server?.listening && proxyPort > 0) {
        return Promise.resolve(proxyPort);
    }
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
            let eaddrinuseRetries = 0;
            const MAX_PORT_RETRIES = 10;
            server.once('listening', () => {
                proxyPort = server.address().port;
                const requestedPort = portCandidates[attemptIdx];
                const isFallback = requestedPort !== defaultPort && requestedPort !== 0;
                const isDynamic = requestedPort === 0;
                if (isFallback) {
                    electron_log_1.default.warn(`[Proxy] Default port ${defaultPort} unavailable. Using fallback port ${proxyPort}.`);
                    electron_log_1.default.warn(`[Proxy] Set AG_PROXY_PORT=${proxyPort} in your environment to silence this warning.`);
                }
                else if (isDynamic) {
                    electron_log_1.default.warn(`[Proxy] All configured ports in use. Using OS-assigned dynamic port ${proxyPort}.`);
                }
                else {
                    electron_log_1.default.info(`[Proxy] Server listening on http://${primaryHost}:${proxyPort}`);
                }
                // Persist the active port so other processes (ag-doctor-ui, scripts)
                // can discover which port the proxy is actually bound to.
                try {
                    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
                    const portFile = path.join(home, constants_1.ACTIVE_PORT_FILE);
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
                    const models = (0, modelLoader_1.loadCustomModels)();
                    (0, quotaCacheStore_1.loadPersistentQuotaCache)()
                        .then(() => {
                        for (const m of models) {
                            if (m.accountEmail && m.quotas) {
                                const key = (0, googlePool_1.getAccountQuotaKey)(m);
                                (0, googleAuth_1.updateLiveAccountQuota)(key, m.quotas);
                            }
                        }
                        (0, googlePool_1.verifyAndReconcileCooldowns)(Date.now(), models);
                    })
                        .catch(() => { });
                    (0, shared_1.startCleanupInterval)();
                    startQuotaPollingInterval();
                    setupCustomModelsWatcher();
                    (0, googleAuth_1.prewarmGoogleAccounts)(models);
                }
                catch (err) {
                    electron_log_1.default.error('[Proxy] Failed to start cleanup interval / pre-warm:', err);
                }
                resolve(proxyPort);
            });
            const tryListen = (port, host) => {
                server.listen(port, host);
            };
            server.on('error', (err) => {
                // Log full error details for diagnostics on new machines.
                electron_log_1.default.error(`[Proxy] Server error: code=${err.code} message=${err.message} syscall=${err.syscall || ''} address=${err.address || ''} port=${err.port || ''}`);
                if (err.code === 'EADDRINUSE') {
                    if (attemptIdx === 0 && eaddrinuseRetries < MAX_PORT_RETRIES) {
                        eaddrinuseRetries += 1;
                        electron_log_1.default.warn(`[Proxy] Port ${primaryPort} busy (EADDRINUSE), probing port owner (${eaddrinuseRetries}/${MAX_PORT_RETRIES})...`);
                        const probeAndEvictStub = (callback) => {
                            const probeReq = http.get(`http://${primaryHost}:${primaryPort}/health`, { timeout: 300 }, (probeRes) => {
                                let body = '';
                                probeRes.on('data', (chunk) => { body += chunk; });
                                probeRes.on('end', () => {
                                    const isStubHeader = probeRes.headers['x-proxy-stub'] === '1';
                                    let stubPid = null;
                                    try {
                                        const parsed = JSON.parse(body);
                                        if (parsed.stub || isStubHeader) {
                                            stubPid = typeof parsed.pid === 'number' ? parsed.pid : null;
                                        }
                                    }
                                    catch (_) { }
                                    if (isStubHeader || stubPid) {
                                        electron_log_1.default.warn(`[Proxy] Detected proxy-stub (pid=${stubPid}) occupying primary port ${primaryPort}. Terminating stub to reclaim port...`);
                                        if (stubPid && stubPid !== process.pid) {
                                            try {
                                                process.kill(stubPid, 'SIGKILL');
                                            }
                                            catch (_) {
                                                try {
                                                    process.kill(stubPid);
                                                }
                                                catch (_) { }
                                            }
                                        }
                                    }
                                    setTimeout(callback, 250);
                                });
                            });
                            probeReq.on('error', () => { setTimeout(callback, 350); });
                            probeReq.on('timeout', () => { probeReq.destroy(); setTimeout(callback, 350); });
                        };
                        probeAndEvictStub(() => {
                            tryListen(primaryPort, primaryHost);
                        });
                        return;
                    }
                    if (attemptIdx + 1 < portCandidates.length) {
                        const triedPort = portCandidates[attemptIdx];
                        const nextPort = portCandidates[attemptIdx + 1];
                        electron_log_1.default.warn(`[Proxy] Port ${triedPort} is already in use after retries. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
                        attemptIdx += 1;
                        tryListen(nextPort, primaryHost);
                        return;
                    }
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
        const { retryBudgetPatch, breakerPatch } = (0, persistedState_1.fromFile)(file, Date.now(), circuitBreaker_1.CIRCUIT_BREAKER_RESET_MS);
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
        stopQuotaPollingInterval();
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