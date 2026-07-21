import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { NormalizedCall, OTEL_SCHEMA_VERSION } from './types';
import {
  appendCalls,
  listPartitions,
  otelStorageDir,
  readAllCalls,
  readCallsForConversation,
  storageBytes
} from './storage';

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'act-otel-'));
}

function call(over: Partial<NormalizedCall>): NormalizedCall {
  return {
    timestamp: '2026-07-20T14:32:18.421Z',
    traceId: 't',
    spanId: 's',
    operation: 'chat',
    schemaVersion: OTEL_SCHEMA_VERSION,
    ...over
  };
}

test('appends calls into per-UTC-day partitions', () => {
  const base = tmpBase();
  appendCalls(base, [
    call({ spanId: 'a', timestamp: '2026-07-20T23:59:00.000Z' }),
    call({ spanId: 'b', timestamp: '2026-07-21T00:01:00.000Z' })
  ]);
  const parts = listPartitions(base);
  assert.deepEqual(parts.map((p) => p.date), ['2026-07-20', '2026-07-21']);
  assert.ok(fs.existsSync(path.join(otelStorageDir(base), '2026-07-20.jsonl')));
});

test('readAllCalls round-trips and dedupes by spanId across appends', () => {
  const base = tmpBase();
  appendCalls(base, [call({ spanId: 'x', inputTokens: 100 })]);
  appendCalls(base, [call({ spanId: 'x', inputTokens: 999 }), call({ spanId: 'y', inputTokens: 5 })]);
  const all = readAllCalls(base);
  assert.deepEqual(
    all.map((c) => c.spanId).sort(),
    ['x', 'y']
  );
  // First-seen wins on duplicate span id.
  assert.equal(all.find((c) => c.spanId === 'x')?.inputTokens, 100);
});

test('tolerates a partial trailing line and corrupt lines', () => {
  const base = tmpBase();
  appendCalls(base, [call({ spanId: 'good' })]);
  const file = path.join(otelStorageDir(base), '2026-07-20.jsonl');
  fs.appendFileSync(file, '{ this is not json\n');
  fs.appendFileSync(file, '{"spanId":"partial","operation":"chat"'); // no newline, truncated
  const all = readAllCalls(base);
  assert.deepEqual(all.map((c) => c.spanId), ['good']);
});

test('skips records written under a different schema version', () => {
  const base = tmpBase();
  fs.mkdirSync(otelStorageDir(base), { recursive: true });
  const file = path.join(otelStorageDir(base), '2026-07-20.jsonl');
  fs.writeFileSync(file, JSON.stringify({ ...call({ spanId: 'old' }), schemaVersion: 0 }) + '\n');
  assert.deepEqual(readAllCalls(base), []);
});

test('storageBytes reflects only written partitions; empty base is 0', () => {
  const base = tmpBase();
  assert.equal(storageBytes(base), 0);
  appendCalls(base, [call({ spanId: 'a' })]);
  assert.ok(storageBytes(base) > 0);
});

test('readCallsForConversation filters by conversation id', () => {
  const base = tmpBase();
  appendCalls(base, [
    call({ spanId: '1', conversationId: 'conv-A' }),
    call({ spanId: '2', conversationId: 'conv-B' }),
    call({ spanId: '3', conversationId: 'conv-A' })
  ]);
  const a = readCallsForConversation(base, 'conv-A');
  assert.deepEqual(a.map((c) => c.spanId).sort(), ['1', '3']);
});
