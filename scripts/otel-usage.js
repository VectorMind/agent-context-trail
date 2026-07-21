// Privacy-safe per-chat-span report (Phase 1). Prints usage/correlation fields
// in full, but for content/repo/git fields prints ONLY value length + whether
// populated — never the content itself. Confirms whether captureContent:false
// actually redacts values and which usage attributes are present.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '.tmp', 'copilot-otel-capture');

function attrVal(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(attrVal);
  if ('kvlistValue' in v) return '[kvlist]';
  return '[obj]';
}
function attrsToObj(attributes) {
  const o = {};
  for (const a of attributes || []) o[a.key] = attrVal(a.value);
  return o;
}
function len(v) {
  if (v === undefined || v === null) return 'ABSENT';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length === 0 ? 'EMPTY(0)' : `POPULATED(${s.length})`;
}

// Fields shown in full — safe usage/correlation/metadata.
const SAFE = [
  'gen_ai.conversation.id',
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.response.id',
  'gen_ai.response.finish_reasons',
  'gen_ai.request.max_tokens',
  'gen_ai.request.stream',
  'gen_ai.request.temperature',
  'gen_ai.request.top_p',
  'gen_ai.response.time_to_first_chunk',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'gen_ai.usage.reasoning.output_tokens',
  'gen_ai.usage.reasoning_tokens',
  'copilot_chat.chat_session_id',
  'copilot_chat.parent_chat_session_id',
  'copilot_chat.session_id',
  'copilot_chat.server_request_id',
  'copilot_chat.request.max_prompt_tokens',
  'copilot_chat.time_to_first_token',
  'copilot_chat.turn_count',
  'copilot_chat.copilot_usage_nano_aiu'
];
// Fields reported by length only — content / repo / git.
const CONTENT = [
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'copilot_chat.user_request',
  'copilot_chat.reasoning_content',
  'copilot_chat.request.options',
  'copilot_chat.request.shape',
  'copilot_chat.repo.remote_url',
  'copilot_chat.repo.head_branch_name',
  'copilot_chat.repo.head_commit_hash',
  'github.copilot.git.repository',
  'github.copilot.git.branch',
  'github.copilot.git.commit_sha',
  'github.copilot.github.org'
];

const metas = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json'));
const chatSpans = [];
for (const mf of metas) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, mf), 'utf8'));
  if (meta.url !== '/v1/traces') continue;
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, mf.replace('.meta.json', '.decoded.json')), 'utf8'));
  for (const rs of doc.resourceSpans || []) {
    for (const ss of rs.scopeSpans || []) {
      for (const span of ss.spans || []) {
        if (!span.name.startsWith('chat ')) continue;
        chatSpans.push({ span, obj: attrsToObj(span.attributes) });
      }
    }
  }
}

console.log(`=== ${chatSpans.length} chat spans ===\n`);
let i = 0;
for (const { span, obj } of chatSpans) {
  console.log(`--- chat span #${++i}: "${span.name}" ---`);
  console.log(`  traceId=${span.traceId}  spanId=${span.spanId}  parent=${span.parentSpanId}`);
  const startNs = Number(span.startTimeUnixNano);
  const endNs = Number(span.endTimeUnixNano);
  if (startNs && endNs) console.log(`  durationMs=${((endNs - startNs) / 1e6).toFixed(1)}`);
  console.log('  SAFE fields:');
  for (const k of SAFE) if (k in obj) console.log(`    ${k} = ${JSON.stringify(obj[k])}`);
  console.log('  CONTENT fields (length only):');
  for (const k of CONTENT) if (k in obj) console.log(`    ${k}: ${len(obj[k])}`);
  console.log('');
}
