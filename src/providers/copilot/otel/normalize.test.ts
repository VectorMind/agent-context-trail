import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTraceExport } from './normalize';
import fixture from './fixtures/real-trace-redacted.json';

test('normalizes only chat spans from the real capture (tools/embeddings ignored)', () => {
  const calls = normalizeTraceExport(fixture);
  // Fixture has 6 spans: 3 chat + 3 execute_tool.
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.operation === 'chat'));
});

test('maps the proven correlation keys and real per-call usage', () => {
  const calls = normalizeTraceExport(fixture);
  const turn = calls.find((c) => c.spanId === 'c7f5438ee46a6323');
  assert.ok(turn);
  assert.equal(turn.conversationId, 'bf40277b-cecd-4698-9d62-3b59f815e72c');
  assert.equal(turn.requestId, 'bd1af91e-ad02-47d8-b569-db2d5d11fe64');
  assert.equal(turn.traceId, 'd36d20a685446c1839e4dcd00a8ae64c');
  assert.equal(turn.parentSpanId, '3c3879f4a2576394');
  assert.equal(turn.resolvedModel, 'mai-code-1-flash');
  assert.equal(turn.inputTokens, 23800);
  assert.equal(turn.outputTokens, 539);
  assert.equal(turn.cacheReadTokens, 13184);
  assert.equal(turn.reasoningOutputTokens, 320);
  assert.equal(turn.contextWindowTokens, 127997);
  assert.equal(turn.maxOutputTokens, 128000);
  assert.equal(turn.timeToFirstTokenMs, 3816);
  assert.equal(turn.finishReason, 'stop');
  assert.equal(turn.premiumUsageNanoAiu, 1137630000);
  assert.equal(turn.sourceVersion, '0.57.0');
});

test('cache-write stays undefined (Copilot never emits it), not zero', () => {
  const calls = normalizeTraceExport(fixture);
  assert.ok(calls.every((c) => c.cacheCreationTokens === undefined));
});

test('a real emitted zero (cache_read on a fresh helper call) is kept as 0', () => {
  // Synthetic minimal span mirroring the observed helper-call shape.
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.version', value: { stringValue: '9.9.9' } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 't1',
                spanId: 's1',
                name: 'chat gpt-4o-mini',
                startTimeUnixNano: '1784575940000000000',
                endTimeUnixNano: '1784575941000000000',
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                  { key: 'gen_ai.usage.input_tokens', value: { intValue: 263 } },
                  { key: 'gen_ai.usage.cache_read.input_tokens', value: { intValue: 0 } }
                ],
                status: { code: 0 }
              }
            ]
          }
        ]
      }
    ]
  };
  const [call] = normalizeTraceExport(body);
  assert.equal(call.cacheReadTokens, 0);
  assert.equal(call.durationMs, 1000);
  assert.equal(call.conversationId, undefined); // helper span: no conversation id
});

test('big-nanosecond timestamps convert without precision loss', () => {
  const calls = normalizeTraceExport(fixture);
  const turn = calls.find((c) => c.spanId === 'c7f5438ee46a6323');
  // 1784575940394000000 ns == 1784575940394 ms == 2026-07-18T...Z
  assert.equal(turn?.timestamp, new Date(1784575940394).toISOString());
});

test('content/repo/git attributes never appear on any normalized record', () => {
  const calls = normalizeTraceExport(fixture);
  const serialized = JSON.stringify(calls);
  for (const banned of ['message', 'system_instruction', 'user_request', 'remote_url', 'commit', 'branch', 'definitions', 'reasoning_content']) {
    assert.ok(!serialized.toLowerCase().includes(banned), `normalized record leaked "${banned}"`);
  }
});

test('tolerates junk input without throwing', () => {
  assert.deepEqual(normalizeTraceExport(undefined), []);
  assert.deepEqual(normalizeTraceExport({}), []);
  assert.deepEqual(normalizeTraceExport({ resourceSpans: 'nope' }), []);
  assert.deepEqual(normalizeTraceExport({ resourceSpans: [{}] }), []);
});
