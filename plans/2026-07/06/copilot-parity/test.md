# Test Proof

## Plan Validation - 2026-07-06

Before implementation, inspected real local data rather than relying only on
`plans/2026-07/05/conversation-meta/survey.md`:

- Located this workspace's own Copilot chatSessions via
  `%APPDATA%\Code\User\workspaceStorage\f7c4183b4b7387d739ea08adb234cc7e\`,
  matched by that folder's `workspace.json` (`"folder":
  "file:///c%3A/dev/VectorMind/agent-context-trail"`).
- Found real, non-trivial session files (VS Code + GitHub Copilot Chat
  0.55.0) and inspected them directly with throwaway Node scripts (not
  committed) - this falsified the original plan's "tokens require OTel
  opt-in" premise; see `plan.md` "External Research" for the full record.
- Reverse-engineered and then validated the `.jsonl` append-log format
  (`kind:0`/`kind:1`/`kind:2`) by writing a generic patch-reconstruction
  script and confirming its output (`customTitle`, `requests[].promptTokens`
  etc.) matched values read directly off individual lines.
- This resolved `OP-004` (format is `.jsonl`) and corrected `OP-003`
  (tokens/cost/model are zero-config) before any production code was
  written.

## Implementation Verification - 2026-07-06

- `npm run typecheck` - passed.
- `npm run build` - passed (`dist/extension.js`, `dist/webview.js` both
  rebuilt without errors).
- Real-data Copilot parser proof against this workspace's own local data
  (throwaway `verify-copilot.ts`, bundled standalone with `esbuild` since it
  imports no `vscode` API, run with `node`, then deleted):
  - `listCopilotConversations('c:\dev\VectorMind\agent-context-trail', ...)`
    returned `2` real conversations (empty stub sessions with 0 requests
    correctly excluded).
  - Conversation `1b049bd5-ccca-42a6-afd2-ab73f7467319` ("hi"): 2 requests,
    57,661 total tokens, `estimated` total cost `$0.1779`.
    - Request 2: model `gpt-5-mini`, in `31492` / out `2531`, `6` tool
      calls (including one real tool error - `read_file` on a bad relative
      path, `isError: true`, matching the real `toolCallResults` error
      text), reasoning `1600`, time-to-first-token `9597ms`, wall time
      `32250ms`, context window `127790`, premium credits `1.412405`, cost
      `$0.1167`.
  - Conversation `935d4fd2-abd5-4c67-991c-01bb69b367c4` ("Key binding issue
    for window reload"): 2 requests, both resolving to the internal routing
    codename `oswe-vscode-prime` (shown to the user as "Raptor mini") -
    confirmed the fallback rate path is exercised for real, non-public
    model names rather than going `unavailable`.
  - A bug was caught by this pass: `modelContextWindow` came back
    `undefined` on the first run because `maxInputTokens` actually lives at
    `inputState.selectedModel.metadata.maxInputTokens`, one level deeper
    than first coded from memory of the earlier field inspection. Fixed in
    `parser.ts`; re-run confirmed `ctxWindow: 127790` on every request.

Behavioral checks covered by the proof:

- Copilot conversation discovery is workspace-scoped (matches this
  project's own `workspaceStorage` folder specifically) and no longer
  renders as "support is not implemented yet."
- Real tokens, resolved model, tool calls (with real error detection from
  `toolCallResults`, not string-sniffing), reasoning tokens, timings, and
  `estimated` cost are all populated from data VS Code's Copilot Chat
  extension already writes - no setting flipped, no command run, no export
  file involved anywhere in this proof.
- Premium credits (`copilotCredits`) surface as their own field, separate
  from and never merged with the USD cost estimate.
- Cache-read/cache-write tokens correctly stay at the provider's structural
  zero (no cache concept exists in this source), matching the same
  convention already used for Codex's cache-write tier.

Remaining gaps:

- No live VS Code panel screenshot or manual hover/click check was run in
  this turn; visual layout and interaction (Storage Footer placement,
  premium-credit chip, edited-files block) were verified by source
  inspection and the shared webview render path only, not a live capture.
- No real example of an errored/canceled Copilot request or a real
  `editedFileEvents` payload was found on this machine to verify those two
  fields against; both stay defensively parsed (see `implementation.md`
  "Known Gaps").

## Corrective Verification - 2026-07-20

- Added unit coverage for adaptive USD precision, including positive values
  from `$0.0042` down below `$0.000001`; no nonzero positive cost renders as
  `$0.00`.
- Added unit coverage for Copilot's last-request context projection (used,
  available, capacity, and fill percentage) and unavailable-value handling.
- Reviewed current official VS Code documentation for Copilot Chat OTel,
  content-disabled file export, SQLite trace export, Agent Debug Log export,
  per-call GenAI token attributes, and enterprise-managed precedence. Findings
  and remaining empirical proof moved to `plans/2026-07/20/copilot-otel`.
- `npm.cmd test` - passed, 26/26 tests.
- `npm.cmd run typecheck` - passed.
- `npm.cmd run build` - passed.
- `git diff --check` - passed.
