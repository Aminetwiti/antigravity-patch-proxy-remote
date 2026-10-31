/**
 * Catalogue of Well-Known Provider Presets.
 * Offers 1-click configuration for standard LLM providers in the UI.
 * Single Source of Truth sourced directly from src/config/providers.json.
 */

import providersData from './config/providers.json';

export interface PresetModel {
  id: string;
  displayName: string;
  description?: string;
  enabled?: boolean;
}

export interface PresetProvider {
  id: string;
  name: string;
  category: 'General' | 'Local' | 'Experimental';
  provider: string;
  apiUrl: string;
  models: PresetModel[];
  description?: string;
  docsUrl?: string;
}

export const WELL_KNOWN_PRESETS: PresetProvider[] = (providersData as Array<{
  id: string;
  name: string;
  category: 'General' | 'Local' | 'Experimental';
  provider: string;
  chatUrl: string;
  description?: string;
  docsUrl?: string;
  suggestedModels?: Array<{ id: string; displayName: string }>;
}>)
  .filter((p) => p.id !== 'custom-preset')
  .map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    provider: p.provider,
    apiUrl: p.chatUrl,
    models: (p.suggestedModels || []).map((m) => ({
      id: m.id,
      displayName: m.displayName,
    })),
    description: p.description,
    docsUrl: p.docsUrl,
  }));
