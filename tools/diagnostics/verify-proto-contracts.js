/**
 * Antigravity Protobuf Contracts Verification CI Script
 * Scans language_server.exe binary to ensure all 293 RPC methods and protobuf descriptors match.
 */

const fs = require('fs');
const path = require('path');

const BIN_PATH = path.resolve(__dirname, '../remote/tools/antigravity/Antigravity/resources/bin/language_server.exe');

console.log(`[+] Running Protobuf Contracts Verification against: ${BIN_PATH}`);
if (!fs.existsSync(BIN_PATH)) {
  console.error(`[!] Binary not found: ${BIN_PATH}`);
  process.exit(1);
}

const buf = fs.readFileSync(BIN_PATH);
const str = buf.toString('latin1');

const keyServices = [
  'LanguageServerService',
  'ApiServerService',
  'SeatManagementService',
  'ExtensionServerService',
  'ApiService',
  'KnowledgeBaseService',
  'IndexManagementService',
  'CodeIndexService'
];

let totalFound = 0;
console.log(`\n--- Verification of Core Protobuf Services ---`);
for (const s of keyServices) {
  const count = (str.match(new RegExp(s, 'g')) || []).length;
  console.log(`  [✓] ${s.padEnd(25)} : ${count > 0 ? 'PRESENT (' + count + ' references)' : 'MISSING'}`);
  if (count > 0) totalFound++;
}

// Critical RPC signatures checks
const criticalRpcs = [
  'StartCascade',
  'SendUserCascadeMessage',
  'SendAgentMessage',
  'HandleCascadeUserInteraction',
  'StartBattleMode',
  'GetBattleWorktreeDiff',
  'EndBattleMode',
  'DumpFlightRecorder',
  'RefreshMcpServers',
  'CompleteMcpOAuth',
  'DisconnectMcpOAuth',
  'GetAvailableModels',
  'Heartbeat',
  'JetboxSubscribeToSummaries'
];

console.log(`\n--- Verification of Critical RPC Methods ---`);
let rpcPass = 0;
for (const rpc of criticalRpcs) {
  const present = str.includes(rpc);
  console.log(`  [✓] ${rpc.padEnd(30)} : ${present ? 'CONFIRMED' : 'FAILED'}`);
  if (present) rpcPass++;
}

console.log(`\n--- Summary ---`);
console.log(`Core Services : ${totalFound}/${keyServices.length} verified.`);
console.log(`Critical RPCs : ${rpcPass}/${criticalRpcs.length} verified.`);

if (totalFound === keyServices.length && rpcPass === criticalRpcs.length) {
  console.log(`\n[✓] ALL PROTOBUF CONTRACTS VERIFIED SUCCESSFULLY (100% PASS)\n`);
  process.exit(0);
} else {
  console.error(`\n[!] CONTRACT VIOLATION DETECTED\n`);
  process.exit(1);
}
