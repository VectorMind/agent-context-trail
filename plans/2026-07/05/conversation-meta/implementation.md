# Implementation Log

[#####-] Survey done; enriched metadata implemented as Layout D vs baseline B
(round-2 layout comparison); awaiting maintainer verdict.

## Files Changed

- `src/domain/types.ts` — `ToolCallInfo` (id, name, input chars + short
  preview, output chars, latency with `reported`/`derived` source, error
  flag, subagent id/tokens/cost/model), `CacheMissInfo`, and enriched
  optional `PromptRequest` fields: `durationMs`, `apiCallCount`,
  `stopReason`, `serviceTier`, `speed`, `modelsUsed`, thinking/text/prompt
  sizes, web search/fetch counts, `cacheMisses`, `tools`. All optional —
  absent means "unavailable", never zero.
- `src/providers/claude/parser.ts` —
  - `parseClaudeSession` now also collects per request: tool calls matched
    tool_use → tool_result across records (latency from the explicit
    `durationMs` sidecar when present, else derived from the two line
    timestamps and labeled so), cache-miss diagnostics
    (`message.diagnostics.cache_miss_reason` type + missed tokens), wall
    time, API-call count, stop reason, service tier / fast-mode `speed`,
    models used in order, thinking/text/prompt sizes, web search/fetch
    counts.
  - Agent tool calls get exact subagent attribution: the matching
    `<sessionId>/subagents/agent-<id>.jsonl` transcript is scanned for
    token totals + estimated cost.
  - **Accuracy fix (pre-existing bug, found by the smoke test):** one API
    response is written as several JSONL lines (one per content block) all
    sharing `message.id` and repeating the same `usage`. The old code summed
    usage per line, overcounting ~65% on a real session (79.1M naive vs
    47.7M deduplicated). Usage/diagnostics are now counted once per
    `message.id` in `parseClaudeSession`, `scanClaudeSessionMeta`, and the
    subagent scan; content blocks are still scanned per line (verified
    distinct per line).
- `src/webview/chart.ts` — `renderChart` gains an opt-in `timeline` mode:
  two extra lanes sharing the request axis below the cost strip — a MODEL
  state strip (fixed categorical order starting on yellow, assigned by first
  appearance, run labels + legend + tooltip so identity is never
  color-alone; a 2px surface ring marks the first cell after a model switch)
  and a WALL TIME lane (neutral single-series bars, direct label on the
  longest request only). Cache-break requests get a ▲ marker in the reserved
  warning color above their token bar, with a legend entry and the
  reason/missed-tokens in the tooltip. Tooltip additionally carries wall
  time, idle-before gap, and tool count. Helpers exported:
  `formatDurationMs`, `shortModelName`, `gapBeforeMs`, `modelColorMap`.
- `src/webview/main.ts` — switcher re-enabled for round 2: `LAYOUTS` is now
  `B · Current` (round-1 winner, untouched baseline) vs `D · Enriched`
  (default). Persisted layouts outside the active comparison are coerced to
  the default. The `LAYOUT_EXPERIMENTS` flag now genuinely gates the design
  bar (round 1 shipped the flag but missed the render guard). Layout D =
  B's shell + timeline thread chart + `renderEnrichedRequestCard`: header
  with cost/confidence; model path (`sonnet-5 → fable-5`) and stop reason;
  chips (wall time, idle before, API calls, tool calls, tier, speed when
  fast, web searches/fetches); prompt preview + size; token breakdown with
  the cache-write 5m/1h TTL split; cache diagnostics block (▲ break with
  reason and missed tokens / ● hit with reused tokens); output composition
  (thinking blocks/chars, visible text chars); per-call tools table
  (#, tool, target preview, in, out, time with ≈ for derived, ⚠ error) with
  subagent attribution sub-rows; conversation share bars.
- `src/panel/panelController.ts` — CSS for chips, sub-headings, prompt
  preview, breakdown TTL note, diagnostics rows, composition, tools table
  (scrollable, ellipsized target column), subagent rows, legend glyph.

## Decisions

- Enrichment ships as a competing layout (D) instead of changing B, per the
  maintainer's ask to compare old vs new with the round-1 switcher tool.
- Derived numbers are visually distinguished: tool latency derived from
  timestamps wears `≈`; explicit provider values don't.
- Model lane colors start on yellow so the first model never shares a hue
  with the token stack's blue baseline directly above it; theme chart tokens
  keep the palette theme-owned (validator can't run on arbitrary themes;
  compensated by run labels, legend, tooltips — identity never color-alone).
- Warning ▲ uses the reserved status color (`editorWarning-foreground`) and
  never doubles as a series hue; it ships with legend text and tooltip rows.
- Subagent totals are labeled as delegated/billed-in-addition; they are not
  added into the conversation totals (would double-count nothing today, but
  the tooltip wording keeps the semantics explicit).

## Deviations From Plan

- The plan scoped this packet as assessment-only; the maintainer requested
  immediate implementation of proposals 1/2/4 (tools detail, model+time
  lanes, enriched card) as a new test layout. Proposal 3 (context-occupancy
  lane) was folded down to the cache-break markers: the token stack above
  already shows carried (cache read) vs new (write+input) per request, so a
  separate occupancy lane would duplicate it.

## Follow-Ups

- Maintainer verdict B vs D (round 2), then flip `LAYOUT_EXPERIMENTS` off.
- The usage-dedup fix lowers all token/cost figures to accurate values;
  worth mentioning in any future comparison against other tools.
- Codex/Copilot request enrichment (explicit timings, reasoning tokens,
  premium multiplier) once their adapters exist.

## Round 2b — maintainer feedback on Layout D (2026-07-05)

Two follow-up requests against the just-shipped Layout D:

- **Full prompt, not an 80-char preview.** `parser.ts`'s `extractPromptPreview`
  (80-char cap) is now two functions: `extractTitlePreview` (still 80 chars,
  used only for the conversation-list title fallback) and `extractPromptText`
  (full text, capped generously at 50,000 chars to bound a pasted-blob
  worst case). `PromptRequest.promptPreview` renamed to `promptText`. This is
  the user's own input, not a tool payload, so OP-002's "no full payloads"
  limit does not apply.
- In the card, `renderPromptBlock` (`main.ts`) shows a ~240-char collapsed
  snippet with a native `title` carrying the full text (hover discoverability)
  plus a "Show full prompt" toggle; clicking or Enter/Space on the block
  expands it in place — the panel's existing collapse/expand convention, not
  a new popup pattern. Expand state lives in `state.promptExpanded` (reset on
  `selectRequest`), **not a local DOM closure** — a closure-based first
  attempt silently lost its expanded state whenever an unrelated control
  (e.g. sorting the tools table) triggered the app's full `render()`, since
  that rebuilds the whole card from scratch. Caught by a headless-harness
  interaction test (click prompt, then click a table header, screenshot)
  before shipping.
- **Tools table sortable + a per-category activity chart.** The tools table
  headers now use the same `th-button`/`aria-sort` pattern as the
  conversations table (`setToolsSort`/`state.toolsSortKey`/`toolsSortDir`,
  not persisted, matching how the conversations table's own sort isn't
  persisted either). `#` sorts by original call order (an identity column,
  not a metric) rather than current row position. Above the table, "Tool
  activity" reuses the Tokens breakdown's exact visual language
  (`breakdownRow`: label · bar · value) with one row per tool name — bar
  scaled to call count, value combining calls/chars/time, plus a plain
  "Total —" summary line (not another bar, to dodge the axis-scale mismatch
  between a single category's max and the grand total). Row colors reuse the
  model-lane's fixed categorical palette: `chart.ts`'s `MODEL_COLORS` was
  generalized to exported `CATEGORY_COLORS` + a generic `categoryColorMap`
  helper (`modelColorMap` now just calls it), so both lanes and this new
  chart share one canonical, first-appearance-ordered palette instead of two.

Verified: typecheck/build clean; headless-Edge harness re-screenshotted
(Layout D with the longer fixture prompt and multi-call-per-tool fixtures,
an interaction pass clicking the prompt then the Time header confirming both
the expand-persists-through-resort fix and correct descending sort by
duration; Layout B re-confirmed unchanged); reinstalled.

## Round 2 Verdict - D Selected (2026-07-05)

The maintainer selected **D - Enriched** as the only active layout for now.
`src/webview/main.ts` now keeps `LAYOUT_EXPERIMENTS = false`, keeps
`DEFAULT_LAYOUT = 'D'`, and leaves only `D - Enriched` in the active layout
descriptor list. Persisted A/B/C choices are ignored while the switcher is
disabled, so the panel renders D directly with no multi-layout bar.

The durable panel surface was updated in
`specification/surfaces-and-privacy.md`: the thread view now includes
provider metadata lanes when available, and request detail now includes the
enriched D fields as provider-conditional data.
