// Privacy-safe: reconstruct a chatSessions doc and report, per request, the
// path/value of responseId + round count + model — to finalize the OTel join.
// Prints structure only, never message/tool content.
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const F = process.argv[2];
if (!F) { console.error('usage: node otel-find-path.js <session.jsonl>'); process.exit(1); }

function getAt(root, p) { let c = root; for (const s of p) { if (c == null || typeof c !== 'object') return undefined; c = c[s]; } return c; }
function setAt(root, p, v) { let c = root; for (let i=0;i<p.length-1;i++){ const s=p[i]; if(c[s]==null||typeof c[s]!=='object') c[s]= typeof p[i+1]==='number'?[]:{}; c=c[s]; } c[p[p.length-1]]=v; }

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(F, { encoding: 'utf8' }), crlfDelay: Infinity });
  let doc = { requests: [] };
  for await (const line of rl) {
    const t = line.trim(); if (!t) continue; let op; try { op = JSON.parse(t); } catch { continue; }
    if (op.kind === 0) { doc = op.v ?? doc; if (!Array.isArray(doc.requests)) doc.requests = []; }
    else if (op.kind === 1 && op.k) setAt(doc, op.k, op.v);
    else if (op.kind === 2 && op.k && Array.isArray(op.v)) { const a = getAt(doc, op.k); if (Array.isArray(a)) a.push(...op.v); }
  }
  const reqs = doc.requests || [];
  console.log(`sessionId=${doc.sessionId} requests=${reqs.length}`);
  reqs.forEach((r, i) => {
    // search for a responseId-looking key anywhere shallow in the request
    const paths = [];
    (function walk(o, p, d) {
      if (d > 4 || o == null || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (/responseId/i.test(k)) paths.push(`${[...p, k].join('.')} = ${JSON.stringify(o[k]).slice(0,45)}`);
        else if (typeof o[k] === 'object') walk(o[k], [...p, k], d + 1);
      }
    })(r, [], 0);
    const rounds = r.result?.metadata?.toolCallRounds?.length ?? 0;
    console.log(`  #${i} id=${r.requestId ?? r.id ?? '?'} model=${r.result?.metadata?.resolvedModel ?? r.modelId ?? '?'} rounds=${rounds} responseIdPaths=[${paths.join(' | ')}]`);
  });
}
main();
