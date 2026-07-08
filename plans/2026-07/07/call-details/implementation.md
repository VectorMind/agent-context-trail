# Implementation Log — call-details

[######] Done - implemented and validated; follow-ups noted below.

## Files Changed

- `src/domain/types.ts` — new `LlmCallInfo` (per-LLM-call detail, provider
  depth varies), `PayloadExcerpt` (bounded head/tail lines), `ToolCallDetail`
  + `ToolCallDetailField` (on-demand transport shape);
  `PromptRequest.llmCalls?`.
- `src/providers/callDetail.ts` — new: shared host-side trimming
  (`buildExcerpt` 8+4 lines / 400-char line cap per OP-102,
  `splitInputFields` payload-vs-fields split at 161 chars,
  `buildToolCallDetail`, `unavailableDetail`).
- `src/providers/claude/parser.ts` — `LlmCallInfo` built on the existing
  `message.id` grouping (usage, context sum, stop_reason picked up from later
  lines, streaming span via endedAt, per-call estimated cost);
  `extractClaudeToolCallDetail` (streams the JSONL, matches `tool_use` /
  `tool_result` by id, line pre-filter on the id for speed).
- `src/providers/codex/parser.ts` — one `LlmCallInfo` per `token_count`
  event (`last_token_usage`; context = `input_tokens`, cached is a subset —
  OpenAI semantics; per-call estimated cost; window); no per-call duration
  is fabricated. `extractCodexToolCallDetail` (function_call /
  function_call_output by call_id).
- `src/providers/copilot/parser.ts` — skeletal `LlmCallInfo` per
  `toolCallRound` (timestamp, thinking tokens, window; tokens/cost honestly
  absent). `extractCopilotToolCallDetail` + `collectTreeText` (walks the
  `$mid`/`ctor` display-node tree; results recovered that way are labeled
  `reconstructed`).
- `src/panel/protocol.ts` — `getToolCallDetail` → `toolCallDetail` pair.
- `src/panel/panelController.ts` — `loadToolCallDetail` host handler
  (per-provider file resolution + extraction, `unavailableDetail` on any
  failure); CSS for the Call detail card (steppers, field grid, file
  dir/name/ext rendering, fixed-height snapshot zones).
- `src/webview/chart.ts` — the tools-only `renderToolCallLanes` replaced by
  `renderPromptTimeline`: `timelineEvents` (timestamp merge of llmCalls +
  tools, carry-forward keys for missing timestamps, ties LLM-first),
  `llmCallSpanMs`, CONTEXT lane with stacked cache-read/cache-write/fresh
  segments that provably sum to `contextTokens` (correct under both Claude
  and Codex usage semantics), ◆ LLM markers + `L#` ticks, per-column
  click/keyboard selection with `overview-selected` highlight, LLM tooltip;
  `legendItem` gained a glyph-char parameter.
- `src/webview/main.ts` — new `callDetail` section (OP-204: one section,
  card adapts); `selectedCall` state + `selectCall` with the on-demand fetch
  through a module-level `toolDetailCache`; Tools-table rows now select the
  same call (click/Enter/Space, `.active` highlight — absorbs old OP-005);
  tool card (fields per OP-103, fixed INPUT/RESULT snapshot zones per
  OP-102/104, metrics chips, subagent attribution) and LLM card (context
  composition breakdown + % of window, output/reasoning/thinking/cost/stop
  chips, honest Copilot absence text); prev/next steppers walk
  `timelineEvents` — the same ordering the chart draws.

## Same-day Follow-up (2026-07-07, post-validation)

- `src/webview/main.ts` `applyDetail`: a `conversationDetail` refresh (e.g.
  re-selecting the same conversation) now preserves `selectedCall` and
  `promptExpanded` when the refreshed detail is the same conversation and
  request, via `preserveSelectedCall` (drops the selection only if the
  refreshed data no longer has that tool/LLM call at that index) — matches
  surfaces-and-privacy.md's "updates the panels below in place" rule, which
  previously only covered `selectedRequestIndex`, not the deeper call
  selection this packet added.
- `render()` now preserves the Prompt timeline's horizontal `chart-scroll`
  position across re-renders (captured before, restored after), the same
  treatment already given to the stack pane's vertical scroll — needed
  once selecting a call could trigger a full re-render while deep in a
  wide (100+ column) timeline.
- Specification checkpoint closed out: both candidate topics from the close
  checkpoint were reviewed and accepted into `surfaces-and-privacy.md` and
  `ui-design.md` (see `plan.md`).

## Decisions Taken During Execution

- Codex context composition: `input_tokens` is the full submitted context
  and `cached_input_tokens` a subset (verified: 56,523 ≥ 52,608 on real
  data), so segments are cache-read + fresh-remainder, never
  cache-read + input (which would double-count). The generic
  remainder-based split also keeps Claude exact (fresh == inputTokens).
- Codex per-call cost reuses `estimateCodexCost` on the same usage mapping
  as the request-level figure, so per-call costs stay consistent with the
  request cost rather than introducing a second convention.
- Excerpts are trimmed **host-side** (OP-101a taken literally): the webview
  message never contains more than 12 capped lines per zone plus capped
  fields; `skippedChars` drives the separator label.
- The input payload/fields split is generic (longest string ≥161 chars
  becomes the excerpted payload; everything else a capped field) instead of
  per-tool hardcoding; OP-103's per-tool treatment is applied at render
  time via key classes (file keys → dir/name/ext badge, code keys →
  monospace).

## Deviations From Plan

- Codex event ordering: a `token_count` event is logged after the response
  that carried its function calls, so on real Codex data an LLM column can
  land just *after* the tool columns its response requested (e.g. sequence
  `#1..#5 L1 #6..`). This is the log's own order, kept as-is rather than
  re-derived — documented here instead of forcing Claude-style L-before-#.
- `Prompt timeline` section hint/summary updated to mention LLM calls; the
  plan only promised a new lane but the summary text would otherwise have
  been misleading.

## Follow-up Risks

- Copilot old-format `chatSessions/*.json` files (plain JSON, not the
  patch-op `.jsonl`) exist on this machine but are not listed by discover;
  unchanged behavior, noted while validating.
- `gapBeforeMs` assumes `request.index` positions match the `requests`
  array; true for all real parses (only the test fixture violated it).
- Claude `usage.iterations[]` (newly observed field) is ignored gracefully
  by the existing shape-tolerant parsing; nothing reads it yet.
