let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d);
    console.log('checks:', j.length, 'passed:', j.filter(c => c.ok).length, '/', j.length);
    for (const c of j) {
      console.log((c.ok ? 'PASS' : 'FAIL') + ' ' + c.check);
    }
  } catch (e) {
    console.log('raw:', d.slice(0, 500));
  }
});
