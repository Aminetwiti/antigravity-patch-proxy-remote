#!/usr/bin/env node
/**
 * patch_2_22.js — Surgical patcher for Antigravity v2.22.x app.asar.
 *
 * The 2.22.0 asar has the same surgical anchor points as 2.17/2.18
 * (main.js, preload.js, ipcHandlers.js, languageServer.js, constants.js,
 * settingsService.js) so the v2.17 patcher handles it directly.
 *
 * New in 2.22: HostBridgeServer (ConnectRPC), WSL 2 provisioning,
 * chrome-devtools-mcp bundled, js-yaml. None of these conflict with
 * the proxy patch — they're additive features on separate code paths.
 */
'use strict';
require('./patch_2_17');
