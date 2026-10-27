const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/antigravity/resources/app.asar';
if (!fs.existsSync(asarPath)) {
  console.error('File not found:', asarPath);
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);
let str = buf.toString('latin1');

const target1 = "localStorage.removeItem('jetski.developer.featureEnvironmentOverride');";
const target2 = "window.localStorage.removeItem('jetski.developer.featureEnvironmentOverride');";

let replaced = 0;
while (str.includes(target1)) {
  const repl = '/* keeping dev env override */ void(0);'.padEnd(target1.length, ' ');
  str = str.replace(target1, repl);
  replaced++;
}

while (str.includes(target2)) {
  const repl = '/* keeping dev env override */ void(0);'.padEnd(target2.length, ' ');
  str = str.replace(target2, repl);
  replaced++;
}

console.log('Replaced instances:', replaced);

if (replaced > 0) {
  if (!fs.existsSync(asarPath + '.bak')) {
    fs.copyFileSync(asarPath, asarPath + '.bak');
    console.log('Backup created:', asarPath + '.bak');
  }
  fs.writeFileSync(asarPath, Buffer.from(str, 'latin1'));
  console.log('SUCCESS: app.asar patched to keep developer environment override permanently!');
} else {
  console.log('No instances found to replace (maybe already patched).');
}
