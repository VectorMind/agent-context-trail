// One-off analysis of captured Copilot OTel traces (Phase 1 fixture proof).
// Reads .tmp/copilot-otel-capture/*.meta.json + .decoded.json, filters to
// /v1/traces, and summarizes span names, the union of attribute keys (to build
// the allowlist and spot any content leakage), gen_ai.* usage examples, and the
// trace/span/parent hierarchy. Prints compact output only.

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
  return JSON.stringify(v);
}

function attrsToObj(attributes) {
  const o = {};
  for (const a of attributes || []) o[a.key] = attrVal(a.value);
  return o;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json'));
const traceFiles = [];
for (const mf of files) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, mf), 'utf8'));
  if (meta.url === '/v1/traces') {
    traceFiles.push(mf.replace('.meta.json', '.decoded.json'));
  }
}

const spanNames = new Map();
const attrKeys = new Set();
const resourceAttrKeys = new Set();
const scopeNames = new Set();
const genAiExamples = [];
let totalSpans = 0;
const perFileSpanCounts = [];

for (const df of traceFiles.sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, df), 'utf8'));
  let fileSpans = 0;
  for (const rs of doc.resourceSpans || []) {
    for (const a of rs.resource?.attributes || []) resourceAttrKeys.add(a.key);
    for (const ss of rs.scopeSpans || []) {
      if (ss.scope?.name) scopeNames.add(ss.scope.name);
      for (const span of ss.spans || []) {
        totalSpans++;
        fileSpans++;
        spanNames.set(span.name, (spanNames.get(span.name) || 0) + 1);
        const obj = attrsToObj(span.attributes);
        for (const k of Object.keys(obj)) attrKeys.add(k);
        const genAi = Object.keys(obj).filter((k) => k.startsWith('gen_ai'));
        if (genAi.length && genAiExamples.length < 6 && span.name.includes('chat')) {
          genAiExamples.push({
            file: df,
            name: span.name,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            genAi: Object.fromEntries(genAi.map((k) => [k, obj[k]]))
          });
        }
      }
    }
  }
  perFileSpanCounts.push(`${df.slice(11, 19)} ${df.match(/_(\d+)\./)[1]}: ${fileSpans} spans`);
}

console.log('=== trace files:', traceFiles.length, ' total spans:', totalSpans, '===');
console.log('\n--- span names (count) ---');
for (const [n, c] of [...spanNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.toString().padStart(4)}  ${n}`);
console.log('\n--- scope names ---');
for (const s of scopeNames) console.log('  ' + s);
console.log('\n--- resource attribute keys ---');
for (const k of [...resourceAttrKeys].sort()) console.log('  ' + k);
console.log('\n--- ALL span attribute keys (union) ---');
for (const k of [...attrKeys].sort()) console.log('  ' + k);
console.log('\n--- gen_ai example spans ---');
console.log(JSON.stringify(genAiExamples, null, 2));
console.log('\n--- spans per trace file ---');
for (const l of perFileSpanCounts) console.log('  ' + l);
