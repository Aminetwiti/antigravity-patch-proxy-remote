import { it, expect } from 'vitest';
import { loadCustomModels } from '../proxy/modelLoader';
import { getGoogleAccountPool } from '../proxy/googlePool';

it('debugs pool size for Flash Low', () => {
  const models = loadCustomModels();
  console.log('Total models loaded:', models.length);
  const lowModels = models.filter(m => m.displayName && m.displayName.includes('Flash (Low)'));
  console.log('Low models count:', lowModels.length);
  console.log('Low models sample:', lowModels.slice(0, 5).map(m => ({ name: m.name, email: m.accountEmail, ext: m.externalModelName, isAuto: m.name.includes(':auto-pool') })));
  if (lowModels.length > 0) {
    const pool = getGoogleAccountPool(lowModels[0], models);
    console.log('Pool count for lowModels[0]:', pool.length);
    console.log('Pool emails:', pool.map(m => m.accountEmail));
  }
  expect(models.length).toBeGreaterThan(0);
});
