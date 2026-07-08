# Call Details Plan (tool-call detail card + LLM calls on the timeline)

## Problem Summary

The "Prompt timeline" section (packet `plans/2026-07/06/tool-timeline`) charts
tool calls as IN/OUT/TIME sequence lanes, but the trail dead-ends at numbers:
you can see call #14 was a 2-minute Bash call that errored, yet not what it
ran, what came back, or why it failed. And the timeline shows only half the
trail — the LLM calls that *requested* those tools are invisible, even though
each provider's local log carries real per-LLM-call data (verified below).

Maintainer constraints (2026-07-07):

- The detail view must **not** render full payloads. It gives identity-grade
  detail — clear path, file name, file type — plus a bounded snapshot from the
  beginning and end of text payloads, always the same format and height, with
  tool-specific argument rendering.
- LLM calls are treated **per provider**, exposing what each honestly has, not
  the common denominator (provider-and-cost.md provider strategy). Per call:
  context size, cost (estimated is acceptable when labeled), time/duration,
  and whatever else is real.
- Preference: LLM calls and tool calls on the **same chart** if they fit.

## Goal and Objectives

1. Make every column on the Prompt timeline clickable, opening a bounded
   fixed-shape **Call detail** card in a new section below.
2. Add **LLM calls as first-class columns** on the Prompt timeline, interleaved
   with the tool calls they requested, per-provider honest.
3. Never render full payloads; never fabricate; absent stays absent.

## Starting Evidence (verified against real local files, 2026-07-07)

Checked directly on this machine per the verify-against-real-data rule.

### Tool call payloads (for the detail card)

| Provider | Full input args in log | Full result in log | Notes |
| --- | --- | --- | --- |
| Claude | yes — complete `tool_use.input` (entire Write content, full commands) | yes — full `tool_result` content | JSONL per project session |
| Codex | yes — `function_call.arguments` full JSON | yes — `function_call_output.output` full text | rollout JSONL |
| Copilot | yes — `toolCalls[].arguments` full JSON | partial — `toolCallResults` is a serialized display-node tree (`$mid`/`ctor`/`children` text fragments); text extractable by walking fragments, must be labeled reconstructed; several recent sessions carry no `toolCallRounds` at all | chatSessions JSON |

Consequence: bounded head/tail snapshots are extractable for all three; the
Copilot result snapshot is "reconstructed" or honestly unavailable.

### Per-LLM-call data

| Provider | Call identity | Per-call usage / context | Cost | Time | Other |
| --- | --- | --- | --- | --- | --- |
| Claude | assistant records grouped by `message.id` (14 calls / 31 records in this session's real file; parser already groups this way for `llmCallCount`) | full per-call usage: fresh input, cache read, cache creation (5m/1h split), output; context = input + cache read + cache creation (probe: 23,515 tok); usages identical across a call's records | estimable per call from the existing rate table (`estimated`) | first→last record timestamps of the call (probe: 2.4 s; ≈ streaming span, excludes TTFB) | model, `stop_reason`, `service_tier`, `requestId`, web search/fetch counts, `iterations[]` observed |
| Codex | `event_msg/token_count`, one per call (13 events ↔ 13 agent messages in real rollout) | `last_token_usage`: input, cached_input, output, reasoning; context = its `input_tokens` (probe: 56,523); `model_context_window` present (probe: 258,400) → fill % | estimable per call (BYOT rule, provider-and-cost.md) | event timestamp; duration not directly stated (deltas between events span tool time — not honest as call duration) | running `total_token_usage`; `rate_limits` snapshot rides along (stays status, never cost) |
| Copilot | `toolCallRounds[]` — one round per LLM call (`llmCallCount` already = rounds.length) | none per round — `promptTokens`/`completionTokens` are request-level only | none per round | round `timestamp` (round-granular); durations between rounds derivable but include tool time — label ≈ or omit | per-round `thinking.tokens` when present; tools of the round |

Consequence: a per-call `LlmCallInfo` is genuinely rich for Claude, solid for
Codex, and skeletal-but-real for Copilot (call marks on the axis, thinking
tokens sometimes, no context bars). That asymmetry is presented, not flattened
(provider-and-cost.md).

## Concept

### Part 1 — unified event-sequence chart (extends "Prompt timeline")

The trail inside one prompt is strictly alternating: LLM call → the tool calls
it requested → next LLM call fed by their results. So the honest unified form
is **one x-axis = event order**, mixed columns:

```
CONTEXT (tok)   ▐▌......▐▌.......▐█▌     LLM columns only — the context
                                          staircase (segments: cache-read /
                                          fresh / cache-write)
IN (chars)      ..▂▁▄▁..█▁▂......         tool columns only
OUT (chars)     ..▅▂█▃..▂▁▁......         tool columns only
TIME            ▁.▁▂▁█..▁▁▁......         ms lane; tool bars + optionally
                L1 t t t L2 t t  L3       LLM streaming spans (≈)
```

- LLM columns visually distinct (outlined/wider bar + legend entry — identity
  never color-alone), tool columns keep the existing per-tool-name colors.
- Units never share a scale: CONTEXT is tokens, IN/OUT are chars, TIME is ms —
  each its own lane (ui-design.md). Stacking cache-read/fresh/cache-write
  segments inside one CONTEXT bar is one unit → allowed, same language as the
  thread chart's token composition.
- A lane with no defined value on any column collapses to the existing
  unavailable-caption treatment (Copilot CONTEXT).
- Interleaving order: by timestamp (Claude/Codex have per-record/per-event
  timestamps; Copilot rounds bound their tools' position).

### Part 2 — "Call detail" section (new, below "Prompt timeline")

Clicking any column (or a Tools-table row — absorbs parked OP-005 of the
tool-timeline packet) selects that call and renders a **fixed-shape card**:

Shared anatomy, constant height regardless of payload size:

1. **Header** — `#12 of 26 · Write` (or `LLM call 3 of 5 · claude-fable-5`),
   error badge, prev/next steppers to walk the trail.
2. **Fields zone** — tool-specific labeled fields (see OP-103), fixed rows.
3. **Snapshot zone(s)** — INPUT and RESULT, each a fixed-line monospace block:
   head N lines, a `⋯ 38.2k chars skipped ⋯` separator, tail M lines. Absent
   result → the zone states unavailable, never collapses the layout.
4. **Metrics footer** — in/out chars, time (≈ when derived), duration source,
   subagent tokens/cost when Agent.

LLM-call card variant: model, started at, streaming span (≈), context size
with fill % vs known window, token breakdown (fresh / cache read / cache write
/ output / reasoning-thinking), stop reason, service tier, estimated cost with
confidence label, requestId. Copilot variant: round index, timestamp, thinking
tokens when present, tools of the round, everything else explicitly
unavailable.

Payload transport: full payloads never enter the webview. On selection the
webview requests the excerpt; the extension host re-reads the source log,
locates the call, and returns only the bounded head/tail excerpt (already
trimmed host-side). Local read of provider-owned files, nothing persisted —
inside surfaces-and-privacy.md as-is.

## Scope and Non-goals

In scope: `LlmCallInfo` domain type + per-provider parsing; unified event
columns in "Prompt timeline"; new "Call detail" section with both card kinds;
on-demand excerpt fetch protocol; chart↔table selection sync; prev/next.

Non-goals:

- No full-payload rendering, ever, in any card (maintainer constraint).
- No subagent drill-down navigation (opening the sidechain transcript as its
  own trail) — surfaced as a labeled fact on Agent cards, navigation parked
  as a follow-up packet.
- No wall-clock Gantt (already restricted in the tool-timeline packet).
- No persisted artifacts, no settings writes.
- No charting library; hand-built SVG (ui-design.md).

## Specification Checkpoint (pre-work, 2026-07-07)

- `specification/ui-design.md` — binding, satisfiable: unified chart keeps
  units in separate lanes; CONTEXT segments are a single-unit stack; LLM
  columns are distinguished by shape/outline + legend + tooltip, never hue
  alone; inline labels go through `contrastingLabelColor`; theme variables
  only.
- `specification/provider-and-cost.md` — binding, satisfiable: per-call cost
  is `estimated` with label (Claude/Codex; BYOT rule covers Codex);
  Copilot's missing per-call tokens/cost stay visibly unavailable; per-call
  depth differences are presented, not flattened.
- `specification/surfaces-and-privacy.md` — the "Request detail" panel
  contract lists per-tool preview/size/latency/error as required exposure;
  a deeper on-demand detail card is an extension of the same surface, reads
  local provider files only, persists nothing, no new always-visible surface.
  In-place update rule respected (selection updates sections below, no
  navigation).
- `specification/product-scope.md` — no tension; still one conversation, one
  request, deeper.
- Candidate durable topics (maintainer review at close, not added now):
  1. "Payload excerpts are bounded and trimmed host-side; full payloads never
     cross into the webview" — likely belongs in surfaces-and-privacy.md if
     it survives implementation.
  2. "Detail cards have fixed shape: constant zones and height independent of
     payload size" — candidate ui-design.md rule.

## Open Points (all resolved 2026-07-07 — maintainer accepted every recommended option)

- **OP-101 — resolved 2026-07-07: (a) on-demand fetch.**
  - (a) **On-demand fetch (recommended):** new protocol pair
    (`getCallDetail` → `callDetail`); host re-reads the log on click and
    ships only the trimmed excerpt. Keeps `conversationDetail` small
    (subagent-heavy sessions have 500+ calls), keeps full payloads out of
    webview memory entirely.
  - (b) Eager: parse bounded excerpts into `ToolCallInfo` at load. No
    protocol change, instant display, but ~2 KB × every call on every
    conversation load.
- **OP-102 — resolved 2026-07-07: (a) 8 head + 4 tail lines.** Options were:
  (a) 8 head + 4 tail lines (recommended), (b) 6+3 more compact, (c) chars
  budget instead of lines (e.g. 700 head + 300 tail chars, wrapped). Same
  geometry for INPUT and RESULT zones.
- **OP-103 — resolved 2026-07-07: all listed renderers accepted** (fallback
  for unknown tools is a scalar-args table):
  - Write/Edit/Read → directory + **file name** + extension badge, sizes,
    Read offset/limit, Edit old/new sizes.
  - Bash/PowerShell/shell (Codex `shell`, `local_shell`) → command (capped
    1–2 lines) + description field when present.
  - Grep/Glob → pattern, path, glob/type flags.
  - Agent/Task → subagent type, model, tokens, cost, agentId.
  - WebFetch/WebSearch → URL/domain or query.
  - Codex `apply_patch` → files touched + hunk count.
- **OP-104 — resolved 2026-07-07: (a).** (a) Same head/tail snapshot as input
  (recommended); (b) stats only (chars, lines, error text when `isError`);
  (c) snapshot for errors, stats otherwise.
- **OP-201 — resolved 2026-07-07: (a) unified interleaved columns.**
  - (a) **Unified interleaved columns in "Prompt timeline" (recommended):**
    LLM columns take their place between the tool calls they bracket — the
    literal context trail.
  - (b) Separate LLM strip stacked above the tool lanes, own x-axis (call
    index), no interleaving.
  - (c) Separate "LLM calls" section entirely.
- **OP-202 — resolved 2026-07-07: (a) minimal.** (a) **Minimal:** add one CONTEXT
  (tokens, segmented) lane above the existing three; LLM output/reasoning
  tokens live in the tooltip and detail card. (b) Full: also an OUT (tokens)
  lane. Minimal keeps five sections of chart height in check.
- **OP-203 — resolved 2026-07-07: (a).** (a) **Claude streaming spans on
  the shared ms lane, labeled ≈;** Codex/Copilot tooltip-only
  (their per-call duration is not honestly derivable). (b) LLM time
  tooltip/card-only for all providers.
- **OP-204 — resolved 2026-07-07: (a).** (a) **One "Call detail" section whose
  card adapts to call kind;** (b) two sections (tool detail / LLM detail).

## Phases

1. **Domain + parsers** — `LlmCallInfo` on `PromptRequest`; Claude: enrich the
   existing `message.id` grouping; Codex: join `token_count` events to calls;
   Copilot: lift rounds. No payload excerpts in the eager path.
2. **Excerpt service (per OP-101)** — protocol pair + per-provider locate-and-
   trim (head/tail, hard caps, Copilot result-tree text walk with
   reconstructed labeling).
3. **Webview chart** — interleaved LLM columns per OP-201/202/203; legend,
   tooltip, unavailable-lane handling for Copilot CONTEXT.
4. **Webview detail** — selection state, new SECTIONS entry, both card kinds,
   chart↔table highlight sync, prev/next, empty states.
5. **Validation** — real sessions × 3 providers, light/dark, large-N prompt,
   `test.md`, refresh this checkpoint.

## Dependencies and Risks

- Open points OP-101..OP-204 need maintainer resolution before phase 2+
  (phase 1 is safe under any resolution).
- Risk: Claude `iterations[]` usage field is newly observed — parser must
  ignore unknown shapes gracefully.
- Risk: Copilot sessions without `toolCallRounds` (several real recent files)
  must degrade to "no per-call data in this log", not break the chart.
- Risk: interleaving order for Copilot tools inside a round is unknown — keep
  log order within the round.
- Chart width: LLM columns add ~llmCallCount columns; existing narrow-bar +
  scroll pattern absorbs it.

## Exit Criteria

- Prompt timeline shows the interleaved trail (per resolved OPs) for real
  sessions of all three providers, honest gaps intact.
- Clicking any column or Tools-table row opens a fixed-shape Call detail card;
  no full payload ever reaches the webview.
- `implementation.md` + `test.md` written; specification checkpoint refreshed;
  candidate durable topics put to maintainer review.

## Specification Checkpoint (close, 2026-07-07)

Reassessed at validation close:

- All shipped behavior fits inside the already-codified rules — unit-split
  lanes, single-unit stacked segments, computed label contrast, glyph+text
  identity for LLM columns, absent-never-zero for Copilot per-call usage
  and Codex per-call time, estimated-labeled per-call cost. No
  specification file needed changes.
- The two candidate durable topics from the pre-work checkpoint survived
  implementation, were reviewed with the maintainer, and accepted
  2026-07-07:
  1. "Payload excerpts are bounded and trimmed host-side; full payloads
     never cross into the webview" — added to `surfaces-and-privacy.md`
     under "Privacy".
  2. "Detail cards have a fixed shape: constant zones and height
     independent of payload size" — added to `ui-design.md` as its own
     rule, ahead of "Two measures never share a plot".

## Status (closed 2026-07-07)

All five phases implemented and validated against real local Claude, Codex,
and Copilot sessions (see `implementation.md`, `test.md`). OP-101..OP-204
resolved as recorded above. One recorded deviation: Codex LLM columns
follow the log's own event order (`token_count` after its response's
function calls), which can place an L column after the tools its response
requested.
