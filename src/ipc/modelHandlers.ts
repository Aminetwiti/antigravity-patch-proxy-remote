import { dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageManager } from '../storage';
import * as cryptoStore from '../cryptoStore';
import * as customModelStore from '../customModelStore';
import type { CustomModelFileEntry as CustomModelFileEntryFromTypes } from '../proxy/types';
import { WELL_KNOWN_PRESETS } from '../presets';
import * as configExchange from '../services/configExchange';
import { DEFAULT_PROXY_PORT } from '../constants';
import { injectCustomModelsIntoUserStatus, injectCustomModelsIntoResponse } from '../proxy/protoInjector';
import { loadCustomModels as loadProxyCustomModels } from '../proxy/modelLoader';
import { discoverLocalAntigravityCredential } from '../services/localCredentialDiscovery';
import { discoverLocalGoogleAccounts } from '../services/localAccountDiscovery';
import { IPC_CHANNELS } from './channels';
import { atomicWriteJson, withWriteLock } from '../services/modelStore';

export interface CustomModelFileEntry {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  /** Reasoning effort from /v1/models */
  reasoningEffort?: string;
  /** Thinking budget from /v1/models */
  thinkingBudget?: string;
  /** Mode from /v1/models */
  mode?: string;
  /** Input modalities (text, image, audio, video) */
  inputModalities?: string[];
  [key: string]: unknown;
}

export function registerModelHandlers(storageManager: StorageManager): void {
  // Storage
  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_ITEMS, async () => {
    return storageManager.getItems();
  });
  ipcMain.handle(IPC_CHANNELS.STORAGE_UPDATE_ITEMS, async (_event, changes: Record<string, string | null>) => {
    await storageManager.updateItems(changes);
  });
  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_CUSTOM_MODELS, async () => {
    const models = await customModelStore.loadCustomModels();
    return models.map((m) => ({
      ...m,
      apiKey: customModelStore.maskApiKey(m.apiKey),
    }));
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_PROVIDERS, async () => {
    const providers = await customModelStore.loadProviders();
    return providers.map(p => ({
      ...p,
      apiKey: customModelStore.maskApiKey(p.apiKey)
    }));
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_PRESETS, async () => {
    return WELL_KNOWN_PRESETS;
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_TEST_PROVIDER_HEALTH, async (_event, params: customModelStore.TestModelParams) => {
    return customModelStore.testProviderHealth(params);
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_EXPORT_PROVIDERS_BASE64, async () => {
    try {
      const providers = await customModelStore.loadProviders();
      const base64 = configExchange.exportProvidersToBase64(providers);
      return { success: true, base64, count: providers.length };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_IMPORT_PROVIDERS_BASE64, async (_event, base64Str: string, strategy: configExchange.MergeStrategy = 'merge') => {
    try {
      const incoming = configExchange.parseProvidersFromBase64(base64Str);
      const existing = await customModelStore.loadProviders();
      const res = configExchange.mergeProviderConfigs(existing, incoming, strategy);
      const providers = res.providers.map((p) => {
        const enc = customModelStore.encryptApiKeyIfNeeded(p.apiKey);
        return { ...p, apiKey: enc.apiKey, encrypted: enc.encrypted };
      });
      await customModelStore.saveProviders(providers);
      return res;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });




  ipcMain.handle(IPC_CHANNELS.STORAGE_SAVE_PROVIDER, async (_event, newProvider: customModelStore.ProviderFileEntry) => {
    try {
      const providers = await customModelStore.loadProviders();
      const existingIdx = providers.findIndex((p) => p.id === newProvider.id);

      // Decide the effective API key value to persist.
      // - 'none' or empty means the user explicitly cleared the key.
      // - Anything matching a masked shape means the field is untouched; preserve existing.
      // - Otherwise treat as a new plaintext value and encrypt.
      const rawKey = newProvider.apiKey;
      const isExplicitClear = !rawKey || rawKey === 'none' || rawKey === '';
      const isMasked = !isExplicitClear && customModelStore.isMaskedApiKey(rawKey);

      if (isExplicitClear) {
        newProvider.apiKey = 'none';
        newProvider.encrypted = false;
      } else if (isMasked && existingIdx !== -1) {
        newProvider.apiKey = providers[existingIdx].apiKey;
        newProvider.encrypted = providers[existingIdx].encrypted;
      } else {
        const enc = customModelStore.encryptApiKeyIfNeeded(rawKey);
        newProvider.apiKey = enc.apiKey;
        newProvider.encrypted = enc.encrypted;
      }

      // Validate URL
      try {
        const u = new URL(newProvider.apiUrl);
        if (!/^https?:$/.test(u.protocol)) {
          return { success: false, error: 'API URL must use http or https' };
        }
      } catch {
        return { success: false, error: 'Invalid API URL' };
      }

      if (existingIdx !== -1) {
        providers[existingIdx] = newProvider;
      } else {
        providers.push(newProvider);
      }

      await customModelStore.saveProviders(providers);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Failed to save provider:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_DELETE_PROVIDER, async (_event, providerId: string) => {
    try {
      const providers = await customModelStore.loadProviders();
      const filtered = providers.filter((p) => p.id !== providerId);
      await customModelStore.saveProviders(filtered);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Failed to delete provider:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_DISCOVER_LOCAL_ACCOUNT, async () => {
    try {
      const cred = await discoverLocalAntigravityCredential();
      if (!cred || !cred.refreshToken) {
        return { success: false, error: 'No authenticated Antigravity account found in system keyring.' };
      }
      return { success: true, credential: cred };
    } catch (err) {
      log.warn('[IPC] Local credential discovery error:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('models:discoverLocalGoogleAccounts', async () => {
    try {
      const accounts = await discoverLocalGoogleAccounts();
      return { success: true, accounts };
    } catch (err) {
      log.warn('[IPC] Local Google accounts discovery error:', err);
      return { success: false, error: (err as Error).message, accounts: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_EXPORT_PROVIDERS, async () => {
    try {
      const providers = await customModelStore.loadProviders();
      const saveResult = await (dialog as unknown as {
        showSaveDialog: (opts: { title: string; defaultPath: string; filters: Array<{ name: string; extensions: string[] }>; }) => Promise<{ canceled: boolean; filePath?: string }>;
      }).showSaveDialog({
        title: 'Export Provider Configuration',
        defaultPath: 'antigravity_providers.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Cancelled' };
      }
      await fs.writeFile(saveResult.filePath, JSON.stringify({ providers }, null, 2), 'utf-8');
      return { success: true, count: providers.length };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Symmetric counterpart to storage:export-providers. The renderer calls this
  // channel (not the -base64 variant) when the user picks "Import" from the UI,
  // so the main process must open a file dialog, parse the JSON, and merge it
  // into the existing provider store.
  ipcMain.handle(IPC_CHANNELS.STORAGE_IMPORT_PROVIDERS, async () => {
    try {
      const openResult = await (dialog as unknown as {
        showOpenDialog: (opts: { title: string; properties: string[]; filters: Array<{ name: string; extensions: string[] }>; }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      }).showOpenDialog({
        title: 'Import Provider Configuration',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' };
      }
      const raw = await fs.readFile(openResult.filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw) as { providers?: customModelStore.ProviderFileEntry[] };
      const incoming = parsed.providers ?? [];
      const existing = await customModelStore.loadProviders();
      const res = configExchange.mergeProviderConfigs(existing, incoming, 'merge');
      const providers = res.providers.map((p) => {
        const enc = customModelStore.encryptApiKeyIfNeeded(p.apiKey);
        return { ...p, apiKey: enc.apiKey, encrypted: enc.encrypted };
      });
      await customModelStore.saveProviders(providers);
      return { success: true, count: incoming.length };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Imported configs (JSON file or base64) may carry plaintext keys. Reuse the
  // canonical encryptApiKeyIfNeeded path: encrypt any non-masked plaintext key,
  // keep 'none' as-is, and pass through keys already encrypted in the store.



  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_DOCTOR_DIAGNOSTICS, async () => {
    try {
      const providers = await customModelStore.loadProviders();
      const customModels = await customModelStore.loadCustomModels();
      let activePort = DEFAULT_PROXY_PORT;
      try {
        const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
        const portFile = path.join(home, '.gemini', 'antigravity', '.proxy_port');
        const content = await fs.readFile(portFile, 'utf-8');
        activePort = parseInt(content.trim(), 10) || DEFAULT_PROXY_PORT;
      } catch {
        /* default port */
      }
      const activeProviders = providers.filter((p) => p.enabled);
      const totalTokens = providers.reduce(
        (acc, p) => acc + (p.usage?.promptTokens || 0) + (p.usage?.completionTokens || 0),
        0,
      );
      const totalRequests = providers.reduce((acc, p) => acc + (p.usage?.totalRequests || 0), 0);

      return {
        success: true,
        proxyPort: activePort,
        providersCount: providers.length,
        activeProvidersCount: activeProviders.length,
        customModelsCount: customModels.length,
        totalTokens,
        totalRequests,
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          enabled: p.enabled,
          modelCount: p.models.length,
          enabledModelCount: p.models.filter((m) => m.enabled).length,
          usage: p.usage,
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_SAVE_CUSTOM_MODEL, async (_event, newModel: CustomModelFileEntry & { apiKey?: string }) => {
    try {
      const models = await customModelStore.loadCustomModels();
      const existingIdx = models.findIndex((m) => m.name === newModel.name);

      const isMasked = !!newModel.apiKey && customModelStore.isMaskedApiKey(newModel.apiKey);
      if (isMasked && existingIdx !== -1) {
        newModel.apiKey = models[existingIdx].apiKey;
        newModel.encrypted = models[existingIdx].encrypted;
      } else if (newModel.apiKey && newModel.apiKey !== 'none') {
        newModel.apiKey = cryptoStore.encryptString(newModel.apiKey);
        newModel.encrypted = true;
      }

      if (existingIdx !== -1) {
        models[existingIdx] = newModel;
      } else {
        models.push(newModel);
      }

      await customModelStore.saveCustomModels(models);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Failed to save custom model:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_DELETE_CUSTOM_MODEL, async (_event, modelName: string) => {
    try {
      await customModelStore.deleteCustomModel(modelName);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Failed to delete custom model:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROTO_INJECT_USER_STATUS, async (_event, rawBytes: Uint8Array | number[]) => {
    try {
      const models = loadProxyCustomModels();
      if (!models || models.length === 0) {
        return rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(Buffer.from(rawBytes));
      }
      const buf = Buffer.from(rawBytes);
      const result = injectCustomModelsIntoUserStatus(buf, models);
      return new Uint8Array(result.buffer);
    } catch (err) {
      log.error('[IPC] Failed to inject custom models into UserStatus:', err);
      return rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(Buffer.from(rawBytes));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROTO_INJECT_AVAILABLE_MODELS, async (_event, rawBytes: Uint8Array | number[]) => {
    try {
      const models = loadProxyCustomModels() || [];
      const buf = Buffer.from(rawBytes);
      const result = injectCustomModelsIntoResponse(buf, models, undefined, true);
      return new Uint8Array(result.buffer);
    } catch (err) {
      log.error('[IPC] Failed to inject custom models into AvailableModels:', err);
      return rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(Buffer.from(rawBytes));
    }
  });
}
