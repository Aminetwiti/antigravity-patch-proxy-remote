const fs = require('fs');
const path = require('path');

const settingsPath = path.join(process.env.APPDATA || '', 'Antigravity IDE', 'User', 'settings.json');

if (!fs.existsSync(settingsPath)) {
  console.error('Settings file not found:', settingsPath);
  process.exit(1);
}

const BIND_HOST = process.env.AG_BIND_HOST || '127.0.0.1';
const PROXY_PORT = process.env.AG_PROXY_PORT || '51074';
const NEW_VALUE = `http://${BIND_HOST}:${PROXY_PORT}`;

let content = fs.readFileSync(settingsPath, 'utf-8');

// Replace jetski.cloudCodeUrl value
const regex = /("jetski\.cloudCodeUrl"\s*:\s*")([^"]*)(")/g;
const newContent = content.replace(regex, (match, prefix, oldValue, suffix) => {
  console.log(`Updating jetski.cloudCodeUrl: ${oldValue} -> ${NEW_VALUE}`);
  return `${prefix}${NEW_VALUE}${suffix}`;
});

if (content === newContent) {
  console.log('No jetski.cloudCodeUrl setting found, adding it...');
  const trimmed = content.trim();
  if (trimmed.endsWith('}')) {
    content = content.slice(0, -1) + `,\n  "jetski.cloudCodeUrl": "${NEW_VALUE}"\n}`;
    fs.writeFileSync(settingsPath, content, 'utf-8');
    console.log('Added jetski.cloudCodeUrl setting.');
  } else {
    console.error('Could not parse settings file structure.');
    process.exit(1);
  }
} else {
  fs.writeFileSync(settingsPath, newContent, 'utf-8');
  console.log('Updated jetski.cloudCodeUrl setting.');
}
