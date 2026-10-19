const { spawn } = require('child_process');
const electronBin = require('./node_modules/electron');

const t0 = Date.now();
const child = spawn(electronBin, ['bench-main.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));
child.on('exit', () => console.log('[BENCH] Child exited after:', Date.now() - t0, 'ms'));
