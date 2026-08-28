const asar = require('@electron/asar');
const asarPath = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\resources\\app.asar';
const content = asar.extractFile(asarPath, 'dist/ipcHandlers.js').toString('utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);

console.log('\n--- First 25 lines (imports/requires) ---');
lines.slice(0, 25).forEach((l, i) => console.log((i + 1) + ': ' + l));

console.log('\n--- All lines with ipcMain or electron_1 or require("electron") ---');
lines.forEach((l, i) => {
  if (l.includes('ipcMain') || l.includes('electron_1') || l.includes('require("electron")') || l.includes("require('electron')")) {
    console.log((i + 1) + ': ' + l.substring(0, 200));
  }
});

console.log('\n--- Lines around storage:fetch-models ---');
lines.forEach((l, i) => {
  if (l.includes('storage:fetch-models') || l.includes('removed duplicate')) {
    const start = Math.max(0, i - 3);
    const end = Math.min(lines.length, i + 4);
    for (let j = start; j < end; j++) {
      console.log((j + 1) + ': ' + lines[j].substring(0, 200));
    }
    console.log('---');
  }
});
