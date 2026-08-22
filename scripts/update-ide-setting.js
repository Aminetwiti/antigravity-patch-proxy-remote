const fs = require('fs');
const path = require('path');

const settingsPath = path.join(process.env.APPDATA || '', 'Antigravity IDE', 'User', 'settings.json');

if (!fs.existsSync(settingsPath)) {
  console.error('Settings file not found:', settingsPath);
  process.exit(1);
}

let content = fs.readFileSync(settingsPath, 'utf-8');

// Replace jetski.cloudCodeUrl value
const regex = /("jetski\.cloudCodeUrl"\s*:\s*")([^"]*)(")/g;
const newContent = content.replace(regex, (match, prefix, oldValue, suffix) => {
  const newValue = 'http://localhost:51074';
  console.log(`Updating jetski.cloudCodeUrl: ${oldValue} -> ${newValue}`);
  return `${prefix}${newValue}${suffix}`;
});

if (content === newContent) {
  console.log('No jetski.cloudCodeUrl setting found, adding it...');
  // Try to add it to the end of the JSON object
  const trimmed = content.trim();
  if (trimmed.endsWith('}')) {
    content = content.slice(0, -1) + ',\n  "jetski.cloudCodeUrl": "http://localhost:51074"\n}';
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
