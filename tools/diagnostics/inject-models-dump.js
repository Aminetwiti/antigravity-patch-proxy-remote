const fs = require('fs');
const p = 'C:\\Business\\tools\\solutions\\antigravity-patch-proxy\\dist\\proxy.js';
let c = fs.readFileSync(p, 'utf8');
const anchor = 'electron_log_1.default.info(`[Proxy] Response for ';
const i = c.indexOf(anchor);
if (i < 0) { console.log('anchor not found'); process.exit(1); }
const inject =
  "try { if (String(req.url).indexOf('fetchAvailableModels')>=0) { var __pf=require('path'); var __of=require('os'); fs.writeFileSync(__pf.join(__of.tmpdir(),'ag-fetchAvailableModels-dump.json'), text); } } catch (e) {}\n                ";
c = c.slice(0, i) + inject + c.slice(i);
fs.writeFileSync(p, c);
console.log('injected fetchAvailableModels dump at', i);
