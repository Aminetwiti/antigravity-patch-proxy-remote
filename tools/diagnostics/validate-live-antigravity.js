const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

function getCommandLine(pid) {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`, { encoding: 'utf-8' });
    return out.trim();
  } catch (e) {
    return '';
  }
}

function getListeningPorts(pid) {
  try {
    const netstat = execSync(`netstat -ano -p TCP | findstr ${pid}`, { encoding: 'utf-8' });
    const ports = [];
    for (const line of netstat.split('\n')) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        if (parts[1]) {
          const match = parts[1].match(/:(\d+)$/);
          if (match) ports.push(parseInt(match[1], 10));
        }
      }
    }
    return ports;
  } catch (e) {
    return [];
  }
}

function makeGrpcCall(port, csrfToken, service, method, payloadBytes = Buffer.alloc(0), timeoutMs = 4000) {
  return new Promise((resolve) => {
    const frame = Buffer.alloc(5 + payloadBytes.length);
    frame.writeUInt8(0, 0); // 0 = Data
    frame.writeUInt32BE(payloadBytes.length, 1);
    payloadBytes.copy(frame, 5);

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: `/${service}/${method}`,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'Accept': 'application/grpc-web+proto,application/grpc-web-text',
        'x-codeium-csrf-token': csrfToken,
        'Connect-Protocol-Version': '1',
        'X-Grpc-Web': '1',
        'Content-Length': frame.length,
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = { statusCode: res.statusCode, headers: res.headers, rawBytes: buf.length, grpcStatus: res.headers['grpc-status'] || '0' };
        if (buf.length >= 5) {
          const flags = buf.readUInt8(0);
          const len = buf.readUInt32BE(1);
          parsed.flags = flags;
          parsed.payloadLength = len;
          parsed.payload = buf.subarray(5, 5 + len);
        }
        resolve({ success: res.statusCode === 200, ...parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'TIMEOUT' });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(frame);
    req.end();
  });
}

async function main() {
  console.log('[*] Scanning active language_server instances...');
  const tasklist = execSync('tasklist /FI "IMAGENAME eq language_server.exe" /FO CSV /NH', { encoding: 'utf-8' });
  const pids = [];
  for (const line of tasklist.split('\n')) {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const pidStr = parts[1].replace(/"/g, '').trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) pids.push(pid);
    }
  }

  console.log(`[+] Found ${pids.length} language_server.exe PIDs:`, pids);

  const instances = [];
  for (const pid of pids) {
    const cmd = getCommandLine(pid);
    const ports = getListeningPorts(pid);
    const csrfMatch = cmd.match(/--csrf_token\s+([a-f0-9\-]{36})/i);
    const subclientMatch = cmd.match(/--subclient_type\s+([a-zA-Z0-9_]+)/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;
    const subclientType = subclientMatch ? subclientMatch[1] : 'unknown';

    console.log(`\nPID: ${pid} | Subclient: ${subclientType} | Ports: [${ports.join(', ')}] | CSRF: ${csrfToken ? 'FOUND' : 'MISSING'}`);
    instances.push({ pid, subclientType, ports, csrfToken, cmd });
  }

  // Find active Hub instance
  let activeHub = null;
  let activePort = null;
  let activeCsrf = null;

  for (const inst of instances) {
    if (!inst.csrfToken || inst.ports.length === 0) continue;
    for (const p of inst.ports) {
      console.log(`[*] Testing probe Heartbeat on port ${p}...`);
      const hb = await makeGrpcCall(p, inst.csrfToken, 'exa.language_server_pb.LanguageServerService', 'Heartbeat');
      if (hb.success) {
        console.log(`  [✓] Heartbeat SUCCESS on port ${p}!`);
        activeHub = inst;
        activePort = p;
        activeCsrf = inst.csrfToken;
        break;
      } else {
        console.log(`  [-] Heartbeat failed on port ${p}:`, hb.statusCode || hb.error);
      }
    }
    if (activePort) break;
  }

  if (!activePort) {
    console.error('[-] Could not connect to any active LanguageServerService.');
    return;
  }

  console.log(`\n[+] ACTIVE HUB TARGET: 127.0.0.1:${activePort} (PID ${activeHub.pid})`);

  // Define comprehensive suite of Read-Only / Safe probe RPCs
  const testRpcList = [
    { service: 'exa.language_server_pb.LanguageServerService', method: 'Heartbeat', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetAvailableModels', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetAllCascadeTrajectories', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'RetrieveUserQuotaSummary', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetWorkspaceInfos', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetKnowledgeItems', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetTermsOfService', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetMcpServerStates', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetCascadeMemories', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetCascadeModelConfigs', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetDebugDiagnostics', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'DumpFlightRecorder', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetDefaultProjectDir', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetBattleWorktreeDiff', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetAllSkills', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetAllRules', mutating: false },
    { service: 'exa.language_server_pb.LanguageServerService', method: 'GetAllWorkflows', mutating: false },
    { service: 'exa.opensearch_clients_pb.CodeIndexService', method: 'HybridSearch', mutating: false },
    { service: 'exa.opensearch_clients_pb.KnowledgeBaseService', method: 'KnowledgeBaseSearch', mutating: false },
    { service: 'exa.index_pb.IndexManagementService', method: 'GetIndexes', mutating: false },
    { service: 'exa.index_pb.IndexManagementService', method: 'GetDatabaseStats', mutating: false },
    { service: 'devtools_jetski_boq_api_proto.ApiService', method: 'ListInstances', mutating: false }
  ];

  console.log(`\n[*] Executing Live RPC Test Suite (${testRpcList.length} probes)...`);
  const runtimeResults = [];

  for (const item of testRpcList) {
    const res = await makeGrpcCall(activePort, activeCsrf, item.service, item.method);
    let classification = 'UNKNOWN';
    if (res.success) {
      classification = 'WORKING';
    } else if (res.statusCode === 401 || res.statusCode === 403) {
      classification = 'AUTH_REQUIRED';
    } else if (res.statusCode === 400 || (res.headers && res.headers['grpc-status'] === '3')) {
      classification = 'INVALID_PAYLOAD'; // Method exists on server but expects specific payload fields
    } else if (res.statusCode === 404 || (res.headers && res.headers['grpc-status'] === '12')) {
      classification = 'NOT_IMPLEMENTED_OR_NOT_FOUND';
    } else if (res.error === 'TIMEOUT') {
      classification = 'STREAMING_OR_TIMEOUT';
    } else {
      classification = 'REJECTED';
    }

    console.log(`  -> ${item.method.padEnd(28)} | Status: ${res.statusCode || res.error} | Payload: ${res.payloadLength || 0}b | Classification: [${classification}]`);
    runtimeResults.push({
      service: item.service,
      method: item.method,
      mutating: item.mutating,
      statusCode: res.statusCode,
      grpcStatus: res.grpcStatus,
      rawBytes: res.rawBytes,
      payloadLength: res.payloadLength || 0,
      classification,
      error: res.error || null,
      headers: res.headers || {}
    });
  }

  // Save runtime tests
  const outDir = path.resolve(__dirname, '../scratch');
  fs.writeFileSync(path.join(outDir, 'runtime_rpc_tests.json'), JSON.stringify(runtimeResults, null, 2));
  console.log(`\n[+] Saved runtime test results to scratch/runtime_rpc_tests.json`);
}

main();
