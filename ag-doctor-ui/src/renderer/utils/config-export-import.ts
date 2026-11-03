/**
 * ag-doctor UI — Configuration Export/Import Manager
 * Handles 1-click JSON backup & restore for custom model providers.
 */

export interface ExportableProviderConfig {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey?: string;
  allowUnauthorized: boolean;
  models: string[];
}

export interface BackupBundle {
  version: string;
  exportedAt: string;
  providers: ExportableProviderConfig[];
}

export function exportProvidersToJson(providers: ExportableProviderConfig[], sanitizeKeys = true): string {
  const sanitized = providers.map((p) => ({
    ...p,
    apiKey: sanitizeKeys && p.apiKey ? (p.apiKey.length > 8 ? `${p.apiKey.substring(0, 4)}...${p.apiKey.substring(p.apiKey.length - 4)}` : '***') : p.apiKey,
  }));

  const bundle: BackupBundle = {
    version: '2.2.0',
    exportedAt: new Date().toISOString(),
    providers: sanitized,
  };

  return JSON.stringify(bundle, null, 2);
}

export function importProvidersFromJson(jsonString: string): {
  valid: boolean;
  providers?: ExportableProviderConfig[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.providers)) {
      return { valid: false, error: 'Invalid backup bundle format: missing "providers" array' };
    }

    const validProviders: ExportableProviderConfig[] = [];
    for (const p of parsed.providers) {
      if (!p.id || !p.name || !p.apiUrl) {
        return { valid: false, error: 'Corrupt provider entry in JSON: missing required fields (id, name, apiUrl)' };
      }
      validProviders.push({
        id: String(p.id),
        name: String(p.name),
        provider: String(p.provider || 'custom'),
        apiUrl: String(p.apiUrl),
        apiKey: p.apiKey ? String(p.apiKey) : '',
        allowUnauthorized: Boolean(p.allowUnauthorized),
        models: Array.isArray(p.models) ? p.models.map(String) : [],
      });
    }

    return { valid: true, providers: validProviders };
  } catch (err) {
    return { valid: false, error: `JSON Parse error: ${(err as Error).message}` };
  }
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { exportProvidersToJson, importProvidersFromJson });
}
