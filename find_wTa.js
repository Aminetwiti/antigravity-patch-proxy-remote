const fs = require('fs');
const content = fs.readFileSync('temp_ui_main.js', 'utf8');
const p = content.indexOf('function wTa(');
console.log('wTa at:', p);
if (p !== -1) {
  console.log(content.substring(p, p + 1500));
}
