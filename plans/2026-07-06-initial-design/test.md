# Test Proof — Phase 1 & 2

Packet: `plans/2026-07-06-initial-design`. Proof for
[implementation.md](implementation.md). Phase 2 proof is appended after the
Phase 1 section below.

## Commands run

```powershell
npm install                # 288 packages; added @types/js-yaml on a second pass
npm run typecheck           # tsc --noEmit -> clean, no errors
npm run build                # esbuild -> dist/extension.js (119 KB) + .map
npx vsce package --no-dependencies -o agent-context-trail.vsix
code --install-extension agent-context-trail.vsix --force
```

`vsce package` output (files actually shipped in the VSIX — confirms
`.vscodeignore` correctly excludes `plans/`, `specification/`, `.agents/`,
`src/`, and source maps while keeping the pricing config):

```text
extension/
├─ LICENSE.txt [1.04 KB]
├─ package.json [2.2 KB]
├─ readme.md [2.02 KB]
├─ dist/extension.js [116.59 KB]
└─ pricing/pricing.yaml [2.67 KB]
Packaged: agent-context-trail.vsix (7 files, 30.6 KB)
```

(`pricing/pricing.yaml` was renamed to `config/tokens-cost.yaml` after this
run — see implementation.md. Re-packaging now ships `config/tokens-cost.yaml`
at the same size instead.)

`code --install-extension` reported success (one unrelated Node
`DEP0169 url.parse()` deprecation warning from the `code` CLI itself, not
from this extension).

## Logic verification against a real Claude Code session

The extension host code can't run outside VS Code, and there's no way to
visually inspect the installed status bar from this environment, so the
provider/parser/pricing modules (none of which import `vscode`) were
exercised directly: a disposable script (`.tmp/verify-claude.ts`, bundled
with esbuild, run with `node`, then deleted — per `WORKFLOW.md`, `.tmp/` is
for disposable artifacts) called `findClaudeProjectDir`,
`listClaudeSessions`, and `parseClaudeSession` against this repository's own
live Claude Code session file for this exact workspace.

### Expected

- Discovery resolves `C:\dev\VectorMind\agent-context-trail` to
  `~/.claude/projects/C--dev-VectorMind-agent-context-trail` via the slug
  fast path (no fallback scan needed).
- The most recently modified session file in that directory is picked.
- Parsing reproduces the conversation title, groups requests correctly, and
  computes plausible token/cost totals.

### Actual

```text
workspacePath: C:\dev\VectorMind\agent-context-trail
projectDir: C:\Users\wassi\.claude\projects\C--dev-VectorMind-agent-context-trail
sessions found: 1
latest session: 1175018a-a8f2-498b-85d7-7265542ba0df  mtime 2026-07-04T18:43:26.249Z
title: Design VS Code extension for API usage analytics
requests: 7
#1 model=undefined  in=0        cacheRead=0        cacheWrite=0       out=0      tools=0   cost=$0.0000
#2 model=undefined  in=0        cacheRead=0        cacheWrite=0       out=0      tools=0   cost=$0.0000
#3 model=claude-fable-5   in=40698  cacheRead=1403285  cacheWrite=171417  out=37735  tools=16  cost=$7.1254 (712.54 AIC)
#4 model=claude-fable-5   in=550    cacheRead=2689693  cacheWrite=33078   out=37039  tools=17  cost=$5.2087 (520.87 AIC)
#5 model=undefined  in=0        cacheRead=0        cacheWrite=0       out=0      tools=0   cost=$0.0000
#6 model=undefined  in=0        cacheRead=0        cacheWrite=0       out=0      tools=0   cost=$0.0000
#7 model=claude-sonnet-5  in=130    cacheRead=9291165  cacheWrite=444231  out=87158  tools=40  cost=$4.5070 (450.70 AIC)
TOTAL in=41378 cacheRead=13384143 cacheWrite=648726 out=161932 cost=$16.8411 (1684.11 AIC)
```

### Assessment

- Discovery: **pass**, slug fast path matched on the first try.
- Title: **pass**, matches the `ai-title` record verbatim.
- Grouping: **pass with an explained edge case** — requests #1, #2, #5, #6
  are local slash-commands (e.g. `/model claude-fable-5[1m]`), which
  genuinely carry no model usage. This is correct per Claude Code's own
  behavior (local commands are handled by the CLI, not sent to the model),
  not a parser defect. Documented as a Phase 2 UX question in
  implementation.md, not a bug.
- Model switch mid-session: **pass** — request #3/#4 correctly show
  `claude-fable-5`, request #7 correctly shows `claude-sonnet-5` after the
  in-session `/model` switch, confirming per-request model attribution
  (not a single session-wide model) works.
- Cost magnitude: **plausible** — $16.84 total for a long, tool-call-heavy
  design session with ~13.4M cumulative cache-read tokens is consistent
  with the size of this actual conversation.

## Known gaps

- ~~No visual confirmation of the status bar/tooltip.~~ **Resolved**: the
  maintainer reloaded the window and confirmed the status bar
  (`$0.11 | $20.05`), tooltip (last call / conversation total / toggle
  link), and output-channel detail dump all render exactly as designed, on
  the real session.
- No automated test suite yet (no test framework wired up). Phase 1
  verification relied on running the real parser against a real session,
  which is stronger evidence than a mocked unit test but is manual and not
  repeatable in CI. Consider adding a small fixture-based test harness once
  Phase 2's panel needs regression protection.
- Codex and Copilot paths are entirely unimplemented (by design — Phase 3/4).

## Environment notes

- Windows 11, PowerShell, Node via `nodejs` global install, VS Code CLI
  (`code`) on PATH.
- Verified against the maintainer's real `~/.claude/projects/` data on this
  machine; paths and slugs will differ on other machines but the matching
  logic is designed to be portable (see implementation.md).

# Test Proof — Phase 2

Proof for the "Implementation Log — Phase 2" section of
[implementation.md](implementation.md).

## Commands run

```powershell
npm run typecheck    # tsc --noEmit -> clean, including src/webview (DOM lib)
npm run build         # esbuild -> dist/extension.js (127 KB) + dist/webview.js (10.4 KB)
npx vsce package --no-dependencies -o agent-context-trail.vsix
code --install-extension agent-context-trail.vsix --force
```

`vsce package` output — confirms both bundles ship and nothing else leaks in:

```text
extension/
├─ LICENSE.txt [1.04 KB]
├─ package.json [2.34 KB]
├─ readme.md [2.02 KB]
├─ config/tokens-cost.yaml [2.67 KB]
└─ dist/
   ├─ extension.js [124.36 KB]
   └─ webview.js [10.4 KB]
Packaged: agent-context-trail.vsix (8 files, 35.77 KB)
```

## Logic verification against real data (pre-package)

Same rationale as Phase 1: this environment has no way to drive the actual
webview UI, so before packaging, the new host-side data functions
(`listClaudeConversations`, `getClaudeSessionFilePath`) were exercised
directly via a disposable bundled script (`.tmp/verify-panel-data.ts`, run
with `node`, then deleted) against this repository's real, live Claude Code
session — the same one the Phase 1 proof used, now grown to 11 requests.

### Expected

- `listClaudeConversations` returns one item for this workspace, with a
  title matching the `ai-title` record.
- `getClaudeSessionFilePath` resolves that item's id back to the exact
  session file on disk.
- Parsing that resolved path produces a title identical to the list's title
  (list and detail must agree — they're derived from the same file by two
  different code paths).

### Actual

```text
conversations found: 1
- 1175018a-a8f2-498b-85d7-7265542ba0df  updatedAt=2026-07-04T19:06:29.382Z  title="Design VS Code extension for API usage analytics"

resolved file path for first item: C:\Users\wassi\.claude\projects\C--dev-VectorMind-agent-context-trail\1175018a-a8f2-498b-85d7-7265542ba0df.jsonl
detail.title matches list title: true
detail.requests.length: 11
detail.totalCost: { usd: 24.723301000000003, source: 'estimated' }
```

### Assessment

- List/detail agreement: **pass** — `peekClaudeSessionTitle` (cheap,
  title-only scan) and `parseClaudeSession` (full parse) agree exactly on
  the title, confirming the two-tier read strategy (list = cheap, detail =
  full) doesn't drift.
- Id → file path resolution: **pass** — `getClaudeSessionFilePath`
  reconstructed the path purely from `<projectDir>/<id>.jsonl` and it
  existed and parsed correctly.
- Cost total grew from $16.84 (Phase 1 proof, 7 requests) to $24.72 (11
  requests) between the two verification runs — consistent with this same
  conversation continuing to accumulate real usage during Phase 2's own
  development.

## Known gaps (Phase 2)

- No visual confirmation of the panel UI itself (tabs, list, chart
  rendering, click-to-select, collapse toggle) — same environment
  limitation as Phase 1. The maintainer should run
  **Developer: Reload Window**, click the status bar item (or run
  `Agent Context Trail: Open Conversation Panel`), and confirm: the Claude
  tab shows this conversation, the chart renders 11 bars with a visible
  cost line, clicking a bar shows the detail card, and the collapse toggle
  hides/shows the list pane.
- Codex and Copilot tabs are only exercised in the "empty state" path
  (`conversationsByProvider.codex/copilot === []`) — not a real gap, since
  those providers aren't implemented, but worth confirming the "support is
  not implemented yet" message actually renders instead of a silently
  empty list.
- No automated test for the webview's message-handshake (`ready` → `init`)
  timing; verified only by code review of the race described in
  implementation.md, not by a running test.
