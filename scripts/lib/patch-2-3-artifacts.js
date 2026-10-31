const fs = require('fs');
const path = require('path');

function discoverJavaScriptFiles(rootDir, fsImpl = fs) {
  const discovered = [];

  function visit(currentDir, prefix) {
    const entries = fsImpl.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        discovered.push(relativePath);
      }
    }
  }

  visit(rootDir, '');
  return discovered.sort();
}

function assertRequiredArtifacts(repoDir, relativePaths, fsImpl = fs) {
  const missing = relativePaths
    .filter((relativePath) => !fsImpl.existsSync(path.join(repoDir, ...relativePath.split('/'))))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `Missing required build artifacts: ${missing.join(', ')}. Run npm run build before patching.`,
    );
  }
}

function copyRelativeFiles(sourceRoot, destinationRoot, relativePaths, fsImpl = fs) {
  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/');
    const source = path.join(sourceRoot, ...segments);
    const destination = path.join(destinationRoot, ...segments);
    fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
    fsImpl.copyFileSync(source, destination);
  }
}

function validateAsarInventory(archivePath, requiredPaths, asarImpl) {
  const normalize = (entry) => `/${entry.replaceAll('\\', '/').replace(/^\/+/, '')}`;
  const inventory = new Set(asarImpl.listPackage(archivePath).map(normalize));
  const missing = requiredPaths
    .map(normalize)
    .filter((relativePath) => !inventory.has(relativePath))
    .sort();
  if (missing.length > 0) {
    throw new Error(`Candidate ASAR is incomplete; missing: ${missing.join(', ')}`);
  }
}

module.exports = {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
  copyRelativeFiles,
  validateAsarInventory,
};
