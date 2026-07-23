import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cacheWriteShare,
  costBubbleRadius,
  COST_BUBBLE_MAX_RADIUS,
  COST_BUBBLE_MIN_RADIUS,
  deriveCostMapPoints,
  isoGrowthDeltas,
  isoRateSlopes,
  iterationScale,
  iterationT,
  niceStep,
  overlapOffsets,
  withinRollingWindow
} from './costMap';
import { EMPTY_USAGE, LlmCallInfo, PromptRequest } from './types';

function llmCall(index: number, contextTokens?: number): LlmCallInfo {
  return { index, contextTokens };
}

function request(overrides: Partial<PromptRequest> & { index: number }): PromptRequest {
  return {
    id: `req-${overrides.index}`,
    startedAt: '2026-07-19T10:00:00.000Z',
    model: 'claude-sonnet-5',
    usage: { ...EMPTY_USAGE },
    cost: { usd: 1, source: 'estimated' },
    toolCallCount: 0,
    ...overrides
  };
}

// ---- deriveCostMapPoints ----------------------------------------------------

test('derives start/end/delta/iterations from the first and last LLM calls', () => {
  const d = deriveCostMapPoints(
    [request({ index: 0, toolCallCount: 3, llmCalls: [llmCall(0, 10_000), llmCall(1, 40_000), llmCall(2, 55_000)] })],
    { id: 'conv-1', title: 'T' }
  );
  assert.equal(d.points.length, 1);
  const p = d.points[0];
  assert.equal(p.startContext, 10_000);
  assert.equal(p.endContext, 55_000);
  assert.equal(p.contextDelta, 45_000);
  assert.equal(p.iterations, 3);
  assert.equal(p.toolCalls, 3);
  assert.equal(p.contextWork, 105_000);
  assert.equal(p.conversationId, 'conv-1');
  assert.equal(d.totalPrompts, 1);
  assert.equal(d.excludedPrompts, 0);
});

test('a one-call prompt is valid: start equals end, delta zero, one iteration', () => {
  const d = deriveCostMapPoints([request({ index: 0, llmCalls: [llmCall(0, 20_000)] })]);
  assert.equal(d.points.length, 1);
  assert.equal(d.points[0].startContext, 20_000);
  assert.equal(d.points[0].endContext, 20_000);
  assert.equal(d.points[0].contextDelta, 0);
  assert.equal(d.points[0].iterations, 1);
});

test('negative deltas (compaction) are preserved, never clamped', () => {
  const d = deriveCostMapPoints([request({ index: 0, llmCalls: [llmCall(0, 300_000), llmCall(1, 40_000)] })]);
  assert.equal(d.points[0].contextDelta, -260_000);
});

test('a prompt with no LLM calls is excluded with its own reason', () => {
  const d = deriveCostMapPoints([request({ index: 0, llmCalls: [] }), request({ index: 1 })]);
  assert.equal(d.points.length, 0);
  assert.equal(d.excludedPrompts, 2);
  assert.equal(d.reasons.noLlmCalls, 2);
});

test('a missing first-call context excludes the prompt; later values are never substituted', () => {
  const d = deriveCostMapPoints([request({ index: 0, llmCalls: [llmCall(0, undefined), llmCall(1, 50_000)] })]);
  assert.equal(d.points.length, 0);
  assert.equal(d.reasons.missingFirstContext, 1);
  assert.equal(d.reasons.missingLastContext, 0);
});

test('a missing last-call context excludes the prompt; earlier values are never substituted', () => {
  const d = deriveCostMapPoints([request({ index: 0, llmCalls: [llmCall(0, 50_000), llmCall(1, undefined)] })]);
  assert.equal(d.points.length, 0);
  assert.equal(d.reasons.missingLastContext, 1);
});

test('unavailable cost excludes the prompt; reasons count every failed criterion', () => {
  const d = deriveCostMapPoints([
    request({ index: 0, cost: { source: 'unavailable' }, llmCalls: [llmCall(0, undefined)] })
  ]);
  assert.equal(d.points.length, 0);
  assert.equal(d.excludedPrompts, 1);
  // one prompt, three failed criteria (first == last call here, both missing)
  assert.equal(d.reasons.missingFirstContext, 1);
  assert.equal(d.reasons.missingLastContext, 1);
  assert.equal(d.reasons.costUnavailable, 1);
});

test('zero cost is chartable data, not an unavailable state', () => {
  const d = deriveCostMapPoints([request({ index: 0, cost: { usd: 0, source: 'estimated' }, llmCalls: [llmCall(0, 1_000)] })]);
  assert.equal(d.points.length, 1);
  assert.equal(d.points[0].costUsd, 0);
});

test('points carry the request own index, not the array position', () => {
  const d = deriveCostMapPoints([request({ index: 7, llmCalls: [llmCall(0, 1_000)] })]);
  assert.equal(d.points[0].promptIndex, 7);
});

test('contextWork sums only the known per-call context values', () => {
  const d = deriveCostMapPoints([
    request({ index: 0, llmCalls: [llmCall(0, 10_000), llmCall(1, undefined), llmCall(2, 30_000)] })
  ]);
  assert.equal(d.points[0].contextWork, 40_000);
});

// ---- rolling window ---------------------------------------------------------

test('withinRollingWindow: All time accepts everything with a parsable date', () => {
  assert.equal(withinRollingWindow('2020-01-01T00:00:00Z', undefined, Date.now()), true);
});

test('withinRollingWindow: boundary is inclusive, older is out, garbage is out', () => {
  const now = Date.parse('2026-07-19T12:00:00Z');
  const cutoff = '2026-07-12T12:00:00.000Z'; // exactly 7 days before
  assert.equal(withinRollingWindow(cutoff, 7, now), true);
  assert.equal(withinRollingWindow('2026-07-12T11:59:59.999Z', 7, now), false);
  assert.equal(withinRollingWindow('not-a-date', 7, now), false);
});

// ---- bubble scaling (OP-005) ------------------------------------------------

test('costBubbleRadius: area stays proportional to cost between the bounds', () => {
  const rMax = costBubbleRadius(8, 8);
  const rQuarter = costBubbleRadius(2, 8);
  assert.equal(rMax, COST_BUBBLE_MAX_RADIUS);
  // quarter the cost -> quarter the area -> half the radius
  assert.ok(Math.abs(rQuarter - rMax / 2) < 1e-9);
});

test('costBubbleRadius: zero and near-zero costs keep a visible minimum', () => {
  assert.equal(costBubbleRadius(0, 10), COST_BUBBLE_MIN_RADIUS);
  assert.equal(costBubbleRadius(0.0001, 100), COST_BUBBLE_MIN_RADIUS);
});

test('costBubbleRadius: an all-zero scope falls back to the minimum, not NaN', () => {
  assert.equal(costBubbleRadius(0, 0), COST_BUBBLE_MIN_RADIUS);
});

// ---- iteration gradient (OP-004) --------------------------------------------

test('iterationScale/iterationT: visible min→max maps to 0→1', () => {
  const scale = iterationScale([3, 10, 120]);
  assert.deepEqual(scale, { min: 3, max: 120, single: false });
  assert.equal(iterationT(3, scale), 0);
  assert.equal(iterationT(120, scale), 1);
  assert.ok(iterationT(10, scale) > 0 && iterationT(10, scale) < 1);
});

test('iterationScale: a single-valued scope collapses to the midpoint, not a false range', () => {
  const scale = iterationScale([5, 5, 5]);
  assert.equal(scale.single, true);
  assert.equal(iterationT(5, scale), 0.5);
});

// ---- guides (DD-005) --------------------------------------------------------

test('isoGrowthDeltas: nice steps under the largest positive delta', () => {
  // probe-shaped data: max positive delta 263K -> 100K step -> 100K, 200K
  assert.deepEqual(isoGrowthDeltas([{ contextDelta: 263_000 }, { contextDelta: -10_000 }]), [100_000, 200_000]);
});

test('isoGrowthDeltas: no positive growth means no guides', () => {
  assert.deepEqual(isoGrowthDeltas([{ contextDelta: 0 }, { contextDelta: -5_000 }]), []);
});

test('isoGrowthDeltas: a ceiling fills the whole range past the data max delta', () => {
  // small data delta (113K) but a 300K plot -> guides every 50K up to (not incl.) 300K
  assert.deepEqual(
    isoGrowthDeltas([{ contextDelta: 113_489 }], 3, 300_000),
    [50_000, 100_000, 150_000, 200_000, 250_000]
  );
});

test('isoGrowthDeltas: a ceiling still yields nothing without positive growth', () => {
  assert.deepEqual(isoGrowthDeltas([{ contextDelta: -5_000 }], 3, 300_000), []);
});

test('niceStep picks the smallest 1/2/5 step covering the rough value', () => {
  assert.equal(niceStep(88_000), 100_000);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(1), 1);
});

// ---- calls-variant helpers (plans/2026-07/23/cost-map-calls-variant) --------

test('cacheWriteShare: cache-write tokens over the total of all four series', () => {
  const share = cacheWriteShare({ ...EMPTY_USAGE, cacheReadTokens: 700, cacheCreationTokens: 200, inputTokens: 50, outputTokens: 50 });
  assert.equal(share, 0.2);
});

test('cacheWriteShare: no tokens at all means 0, not NaN', () => {
  assert.equal(cacheWriteShare({ ...EMPTY_USAGE }), 0);
});

test('isoRateSlopes: nice tokens-per-call steps up to the steepest visible slope', () => {
  // steepest slope: 210K work / 2 calls = 105K tok/call -> 50K step (105K/4 -> 26.25K -> 50K)
  const slopes = isoRateSlopes([
    { iterations: 2, contextWork: 210_000 },
    { iterations: 10, contextWork: 100_000 }
  ]);
  assert.deepEqual(slopes, [50_000, 100_000]);
});

test('isoRateSlopes: zero work means no rays', () => {
  assert.deepEqual(isoRateSlopes([{ iterations: 3, contextWork: 0 }]), []);
});

test('isoRateSlopes: always yields at least one ray when there is positive work', () => {
  const slopes = isoRateSlopes([{ iterations: 1, contextWork: 1 }]);
  assert.ok(slopes.length >= 1);
});

// ---- overlap handling (DD-013) ----------------------------------------------

test('overlapOffsets: distinct positions stay untouched', () => {
  const offsets = overlapOffsets([
    { x: 0, y: 0 },
    { x: 50, y: 50 }
  ]);
  assert.deepEqual(offsets, [
    { dx: 0, dy: 0, overlap: 1 },
    { dx: 0, dy: 0, overlap: 1 }
  ]);
});

test('overlapOffsets: identical positions fan out deterministically and stay distinct', () => {
  const positions = [
    { x: 10, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 10 }
  ];
  const a = overlapOffsets(positions);
  const b = overlapOffsets(positions);
  assert.deepEqual(a, b); // deterministic
  assert.ok(a.every((o) => o.overlap === 3));
  assert.deepEqual(a[0], { dx: 0, dy: 0, overlap: 3 }); // first stays centered
  const keys = a.map((o) => `${o.dx.toFixed(3)}|${o.dy.toFixed(3)}`);
  assert.equal(new Set(keys).size, 3); // every point remains individually reachable
});
