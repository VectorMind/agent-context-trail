import { CostSource, PromptRequest, UsageTokens } from './types';

// Prompt cost map derivation (plans/2026-07/19/prompt-cost-map, Option A).
// Pure functions shared by the webview (Selected conversation scope) and the
// extension host (Selected period projection): no DOM, no vscode, no fs.

/** One chartable prompt in the Prompt cost map. */
export interface CostMapPoint {
  /** The request's own 0-based index within its conversation (PromptRequest.index). */
  promptIndex: number;
  startedAt: string;
  /** Context tokens on the first recorded LLM call (DD-002: never substituted). */
  startContext: number;
  /** Context tokens on the last recorded LLM call (DD-003: never substituted). */
  endContext: number;
  /** endContext - startContext; negative means compaction/reset, never clamped (DD-004). */
  contextDelta: number;
  /** Number of recorded LLM calls (OP-003: LLM calls only, tools excluded). */
  iterations: number;
  /** Tooltip/detail value only, never a plot channel (DD-006). */
  toolCalls: number;
  /** Sum of the known per-LLM-call context tokens (DD-007: tooltip diagnostic). */
  contextWork: number;
  costUsd: number;
  costSource: CostSource;
  model?: string;
  modelsUsed?: string[];
  usage: UsageTokens;
  /** Set only on period-mode projections, where points span conversations. */
  conversationId?: string;
  conversationTitle?: string;
}

/**
 * Why a prompt is not plotted (DD-010). A prompt can fail several criteria at
 * once; each failed criterion is counted, so the counts explain the data
 * honestly rather than summing to the number of excluded prompts.
 */
export interface CostMapExclusions {
  noLlmCalls: number;
  missingFirstContext: number;
  missingLastContext: number;
  costUnavailable: number;
}

export interface CostMapDerivation {
  points: CostMapPoint[];
  totalPrompts: number;
  excludedPrompts: number;
  reasons: CostMapExclusions;
}

export function emptyExclusions(): CostMapExclusions {
  return { noLlmCalls: 0, missingFirstContext: 0, missingLastContext: 0, costUnavailable: 0 };
}

export function addExclusions(a: CostMapExclusions, b: CostMapExclusions): CostMapExclusions {
  return {
    noLlmCalls: a.noLlmCalls + b.noLlmCalls,
    missingFirstContext: a.missingFirstContext + b.missingFirstContext,
    missingLastContext: a.missingLastContext + b.missingLastContext,
    costUnavailable: a.costUnavailable + b.costUnavailable
  };
}

/**
 * Projects one conversation's requests to chart points plus explicit
 * exclusion counts. Missing data is never converted to zero: a prompt is
 * chartable only when its first and last LLM calls both expose contextTokens
 * and its prompt-level cost is usable.
 */
export function deriveCostMapPoints(
  requests: PromptRequest[],
  conversation?: { id: string; title?: string }
): CostMapDerivation {
  const points: CostMapPoint[] = [];
  const reasons = emptyExclusions();
  let excludedPrompts = 0;

  for (const request of requests) {
    const llmCalls = request.llmCalls ?? [];
    if (llmCalls.length === 0) {
      reasons.noLlmCalls += 1;
      excludedPrompts += 1;
      continue;
    }
    const start = llmCalls[0].contextTokens;
    const end = llmCalls[llmCalls.length - 1].contextTokens;
    const cost = request.cost.usd;
    let excluded = false;
    if (start === undefined) {
      reasons.missingFirstContext += 1;
      excluded = true;
    }
    if (end === undefined) {
      reasons.missingLastContext += 1;
      excluded = true;
    }
    if (cost === undefined) {
      reasons.costUnavailable += 1;
      excluded = true;
    }
    if (excluded || start === undefined || end === undefined || cost === undefined) {
      excludedPrompts += 1;
      continue;
    }

    let contextWork = 0;
    for (const call of llmCalls) {
      if (call.contextTokens !== undefined) contextWork += call.contextTokens;
    }

    points.push({
      promptIndex: request.index,
      startedAt: request.startedAt,
      startContext: start,
      endContext: end,
      contextDelta: end - start,
      iterations: llmCalls.length,
      toolCalls: request.toolCallCount,
      contextWork,
      costUsd: cost,
      costSource: request.cost.source,
      model: request.model,
      modelsUsed: request.modelsUsed,
      usage: request.usage,
      conversationId: conversation?.id,
      conversationTitle: conversation?.title
    });
  }

  return { points, totalPrompts: requests.length, excludedPrompts, reasons };
}

// ---- period filter (Selected period mode, product-scope.md narrow exception) ----

/** True when `startedAt` falls inside the rolling window; undefined days = All time. */
export function withinRollingWindow(startedAt: string, days: number | undefined, nowMs: number): boolean {
  if (days === undefined) return true;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return false;
  return t >= nowMs - days * 24 * 60 * 60 * 1000;
}

// ---- visual scales (OP-004, OP-005) — pure so they are unit-testable ----

export const COST_BUBBLE_MIN_RADIUS = 4;
export const COST_BUBBLE_MAX_RADIUS = 24;

/**
 * Cost maps to bubble AREA, not radius (OP-005): radius grows with the square
 * root of cost, scaled so the most expensive visible prompt gets `maxR`. A
 * visible minimum keeps zero/near-zero costs findable; the bound keeps one
 * outlier from covering the plot (below the minimum, area proportionality is
 * intentionally traded for visibility).
 */
export function costBubbleRadius(
  costUsd: number,
  maxCostUsd: number,
  minR = COST_BUBBLE_MIN_RADIUS,
  maxR = COST_BUBBLE_MAX_RADIUS
): number {
  if (!(maxCostUsd > 0)) return minR;
  const r = maxR * Math.sqrt(Math.max(costUsd, 0) / maxCostUsd);
  return Math.min(maxR, Math.max(minR, r));
}

export interface IterationScale {
  min: number;
  max: number;
  /** All visible prompts share one iteration count: midpoint color, single-value legend (OP-004). */
  single: boolean;
}

export function iterationScale(iterationCounts: number[]): IterationScale {
  if (iterationCounts.length === 0) return { min: 0, max: 0, single: true };
  const min = Math.min(...iterationCounts);
  const max = Math.max(...iterationCounts);
  return { min, max, single: min === max };
}

/** Position of `iterations` on the visible min→max gradient, 0..1; 0.5 for a single-valued scope. */
export function iterationT(iterations: number, scale: IterationScale): number {
  if (scale.single || scale.max <= scale.min) return 0.5;
  return Math.min(1, Math.max(0, (iterations - scale.min) / (scale.max - scale.min)));
}

/** Smallest "nice" step (1/2/5 × 10^k) that is ≥ rough. */
export function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= rough) return m * pow;
  }
  return 10 * pow;
}

/**
 * Up to `count` nice positive iso-growth guide deltas inside the visible
 * range (DD-005): parallels to the end = start diagonal, spaced by a nice
 * step derived from the largest positive delta actually on screen.
 */
export function isoGrowthDeltas(points: { contextDelta: number }[], count = 3): number[] {
  const maxDelta = Math.max(0, ...points.map((p) => p.contextDelta));
  if (maxDelta <= 0) return [];
  const step = niceStep(maxDelta / count);
  const deltas: number[] = [];
  for (let k = 1; k <= count && k * step <= maxDelta * 1.05; k++) {
    deltas.push(k * step);
  }
  return deltas.length > 0 ? deltas : [step];
}

// ---- overlap handling (DD-013) ----

export interface OverlapOffset {
  dx: number;
  dy: number;
  /** Total points sharing this position (1 = no overlap). */
  overlap: number;
}

/**
 * Deterministic small offsets for points that land on the same pixel
 * position: the first stays centered, the rest fan out clockwise on a small
 * ring, in input order (stable across renders). Every point stays its own
 * hit/focus target, so overlapping prompts remain keyboard-reachable.
 */
export function overlapOffsets(positions: { x: number; y: number }[], spacing = 6): OverlapOffset[] {
  const clusters = new Map<string, number[]>();
  positions.forEach((p, i) => {
    const key = `${Math.round(p.x)}|${Math.round(p.y)}`;
    const members = clusters.get(key);
    if (members) members.push(i);
    else clusters.set(key, [i]);
  });

  const offsets: OverlapOffset[] = positions.map(() => ({ dx: 0, dy: 0, overlap: 1 }));
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    members.forEach((pointIndex, k) => {
      offsets[pointIndex].overlap = members.length;
      if (k === 0) return;
      const angle = (2 * Math.PI * (k - 1)) / (members.length - 1);
      offsets[pointIndex].dx = Math.cos(angle) * spacing;
      offsets[pointIndex].dy = Math.sin(angle) * spacing;
    });
  }
  return offsets;
}
