const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    console.log('✓ cleaned dist directory');
  } catch (err) {
    try {
      for (const f of fs.readdirSync(distDir)) {
        try {
          fs.rmSync(path.join(distDir, f), { recursive: true, force: true });
        } catch (_) {}
      }
      console.log('✓ cleaned dist contents (fallback)');
    } catch (_) {}
  }
}
