# Codex Parity Plan

## Problem Summary

The panel already has a Codex tab, but there is no Codex provider adapter under
`src/providers/`. Codex currently renders as "support is not implemented yet"
while Claude has the full D - Enriched surface.

This packet plans Phase 3: implement Codex support from local Codex session
data, first reaching honest parity where Codex exposes equivalent request and
conversation fields, then surfacing Codex-native status signals that Claude
does not currently expose.

## Goal

Make Codex conversations usable in the same panel without pretending Codex and
Claude have identical telemetry.

1. Show a Codex conversation list from local Codex session data.
2. Parse Codex turns into the same `ConversationSummary` / `PromptRequest`
   domain model where fields are equivalent.
3. Extend the domain model and D - Enriched card only where needed for
   Codex-native fields.
4. Add a provider-conditional current-status surface for Codex signals that are
   not request-detail facts, while keeping provider-global limits distinct from
   conversation-scoped context status.
5. Preserve the provider contract: absent fields are unavailable, never zero.

## Starting Evidence

From `plans/2026-07/05/conversation-meta/survey.md`:

- Codex local sessions live under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  plus `session_index.jsonl`.
- Observed Codex fields include conversation metadata, model slug,
  `model_context_window`, `input_tokens`, `output_tokens`,
  `reasoning_output_tokens`, `total_tokens`, rate-limit snapshots with
  `used_percent` and reset times, `duration_ms`, `time_to_first_token_ms`,
  shell/tool calls with commands, outputs, durations, and errors.
- Codex has no honest USD cost in the sampled data. The provider-specific
  economic signal is rate-limit consumption rather than estimated dollars.

Current repo check:

- `src/providers/claude/*` exists.
- No `src/providers/codex/*` exists.
- `src/panel/panelController.ts` already lists `codex` as a provider tab but
  supplies an empty list and only loads Claude detail.

## Scope Boundaries

The Codex surface must stay honest about the level of data it represents.

- The Codex table is a conversation list, not a workspace-level aggregation.
- Do not compute or display workspace totals, workspace summaries, or
  cross-workspace analytics.
- If Codex session metadata exposes a path, use it only as conversation
  metadata and as a user-facing path filter. Do not describe path filtering as
  a workspace aggregation.
- A conversation total is still allowed when it is the sum of that
  conversation's own requests.
- Rate-limit state is current provider/account status, not conversation
  metadata and not request telemetry.
- Current context status is conversation-scoped status for the selected
  conversation, not a provider-global summary.
- Request token composition remains the request detail surface. Current context
  status is related to the latest request, but it may also add model context
  capacity, reserved-for-output budget, fill percentage, and long-context or
  expensive-context mode.

## Parity Scope

Implement these Claude-equivalent fields for Codex when present:

- conversation id, title, first/last timestamps;
- request boundaries and request count;
- model per request and model switches;
- input tokens, output tokens, and total tokens;
- tool calls with target preview, input/output size, duration, and error flag;
- request wall time;
- prompt text when available in the local log;
- conversation table rows and detail loading through the existing provider tab.

Map unavailable Claude-specific fields honestly:

- cache read/write, cache-write TTL split, and cache-miss reasons are
  unavailable unless Codex logs equivalent cache fields in future samples;
- subagent transcript attribution is unavailable unless Codex records a stable
  delegated-agent transcript boundary.

USD cost is **not** in this unavailable list (see amendment below): Codex does
not report cost directly, but that alone does not make it unavailable — a
maintained OpenAI API rate table gives the same `estimated` confidence tier
Claude uses.

## Codex-Native Scope

Add Codex-only value where the sampled logs expose it:

- reasoning output tokens as a separate request metric;
- time to first token as a timing chip distinct from full wall time;
- model context window when Codex reports it;
- current context status as a current-status metric, including context fill and
  related capacity fields rather than a duplicate request composition chart;
- rate-limit snapshots (`used_percent`, reset windows) as an additional
  subscription/quota signal shown alongside estimated USD cost, not instead
  of it.

UI rules:

- These fields appear only for providers that expose them.
- The panel must not add a cross-provider chart that implies Claude has the
  same signals.
- Rate limits should live in a separate Current Status section near the top of
  the panel. The section may be collapsible.
- Current context status belongs with Current Status for the selected
  conversation, not as a provider-global latest-only summary inside the panel.
- Request detail may show the request's own token composition and context
  window facts. Current Status may separately show context capacity,
  reserved-for-output budget, fill percentage, and long-context or
  expensive-context mode for the selected conversation.
- The status bar tooltip may show the last prompted conversation's current
  context status as a passive readout. Switching to another conversation's
  context status happens in the panel.

## Proposed Implementation Phases

1. **Codex discovery**
   - Add `src/providers/codex/discover.ts`.
   - Locate candidate rollout files under the user's Codex session tree.
   - Produce a Codex `ConversationListItem[]` for the panel.
   - Preserve discovered path metadata and expose it through a user-facing path
     filter without turning it into workspace totals or workspace summaries.

2. **Codex parser**
   - Add `src/providers/codex/parser.ts`.
   - Group rollout events into prompt requests with stable request ids.
   - Populate the shared `ConversationSummary` model for parity fields.
   - Preserve raw-provider uncertainty in comments/tests for ambiguous event
     boundaries.

3. **Domain extensions**
   - Extend `PromptRequest` only for request-scoped fields that are not
     Claude-shaped: reasoning tokens and time-to-first-token.
   - Add a provider-conditional status shape that separates provider-global
     fields such as rate-limit snapshots from selected-conversation fields such
     as context-window size, reserved-for-output budget, fill percentage, and
     long-context or expensive-context mode.
   - Keep every new field optional.

4. **Panel integration**
   - Update `PanelController.sendInit()` to load Codex list items.
   - Update `loadDetail()` to dispatch by provider instead of Claude-only.
   - Add a top Current Status section that combines provider-global status and
     selected-conversation context status without conflating them.
   - Keep the Current Status section directly above the request chart so it
     reads as the last status of the selected conversation's current context.
   - When a conversation is selected, auto-select its last request for the
     lower request-detail section unless the user explicitly changes the
     request selection.
   - Keep Codex no-data states explicit.

5. **D - Enriched UI additions**
   - Add provider-conditional chips/rows for Codex-native request fields.
   - Avoid mixing rate-limit percent with USD cost; show it as separate
     provider status.
   - Distinguish request token composition from current context status by
     showing context capacity, reserved output, fill percentage, and
     long-context or expensive-context mode only in Current Status.
   - Use a direct label for the top section that makes the distinction clear:
     `Current Context Status`.

6. **Verification**
   - Unit or scratch parser checks against at least one real Codex rollout.
   - `npm run typecheck`.
   - `npm run build`.
   - Webview smoke check that Claude still renders D - Enriched and Codex
     renders real rows/detail when local data exists.
   - UI smoke check that Current Status collapses without implying rate limits
     belong to a conversation.

## Open Decisions

- None. The packet is ready for implementation.

## Resolved Implementation Decisions

- `OD-001`: use a user-facing path filter in the Codex conversation list.
- `OD-002`: place `Current Context Status` above the request chart, treat it as
  the latest context status for the selected conversation, and auto-select the
  last request for the lower request-detail section when the conversation
  changes.

## Resolved Specification Decisions

- `SR-001`: `Current Status` is a third durable surface.
- `SR-002`: Current Status may include provider-global limits and
  selected-conversation context status, but it must not compute workspace,
  time-window, or cross-conversation aggregation.
- `SR-003` and `SR-004`: the status bar tooltip may show the last prompted
  conversation's current context status as a passive readout only.
- `SR-005`: the durable specs may name provider-specific fields and behavior
  directly. The product should take maximum practical advantage of Copilot,
  Codex, and Claude rather than collapsing to a lowest common denominator.
- `SR-006`: current context status is materially related to the latest request,
  but it is not identical to request token composition because it may also
  include total context capacity, reserved-for-output budget, fill percentage,
  and long-context or expensive-context mode.

## Specification Checkpoint

Reviewed `specification/product-scope.md`, `provider-and-cost.md`, and
`surfaces-and-privacy.md`.

- Respected: the work stays local-first and uses provider-written local files.
- Respected: the work does not add workspace totals or workspace aggregation.
- Resolved: `product-scope.md` now defines `Current Status` as a third surface
  with no new aggregation level.
- Resolved: `surfaces-and-privacy.md` now allows a passive tooltip readout for
  the last prompted conversation's context status and defines Current Status as
  a panel surface that follows the selected conversation.
- Resolved: `provider-and-cost.md` now explicitly prefers provider-specific
  depth over false symmetry and separates rate-limit consumption from USD cost.

## Amendment: Codex Cost Is Estimated, Not Unavailable

`SR-002`/`SR-005` above and the original Parity Scope both treated Codex USD
cost as unavailable because Codex's local logs don't report cost directly.
That reasoning conflated "not provider-reported" with "not knowable" — the
same gap Claude cost estimation already closes with a maintained rate table.
The maintainer corrected this: the product's purpose is to make real usage
legible against opaque subscription rate limits, so a BYOT-equivalent dollar
estimate belongs on Codex requests too, computed the same way Claude's is.

- `specification/provider-and-cost.md` gained a "Subscription-billed providers
  still get a BYOT cost estimate" section making this a durable rule: a
  subscription/rate-limit billing model is not grounds for `unavailable`
  cost as long as usable token counts exist.
- `config/tokens-cost.yaml` gained a `codex` rate table (source:
  `developers.openai.com/api/docs/pricing`, retrieved 2026-07-05) shaped like
  the Claude table minus the cache-write tiers Codex doesn't have.
- `PricingService.estimateCodexCost` mirrors `estimateClaudeCost`: per-token
  rates against `inputTokens` / `cacheReadTokens` / `outputTokens`, `estimated`
  confidence, resolved model → fallback rate.
- Codex `PromptRequest.cost` and `ConversationSummary.totalCost` are now
  `estimated` instead of `unavailable`; rate-limit `used_percent` remains a
  separate status field shown alongside cost, not a replacement for it.
