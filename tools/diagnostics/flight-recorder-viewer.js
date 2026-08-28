#!/usr/bin/env node
/**
 * scripts/flight-recorder-viewer.js
 * 
 * Interacts with running Language Server, triggers `DumpFlightRecorder` RPC,
 * extracts the raw Go runtime execution trace, and saves it for `go tool trace`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

function discoverLanguageServer() {
  try {
    const cmd = 'wmic process where "name=\'language_server.exe\'" get ProcessId,CommandLine /format:list';
    const output = execSync(cmd, { encoding: 'utf-8' });
    const pidMatch = output.match(/ProcessId=(\d+)/);
    const csrfMatch = output.match(/--csrf_token\s+([a-f0-9\-]{36})/i);

    if (!pidMatch || !csrfMatch) {
      return null;
    }

    const pid = pidMatch[1];
    const csrfToken = csrfMatch[1];

    // Find listening port
    const netstat = execSync(`netstat -ano -p TCP | findstr ${pid}`, { encoding: 'utf-8' });
    const lines = netstat.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const portMatch = line.trim().split(/\s+/)[1].match(/:(\d+)$/);
        if (portMatch) {
          return { port: parseInt(portMatch[1], 10), csrfToken, pid };
        }
      }
    }
  } catch (e) {
    // Process discovery fallback
  }
  return null;
}

function dumpFlightRecorder(port = 55256, csrfToken = 'dca42d6a-3d87-4a6b-a620-dde9bc7ce40e', outDir = path.resolve(__dirname, '../scratch')) {
  console.log(`[*] Connecting to Language Server at 127.0.0.1:${port}...`);

  // Build gRPC-Web 5-byte frame for empty request (0x00 flags, 0x00 length)
  const reqFrame = Buffer.alloc(5);
  reqFrame.writeUInt8(0, 0); // Data frame
  reqFrame.writeUInt32BE(0, 1); // 0 bytes payload

  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: '/exa.language_server_pb.LanguageServerService/DumpFlightRecorder',
    method: 'POST',
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      'Accept': 'application/grpc-web+proto,application/grpc-web-text',
      'x-codeium-csrf-token': csrfToken,
      'Connect-Protocol-Version': '1',
      'X-Grpc-Web': '1',
      'Content-Length': reqFrame.length,
    }
  };

  const req = http.request(options, (res) => {
    console.log(`[+] Response status: ${res.statusCode} ${res.statusMessage}`);
    const chunks = [];

    res.on('data', (chunk) => {
      chunks.push(chunk);
    });

    res.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      if (fullBuffer.length < 5) {
        console.error('[-] Received empty or invalid gRPC-Web response.');
        return;
      }

      const flags = fullBuffer.readUInt8(0);
      const payloadLength = fullBuffer.readUInt32BE(1);
      const payload = fullBuffer.subarray(5, 5 + payloadLength);

      console.log(`[+] Received ${payload.length} bytes of raw FlightRecorder trace.`);

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const traceFile = path.join(outDir, `flight_recorder_${timestamp}.trace`);
      fs.writeFileSync(traceFile, payload);

      console.log(`\n======================================================`);
      console.log(`[✓] Go Runtime Trace successfully saved to:`);
      console.log(`    ${traceFile}`);
      console.log(`\nTo view in browser interactive trace viewer, run:`);
      console.log(`    go tool trace "${traceFile}"`);
      console.log(`======================================================\n`);
    });
  });

  req.on('error', (err) => {
    console.error(`[-] Request failed: ${err.message}`);
    console.log('[*] Tip: Ensure Antigravity is running with Language Server Hub active.');
  });

  req.write(reqFrame);
  req.end();
}

function main() {
  const args = process.argv.slice(2);
  let port = null;
  let csrf = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i+1]) port = parseInt(args[i+1], 10);
    if (args[i] === '--csrf' && args[i+1]) csrf = args[i+1];
  }

  if (!port || !csrf) {
    console.log('[*] Auto-discovering Language Server PID, Port, and CSRF token...');
    const discovered = discoverLanguageServer();
    if (discovered) {
      console.log(`[+] Found Language Server PID ${discovered.pid} on port ${discovered.port}`);
      port = discovered.port;
      csrf = discovered.csrfToken;
    } else {
      console.log('[!] Auto-discovery could not detect active LS. Using defaults (55256).');
      port = port || 55256;
      csrf = csrf || '00000000-0000-0000-0000-000000000000';
    }
  }

  dumpFlightRecorder(port, csrf);
}

if (require.main === module) {
  main();
}

module.exports = { dumpFlightRecorder, discoverLanguageServer };
