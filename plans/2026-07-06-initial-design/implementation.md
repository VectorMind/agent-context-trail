[######] Phase 1 & 2 done — Claude Code data + status bar + webview panel
(conversation list, SVG chart, request detail) implemented and validated
against real sessions; ready to reload/test in a running VS Code window.
Follow-ups noted below. See "Phase 2" section further down for the panel.

# Implementation Log — Phase 1

Packet: `plans/2026-07-06-initial-design`. Implements Phase 1 of
[plan.md](plan.md) §6: Claude Code JSONL parsing, `config/tokens-cost.yaml`
v1, and a status bar item with the AIC ↔ $ toggle. No webview/panel yet
(Phase 2).

The repository root is now the extension package itself (single-package
layout, unlike astro-huge-doc's `packages/vscode-extension` monorepo — there
was no reason to nest, since this repo has no other product).

## Files added

```text
package.json            extension manifest + npm scripts (build/package/install)
tsconfig.json            strict TS, commonjs, ES2022
esbuild.js                bundles src/extension.ts -> dist/extension.js
.vscodeignore             keeps plans/specification/.agents/src out of the VSIX
README.md                 install/dev/package instructions for the extension itself
config/tokens-cost.yaml   Claude model rates, sourced from the official pricing page
src/domain/types.ts       UsageTokens, CostAmount, PromptRequest, ConversationSummary
src/pricing/pricingService.ts   loads config/tokens-cost.yaml, estimates cost per request
src/providers/claude/discover.ts   finds the Claude project dir + latest session file
src/providers/claude/parser.ts     JSONL -> ConversationSummary (grouped by request)
src/status/statusBar.ts   status bar item: last | total, AIC/$ toggle in tooltip
src/extension.ts          activation, refresh loop, showSummary/setCostUnit commands
```

`.gitignore` updated for `node_modules/`, `dist/`, `out/`, `*.vsix`,
`*.tsbuildinfo`.

## Implementation facts

### Workspace → Claude project directory matching

Claude Code names each project folder after the workspace's absolute path
with `:` and path separators replaced by `-`
(`C:\dev\VectorMind\agent-context-trail` → `C--dev-VectorMind-agent-context-trail`).
`discover.ts` tries that slug as-is, then with a lowercased leading drive
letter (Node's path casing varies by launch method), and only if both miss
falls back to scanning every project directory and reading the `cwd` field
recorded in each session's first JSONL line — every Claude Code record
carries `cwd`, confirmed on this machine's real session files (survey
follow-up, plan §5.1). The scan fallback exists so a future rename of the
slug scheme doesn't silently break discovery.

### Prompt-iteration grouping

A "real" user prompt is a `user` record that is not `isMeta` and whose
`message.content` is a non-empty string or contains a `text` content block.
This deliberately includes local slash-command records (e.g. `/model`),
because they are genuine session-log entries with real string content —
and, verified against this session's own log, they correctly show up as
zero-usage/zero-cost requests since the CLI handles them without a model
turn. That is accurate, not a bug (see test.md).

Every `assistant` record between two such boundaries is folded into the
current request: usage is summed via `addUsage`, `model` is taken from the
last assistant record seen, and `tool_use` content blocks are counted.

### Cost estimation

`PricingService` resolves the model id first exactly, then with a trailing
`-YYYYMMDD` date suffix stripped, then falls back to current-generation
Sonnet rates. Cache-write cost uses the nested `cache_creation.ephemeral_5m
/ephemeral_1h` breakdown when the log provides it (accurate per-TTL pricing);
otherwise it assumes the entire cache-write total is 5-minute TTL, which is
the Claude Code default. All Claude costs are labeled `estimated` — the
session logs do not report cost directly (matches survey §9.3).

### Status bar / cost unit

Per the maintainer's OP-001/OP-002 decisions: the status bar always shows
**both** last-call and conversation-total cost side by side
(`$(comment-discussion) 71.25 | 168.41 AIC`), and the only toggle is AIC ↔
$ (`agentContextTrail.costUnit` setting, global scope). No token counts
appear in the status bar item or its tooltip — token/tool-call detail is
reachable only via the click-through `agentContextTrail.showSummary`
command, which is the stand-in for the Phase 2 panel today (prints a full
per-request breakdown to the "Agent Context Trail" output channel).

### Refresh

A 15s `setInterval` re-parses the latest session file. This is a polling
placeholder; Phase 5 (plan §6) calls for real file-watching, which is more
appropriate once the panel needs live updates too.

## Decisions taken during execution

- Single-package repository layout (no `packages/vscode-extension`
  subfolder) — there is nothing else in this repo to separate it from.
- `js-yaml@4.3.0` dropped its bundled type declarations; added
  `@types/js-yaml` as a devDependency (not anticipated in plan.md, harmless
  addition).
- Pricing figures were fetched live from
  `https://platform.claude.com/docs/en/about-claude/pricing` rather than
  estimated, including the `claude-fable-5` row and the Sonnet 5
  introductory-pricing window (through 2026-08-31) — see
  `config/tokens-cost.yaml` for the exact numbers and citation.
- Renamed `pricing/pricing.yaml` to `config/tokens-cost.yaml` (maintainer
  request, post-Phase-1) — `config/` reads better as the general home for
  hand-maintained extension config, and `tokens-cost.yaml` names what the
  file computes rather than restating the folder. `PricingService`'s file
  path is the only code reference; updated accordingly.

## Deviations from plan.md

None. DD-001..DD-005 and OP-001..OP-006 are implemented as decided.

## Follow-up risks / notes for Phase 2+

- The zero-usage synthetic requests (local slash commands) inflate the
  visible request count (7 requests in the validated session, only 3 with
  real usage). Phase 2's panel should decide whether to hide or visually
  de-emphasize these — they are correct data, not noise, but may read as
  confusing in a chart of "prompt iterations".
- `findClaudeProjectDir`'s scanning fallback reads the first line of every
  session file in every project directory when the slug guess misses. Fine
  at current scale (tens of projects, small first lines); revisit if this
  ever needs to scale to hundreds of projects.
- Multi-root workspaces are not handled — `getWorkspacePath()` takes
  `workspaceFolders[0]` only. Acceptable for Phase 1; the panel's
  conversation list will need real multi-root awareness in Phase 2.

# Implementation Log — Phase 2

Implements Phase 2 of [plan.md](plan.md) §6: the WebviewPanel, conversation
list with provider tabs, SVG thread chart, and request-detail card. DD-002
(plain SVG) and DD-003 (WebviewPanel, editor tab) implemented as decided.

## Files added

```text
src/panel/protocol.ts          host<->webview message types (shared, no runtime deps)
src/panel/panelController.ts   creates/reveals the WebviewPanel, owns the message loop,
                                 loads Claude conversation lists/details on demand
src/webview/chart.ts           hand-rolled SVG stacked-bar + cost-line chart (DD-002)
src/webview/main.ts            webview app shell: tabs, list, header, chart, detail card
```

## Files changed

- `src/domain/types.ts` — added `ConversationListItem`.
- `src/providers/claude/parser.ts` — added `peekClaudeSessionTitle` (title-only
  scan, no usage computation, for cheap list building) and exported
  `extractPromptPreview` support for its first-user-prompt fallback.
- `src/providers/claude/discover.ts` — added `getClaudeSessionFilePath`
  (resolve a session id back to its file, for on-demand detail loading) and
  `listClaudeConversations` (title + recency list for the sidebar).
- `src/status/statusBar.ts` — click target and tooltip's "Open panel" link
  now point at `agentContextTrail.openPanel` instead of `showSummary`.
- `src/extension.ts` — instantiates `PanelController`, registers
  `agentContextTrail.openPanel`.
- `package.json` — added the `openPanel` command; `showSummary`'s title
  clarified to "(Text)" since it's now the secondary, output-channel path.
- `esbuild.js` — now builds two entry points (`extension.ts` → `dist/
  extension.js`, node/cjs; `webview/main.ts` → `dist/webview.js`,
  browser/iife) instead of one.
- `tsconfig.json` — added `"DOM"` to `lib` so the webview code typechecks
  alongside the Node host code in one `tsc --noEmit` pass.

## Implementation facts

### Webview architecture

`PanelController` owns a single `WebviewPanel` (created lazily on first
`agentContextTrail.openPanel`, reused via `.reveal()` afterward). The host
never renders HTML for data — it only ever sends typed messages
(`HostToWebviewMessage`/`WebviewToHostMessage` in `protocol.ts`); the webview
(`main.ts`) owns all DOM rendering. This keeps the parsing/pricing code
(`src/providers`, `src/pricing`) entirely on the host side, untouched by
Phase 2, and the webview bundle free of any `vscode` or Node dependency.

A `ready`/`init` handshake avoids the message-loss race where the host
might `postMessage` before the webview's listener is attached: the webview
posts `{ type: 'ready' }` on load; only on receiving that does the host send
`{ type: 'init', ... }` with the full conversation list and the
most-recently-updated conversation's detail preloaded. Re-opening an
already-open panel (`reveal()` called again) skips recreating the webview
and just re-sends `init` if the handshake already completed.

### List vs. detail cost

Building the sidebar list (`listClaudeConversations`) only scans each
session file for its title (`peekClaudeSessionTitle`) — it does not compute
token/cost totals, unlike `parseClaudeSession`. Full detail (`requests[]`
with usage/cost) is only parsed for the one conversation currently selected,
fetched on demand via a `selectConversation` message. This mirrors the
plan's "titles only" list requirement (plan §3) and avoids parsing every
session in a project just to populate a list.

### Chart

`chart.ts` builds raw SVG via `document.createElementNS` — no chart
library, per DD-002. Each request is a stacked bar (cache read → cache
write → fresh input → output, bottom to top) scaled to the conversation's
own max token total, plus a cost polyline scaled to the conversation's own
max cost, drawn with `pointer-events: none` so it never blocks bar clicks. A
transparent full-height rect per bar column is the actual click target, so
short/near-empty bars (e.g. the local-slash-command zero-usage requests
noted in the Phase 1 follow-ups) are still easy to select. Colors reference
`--vscode-charts-*` variables so light/dark/high-contrast theming is
automatic, with no extra code.

### List, tabs, detail card

Plain DOM manipulation in `main.ts` (`document.createElement`, full
re-render into `#app` on every state change) — no framework. At this UI
size (a tab bar, a list, a chart, a key/value detail grid) a full re-render
per state change is simpler to reason about than incremental diffing, and
is cheap enough that it isn't worth Preact yet (plan §4 DD-001 left this
door open only "if templating gets noisy" — it isn't).

Copilot and Codex tabs render with an explicit "support is not implemented
yet" empty state rather than an empty list with no explanation, consistent
with the "unavailable, never silently empty/zero" principle from the survey
and handoff.

## Decisions taken during execution

- Cost-unit toggle (AIC ↔ $) was **not** duplicated inside the panel. The
  panel always shows both `$X.XXXX (Y.YY AIC)` together (same pattern as the
  Phase 1 output-channel dump), since plan §3 only specifies the status
  bar's AIC/$ toggle; the panel's job is showing token detail, which the
  status bar deliberately never does.
- `getClaudeSessionFilePath` reconstructs the session's file path from
  `<projectDir>/<sessionId>.jsonl` rather than re-scanning
  `listClaudeSessions` — the id-to-filename mapping is already exact and
  stable (see `parser.ts`'s use of the filename stem as `sessionId`).

## Deviations from plan.md

None. The panel matches the layout sketched in plan §3 (collapsible list,
provider tabs, chart, detail-on-click), modulo the specific visual styling,
which plan.md left unspecified.

## Follow-up risks / notes for Phase 3+

- No live update: opening the panel loads data once; switching conversations
  re-fetches, but the currently-displayed conversation does not refresh if
  the underlying session file changes while the panel is open. Phase 5's
  file-watching (plan §6) should drive both the status bar and an open
  panel.
- The chart has no y-axis scale/gridlines and no legend for the four segment
  colors — acceptable for a first cut given hover tooltips (native SVG
  `<title>`) explain each bar, but a legend is a likely near-term polish
  item once Codex data (different token shape) starts appearing in the same
  chart.
- Multi-root workspaces still use `workspaceFolders[0]` only (carried over
  from Phase 1's note); the panel does not yet let a user switch which
  workspace/root it's showing.
- The zero-usage synthetic requests (Phase 1's local-slash-command finding)
  now show up as near-invisible slivers in the chart; the transparent
  full-height hit-target rect makes them still clickable, but a future pass
  may want to filter or visually flag them rather than let them look like
  empty bars.
