# Prompt Cost Map Plan

## Status

Design approved by the maintainer on 2026-07-19. Option A and the full decision
register are accepted. No implementation has started.

One specification-review point remains: the accepted **Selected period** mode
intentionally introduces workspace-scoped, cross-conversation time filtering,
while the current durable product contract forbids both. The plan records the
required narrow contract amendment for maintainer approval before
implementation.

## Problem Summary

The panel explains one prompt and one call in depth, but it does not provide a
single visual comparison of every prompt in a chosen analysis scope. Users
therefore cannot readily see that two prompts with similar context growth and
the same number of LLM iterations can have very different cost when one starts
from a much larger context.

The desired comparison has four primary values per prompt:

- starting context size;
- ending context size;
- iteration count;
- cost in USD.

Tool calls are also useful evidence, but combining them with LLM calls into one
"iteration" count would blur two different things. LLM calls incur model usage;
tool calls affect latency and can enlarge the next LLM context, but do not have
the same direct token-pricing meaning.

## Goal And Objectives

Add a collapsible **Prompt cost map** panel after **Call detail** and before the
storage footer. It should:

1. show one mark per prompt in either the selected conversation or selected
   workspace/provider period;
2. make start context, end context, LLM iterations, and cost comparable at a
   glance;
3. make the "same growth, higher starting context" comparison visually direct;
4. keep exact values, cost confidence, model identity, tool count, and missing
   data available without overloading the plot;
5. select the corresponding prompt from mouse or keyboard without moving the
   page;
6. remain honest across Claude, Codex, and Copilot when provider data differs.

## Selected Diagram

### Option A - start/end cost map (selected)

Use a two-dimensional scatter plot:

| Visual channel | Meaning |
| --- | --- |
| X position | context tokens at the first LLM call |
| Y position | context tokens at the last LLM call |
| Bubble area | prompt cost in USD |
| Bubble color | number of LLM calls (iterations), on a visible min-to-max gradient |
| Bubble outline | selected prompt and focus state, not another metric |

Add a diagonal `end = start` reference and a small number of parallel
iso-growth guides such as `+32K`, `+64K`, and `+128K`. Prompts with the same
context delta sit along the same diagonal. Moving up and right along that
diagonal means the prompt had the same growth but began at a larger context;
bubble size then makes the cost difference visible. Iteration color lets users
compare points with the same or similar number of LLM calls. The gradient is
scaled to the minimum and maximum iteration counts in the currently visible
scope, with both endpoints labeled in the legend. If all visible prompts have
the same count, use one midpoint color and a single-value legend rather than a
false range.

This is the best fit for the stated insight because all four primary values are
encoded without a second axis or a derived score. The legend must show both
color-to-iteration values and example bubble sizes. Color is never the only
source of iteration identity: hover/focus text always includes the exact count.

Cost maps to **area**, not radius. The rendered radius is therefore proportional
to the square root of cost, with a small visible minimum for zero or near-zero
values and a bounded maximum so one outlier cannot cover the plot.

### Option B - driver map (not selected)

| Visual channel | Meaning |
| --- | --- |
| X position | starting context tokens |
| Y position | LLM-call count |
| Bubble area | cost in USD |
| Bubble color | context growth (`end - start`) |

This makes the two proposed cost drivers the axes and is the easiest chart for
asking "what happens as start context and iterations rise?" Its weakness is
that end context is only indirectly encoded as color/tooltip, and equal-growth
comparison depends more heavily on color perception.

### Option C - context interval map (not selected)

Place each prompt in an iteration-count band on Y. Draw a horizontal segment
from start context to end context on X, using a hollow start marker and a filled
end bubble whose area represents cost. This expresses every variable in one
glyph and also reveals context compaction when the segment points left.

It is more literal than Option A, but many prompts share the same integer
iteration count. The required stacking/jitter makes Y less exact and dense
conversations can become a tangle. It is a useful fallback if user testing
shows that people do not understand the start/end coordinate pair in Option A.

### Options not recommended for the first version

- A heatmap would summarize bins rather than show every prompt and would hide
  individual outliers.
- Parallel coordinates would fit all four measures but make the specific
  same-delta comparison difficult.
- A line per prompt across its LLM calls would show the full context trajectory,
  but multiple prompts would overlap heavily and cost would still need another
  channel.
- A dual-axis chart would create a false visual correlation and conflicts with
  the existing UI design contract.

## Metric Definitions

For a prompt with `llmCalls` in recorded order:

- **Start context**: `contextTokens` on the first LLM call. Do not substitute a
  later call when the first value is missing.
- **End context**: `contextTokens` on the last LLM call. Do not substitute an
  earlier call when the last value is missing.
- **Context delta**: `end context - start context`. A negative value is valid
  and signals compaction or a context reset; it must not be clamped to zero.
- **Iterations**: number of recorded LLM calls, preferably `llmCalls.length`.
- **Tool calls**: a separate tooltip/detail value, not folded into iterations.
- **Cost**: the prompt-level USD cost already exposed by `PromptRequest.cost`,
  with its `provider-reported`, `estimated`, or `unavailable` confidence.
- **Context work** (tooltip-only diagnostic): sum of known per-LLM-call context
  tokens. This helps explain cases where identical endpoints and iteration
  counts followed different intermediate trajectories. It is not a new score
  and is not presented as cost.

This is an explanatory comparison, not a causal model. Model rate, cache-read
pricing, cache-write pricing, output/reasoning tokens, and intermediate context
shape can all affect cost. The tooltip must expose enough of these facts to
avoid implying that the four headline measures completely determine price.

## Scope And Placement

The panel begins with a two-state scope toggle:

- **Selected conversation** - every prompt in the current conversation.
- **Selected period** - every prompt in the current workspace and currently
  selected provider whose `startedAt` falls inside the period filter.

Selected period reuses the existing rolling filter vocabulary:

- **All time**;
- **Last day** (rolling 24 hours);
- **Last week** (rolling 7 days);
- **Last month** (rolling 30 days).

Selected conversation is the default. The chosen scope and period persist with
the panel state. The period selector is visible only in Selected period mode.
Keeping period mode within the current provider avoids silently comparing
different vendors' pricing semantics; mixed models remain possible and follow
the model handling below.

The panel sits immediately after **Call detail** in the section stack and side
app bar. It follows the existing collapsible-panel behavior, persists collapse
state, and keeps a live collapsed summary such as:

`6 prompts - 5 charted - 1 missing context - $1.73 total`

In period mode the same summary is prefixed by the period, for example:

`Last week - 42 prompts - 38 charted - 4 missing context - $8.24 total`

The storage footer remains the final, non-collapsible element.

## Interaction And Detail

- Hover or keyboard focus shows prompt number, model/model path, start, end,
  delta, LLM iterations, tool calls, context work when available, cost plus
  confidence, and the main token composition.
- Clicking or pressing Enter/Space selects that prompt through the existing
  selection path. Prompt detail, Prompt timeline, and Call detail update in
  place; the page does not scroll. Call selection clears because it belongs to
  the previously selected prompt.
- The selected prompt uses the existing selection outline language. It must not
  be identified by color alone.
- Model identity stays visible in tooltip text. If a conversation contains
  multiple pricing models, add a compact model filter or model legend rather
  than inventing a model-normalized "efficiency" score.
- Identical points receive a deterministic small offset and an overlap count;
  the tooltip/focus cycle must still reach each prompt.
- Axes use compact token labels, while tooltips retain exact values.

## Missing And Uneven Data

- A prompt is chartable in Option A only when its first and last LLM calls both
  expose `contextTokens` and its prompt cost is usable.
- Missing data is never converted to zero. The panel reports `N of M prompts
  charted` and lists the reason counts (`missing first context`, `missing last
  context`, `cost unavailable`).
- Claude and Codex currently expose useful per-LLM context data. Copilot's
  per-round data does not expose context size, so a Copilot conversation will
  generally show an explicit unavailable explanation instead of an empty plot.
- A one-call prompt is valid: start equals end, delta is zero, iterations is
  one.
- A prompt with no LLM calls is unchartable and reported honestly.
- Period mode aggregates only the chart-point projection needed for the map;
  it does not ship full prompt or call payloads into the webview.

## Decision Register

Confidence expresses how strongly the proposal is supported before the
real-data and rendered-design validation phase:

- **High** - directly supported by the user goal, existing data, or a durable
  repository contract.
- **Medium-high** - strong design fit, with implementation details still to
  validate against real distributions.
- **Medium** - reasonable starting choice whose usability should be tested
  visually before it becomes durable behavior.

The maintainer accepted every product/design row on 2026-07-19. Confidence is
retained as implementation-risk guidance, not as decision status. The only
pending item is the specification amendment recorded after the table.

| ID | Decision | Proposal | Status | Confidence | Basis / remaining uncertainty |
| --- | --- | --- | --- | --- | --- |
| OP-001 | Aggregation scope | Add **Selected conversation / Selected period** toggle. Period mode covers prompts in the current workspace and selected provider, filtered by All time / Last day / Last week / Last month. | Accepted; specification amendment pending | Medium-high | Requested by maintainer. Exact scope is intentionally narrow, but it conflicts with the current no-cross-conversation/time-window contract. |
| OP-002 | Primary diagram | Use **Option A: start/end cost map**. X = first-call context, Y = last-call context, area = cost, color = LLM iterations. | Accepted | Medium-high | Best direct expression of equal growth at different starting contexts. Needs rendered validation. |
| OP-003 | Meaning of iteration | Count **LLM calls only** (`llmCalls.length`). | Accepted | High | LLM calls incur model usage. Combining tools and LLM calls would produce an activity count rather than a useful cost driver. |
| OP-004 | Iteration color scale | Use a **continuous gradient scaled from the visible minimum to maximum LLM-call count**, with a labeled gradient legend and exact values in text. | Accepted | Medium-high | Requested by maintainer. A single-valued dataset needs a deliberate midpoint-color fallback; accessible text remains necessary. |
| OP-005 | Cost encoding | Map cost to **linear bubble area**, using square-root radius, a visible minimum, bounded maximum, and size legend. | Accepted | Medium-high | Perceptually correct default. Outliers may still require later scale adjustment. |
| OP-006 | Point activation | Click or Enter/Space selects the prompt and updates existing detail panels without scrolling. | Accepted | Medium-high | Reuses current selection behavior and makes the chart actionable; the updated detail sits above the viewport. |
| OP-007 | Panel name | **Prompt cost map**. | Accepted | Medium | Clear and compact. |
| DD-001 | Panel placement | Put the collapsible panel immediately after **Call detail** and before the storage footer. | Accepted | High | Directly requested and compatible with the current stacked-panel structure. |
| DD-002 | Start context definition | Use `contextTokens` from the **first recorded LLM call**; do not substitute a later known value. | Accepted | High | Preserves the literal requested meaning and avoids silently shifting the baseline. |
| DD-003 | End context definition | Use `contextTokens` from the **last recorded LLM call**; do not substitute an earlier known value. | Accepted | High | Preserves the literal requested meaning and makes missing endpoints honest. |
| DD-004 | Context delta | Derive `end - start`; retain negative values as compaction/reset signals. | Accepted | High | Clamping would erase meaningful behavior and distort the equal-growth comparison. |
| DD-005 | Equal-growth guides | Draw `end = start` plus a few parallel positive-growth guides chosen from the visible range. | Accepted | Medium-high | This is the central aid for the requested insight; exact guide spacing should follow real data. |
| DD-006 | Tool-call treatment | Show tool-call count in tooltip/detail only; do not encode it in the initial plot. | Accepted | High | Keeps the four-channel diagram readable and avoids conflating tools with priced LLM iterations. |
| DD-007 | Context-work diagnostic | Show the sum of known per-call context tokens in the tooltip only. | Accepted | Medium-high | Explains different intermediate trajectories without adding a fifth visual channel or an invented score. |
| DD-008 | Cost source | Use existing prompt-level USD cost and always show its confidence label with exact values. | Accepted | High | Required by the provider-and-cost contract. |
| DD-009 | Model-price confounding | Always name the model in the tooltip; add a compact model filter when more than one priced model appears. Do not use model color because color is reserved for iterations. | Accepted | Medium-high | Raw cost is not comparable without knowing the rate schedule. The exact filter treatment needs a visual pass. |
| DD-010 | Missing endpoints or cost | Exclude the prompt from plotted marks, report `N of M charted`, and show exclusion-reason counts. Never convert missing data to zero. | Accepted | High | Required by provider honesty and prevents false low-cost/empty-context points. |
| DD-011 | Copilot fallback | Show an explicit per-call-context-unavailable state instead of an empty or fabricated chart. | Accepted | High | Current Copilot rounds do not expose context size. |
| DD-012 | One-call and zero-delta prompts | Plot normally at `start = end`, with iteration count `1`. | Accepted | High | This is valid data, not an unavailable state. |
| DD-013 | Overlapping points | Apply a deterministic small offset, display an overlap count, and keep every prompt keyboard-reachable. | Accepted | Medium | Avoids hidden marks, but the best offset/cluster treatment depends on observed density. |
| DD-014 | Selection identity | Use the existing outline/focus language; never use color alone for selection or iteration identity. | Accepted | High | Required by the UI accessibility contract and current chart patterns. |
| DD-015 | Axes and exact values | Use compact token ticks on axes and exact values in hover/focus detail. | Accepted | High | Preserves chart readability without sacrificing numerical precision. |
| DD-016 | Collapsed summary | Show active scope/period, prompt total, charted/missing counts, and scope cost. | Accepted | Medium-high | Matches existing live summaries; final wording needs a narrow-width check. |
| DD-017 | Causal framing | Describe the chart as an explanatory comparison, not a causal model or efficiency score. | Accepted | High | Model price, cache policy, output tokens, and intermediate context also affect cost. |
| DD-018 | Rendering approach | Reuse the existing hand-built, VS Code-themed SVG and chart helpers; add no chart library. | Accepted | High | Binding UI specification and consistent with the current implementation. |
| DD-019 | Specification follow-up | Amend product/panel scope for the narrow period mode and clarify multidimensional scatter versus forbidden dual-axis overlays. | Accepted; specification amendment pending | High | Period mode cannot be implemented consistently while the existing durable prohibition remains unchanged. |
| DD-020 | Scope-control default | Default to **Selected conversation**; persist scope and period; show the period selector only in period mode. | Accepted implementation default | Medium-high | Preserves current behavior and follows existing persisted panel-state patterns. |

## Specification Checkpoint (pre-implementation)

Reviewed the current durable specifications:

- `specification/product-scope.md`: Selected conversation mode is compatible.
  Accepted Selected period mode directly conflicts with the binding rules "No
  day, week, month, or other time-window aggregation" and "No level above
  conversation is ever computed, stored, or displayed."
- `specification/provider-and-cost.md`: raw USD and confidence labels remain
  intact; provider/model differences and missing per-call data are not
  flattened or fabricated.
- `specification/surfaces-and-privacy.md`: the new panel extends the existing
  one-page stack and follows collapse, persistence, selection, and no-scroll
  behavior. Selected period mode conflicts with its binding rule that no level
  of aggregation above one conversation is computed or displayed.
- `specification/ui-design.md`: the proposal does not use a dual axis. It does
  use position, area, and color for a deliberate multidimensional scatter plot.
  The accepted clarification is that the "two measures never share a plot"
  rule should distinguish forbidden dual-axis overlays from a labeled scatter
  plot whose axes and visual channels have independent, honest legends.

### SR-001 - open specification amendment

Before implementation, present a narrow durable amendment for maintainer
approval:

- Prompt Cost Map may compare request-level points across conversations only
  within the **current workspace and selected provider**.
- That comparison may be filtered by All time, rolling day, rolling week, or
  rolling month.
- It does not create or persist day/week/month totals, trends, budgets, grades,
  or cross-workspace/provider summaries; the period is a view filter over local
  prompt points.
- The exception applies to Prompt Cost Map only. Conversation totals and every
  other panel retain the existing conversation-level contract.

This is recorded as an open specification-review point rather than silently
planning behavior against a settled durable rule. No specification file is
changed by this plan revision.

## Proposed Phases

1. **Resolve specification scope** - approve and apply the narrow SR-001
   amendment before implementing Selected period mode.
2. **Validate against real data** - calculate the accepted Option A points for several
   large Claude and Codex conversations; measure overlap, ranges, outliers,
   negative deltas, mixed models, gradient bounds, missing values, and the size
   of All time period results before fixing scales.
3. **Domain, protocol, and view model** - add a small pure derivation from
   `PromptRequest[]` to chart points and explicit exclusion reasons. Add a
   host-side period query that returns only chart-point projections across the
   current workspace/selected provider; avoid eager full-detail transport and
   parser changes unless validation finds an honest provider gap.
4. **Panel and chart** - add the section after Call detail, scope toggle and
   period filter, hand-built themed
   SVG, legends, diagonal guides, tooltip, keyboard navigation, selection sync,
   and responsive layout using existing chart helpers and panel patterns.
5. **Validation and specification checkpoint** - typecheck/build, focused unit
   tests for derivation and scaling, rendered light/dark/high-contrast checks,
   keyboard/overlap checks, real-provider checks, then review candidate durable
   specification updates with the maintainer.

## Dependencies And Risks

- Cost is strongly affected by model price and cache policy; a visually strong
  correlation must not be labeled as causal or as an efficiency grade.
- Endpoint-only context hides intermediate spikes. Context work in the tooltip
  mitigates this; a full trajectory chart remains out of scope for the first
  version.
- Bubble charts can hide overlapping low-cost prompts. Deterministic overlap
  handling and keyboard traversal are required.
- Iteration bands must use VS Code theme colors and retain textual identity.
- Provider data gaps may leave whole conversations or period results
  unchartable, especially Copilot. The unavailable state is a designed result,
  not an error.
- The bottom placement means selection updates panels above the viewport. No
  automatic scroll or navigation should be introduced.
- All time period mode may contain far more points than a conversation. Real
  data must determine whether overlap handling and hand-built SVG remain
  responsive without sampling away prompts.
- Period mode requires a new host-side data path; the existing webview only has
  full prompt data for the selected conversation.

## Non-Goals

- No project-portfolio, cross-workspace, cross-provider, team, or organization
  dashboard. The accepted period mode is a narrow current-workspace/current-
  provider request comparison, not a general usage dashboard.
- No persisted daily, weekly, or monthly totals or trend series.
- No budget, efficiency score, recommendation, or automatic prompt coaching.
- No regression line or claim that starting context and iterations alone cause
  the observed cost.
- No charting library; retain the repository's hand-built SVG baseline.
- No parser fabrication for providers that do not expose per-call context.
- No implementation of period mode until SR-001 is approved and the durable
  specifications are reconciled.

## Exit Criteria

- The full decision register remains recorded as accepted.
- SR-001 is reviewed and the accepted durable specification change is applied
  before period-mode implementation.
- Every plotted channel and derived metric has an agreed definition.
- Real-data probes show whether Option A remains legible at the repository's
  observed prompt counts and price ranges.
- The plan, future implementation log, and test proof describe the same chosen
  design.
- Before completion, candidate `ui-design.md` and
  `surfaces-and-privacy.md` changes are presented for maintainer review.
