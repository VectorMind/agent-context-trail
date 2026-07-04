[######] Phase 1 done — Claude Code data + status bar implemented and
validated against a real session; ready to reload/test in a running VS Code
window. Follow-ups noted below.

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
