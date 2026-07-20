# Implementation Log - Prompt Cost Map

[#####-] Phase 5/5 - implemented and machine-validated (typecheck, build,
22 unit tests, real-data probe); the rendered in-VS Code visual pass
(light/dark/high-contrast, keyboard walk in the live panel) is still pending.

## Files Changed

- `specification/product-scope.md` - SR-001 applied: added the "Narrow
  exception: Prompt Cost Map period view" section and referenced it from the
  data-scope preamble.
- `specification/surfaces-and-privacy.md` - SR-001 applied: added the
  **Prompt cost map** panel to the panel contract and bounded the
  no-cross-conversation rule with the same narrow exception.
- `specification/ui-design.md` - DD-019 clarification applied: "Two measures
  never share a plot" now distinguishes forbidden dual-axis overlays from a
  labeled multidimensional scatter.
- `src/domain/costMap.ts` (new) - pure derivation and scales:
  `deriveCostMapPoints` (points + per-criterion exclusion counts),
  `withinRollingWindow`, `costBubbleRadius` (area = cost, sqrt radius,
  visible min 4px / bounded max 24px), `iterationScale`/`iterationT`
  (min→max gradient, single-value midpoint fallback), `niceStep`,
  `isoGrowthDeltas`, `overlapOffsets` (deterministic ring fan-out).
- `src/domain/costMap.test.ts` (new) - 22 node:test unit tests covering
  start/end/delta/iteration derivation, one-call prompts, negative deltas,
  every exclusion reason (including multi-reason counting), zero-cost
  chartability, request-index fidelity, context work, rolling-window
  boundaries, radius bounds/proportionality, gradient bounds and
  single-value fallback, guide steps, and overlap determinism/reachability.
- `src/panel/protocol.ts` - `CostMapPeriodPayload`, webview→host
  `getCostMapPeriod`, host→webview `costMapPeriod`.
- `src/panel/panelController.ts` - `loadCostMapPeriod`: per provider,
  current-workspace conversations are parsed host-side, prompts filtered by
  `startedAt` against the rolling window, and only chart-point projections
  cross into the webview. Conversations whose `lastAt` predates the window
  skip the full parse. Plus CSS for the new panel controls.
- `src/webview/chart.ts` - `renderCostMapChart`: hand-built SVG scatter with
  one shared token scale on both axes, `end = start` diagonal plus nice
  iso-growth guides, area-coded bubbles, theme-resolved blue→red iteration
  gradient, size/gradient/selection legend, exact-value tooltip, per-point
  focusable hit targets (Enter/Space select), overlap ×N labels, and the
  focus-border selection ring.
- `src/webview/main.ts` - new `costMap` section after Call detail and before
  the storage footer: scope toggle (Selected conversation default / Selected
  period), period pills visible only in period mode, persisted scope+period,
  live collapsed summary (`N prompts · M charted · K not charted · $X
  total`, period-prefixed in period mode), honest exclusion-reason line,
  explicit all-unchartable state (Copilot), compact model filter when >1
  model is visible, period-projection cache cleared on init, and point
  activation through the existing selection path (cross-conversation period
  points load the conversation first, then select the prompt; no scroll).
- `scripts/run-tests.js` (new) + `package.json` - minimal esbuild +
  `node --test` runner (`npm test`); no test-framework dependency added.

## Real-Data Validation (phase 2, this machine, 2026-07-19)

Probe (`.tmp/probe.ts`, disposable) ran the production parsers + derivation:

- Claude, this workspace: 14 conversations, 78 prompts, 43 charted (55%).
  Dominant exclusion is `no LLM calls` (35) — not missing context. Contexts
  0-322K, deltas -306K..+263K (1 negative), iterations 1-120, cost
  $0-$27.88, 3 distinct models.
- Codex, this workspace: 30/30 prompts charted, iterations 1-129, cost
  $0-$0.66, 5 distinct models.
- Copilot, this workspace: 0/4 charted, all `missing first/last context` —
  the explicit unavailable state renders instead of an empty plot.
- No pixel-level overlap at plot scale in either provider's All-time scope;
  All-time point counts (43/30) are far below any SVG responsiveness limit.
  Iso-growth guides land at 100K/200K on this data.

## Decisions Taken During Execution

- `CostMapPoint.promptIndex` uses `PromptRequest.index` (not array position)
  so period-filtered projections still select the correct prompt in the full
  conversation.
- The exclusion counts are per-criterion, so a one-call prompt with no
  context counts both `missing first` and `missing last`; the summary
  additionally shows the distinct excluded-prompt count.
- Iteration gradient endpoints are `--vscode-charts-blue` → `--vscode-charts-red`,
  resolved to RGB at render time via the existing theme probe and
  interpolated, so the gradient tracks the live theme without hardcoded hex.
- Bubble hit targets are separate transparent circles (min 9px radius) laid
  down in prompt order above a big-first fill layer: small bubbles stay
  clickable under large ones and tab order follows prompt order.
- Period-mode activation of another conversation's point posts the existing
  `selectConversation` and defers prompt selection until that detail
  arrives (`pendingPromptSelect`), reusing the in-place update path.
- A conversation whose `lastAt` predates the rolling window is skipped
  without a full parse in the period query.

## Deviations From The Plan

- None in behavior. The plan's collapsed-summary example wording
  ("1 missing context") is rendered as the more general "K not charted",
  because cost-unavailable and no-LLM-call prompts are also uncharted; the
  exact reasons are listed in the expanded panel body.
- Unit tests required introducing a first test runner (esbuild +
  `node --test`); the repo previously had no test infrastructure.

## Follow-Up Risks

- The period query re-parses every in-window conversation on each request
  (parser list caches soften this; full-parse results are not cached
  host-side). Fine at this machine's volumes (14+15+2 conversations); a
  host-side mtime cache is the natural next step if All time ever feels slow.
- The rendered visual pass in the live panel (themes, tooltip clipping at
  narrow widths, high-contrast) has not run yet; see test.md.
- `<synthetic>` appears as a Claude model name in real data and therefore as
  a model-filter pill; harmless but could be prettified later.

## Commands

- `npm run typecheck` - clean.
- `npm test` - 22/22 pass.
- `npm run build` - clean.
- `npx esbuild .tmp/probe.ts --bundle --platform=node --outfile=.tmp/probe.js && node .tmp/probe.js`
  - the phase-2/phase-5 real-data probe.
