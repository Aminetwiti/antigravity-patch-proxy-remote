import { discoverLocalHarness } from './discovery.js';
import { GrpcWebClient, buildStartCascade } from './grpcweb.js';
import { decodeFields } from './protobuf.js';

/**
 * Phase 1 CLI — validates the ConnectRPC/gRPC-Web protocol against the live
 * language_server (see remote/PROTOCOL.md). Run: npm run test:connect
 */

async function main() {
  console.log('🔍 Découverte du language_server...');
  const info = await discoverLocalHarness();
  if (!info) {
    console.error('❌ Échec découverte. Vérifiez que l’IDE Antigravity est ouvert.');
    process.exit(1);
  }

  console.log(`✅ language_server trouvé : PID=${info.pid} port=${info.connectRpcPort} type=${info.subclientType || '?'}`);
  console.log(`   CSRF: ${info.extensionCsrfToken.substring(0, 8)}...`);

  const client = new GrpcWebClient(info.connectRpcPort, info.extensionCsrfToken);

  // ── Test A : Heartbeat (probe la connexion + auth) ──────────────────────
  console.log('\n── Test A : Heartbeat ──');
  try {
    const res = await client.call('Heartbeat');
    console.log(`   Status: ${res.statusCode} | CT: ${res.contentType} | frames: ${res.frames.length}`);
    for (const f of res.frames) {
      console.log(`   Frame (${f.length} B): ${f.toString('utf8').substring(0, 120)}`);
    }
  } catch (e: any) {
    console.error(`   ❌ ${e.message}`);
  }

  // ── Test B : GetAllCascadeTrajectories ──────────────────────────────────
  console.log('\n── Test B : GetAllCascadeTrajectories ──');
  try {
    const res = await client.call('GetAllCascadeTrajectories');
    console.log(`   Status: ${res.statusCode} | frames: ${res.frames.length}`);
    res.frames.forEach((f, i) => {
      const fields = decodeFields(f);
      const summary = fields
        .map((x) => `#${x.fieldNum}:${x.wireType}=${x.value instanceof Uint8Array ? `${x.value.length}B` : x.value}`)
        .join(' ');
      console.log(`   Frame ${i} (${f.length} B) fields: ${summary}`);
    });
  } catch (e: any) {
    console.error(`   ❌ ${e.message}`);
  }

  // ── Test C : StartCascade (création de session) ─────────────────────────
  console.log('\n── Test C : StartCascade ──');
  const workspaceUri = 'file:///' + process.cwd().replace(/\\/g, '/');
  try {
    const payload = buildStartCascade(workspaceUri);
    const res = await client.call('StartCascade', payload);
    console.log(`   Status: ${res.statusCode} | frames: ${res.frames.length}`);
    res.frames.forEach((f, i) => {
      console.log(`   Frame ${i} (${f.length} B): ${f.toString('utf8').substring(0, 200)}`);
    });
  } catch (e: any) {
    console.error(`   ❌ ${e.message}`);
  }

  console.log('\n✅ Validation terminée.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
