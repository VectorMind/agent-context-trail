# Test Proof — Cost Map Calls Variant

## Commands Run (2026-07-23)

- `npm run typecheck` — clean.
- `npm test` — 85/85 pass (80 pre-existing + 5 new).
- `npm run build` — clean.

## New Unit Tests (`src/domain/costMap.test.ts`)

- `cacheWriteShare`: cache-write tokens over the total of all four series
  (700/200/50/50 → 0.2).
- `cacheWriteShare`: all-zero usage returns 0, not NaN.
- `isoRateSlopes`: nice tokens-per-call steps up to the steepest visible
  slope (210K work / 2 calls → [50K, 100K]).
- `isoRateSlopes`: zero context work yields no rays.
- `isoRateSlopes`: positive work always yields at least one ray.

## Commands Not Run / Known Gaps

- No rendered in-VS Code visual pass yet (webview SVG output: axes, rays,
  gradient legend, toggle pills, detail-panel share row). Same standing gap
  as the parent `plans/2026-07/19/prompt-cost-map` packet; verify via
  `npm run reinstall` + opening the panel on real local data.
- Chart rendering itself has no DOM test harness (consistent with all
  sibling charts — hand-built SVG is proven by the visual pass).

## Specification Checkpoint (closing)

- `specification/surfaces-and-privacy.md` Prompt cost map bullet updated in
  this packet: two variants, cost-as-area invariant, shared eligibility,
  variant persistence. Maintainer-initiated feature, so the spec change is
  the checkpoint's normal outcome, not speculative.
- `product-scope.md` unaffected (same points, same period exception).
- No new durable-contract topics beyond the updated bullet.

## Environment

Windows 11, Node via npm scripts, no network needed.
