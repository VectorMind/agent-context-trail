# Tool Call Timeline Plan

## Problem Summary

The Prompt detail card already exposes tool calls in two forms: the "Tool
activity" per-category breakdown (calls/chars/time totals per tool name) and
the sortable per-call Tools table. What is missing is the **sequence
dimension**: for a prompt with 26 tool calls there is no way to see at a
glance how In/Out/Time evolve across the call sequence, where the heavy calls
cluster, where errors landed in the flow, or which single call dominated the
time. The table has the numbers; nothing charts them per call.

The maintainer's framing (2026-07-06): LLM calls may be hard to place on a
timeline, but tool calls can be charted as bars for in, out, and time. The
existing detail card stays as is; its section title can change.

## Goal and Objectives

1. Add a per-tool-call chart for the selected prompt: one column per
   call, bars for In (chars), Out (chars), and Time (per-call duration),
   in the same visual language as the existing charts.
2. Ship it as a **new panel section "Prompt timeline"** (decided
   2026-07-06, resolving OP-002): the existing "Prompt detail" section
   (`SECTIONS` at `src/webview/main.ts:60`) stays untouched, title
   included; the new section renders the per-call lanes for whichever
   prompt is selected, defaulting to sit directly after "Prompt detail".
3. Keep every absent value absent — never zero (provider-and-cost.md).

## Starting Evidence (verified against real local files, 2026-07-06)

Checked directly on this machine, per the verify-against-real-data rule —
not from surveys:

| Provider | Per-call start | Per-call duration | Notes |
| --- | --- | --- | --- |
| Claude | yes — every `tool_use` record timestamped (14/14 in newest real session) | mostly **derived** from `tool_use` → `tool_result` timestamps (≈); sidecar-`reported` occasionally (1/12) | already parsed into `ToolCallInfo` |
| Codex | yes — `function_call` records timestamped | **derived**: `function_call_output` records also timestamped | already parsed |
| Copilot | round-granular only — `toolCallRounds[].timestamp` (8/8 rounds in a real chatSessions file); all calls in a round share it | **none** — `toolCalls[]` keys are `id`/`name`/`arguments` only, no per-call timing anywhere in the log | In/Out chars available; Time is honestly unavailable |

Conclusion: **no parser or domain-type changes are needed** for the core
concept. `ToolCallInfo` already carries `inputChars`, `outputChars`,
`durationMs` + `durationSource`, `isError`, `startedAt`, `agentId`. The
Copilot Time gap is a data fact, not an implementation gap.

## Concept

### Concept A — sequence lanes (selected, OP-001 resolved 2026-07-06)

A per-call column chart in the new "Prompt timeline" section, directly
reusing the aligned-lane language of the thread chart (Layout D):

```
IN (chars)        ▂▁▄▁▁█▁▂ ...        one column per call, #1..#N
OUT (chars)       ▅▂█▃▁▂▁▁ ...        (same order as the Tools table '#')
TIME              ▁▁▂▁█▁▁▁ ...        ≈ when derived; lane absent when
                  #1  #5  #10 ...       no call has a duration (Copilot)
```

- x-axis = **call order**, one column per call, matching the table's `#`
  column so chart and table cross-reference trivially.
- Three lanes share that x-axis but never a scale (ui-design.md: two
  measures never share a plot).
- Bars colored by tool name via the existing `categoryColorMap`
  first-appearance assignment — same colors as the sibling "Tool activity"
  breakdown, so color means the same thing in both. Identity never
  color-alone: tooltip carries `#`, tool name, target preview, in, out,
  time (with ≈), error, subagent attribution.
- Errors: `▲`/`⚠` glyph marker in `WARN_COLOR` over the column, same
  treatment as cache-break markers in the thread chart.
- Direct value label only on each lane's max column, via `laneValueLabel`
  (computed-contrast rule).
- Wide prompts (subagent-heavy requests reach 100+ calls): narrower bars
  than the thread chart plus the existing `.chart-scroll` horizontal
  scrolling.
- Absent values: no bar, tooltip says unavailable; an all-absent lane is
  dropped with its caption noting unavailability, never rendered as zeros.

### Concept B — true wall-clock timeline (restricted out of core)

A Gantt-style strip (x = wall-clock from request start to end, each call a
bar `startedAt → startedAt + durationMs`) was considered and deliberately
restricted: on real data tool execution is a small fraction of wall time
(reference prompt: 22s of tool time inside 7.7min wall), so
time-proportional bars degenerate into slivers separated by long
model/idle stretches; Copilot has only round-granular starts and no
durations; and In/Out cannot ride a time axis without violating the
units rule anyway. If the "where did the wall time go" question matters,
the honest form is a separate compact **activity strip** (tool-busy vs
model/idle time across the request) as an optional later phase — not bars
for in/out/time on a clock axis.

## Scope and Non-goals

In scope: the Concept A chart in the enriched request card; section title
rename; tooltip, error markers, subagent hint; empty/unavailable states.

Non-goals:

- LLM-call timeline. Per-LLM-call spans are actually derivable for
  Claude/Codex from assistant-record timestamps, but the maintainer flagged
  this as hard/uncertain — parked as a possible follow-up packet, not
  attempted here.
- No parser/domain changes (nothing new to parse — see Starting Evidence).
- No charting library (ui-design.md baseline; hand-built SVG).
- No change to the Tools table itself.

## Specification Checkpoint (pre-work, 2026-07-06)

- `specification/ui-design.md` reviewed — binding and satisfiable: aligned
  lanes on a shared x-axis instead of dual axes; identity never color-alone;
  label contrast computed via the shared `contrastingLabelColor` helper;
  theme CSS variables only; hand-built SVG.
- `specification/provider-and-cost.md` reviewed — binding: never fabricate;
  absent ≠ zero; providers are not forced to look equivalent. Copilot's
  missing Time lane is presented as unavailable, not zero-height bars.
- `specification/product-scope.md`, `surfaces-and-privacy.md` — no tension
  identified; the chart reads already-parsed in-memory data, stores nothing.
- Candidate durable topic (maintainer review at close, not added now):
  "sibling charts over the same entities reuse one category-color
  assignment" — generalizes the categoryColorMap reuse if it proves stable.

## Open Points

- **OP-001 — resolved 2026-07-06**: Concept A, sequence lanes. The
  wall-clock activity strip (Concept B-lite) was not selected; it stays
  parked as a possible future packet, not a phase of this one.
- **OP-002 — resolved 2026-07-06**: two sections. "Prompt detail" stays
  exactly as is (content and title); the per-call chart ships as a new
  section titled **"Prompt timeline"**. Section order not explicitly
  specified — default is directly after "Prompt detail" (trivial to move).
- **OP-003 — resolved 2026-07-06**: stack all three, adapted to the
  two-section decision: "Tool activity" (category totals) and the Tools
  table stay in "Prompt detail" unchanged; the per-call sequence chart is
  the body of "Prompt timeline". The shared category-color assignment
  still ties the breakdown and the new chart together across sections.
- **OP-004 — resolved 2026-07-06**: linear scale with a direct label on
  each lane's max column (existing pattern, honest proportions).
- **OP-005 (stretch, default off)** — chart↔table interaction: clicking a
  column highlights/scrolls to the table row. Not part of the core packet.

## Phases

1. **Chart helper** — `renderToolCallLanes(tools)` (or similar) in
   `src/webview/chart.ts`: lanes, tooltip, error markers, scroll, labels.
2. **Section integration** — `src/webview/main.ts`: new "Prompt timeline"
   `SECTIONS` entry after "Prompt detail", rendering the lanes for the
   selected prompt; empty state when no prompt is selected or the prompt
   has no tool calls; unavailable-lane treatment (Copilot Time).
3. **Validation** — render real Claude, Codex, and Copilot sessions; light
   + dark theme pass; large-N prompt (subagent-heavy) pass; `test.md`
   proof; refresh this specification checkpoint at close.

## Dependencies and Risks

- OP-001..OP-004 are resolved; no external dependencies remain.
- Risk: very wide prompts (100+ calls) — mitigated by narrow bars + the
  existing chart scroll pattern; no virtualization needed at this scale.
- Risk: Copilot card showing only two lanes must read as "data doesn't
  exist", not "chart broke" — explicit caption treatment.

## Exit Criteria

- Per-call chart renders correctly for real sessions from all three
  providers, respecting every ui-design.md rule.
- "Prompt timeline" section added; "Prompt detail" untouched; absent data
  never rendered as zero.
- `implementation.md` + `test.md` written; specification checkpoint
  refreshed; open points resolved or explicitly carried.

## Status (closed 2026-07-06)

All three phases implemented and validated against real local Claude,
Codex, and Copilot sessions (see `implementation.md`, `test.md`). OP-001
through OP-004 resolved as recorded above; OP-005 stays parked, out of
scope. No specification changes were needed at close — the checkpoint
reassessment found the work fits entirely inside already-codified rules.
