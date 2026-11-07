const { loadCustomModels } = require('./dist/proxy/modelLoader.js');

try {
  const models = loadCustomModels();
  console.log('Total models loaded:', models.length);
  models.forEach((m, i) => {
    console.log(`[${i}] name: ${m.name}, displayName: "${m.displayName}", provider: ${m.provider}, externalModelName: ${m.externalModelName}, _poolOnly: ${m._poolOnly}`);
  });
} catch (e) {
  console.error(e);
}
