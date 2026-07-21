// Build a committable, content-stripped fixture from the real Copilot OTel
// trace captures (Phase 1 proof). Keeps the true OTLP/JSON ResourceSpans
// structure and all usage/correlation/metadata attributes, but DROPS every
// content, repo, and git attribute so nothing sensitive is committed. This is
// the allowlist's inverse applied at fixture time; the production receiver will
// apply the same drop before any persistence.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '.tmp', 'copilot-otel-capture');
const OUT_DIR = path.join(__dirname, '..', 'src', 'providers', 'copilot', 'otel', 'fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Attributes dropped before commit: content, repo/git, and free-form blobs.
const DROP = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.description',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'copilot_chat.user_request',
  'copilot_chat.reasoning_content',
  'copilot_chat.debug_log_label',
  'copilot_chat.request.options',
  'copilot_chat.request.shape',
  'copilot_chat.repo.remote_url',
  'copilot_chat.repo.head_branch_name',
  'copilot_chat.repo.head_commit_hash',
  'github.copilot.git.repository',
  'github.copilot.git.branch',
  'github.copilot.git.commit_sha',
  'github.copilot.github.org'
]);

const metas = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json'));
const kept = [];
const dropped = new Map();

for (const mf of metas.sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, mf), 'utf8'));
  if (meta.url !== '/v1/traces') continue;
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, mf.replace('.meta.json', '.decoded.json')), 'utf8'));
  for (const rs of doc.resourceSpans || []) {
    for (const ss of rs.scopeSpans || []) {
      for (const span of ss.spans || []) {
        span.attributes = (span.attributes || []).filter((a) => {
          if (DROP.has(a.key)) {
            dropped.set(a.key, (dropped.get(a.key) || 0) + 1);
            return false;
          }
          return true;
        });
      }
    }
  }
  kept.push({ envelope: doc, seq: meta.seq });
}

// One representative multi-round trace fixture: the largest by span count.
let best = null;
let bestSpans = -1;
for (const k of kept) {
  let n = 0;
  for (const rs of k.envelope.resourceSpans || []) for (const ss of rs.scopeSpans || []) n += (ss.spans || []).length;
  if (n > bestSpans) {
    bestSpans = n;
    best = k;
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'real-trace-redacted.json'), JSON.stringify(best.envelope, null, 2));

console.log(`kept ${kept.length} trace envelopes; representative fixture has ${bestSpans} spans`);
console.log('dropped content/repo attributes (key: occurrences):');
for (const [k, c] of [...dropped.entries()].sort()) console.log(`  ${k}: ${c}`);
console.log(`\nfixture written: src/providers/copilot/otel/fixtures/real-trace-redacted.json`);
