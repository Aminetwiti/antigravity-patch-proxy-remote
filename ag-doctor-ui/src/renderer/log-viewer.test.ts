import { describe, expect, it } from 'vitest';
import {
  classifyLogLevel,
  isLogNoise,
  parseLogLine,
  highlightText,
  escapeHtml,
} from './log-viewer';

describe('Structured Log Viewer - classifyLogLevel', () => {
  it('classifies Go glog ERROR prefix as error', () => {
    const line = 'ERROR: logging before google.Init: E0917 16:09:20.457963 1117 cascade_run_state.go:141] Failed';
    expect(classifyLogLevel(line)).toBe('error');
  });

  it('classifies errorreport.go as error', () => {
    const line = 'E0917 16:38:07.627858 3241 errorreport.go:224] serializer encountered step with unexpected status';
    expect(classifyLogLevel(line)).toBe('error');
  });

  it('classifies Go glog WARN prefix as warn', () => {
    const line = 'W0917 16:38:07.559325 3241 declarative_config_loader.go:251] skipping component';
    expect(classifyLogLevel(line)).toBe('warn');
  });

  it('classifies Go glog INFO prefix as info', () => {
    const line = 'I0917 16:38:12.061981 3374 http_helpers.go:296] URL: http://127.0.0.1:51074/v1internal';
    expect(classifyLogLevel(line)).toBe('info');
  });

  it('classifies panic / runtime error as panic', () => {
    expect(classifyLogLevel('panic: runtime error: invalid memory address')).toBe('panic');
    expect(classifyLogLevel('goroutine 2496 [running]:')).toBe('panic');
    expect(classifyLogLevel('fatal error: signal 0xc0000005')).toBe('panic');
  });

  it('defaults unclassified lines to info', () => {
    expect(classifyLogLevel('Language server listening on random port at 50595')).toBe('info');
  });
});

describe('Structured Log Viewer - parseLogLine', () => {
  it('parses standard Go glog lines with prefix stripped', () => {
    const raw = 'ERROR: logging before google.Init: I0917 17:34:34.817438   14860 http_helpers.go:296] URL: http://127.0.0.1:51074/v1internal:generateContent Trace: 0xcdbb2ef6303b6b91';
    const entry = parseLogLine(raw);
    expect(entry.level).toBe('info');
    expect(entry.time).toBe('17:34:34.817');
    expect(entry.location).toBe('http_helpers.go:296');
    expect(entry.message).toBe('URL: http://127.0.0.1:51074/v1internal:generateContent Trace: 0xcdbb2ef6303b6b91');
    expect(entry.isNoise).toBe(true);
  });

  it('parses glog error line and detects noise for canceled steps', () => {
    const raw = 'ERROR: logging before google.Init: E0917 17:34:35.389912   13222 errorreport.go:224] serializer encountered non-tool step 1380 of type CORTEX_STEP_TYPE_PLANNER_RESPONSE with unexpected status CORTEX_STEP_STATUS_CANCELED';
    const entry = parseLogLine(raw);
    expect(entry.level).toBe('error');
    expect(entry.time).toBe('17:34:35.389');
    expect(entry.location).toBe('errorreport.go:224');
    expect(entry.isNoise).toBe(true);
  });

  it('parses non-glog lines gracefully', () => {
    const raw = 'Language server listening on random port at 50595';
    const entry = parseLogLine(raw);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Language server listening on random port at 50595');
    expect(entry.isNoise).toBe(false);
  });

  it('parses electron-log format lines from main.log', () => {
    const raw = '[2026-09-19 16:18:39.804] [info] [Proxy] resolveGoogleIp using public DNS';
    const entry = parseLogLine(raw);
    expect(entry.level).toBe('info');
    expect(entry.time).toBe('16:18:39.804');
    expect(entry.message).toBe('[Proxy] resolveGoogleIp using public DNS');
    expect(entry.isNoise).toBe(false);
  });

  it('parses fatal/panic lines properly', () => {
    const raw = 'panic: runtime error: invalid memory address or nil pointer dereference';
    const entry = parseLogLine(raw);
    expect(entry.level).toBe('panic');
    expect(entry.isNoise).toBe(false);
  });
});

describe('Structured Log Viewer - isLogNoise', () => {
  it('detects routine SSE ping traces as noise', () => {
    expect(isLogNoise('http_helpers.go:296] URL: http://127.0.0.1:51074/v1internal Trace: 0x123 ResponseID: abc')).toBe(true);
  });

  it('detects CORTEX canceled step warnings as noise', () => {
    expect(isLogNoise('unexpected status CORTEX_STEP_STATUS_CANCELED')).toBe(true);
  });

  it('detects CDP discovery routine as noise', () => {
    expect(isLogNoise('[CDP Discovery] Successfully discovered Electron WS URL')).toBe(true);
  });

  it('detects ripgrep path parse error as noise', () => {
    expect(isLogNoise('Error parsing grep result: strconv.Atoi: parsing "/Users/amine/file.tsx": invalid syntax')).toBe(true);
  });

  it('detects test cascade cancellations as noise', () => {
    expect(isLogNoise('/exa.language_server_pb.LanguageServerService/CancelCascadeInvocation (unknown): cascade not found')).toBe(true);
    expect(isLogNoise('LoadTrajectory LoadUnsafe failed for casc-cancel: trajectory casc-cancel not found in any store')).toBe(true);
  });

  it('keeps genuine errors and panics as non-noise', () => {
    expect(isLogNoise('dial tcp 127.0.0.1:51074: connect: connection refused')).toBe(false);
    expect(isLogNoise('panic: runtime error: slice bounds out of range')).toBe(false);
    expect(isLogNoise('HTTP 500 Internal Server Error')).toBe(false);
  });

  it('detects RemoteControl subscription callbacks as noise', () => {
    expect(isLogNoise('[RemoteControl] Subscription callback triggered.')).toBe(true);
    expect(isLogNoise('[RemoteControl] Staying disconnected: remote-control-setting-enabled Mendel flag is off')).toBe(true);
    expect(isLogNoise('[RemoteControl] Resolved proxyServerURL: ""')).toBe(true);
    expect(isLogNoise('[RemoteControl] RemoteControlEnabled value: true')).toBe(true);
  });

  it('detects cascade force-stop cancel warnings as noise', () => {
    expect(isLogNoise('Cancel during force stop of conversation 42d9ad4c-a514-4ad7-a839-31a221aa9b03: executor is not currently running')).toBe(true);
  });

  it('detects migration skip logs as noise', () => {
    expect(isLogNoise('Migration [MIGRATION_ID_SIDECAR_USER_CONFIG_BYPASS] is disabled, skipping entirely')).toBe(true);
    expect(isLogNoise('Migration [MIGRATION_ID_PLUGIN_ENABLEMENT] already has status MIGRATION_STATUS_COMPLETED, skipping')).toBe(true);
  });

  it('detects AuthProvider UpdateEndpointURL skip as noise', () => {
    expect(isLogNoise('[AuthProvider] UpdateEndpointURL skipping update for custom configCloudCodeURL: "http://127.0.0.1:51074"')).toBe(true);
  });

  it('detects latency breakdown metrics as noise', () => {
    expect(isLogNoise('latency_breakdown.go:142] SEND_USER_CASCADE_MESSAGE_LATENCY latency breakdown: map[...]')).toBe(true);
  });

  it('detects summary store reconciliation as noise', () => {
    expect(isLogNoise('summary store: starting background reconciliation (trigger=startup)')).toBe(true);
    expect(isLogNoise('summary store: reconciliation complete, synced 1570 records')).toBe(true);
  });

  it('detects startup banner logs as noise', () => {
    expect(isLogNoise('Serving UI bundle from embedded assets')).toBe(true);
    expect(isLogNoise('initialized server successfully in 1.7676385s')).toBe(true);
    expect(isLogNoise('Using bundled agy-node')).toBe(true);
    expect(isLogNoise('Creating trajectory store manager with proto store and SQLite store')).toBe(true);
  });

  it('keeps errorreport model-turn error as real (non-noise)', () => {
    // This is the one real signal in these logs — must NOT be filtered
    expect(isLogNoise('request would have ended on a model turn (trajectory 8450eb57-fa24-4799-95bc-a3b0d5527e54, generator metadata 57)')).toBe(false);
  });
});

describe('Structured Log Viewer - highlightText & escapeHtml', () => {
  it('escapes HTML special characters safely', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('highlights search match while preserving safety', () => {
    const res = highlightText('Failed to connect to <server>', 'connect');
    expect(res).toBe('Failed to <mark class="log-hl">connect</mark> to &lt;server&gt;');
  });

  it('handles case-insensitive match correctly', () => {
    const res = highlightText('Error: Timeout waiting for response', 'error');
    expect(res).toBe('<mark class="log-hl">Error</mark>: Timeout waiting for response');
  });

  it('returns escaped string when query is empty', () => {
    expect(highlightText('Pure text & more', '')).toBe('Pure text &amp; more');
  });
});
