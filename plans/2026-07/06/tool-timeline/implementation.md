# Implementation Log

[######] Done - "Prompt timeline" section shipped: a per-tool-call sequence
chart (IN/OUT/TIME lanes, one column per call) alongside the untouched
"Prompt detail" section.

## Files Changed

- `src/webview/chart.ts` - added `renderToolCallLanes(container, tools)`:
  hand-built SVG, three lanes (IN chars, OUT chars, TIME) aligned on a
  call-order x-axis, never sharing a scale. Bars are colored per tool name
  via the existing `categoryColorMap` (same assignment as the sibling "Tool
  activity" breakdown, so color means the same thing in both places).
  Direct value label only on each lane's max column (`laneValueLabel`,
  reused as-is). Error calls get a `▲` marker in `WARN_COLOR` above the IN
  lane. Hover/focus per call shows a tooltip with `#`, tool name, target,
  in/out/time (with `≈` for derived time), error, and subagent attribution.
  A lane with no defined value anywhere (Copilot has no per-call TIME, and
  in principle OUT could be similarly absent) collapses to a caption-only
  "— unavailable (…)" note instead of a zero-height plot. Narrower bars
  (12px + 6px gap) than the thread chart, riding the existing
  `.chart-scroll` horizontal scroll for wide (100+ call) prompts. A minimum
  SVG width (`TC_MIN_WIDTH`) guarantees the unavailable-note caption never
  clips for narrow (few-call) prompts — caught during real-data validation,
  see `test.md`.
- `src/webview/main.ts` - added `SectionId: 'toolTimeline'` and its
  `SECTIONS` entry ("Prompt timeline", positioned directly after "Prompt
  detail" per the plan's default); wired `renderSectionBody`/`sectionSummary`
  branches; `selectRequest` now also expands `sectionsCollapsed.toolTimeline`
  alongside `.request`, so choosing a prompt reveals both sibling sections.
  "Prompt detail" (title and content) is untouched.

## Implementation Decisions

- Colors: both the "Tool activity" breakdown and the new lanes call
  `categoryColorMap(tools.map(t => t.name))` over the same call-order
  array, so the two sibling views assign colors identically without a
  shared cache — first-appearance order is deterministic from the same
  input.
- Absent lanes (OP-004/provider-and-cost.md): a lane collapses to a
  caption-only note only when *every* call in the prompt lacks that value
  (checked once per render), not per-call — a single missing value inside
  an otherwise-populated lane just leaves that one column's bar out,
  which is the same "gap, not zero" convention already used by
  `renderCountLane` elsewhere in this file.
- No selection/click wiring (OP-005 stays out of scope): the per-call
  hit-target is focusable and hoverable for the tooltip but has no
  `onSelect` — clicking a column does nothing beyond focus, matching the
  plan's explicit "not part of the core packet" for chart↔table
  cross-highlighting.

## Known Gaps

- OP-005 (chart↔table click interaction) intentionally not built.
- No live VS Code Extension Development Host screenshot in this pass;
  validation used a local headless-browser harness instead (see
  `test.md`) - same category of gap as prior UI packets in this repo.
- The harness's VS Code theme variable values are hand-approximated
  Dark+/Light+ defaults, not sourced live from a running VS Code instance;
  good enough to prove contrast/legibility, not pixel-identical to the
  real theme host.

## Specification Checkpoint (closing, 2026-07-06)

- Re-reviewed `ui-design.md`, `provider-and-cost.md` after implementation:
  no new durable rule needed. The chart follows existing codified rules
  (aligned lanes, computed label contrast, identity never color-alone,
  absent ≠ zero) rather than establishing new ones.
- The candidate durable topic flagged in `plan.md` ("sibling charts over
  the same entities reuse one category-color assignment") held up exactly
  as described here (Tool activity breakdown + Prompt timeline lanes) but
  is still only two data points; left parked for the maintainer to
  promote into `specification/ui-design.md` if a third sibling chart
  repeats it.
