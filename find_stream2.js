const fs = require('fs');
const content = fs.readFileSync('temp_ui_main.js', 'utf8');
console.log(content.substring(10633500, 10635000));
