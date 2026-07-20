# Implementation Log

[######] Done - Copilot provider support shipped from local `chatSessions`
data (zero configuration); verified with typecheck, build, and a real local
Copilot chatSessions parse against this machine's own workspace history.

## 2026-07-20 Corrective Amendment

- Fixed sub-cent USD display globally: nonzero estimates below `$0.01` now use
  adaptive precision instead of rendering as `$0.00`.
- Fixed the missing Copilot Current Context Status projection. The parser had
  already captured request-level `promptTokens` and `maxInputTokens`, but never
  assigned a `currentStatus` to the returned conversation summary.
- Kept Copilot Prompt timeline context unavailable because `chatSessions` has
  no per-LLM-call usage. The supported OTel file-export enrichment path and
  enterprise-policy constraints moved to the follow-up packet
  `plans/2026-07/20/copilot-otel`.
- Made the test runner recurse through esbuild's output tree; adding tests in
  multiple source folders exposed that it had only scanned the output root.

## Files Changed

- `src/providers/copilot/discover.ts` - new: finds the current workspace's
  `workspaceStorage/<hash>` folder by scanning every folder's
  `workspace.json` for a matching `folder` URI (decoded via
  `url.fileURLToPath`), enumerates `chatSessions/*.jsonl`, and lists
  conversations with mtime caching, matching the Claude/Codex discovery
  pattern (in-memory only, no disk persistence).
- `src/providers/copilot/parser.ts` - new: reconstructs each `.jsonl`
  session's document from its append-log of patch operations (`kind:0` full
  snapshot, `kind:1` set-at-path, `kind:2` push-onto-array-at-path - see
  `plan.md` "External Research"), then maps each finished request to
  `PromptRequest`: real input/output tokens, resolved model, tool calls with
  real per-call error text, thinking/reasoning tokens, timings, premium
  credits, and an `estimated` USD cost.
- `config/tokens-cost.yaml` / `src/pricing/pricingService.ts` - added a
  `copilot` rate section (fallback-only for now, cited/dated) and
  `estimateCopilotCost()`, mirroring `estimateCodexCost()` (no cache-write
  tier).
- `src/domain/types.ts` - added `premiumCredits` and `editedFiles` to
  `PromptRequest`, both optional.
- `src/panel/panelController.ts` / `src/extension.ts` - wired Copilot
  discovery/parsing into the panel's conversation list, detail loading, and
  the status bar's cross-provider "latest conversation" selection. No
  Copilot-specific status bar fallback was needed - cost is real data now,
  so the existing generic cost-or-fallback rendering already handles it.
- `src/webview/main.ts` - removed the "Copilot support is not implemented
  yet" special case; added a premium-credits chip and an edited-files list
  to the enriched request card; added the panel's Storage Footer (always
  "no local data stored" today).
- `src/panel/panelController.ts` - added the Storage Footer's CSS.
- `README.md` / `specification/provider-and-cost.md` - documented what's
  real (tokens, model, cost, credits) and what isn't (cache tokens) for
  Copilot; updated the durable spec paragraph that previously called
  Copilot "titles and conversation structure... out of scope."

## Implementation Decisions

- The original two-tier plan (opt-in OTel export for real tokens) was
  revised before implementation after inspecting this workspace's own real
  `chatSessions/*.jsonl` files and finding real tokens/model/cost signals
  already present, zero-config. See `plan.md`'s "Revision note" and
  "External Research" for the full record; the OTel/`sql.js` tier is
  deferred, not built.
- `chatSessions/*.jsonl` is an append log of patch operations, not a
  snapshot - confirmed empirically (`kind:0`/`kind:1`/`kind:2`, generic
  path-based set/push). The parser implements a small generic patcher
  rather than a hand-picked field list, since `kind:1` can set arbitrary
  top-level fields (e.g. `customTitle` arrives this way, not in the initial
  `kind:0` snapshot).
- `resolvedModel` can be a non-public internal routing codename (observed:
  `"oswe-vscode-prime"`, shown to the user as "Raptor mini"). Rather than
  mark cost `unavailable` for unrecognized models, the `copilot` rate table
  falls back to a generic current-generation rate, matching the existing
  Claude/Codex BYOT precedent that `unavailable` is reserved for "no rate
  table entry at all," not "unrecognized model name."
- Session-level `maxInputTokens` (model capacity) lives at
  `inputState.selectedModel.metadata.maxInputTokens` - one level deeper than
  first assumed; caught by the real-data verification pass (see `test.md`).
- Empty stub sessions (0 requests - e.g. a session created but never
  prompted) are filtered out of the conversation list rather than shown as
  empty rows; this is a discovery-level filter, not a fabricated exclusion
  of real data.
- The Storage Footer ships in its static "no local data stored" state; no
  disk-persisted artifact exists in this packet, so the Data Retention
  rule's active-enforcement machinery is not built (correctly dormant per
  `surfaces-and-privacy.md`).

## Known Gaps

- Cache-read/cache-write tokens are genuinely unavailable for Copilot - not
  a missing feature, confirmed absent from the real data source.
- `errorDetails` on a canceled/errored request was not observed in any real
  local file searched on this machine; parsed defensively
  (`request.stopReason`), not empirically confirmed.
- `editedFileEvents` was not observed in either real sample used for
  verification (both were read/tool-call heavy sessions); the field is
  parsed defensively and will simply stay absent until a session with real
  file edits is available to confirm its shape.
- The `copilot` rate table in `config/tokens-cost.yaml` currently ships
  fallback-only (no per-model entries); per-model precision can be added
  once specific Copilot-resolved model names are confirmed against a cited,
  dated public rate.
- No live VS Code visual smoke pass was run in this turn; verification is
  compile/build plus direct parser proof against this machine's real local
  Copilot chatSessions data (see `test.md`).
