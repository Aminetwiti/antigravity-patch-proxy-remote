const fs = require('fs');
const content = fs.readFileSync('temp_ui_main.js', 'utf8');
const target = 'trajectorySummaries/startStream';
const idx = content.indexOf(target);
console.log('Target at:', idx);
const before = content.substring(Math.max(0, idx - 100), idx + 200);
console.log('Context:', before);

// Find where this action is used or dispatched
const varNameMatch = before.match(/var\s+([a-zA-Z0-9_$]+)\s*=\s*[a-zA-Z0-9_$]+\(["']trajectorySummaries\/startStream["']/);
console.log('Action creator name:', varNameMatch ? varNameMatch[1] : 'null');
if (varNameMatch) {
  const name = varNameMatch[1];
  let p = 0;
  while ((p = content.indexOf(name, p)) !== -1) {
    const prevChar = content[p - 1] || ' ';
    const nextChar = content[p + name.length] || ' ';
    if (!/[a-zA-Z0-9_$]/.test(prevChar) && !/[a-zA-Z0-9_$]/.test(nextChar)) {
      console.log('Match at', p, ':', content.substring(Math.max(0, p - 30), p + name.length + 80).replace(/\n/g, ' '));
    }
    p += name.length;
  }
}
