/**
 * Deep Inspection of Phase 5 Targets in language_server.exe
 * Dissects exact formulas (RRF vs weighted), State Machine transitions,
 * Tool Dispatchers, Subagent lifetimes, MCP transports, Sidecars, and Compaction.
 */
const fs = require('fs');
const path = require('path');

const BIN_PATH = path.resolve(__dirname, '../remote/tools/antigravity/Antigravity/resources/bin/language_server.exe');
console.log(`[+] Reading language_server.exe...`);
const buf = fs.readFileSync(BIN_PATH);
const strBuf = buf.toString('latin1');

// 1. RAG Ranking Formula Search (RRF vs Weighted)
console.log(`[+] Investigating RAG / Code Index ranking formula...`);
const rankingTerms = [
  'ReciprocalRankFusion',
  'reciprocal_rank',
  'rrf_k',
  'rrfScore',
  'CombineScores',
  'BM25Score',
  'CosineScore',
  'HybridRanking',
  'lexical_weight',
  'semantic_weight',
  'vector_weight',
  'score_fusion'
];

const ragFindings = [];
rankingTerms.forEach(term => {
  let pos = 0;
  while ((pos = strBuf.indexOf(term, pos)) !== -1) {
    const snippet = strBuf.substring(Math.max(0, pos - 80), Math.min(strBuf.length, pos + 160)).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
    ragFindings.push({ term, offset: pos, snippet });
    pos += term.length;
  }
});

// 2. State Machine Transitions & Call Graph
console.log(`[+] Inspecting Cortex Planner State Machine transitions...`);
const smTerms = [
  'NewAgentExecutor',
  'ProcessStep',
  'ExecuteTurn',
  'HandleInteraction',
  'StepRecovery',
  'SummarizeConversation',
  'TruncateContext',
  'RevertStep',
  'ForkTrajectory',
  'SendToBackground',
  'AutoAcceptHeuristic',
  'CommandRuleSet',
  'ApprovalPolicy'
];

const smFindings = [];
smTerms.forEach(term => {
  let pos = 0;
  let matches = 0;
  while ((pos = strBuf.indexOf(term, pos)) !== -1 && matches < 10) {
    const snippet = strBuf.substring(Math.max(0, pos - 80), Math.min(strBuf.length, pos + 200)).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
    smFindings.push({ term, offset: pos, snippet });
    pos += term.length;
    matches++;
  }
});

// 3. MCP Transports & Lifecycle
console.log(`[+] Inspecting MCP Transports & Connection Manager...`);
const mcpTerms = [
  'mcpcore',
  'StdioClient',
  'SSEClient',
  'CompleteOAuth',
  'DisconnectOAuth',
  'RefreshMcp',
  'CallTool',
  'ListTools',
  'ListResources',
  'ReadResource'
];

const mcpFindings = [];
mcpTerms.forEach(term => {
  let pos = 0;
  let matches = 0;
  while ((pos = strBuf.indexOf(term, pos)) !== -1 && matches < 10) {
    const snippet = strBuf.substring(Math.max(0, pos - 80), Math.min(strBuf.length, pos + 200)).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
    mcpFindings.push({ term, offset: pos, snippet });
    pos += term.length;
    matches++;
  }
});

// 4. Subagents Lifecycle
console.log(`[+] Inspecting Subagents delegation and depth limit...`);
const subagentTerms = [
  'SubagentExecutor',
  'SpawnSubagent',
  'subagent_depth',
  'max_subagent_depth',
  'ParentConversation',
  'ChildConversation',
  'BrowserSubagent'
];

const subagentFindings = [];
subagentTerms.forEach(term => {
  let pos = 0;
  let matches = 0;
  while ((pos = strBuf.indexOf(term, pos)) !== -1 && matches < 10) {
    const snippet = strBuf.substring(Math.max(0, pos - 80), Math.min(strBuf.length, pos + 200)).replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');
    subagentFindings.push({ term, offset: pos, snippet });
    pos += term.length;
    matches++;
  }
});

// 5. Save Output
const results = {
  ragFindings,
  smFindings,
  mcpFindings,
  subagentFindings
};

const OUT_PATH = path.resolve(__dirname, '../scratch/phase5_deep_findings.json');
fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
console.log(`[+] Findings written to ${OUT_PATH}`);
