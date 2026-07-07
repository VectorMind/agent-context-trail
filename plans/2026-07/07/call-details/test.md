# Test Proof — call-details

## Commands Run

- `npx tsc --noEmit` — pass, no errors (run after each phase).
- `node esbuild.js` — pass (`dist/extension.js`, `dist/webview.js` rebuilt).

## Real-data extraction (throwaway scripts, session scratchpad, deleted with it)

Per the verify-against-real-data rule, validation used this machine's real
session logs via the extension's own parser/extractor modules (no `vscode`
import), bundled with esbuild and run with node.

### Per-LLM-call parsing

- **Claude** (this workspace's newest session, busiest request): 57 LLM
  calls with `llmCalls.length == llmCallCount` exactly; real context
  staircase (81,504 → 86,828 tokens across the first four calls) with
  cache-read/cache-write/fresh segments summing to `contextTokens` on every
  call (invariant checked in-script over all calls); per-call estimated
  cost present; streaming spans present where a call truly spanned records
  (16.8 s on L1) and absent otherwise — never fabricated; `stop_reason`
  captured from the call's later lines (`tool_use`/`end_turn`).
- **Codex** (newest rollout, request #3): 36/36 calls; context growth
  95,109 → 110,781 against a 258,400 window; per-call cost; no per-call
  duration emitted anywhere, matching the plan's honesty call (OP-203:
  Codex time is card/tooltip-absent, not derived).
- **Copilot** (real `chatSessions/*.jsonl` with rounds): 7/7 round marks,
  thinking tokens on the rounds that report them (896, 128), window
  127,790; context/cost fields absent as expected — perfect `L1 #1 L2 #2 …`
  alternation in `timelineEvents`.
- Codex ordering note verified on real data: `token_count` logs after its
  response's `function_call` records, so `#1..#5 L1 #6..` is the log's own
  sequence (recorded as a deviation, not a bug).

### On-demand excerpts (OP-101/102/104)

- Claude `Write` (21,768-char content): payloadKey `content`, 8 head +
  4 tail lines, 21,130 chars skipped; result excerpt 1 line, 0 skipped.
- Claude errored `Edit`: fields capped (`replace_all`, `file_path`,
  `old_string`), `new_string` as payload; the `<tool_use_error>` text comes
  back in the RESULT excerpt — the error-investigation payoff works.
- Codex `shell_command`: short input → fields only, no payload (correct);
  6,289-char result → 8+4 lines, 5,874 skipped.
- Copilot `manage_todo_list`: plain-string result extracted; **display-tree
  reconstruction exercised on real data** in a second session file
  (`list_dir` result reassembled from `$mid` node fragments, returned with
  `reconstructed: true`).

## Visual verification (headless browser harness)

Same harness pattern as `plans/2026-07/06/tool-timeline/test.md`
(`harness.html` + node static server on :8734, hand-approximated Dark+/
Light+ `--vscode-*` variables, real `dist/webview.js`, real single-request
fixtures, headless Edge screenshots), extended with a stubbed
`acquireVsCodeApi` that answers `getToolCallDetail` from pre-extracted real
details after a 30 ms delay — so the async fetch → cache → re-render path
ran for real, and with an auto-click on a chosen timeline column.

Observed:

- **Claude dark + light** (87 tools + 57 LLM calls = 144 columns): ◆
  markers and purple `L#` ticks on LLM columns interleaved with tool
  columns; CONTEXT lane a cache-read-dominated staircase; selected column
  highlighted through all lanes; Call detail card shows `#1 of 87 · Edit`,
  stepper `2 of 144`, file field as dir + **name** + `md` badge, capped
  `old_string`/`new_string` fields, fixed-height INPUT ("no long text
  payload…") and RESULT (fetched excerpt text) zones, in/out/time chips.
- **Codex dark**: two-segment context bars (cache read + fresh);
  `#6 of 36 · shell_command` card with `command`/`workdir`/`timeout_ms`
  fields and a RESULT excerpt showing 8 head lines, a centered
  "2.6K chars skipped" separator, and 4 tail lines.
- **Copilot dark**: `CONTEXT (tokens) — unavailable (no per-call usage in
  this log)` and `TIME — unavailable…` captions collapse their lanes;
  clicking `L1` renders the LLM card: "Per-call token usage is not recorded
  in this provider's log." plus `thinking 896 tok` and `context window
  128K` chips, stepper `1 of 13`.
- Section wiring: "Call detail" renders after "Prompt timeline"; summaries
  read `57 LLM calls · 87 tool calls` and `#1 · Edit` respectively; both
  themes legible; `contrastingLabelColor` reused unmodified for lane max
  labels.

Bug caught and fixed during this pass: none in product code. One harness
crash traced to the fixture (single-request payload keeping its original
`request.index`, breaking `gapBeforeMs`'s neighbor lookup) — fixed by
reindexing the fixture; real parses always produce consistent indexes.

## Known Gaps

- No live VS Code Extension Development Host screenshot; theme variables
  are hand-approximated (same gap as prior packets).
- Tools-table → Call detail click sync verified by code path identity
  (`selectCall` shared with the chart) plus the chart-click screenshots,
  not by a separate table-click screenshot.
- Hover tooltips (including the new LLM tooltip) verified by source
  inspection; they reuse the shipped tooltip plumbing verbatim.

## Environment

- Windows 11; esbuild-bundled throwaway node scripts; headless Microsoft
  Edge; plain node `http` static server; no new dependencies.
