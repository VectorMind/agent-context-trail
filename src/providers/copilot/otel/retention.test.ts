import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { PartitionInfo } from './storage';
import { planRetention, retentionCutoff, runRetention } from './retention';
import { appendCalls, listPartitions } from './storage';
import { NormalizedCall, OTEL_SCHEMA_VERSION } from './types';

function part(date: string, bytes: number): PartitionInfo {
  return { date, filePath: `/x/${date}.jsonl`, bytes };
}

test('cutoff keeps the current month plus two preceding months', () => {
  // 2026-07-20 -> retain from 2026-05-01 (May, June, July).
  assert.equal(retentionCutoff(new Date('2026-07-20T12:00:00Z'), 3), '2026-05-01');
});

test('cutoff crosses a year boundary correctly', () => {
  // 2026-01-15 with 3 months -> Nov, Dec, Jan -> 2025-11-01.
  assert.equal(retentionCutoff(new Date('2026-01-15T00:00:00Z'), 3), '2025-11-01');
});

test('time policy removes whole months older than the cutoff', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  const plan = planRetention(
    [part('2026-04-30', 10), part('2026-05-01', 10), part('2026-07-20', 10)],
    now,
    { capBytes: 1_000 }
  );
  assert.deepEqual(plan.remove.map((r) => r.date), ['2026-04-30']);
  assert.equal(plan.remove[0].reason, 'time');
  assert.deepEqual(plan.retained.map((r) => r.date), ['2026-05-01', '2026-07-20']);
});

test('size cap drops oldest survivors first, preserving newest reporting months', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  const plan = planRetention(
    [part('2026-05-01', 100), part('2026-06-01', 100), part('2026-07-01', 100)],
    now,
    { capBytes: 150 }
  );
  // All three are within the time window; cap 150 forces dropping oldest until <=150.
  assert.deepEqual(
    plan.remove.map((r) => `${r.date}:${r.reason}`),
    ['2026-05-01:size', '2026-06-01:size']
  );
  assert.deepEqual(plan.retained.map((r) => r.date), ['2026-07-01']);
  assert.equal(plan.bytesAfter, 100);
});

test('nothing removed when within window and under cap', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  const plan = planRetention([part('2026-06-01', 100), part('2026-07-01', 100)], now, { capBytes: 1_000 });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.bytesAfter, 200);
});

test('runRetention deletes real expired partitions and logs each removal', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'act-otel-ret-'));
  const mk = (over: Partial<NormalizedCall>): NormalizedCall => ({
    timestamp: '2026-01-01T00:00:00.000Z',
    traceId: 't',
    spanId: 's',
    operation: 'chat',
    schemaVersion: OTEL_SCHEMA_VERSION,
    ...over
  });
  appendCalls(base, [mk({ spanId: 'old', timestamp: '2026-01-10T00:00:00.000Z' })]);
  appendCalls(base, [mk({ spanId: 'new', timestamp: '2026-07-10T00:00:00.000Z' })]);

  const logs: string[] = [];
  const plan = runRetention(base, new Date('2026-07-20T00:00:00Z'), {}, (m) => logs.push(m));

  assert.deepEqual(plan.remove.map((r) => r.date), ['2026-01-10']);
  assert.deepEqual(listPartitions(base).map((p) => p.date), ['2026-07-10']);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /removed 2026-01-10\.jsonl \(time/);
});
