import { describe, expect, it } from 'vitest';

export interface CustomModel {
  name: string;
  displayName?: string;
  provider: string;
  externalModelName: string;
  apiUrl: string;
  apiKey?: string;
  encrypted?: boolean;
  enabled?: boolean;
}

export function filterAndPaginateModels(
  models: CustomModel[],
  searchQuery: string,
  currentPage: number,
  pageSize: number
) {
  const query = searchQuery.trim().toLowerCase();
  const filtered = models.filter((m) => {
    if (!query) return true;
    const name = (m.name ?? '').toLowerCase();
    const displayName = (m.displayName ?? '').toLowerCase();
    const provider = (m.provider ?? '').toLowerCase();
    const externalName = (m.externalModelName ?? '').toLowerCase();
    const apiUrl = (m.apiUrl ?? '').toLowerCase();
    return (
      name.includes(query) ||
      displayName.includes(query) ||
      provider.includes(query) ||
      externalName.includes(query) ||
      apiUrl.includes(query)
    );
  });

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIdx = (validPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  let infoText = 'Showing 0 models';
  if (models.length > 0) {
    if (totalItems === 0) {
      infoText = `0 models found (filtered from ${models.length})`;
    } else {
      const filterSuffix = query ? ` (filtered from ${models.length})` : '';
      infoText = `Showing ${startIdx + 1}–${endIdx} of ${totalItems} models${filterSuffix}`;
    }
  }

  return {
    filtered,
    pageItems,
    totalItems,
    totalPages,
    validPage,
    startIdx,
    endIdx,
    infoText,
  };
}

describe('Models View Pagination & Filtering', () => {
  const mockModels: CustomModel[] = Array.from({ length: 25 }, (_, i) => ({
    name: `model-${i + 1}`,
    displayName: i % 2 === 0 ? `Claude Custom ${i + 1}` : `GPT Model ${i + 1}`,
    provider: i < 15 ? 'anthropic' : 'openai',
    externalModelName: i % 2 === 0 ? 'claude-3-5-sonnet' : 'gpt-4o',
    apiUrl: i < 15 ? 'https://api.anthropic.com' : 'https://api.openai.com',
  }));

  it('calculates total pages correctly with default page size of 10', () => {
    const res = filterAndPaginateModels(mockModels, '', 1, 10);
    expect(res.totalPages).toBe(3);
    expect(res.totalItems).toBe(25);
    expect(res.pageItems.length).toBe(10);
    expect(res.infoText).toBe('Showing 1–10 of 25 models');
  });

  it('slices second page items correctly', () => {
    const res = filterAndPaginateModels(mockModels, '', 2, 10);
    expect(res.validPage).toBe(2);
    expect(res.pageItems.length).toBe(10);
    expect(res.pageItems[0].name).toBe('model-11');
    expect(res.infoText).toBe('Showing 11–20 of 25 models');
  });

  it('handles last page with partial count', () => {
    const res = filterAndPaginateModels(mockModels, '', 3, 10);
    expect(res.validPage).toBe(3);
    expect(res.pageItems.length).toBe(5);
    expect(res.pageItems[4].name).toBe('model-25');
    expect(res.infoText).toBe('Showing 21–25 of 25 models');
  });

  it('clamps page number if out of bounds', () => {
    const resOver = filterAndPaginateModels(mockModels, '', 99, 10);
    expect(resOver.validPage).toBe(3);

    const resUnder = filterAndPaginateModels(mockModels, '', -5, 10);
    expect(resUnder.validPage).toBe(1);
  });

  it('filters models by query string across fields', () => {
    const res = filterAndPaginateModels(mockModels, 'anthropic', 1, 10);
    expect(res.totalItems).toBe(15);
    expect(res.totalPages).toBe(2);
    expect(res.infoText).toBe('Showing 1–10 of 15 models (filtered from 25)');
  });

  it('returns empty results when query does not match any model', () => {
    const res = filterAndPaginateModels(mockModels, 'nonexistent-model-xyz', 1, 10);
    expect(res.totalItems).toBe(0);
    expect(res.pageItems.length).toBe(0);
    expect(res.infoText).toBe('0 models found (filtered from 25)');
  });

  it('handles empty models list gracefully', () => {
    const res = filterAndPaginateModels([], '', 1, 10);
    expect(res.totalItems).toBe(0);
    expect(res.totalPages).toBe(1);
    expect(res.pageItems.length).toBe(0);
    expect(res.infoText).toBe('Showing 0 models');
  });
});
