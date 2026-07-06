# Test Proof

## Commands Run

- `npm run typecheck` - pass, no errors.
- `npm run build` - pass (`dist/extension.js`, `dist/webview.js` rebuilt).

## Real-data extraction (throwaway script, deleted after use)

Per this repo's verify-against-real-data rule, validation used this
machine's own local session logs rather than synthetic data. A throwaway
`verify-tool-timeline.ts` (repo root, bundled with `esbuild`, run with
`node`, then deleted along with its `.js` output) called the extension's
own parser modules directly (`findClaudeProjectDir`/`listClaudeSessions`/
`parseClaudeSession`, `listCodexConversations`/`parseCodexSession`,
`listCopilotConversations`/`parseCopilotSession` — all pure Node, no
`vscode` import) against this workspace's real logs, picked the
busiest-by-tool-calls request per provider, and wrote one
`ConversationDetailPayload`-shaped JSON per provider to the session
scratchpad. Real requests found:

- **Claude**: session `97f25e32-…`, request #12, **110 tool calls**
  (mostly `Read`, plus `Bash`/`Glob`/`AskUserQuestion`/`Write`/`Edit`/
  `ToolSearch`/`TodoWrite`), 4 real errors, `durationSource` mix of
  `derived` and `reported`.
- **Codex**: session `019f32e5-…`, request #6, **102 tool calls**
  (`shell_command`/`update_plan`), 9 real errors, all `derived` durations.
- **Copilot**: session `1b049bd5-…`, request #2, **6 tool calls**
  (`manage_todo_list`/`read_file`), 1 real error, **no call has a
  `durationMs`** — confirmed empirically, not assumed.

This organically covered both the wide-prompt case (100+ calls, no
synthetic data needed) and the Copilot TIME-unavailable case from real
logs.

## Visual verification (headless browser harness)

A scratchpad harness (`harness.html` + a tiny static file server on
`localhost:8734`, both session-temp, not committed) stubbed
`acquireVsCodeApi`, inlined the panel's real `<style>` block extracted
from `panelController.ts`, defined approximate VS Code Dark+/Light+
`--vscode-*` variable values gated by `[data-theme]`, loaded the built
`dist/webview.js`, and posted a real `init` message (one provider, the
extracted single-request `ConversationDetailPayload`) via
`window.postMessage`. Screenshotted with headless Microsoft Edge
(`--headless=new --screenshot`) at 1500px width, tall enough to avoid the
panel's internal `overflow-y:auto` scroll.

Bug caught and fixed during this pass (not a pre-existing issue -
introduced and fixed within this packet): the Copilot render (6 calls,
narrow chart) clipped the TIME lane's "— unavailable (…)" caption because
the SVG width was sized only to the call columns. Fixed with a
`TC_MIN_WIDTH` floor on the chart's SVG width plus shorter reason text;
re-verified clean after the fix.

Observed, per provider:

- **Claude (110 calls, dark + light)**: IN/OUT lanes correctly dominated
  by one outlier column each (a `Write` call's large input, an early
  `Read`'s large output) with direct labels (`30.8K`, `58K`) on exactly
  those columns; every other column still renders its own thin,
  correctly-colored sliver rather than disappearing (linear scale,
  honest proportions, per OP-004 - not a bug). TIME lane's max (`40s`,
  a `Bash` call) labeled. All 4 real errors present: one visible in the
  initial viewport, the other three confirmed by scrolling
  `.chart-scroll` to its end (`hscroll.scrollLeft = scrollWidth`) - proves
  wide-prompt scroll actually reaches the tail data, not just visually
  present up front. Legend colors match the "Tool activity" breakdown
  directly above it (both built from the same call-order tool-name list).
- **Codex (102 calls, light)**: less skewed data produces a visibly varied
  bar profile across all three lanes; OUT lane max labeled `40.1K`; error
  markers at multiple points, tail errors again confirmed via scroll.
- **Copilot (6 calls, dark + light, post-fix)**: IN/OUT lanes render
  normally; TIME lane fully collapses to `TIME — unavailable (no per-call
  duration in this log)` with no gridline/bars underneath - reads as
  "data doesn't exist," not "chart broke." Section summary chip correctly
  reads "6 calls · time unavailable." The one real error (`read_file`)
  shows its `▲` marker.
- **Section wiring**: "Prompt timeline" renders directly after "Prompt
  detail," expands automatically when a prompt is selected (fresh/empty
  persisted state - `sectionsCollapsed` defaults everything expanded), and
  "Prompt detail" itself (title, Tool activity breakdown, Tools table) is
  visibly unchanged in every screenshot.
- **Theme pass**: dark and light both legible; computed label contrast
  (`contrastingLabelColor`, reused unmodified) picks readable ink on every
  lane's colored max-bar in both themes.

## Known Gaps

- No live VS Code Extension Development Host screenshot; the headless
  harness's theme variables are hand-approximated Dark+/Light+ defaults,
  not captured live from a running VS Code instance. Same category of gap
  as `plans/2026-07/05/conversations-overview/test.md`.
- Chart↔table click interaction (OP-005) was not built, so there was
  nothing to verify there.
- Tooltip hover content was verified by source inspection (mirrors the
  already-shipped `renderChart` tooltip pattern exactly) rather than a
  captured hover screenshot - synthetic pointer-event dispatch inside the
  headless harness was judged not worth the added harness complexity for
  this pass.

## Environment

- Windows 11, esbuild-bundled throwaway Node scripts, headless Microsoft
  Edge for screenshots, a plain Node `http` static server for the harness
  (no new dependencies added to the project).
