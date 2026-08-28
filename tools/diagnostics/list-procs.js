const { execSync } = require('child_process');

// List all electron/node processes with their command lines to identify which app is running
try {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'electron|node|language_server|Antigravity\' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  let data;
  try { data = JSON.parse(out); } catch { data = []; }
  const list = Array.isArray(data) ? data : [data];
  for (const p of list) {
    if (!p) continue;
    console.log('PID=' + p.ProcessId + ' NAME=' + p.Name);
    console.log('  CMD=' + (p.CommandLine || '').slice(0, 400));
  }
} catch (e) {
  console.error('Error:', e.message);
}
