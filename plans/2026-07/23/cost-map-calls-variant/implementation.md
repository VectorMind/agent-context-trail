# Implementation Log — Cost Map Calls Variant

[#####-] Implemented and validated (typecheck/build/test clean); rendered
in-VS Code visual pass pending, same as the parent cost-map packet.

## Files Changed

- `src/domain/costMap.ts` — added `cacheWriteShare(usage)` (cache-write
  tokens over the four-series total, 0 when totals are 0) and
  `isoRateSlopes(points, count)` (nice tokens-per-call values up to the
  steepest visible `contextWork / iterations` slope, the ratio analog of
  `isoGrowthDeltas`).
- `src/webview/chart.ts` — `renderCostMapChart` now takes
  `variant?: CostMapVariant` (`'context'` default | `'calls'`). The bubble /
  overlap / selection-ring / hit-target / detail-panel machinery is shared;
  the variant branches only the axis scales (calls: independent x and y
  scales instead of the shared token scale), captions, tick formatting,
  guides (equal-growth diagonals vs origin rays labeled `N/call`), color
  channel (LLM-call count vs cache-write share, one `iterationScale`
  gradient mechanism), gradient legend wording, chart aria-label, and point
  aria-labels (calls variant adds context work + share). The detail panel
  tints the LLM-calls hero only in the context variant and adds a
  "Cache write share" row (swatch = bubble color) in the calls variant.
- `src/webview/main.ts` — `costMapVariant` added to `State` and
  `PersistedState` (restored with validation, persisted alongside
  scope/period); "Context growth" / "Calls vs work" pill toggle appended to
  the section toolbar; variant passed to the chart; per-variant explanatory
  hint; section hint reworded to cover both variants.
- `src/domain/costMap.test.ts` — 5 new tests (see test.md).
- `specification/surfaces-and-privacy.md` — Prompt cost map bullet rewritten
  to describe the two variants, the shared cost-as-area rule, shared
  eligibility, and variant persistence.

## Decisions Taken During Execution

- Color channel (plan OP-001): cache-write share, as recommended in the
  maintainer conversation; reuses the existing blue→red min→max gradient and
  the OP-004 single-value fallback rather than introducing a new hue pair.
- The calls variant reuses `iterationScale`/`iterationT` unchanged for its
  share gradient — they are already generic numeric min→max helpers.
- Overlap at identical (calls, work) positions relies on the existing DD-013
  offsets; the x axis is a nice integer scale (0 tick label suppressed, like
  the context variant's origin).

## Deviations From Plan

None.

## Found During the Visual Pass: Scroll Reset on Periodic Refresh

The maintainer's visual pass of this chart exposed a pre-existing recurring
defect: `render()` restored inner scroll positions from a per-section
allowlist (`SCROLL_RESTORE_SELECTORS`) that never listed the cost map's
`.chart-scroll` (nor the thread/overview chart scrollers), so the periodic
refresh reset their horizontal position. Fixed in `src/webview/main.ts` by
replacing the allowlist with a generic enumeration of all scroll-container
classes (`.stack-pane, .chart-scroll, .table-scroll, .tools-scroll`), keyed
by owning section + class + occurrence, saved before and restored after
every re-render. The spec had no rule covering refresh-time scroll
preservation; `specification/surfaces-and-privacy.md` "Panel interaction
rules" now has a blanket bullet requiring every re-render (selection or
periodic refresh) to preserve all scroll positions via a generic mechanism.

## Follow-up Risks

- The calls variant's x axis can have very few distinct values in short
  conversations (many prompts at x = 1–3); DD-013 offsets handle exact
  collisions but near-collisions may still crowd. Revisit only if real use
  shows it.
- `contextWork` sums only known per-call context values (DD-007), so a
  provider with partially missing per-call usage understates y for those
  prompts; the point stays honest to recorded data and the detail panel
  shows the exact number.
