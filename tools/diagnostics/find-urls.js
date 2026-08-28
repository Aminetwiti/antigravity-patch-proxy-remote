const fs = require('fs');
const path = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
const b = fs.readFileSync(path, 'ascii');
const matches = [...b.matchAll(/https?:\/\/[a-zA-Z0-9._\/-]+\.googleapis\.com[^"'\s]*/g)];
matches.forEach(m => console.log(m[0]));
