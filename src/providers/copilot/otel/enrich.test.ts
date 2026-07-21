import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_USAGE, PromptRequest } from '../../../domain/types';
import { PricingService } from '../../../pricing/pricingService';
import { NormalizedCall, OTEL_SCHEMA_VERSION } from './types';
import { applyOtelEnrichment, groupCallsByRequestId } from './enrich';
import { normalizeTraceExport } from './normalize';
import fixture from './fixtures/real-trace-redacted.json';

// PricingService needs the extension root to load the rate table; tests run
// from the repo root, so that is the extension path here.
const pricing = new PricingService(process.cwd());

function req(index: number, over: Partial<PromptRequest> = {}): PromptRequest {
  return {
    id: `req-${index}`,
    index,
    startedAt: '2026-07-20T00:00:00.000Z',
    model: 'mai-code-1-flash',
    usage: { ...EMPTY_USAGE },
    cost: { usd: 0, source: 'estimated' },
    toolCallCount: 0,
    ...over
  };
}

function call(over: Partial<NormalizedCall>): NormalizedCall {
  return {
    timestamp: '2026-07-20T00:00:00.000Z',
    traceId: 't',
    spanId: 's',
    operation: 'chat',
    schemaVersion: OTEL_SCHEMA_VERSION,
    ...over
  };
}

test('groups calls by request id and orders each group by time', () => {
  const grouped = groupCallsByRequestId([
    call({ spanId: 'b', requestId: 'R', timestamp: '2026-07-20T00:00:02.000Z' }),
    call({ spanId: 'a', requestId: 'R', timestamp: '2026-07-20T00:00:01.000Z' }),
    call({ spanId: 'c', requestId: 'other', timestamp: '2026-07-20T00:00:00.000Z' })
  ]);
  assert.deepEqual(grouped.get('R')?.map((c) => c.spanId), ['a', 'b']);
});

test('enriches the matching request with real per-call context; splits fresh vs cache', () => {
  const calls = normalizeTraceExport(fixture).filter((c) => c.conversationId); // the mai-code turn
  const responseId = calls[0].requestId; // bd1af91e...
  const requests = [req(0, { id: 'unmatched' }), req(1)];
  const enriched = applyOtelEnrichment(requests, [undefined, responseId], calls, pricing);

  // Unmatched request untouched.
  assert.equal(enriched[0].llmCalls, undefined);

  const turn = enriched[1];
  assert.ok(turn.llmCalls && turn.llmCalls.length >= 1);
  assert.equal(turn.llmCallCount, turn.llmCalls.length);
  const first = turn.llmCalls[0];
  // Span c7f5438…: input 23800 total, cache_read 13184 -> fresh 10616, context 23800.
  assert.equal(first.contextTokens, 23800);
  assert.equal(first.cacheReadTokens, 13184);
  assert.equal(first.inputTokens, 10616);
  assert.equal(first.outputTokens, 539);
  assert.equal(first.reasoningOutputTokens, 320);
  assert.equal(first.cacheCreationTokens, undefined); // never fabricated
  assert.equal(first.modelContextWindow, 127997);
  assert.ok((first.costUsd ?? 0) > 0);
});

test('no matching responseId leaves requests unchanged', () => {
  const calls = normalizeTraceExport(fixture).filter((c) => c.conversationId);
  const requests = [req(0)];
  const enriched = applyOtelEnrichment(requests, ['does-not-match'], calls, pricing);
  assert.equal(enriched[0].llmCalls, undefined);
  assert.equal(enriched[0], requests[0]); // same object, untouched
});

test('empty otel calls returns the input requests as-is', () => {
  const requests = [req(0)];
  assert.equal(applyOtelEnrichment(requests, ['x'], [], pricing), requests);
});
