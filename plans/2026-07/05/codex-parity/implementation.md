# Implementation Log

[######] Done - Codex provider support and Current Status shipped; verified with
typecheck, build, and a real local Codex rollout parse.

## Files Changed

- `src/providers/codex/discover.ts` - new Codex conversation discovery from
  `~/.codex/sessions`, scoped to the current workspace, with session-index
  title lookup, per-file mtime caching, and a user-facing path label for
  filtering.
- `src/providers/codex/parser.ts` - new Codex request parser using
  `task_started` / `turn_context` / `task_complete` turn boundaries, tool call
  pairing, prompt capture, explicit reasoning-output and time-to-first-token
  fields, rate-limit snapshots, and selected-conversation current-context
  status.
- `src/domain/types.ts` / `src/panel/protocol.ts` - added provider-conditional
  current-status types plus Codex request fields; USD cost is now optional so
  unavailable provider cost stays unavailable instead of rendering as zero.
- `src/extension.ts` / `src/status/statusBar.ts` - refresh and tooltip are no
  longer Claude-only; the latest workspace conversation may now be Codex, and
  the tooltip can show the passive current-context readout when present.
- `src/panel/panelController.ts` / `src/webview/main.ts` / `src/webview/chart.ts`
  - panel now loads Codex rows and detail, inserts a distinct `Current Status`
  panel above the conversation thread, auto-selects the last request when a
  conversation changes, adds the Codex path filter, and keeps USD-unavailable
  surfaces honest in charts and tables.
- `src/providers/claude/parser.ts` - adjusted for optional USD on the shared
  cost type; Claude behavior remains the same.

## Implementation Decisions

- Codex cost remains `unavailable`; the panel and status bar render `n/a`
  rather than fabricating `$0.00`.
- Current-context fill for Codex is based on the provider-reported request
  input against `model_context_window`. An earlier `input + cached` attempt
  produced impossible values above 100% on real data and was removed.
- The path filter is shown only when the selected provider exposes path labels.
- `Current Status` is its own stacked panel, but still follows the selected
  conversation and uses the selected conversation's latest context snapshot.

## Known Gaps

- Copilot remains unimplemented.
- No live VS Code visual smoke pass was run in this turn; verification is
  compile/build plus direct parser proof against local Codex data.

## Amendment 2026-07-05: Codex Cost Estimation, Encoding Fixes, "Prompt" Rename

Maintainer-reported follow-up on the shipped Codex work, actioned same day:

- Fixed literal encoding corruption in `src/webview/main.ts` (`icon: 'â‰¡'` →
  `'≡'`, `'Filter by pathâ€¦'` → `'Filter by path…'`, five `'Â·'` → `'·'`
  instances) — these rendered as garbled characters on the Current Status
  section title and other summary rows.
- Renamed the display label "Request" → "Prompt" throughout the panel and
  charts (section titles, table column, tooltips, aria-labels, chart headers,
  output-channel summary) to stop reading as a REST/API request. Internal
  identifiers (`PromptRequest`, `requestCount`, `selectedRequestIndex`, etc.)
  were left alone — this was a display-label rename, not a domain rename.
- Reversed the "Codex cost is unavailable" decision (see plan.md amendment):
  added a `codex` rate table to `config/tokens-cost.yaml`
  (`developers.openai.com/api/docs/pricing`, retrieved 2026-07-05), added
  `PricingService.estimateCodexCost`, and threaded a `PricingService` through
  `scanCodexSessionMeta`, `parseCodexSession`, and `listCodexConversations`
  (`src/providers/codex/parser.ts`, `discover.ts`, `src/extension.ts`,
  `src/panel/panelController.ts`). Codex `PromptRequest.cost` and
  `ConversationSummary.totalCost` are now `estimated` instead of
  `unavailable`.
- `src/status/statusBar.ts`: the compact status-bar text no longer collapses
  to `n/a | n/a` when cost is unavailable for a request/model the rate table
  truly can't resolve — it falls back to rate-limit `used_percent`, then a
  plain prompt count. The tooltip gained a rate-limit line
  (`appendRateLimits`) and only shows the "does not report per-token cost"
  note when cost is genuinely absent. In practice this fallback path is now
  rarely hit for Codex since `estimateCodexCost` always resolves a rate
  (including its own fallback entry).
