# Copilot Parity Plan

## Problem Summary

The panel already has a Copilot tab, but there is no Copilot provider adapter
under `src/providers/`. Copilot currently renders as "Copilot support is not
implemented yet" while Claude has the full D - Enriched surface and Codex
reached parity in `plans/2026-07/05/codex-parity`.

This packet plans Phase 4: implement Copilot support from local VS Code
Copilot Chat session data, reaching honest parity where Copilot exposes
equivalent request and conversation fields, and surfacing Copilot-native
signals.

**Revision note (2026-07-06):** an earlier draft of this plan assumed real
token/cost data was locked behind Copilot's opt-in OpenTelemetry export
(`agent-traces.db`), based on `plans/2026-07/05/conversation-meta/survey.md`.
Direct inspection of real, current `chatSessions/*.jsonl` files on this
machine (see "External Research") falsified that assumption: input/output
tokens, the resolved model, and a real premium-credit cost signal are already
present in the always-on chatSessions log, zero configuration required. This
revision replaces the two-tier (zero-config / OTel opt-in) design with a
single zero-config tier that already reaches real economics, and defers the
OTel reader entirely - see "Copilot Cost Enrichment (deferred)" below.

## Goal

Make Copilot conversations usable in the same panel as Claude and Codex,
using only data VS Code's own Copilot Chat extension already writes locally,
with no configuration step and no action on the user's VS Code settings ever
taken by this extension.

1. Show a Copilot conversation list from local VS Code `chatSessions` data,
   scoped to the current workspace, using only data already written by normal
   Copilot Chat use - zero configuration required.
2. Parse Copilot requests into the same `ConversationSummary` / `PromptRequest`
   domain model where fields are equivalent: prompts, models, timings, tool
   calls, errors, titles, **and real input/output tokens plus an
   `estimated` USD cost** (see "External Research" - these are not gated
   behind any opt-in step).
3. Surface Copilot-native fields: real premium-request credits consumed
   (`copilotCredits`), per-round thinking tokens, explicit first-progress
   latency, edited-file events when present.
4. Keep every field honestly unavailable when chatSessions doesn't cover it -
   principally cache-read/cache-write token counts, which do not exist
   anywhere in this log (see "External Research"). Never show zero for
   missing data.
5. Resolve `OP-003` and `OP-004` from `plans/2026-07/05/conversation-meta`
   (the Copilot OTel lead, and the `.jsonl` chatSessions variant) - see
   "External Research" below. The OTel lead was reopened as its own active
   packet on 2026-07-20: `plans/2026-07/20/copilot-otel`.

## External Research

Two rounds of research went into this packet: (a) the competitive survey and
Microsoft's public docs/source (first round, informed the original two-tier
draft), and (b) direct inspection of real local `chatSessions/*.jsonl` files
on this machine (second round, corrected it). Both are recorded here because
the correction only makes sense against what it corrected.

### Round 1: competitive survey and Microsoft's public docs/source

**From `plans/2026-07/04/initial-design/survey-short-list.md`:** Copilot Cost
Tracker is "the only surveyed product with real per-turn economics (cache %,
context resend, cost per turn)" and its `dbSpanExporter` telemetry lead is
flagged as "the most promising path to Copilot per-turn data."

**Microsoft's docs and source**
(`code.visualstudio.com/docs/agents/guides/monitoring-agents`,
`github.com/microsoft/vscode-copilot-chat`) establish that
`github.copilot.chat.otel.dbSpanExporter.enabled` is a real, default-`false`
setting that persists OTel spans (including real token counts) to a SQLite
database via the **Chat: Export Agent Traces DB** command, and that this is
an explicit export action, not a continuous log.

**Copilot Cost Tracker's own listing** confirms it depends on exactly this
setting, and goes further: *"The extension attempts to enable this
automatically on activation."* - a real competitor auto-enabling a setting on
the user's behalf, which is the anti-pattern this packet's durable spec rule
(see "New durable rules adopted," below) guards against regardless of what
this packet ends up building.

This round concluded (in the original draft) that real tokens/cost required
building the OTel reader as an opt-in second tier. That conclusion did not
survive contact with real data - see Round 2.

### Round 2: direct inspection of real local data (corrects Round 1)

This workspace (`c:\dev\VectorMind\agent-context-trail`) has its own real
Copilot Chat history at
`%APPDATA%\Code\User\workspaceStorage\f7c4183b4b7387d739ea08adb234cc7e\chatSessions\`
(matched via that folder's `workspace.json`). Inspecting these files directly
(current VS Code + GitHub Copilot Chat **0.55.0**) found:

- **File format is `.jsonl` (resolves `OP-004`), and it is an append log of
  operations, not a single JSON snapshot:**
  - `{"kind":0,"v":{...}}` - the initial session snapshot (session id,
    creation date, model selection, empty `requests`/`pendingRequests`).
  - `{"kind":1,"v":{...}}` - incremental streaming deltas applied to the
    *in-flight* request while its response is still arriving (observed as
    small sparse per-index patches). These are transient progress and are
    **not needed** for a request that later completes.
  - `{"kind":2,"v":[...]}` - one or more **complete, finished request
    objects** to append to `requests[]`. This is the only operation this
    packet's parser needs: read `kind:0` for session metadata, then apply
    each `kind:2` line's array, in file order, as completed requests. A
    trailing in-flight request with no subsequent `kind:2` (session closed
    mid-response) is simply not represented - honestly incomplete, not
    guessed.
- **Real, per-request fields directly on each finished request object**
  (verified across multiple requests, multiple models, in two different real
  session files):
  - `promptTokens` / `completionTokens` - real input/output token counts
    (e.g. `31492` / `2531`), duplicated (and confirmed consistent) inside
    `result.metadata.promptTokens` / `.outputTokens`.
  - `result.metadata.resolvedModel` - the actual concrete model behind a
    router alias like `modelId: "copilot/auto"` (e.g. `"gpt-5-mini"`). Also
    observed resolving to an internal, non-public codename
    (`"oswe-vscode-prime"`, shown to the user as "Raptor mini" in
    `result.details`) - a real case where no public per-token rate exists,
    which the BYOT cost estimate must fall back on rather than treat as a
    parsing failure.
  - `copilotCredits` - a real fractional premium-request credit value (e.g.
    `1.412405`), far more precise than the integer "1x" multiplier the
    original survey described. Shown alongside the model in
    `result.details` (e.g. `"GPT-5 mini • 1.4 credits"`).
  - `result.metadata.toolCallRounds[].thinking.tokens` - confirms the
    original survey's thinking-tokens finding.
  - `result.metadata.toolCallResults` - per-tool-call-id result content,
    including real tool errors (e.g. `"ERROR while calling tool: Invalid
    input path..."`), usable for tool error detection instead of the
    string-sniffing Codex needs.
  - `result.timings.firstProgress` / `.totalElapsed`, `elapsedMs` - explicit
    latency fields, matching the original survey.
  - `message.text` - the user's prompt text, verbatim.
  - **No cache-read or cache-write token field exists anywhere in this
    data.** The only "cache" mentions found are the LLM API's own
    ephemeral prompt-cache metadata embedded in the rendered prompt
    structure (`"cacheType":"ephemeral"`, `"cacheKey":"..."`), not a token
    count exposed to us. This part of the original survey's finding holds.
  - `editedFileEvents` was **not observed** in either real sample (both
    sessions were read/tool-call heavy, no file edits) - stays a
    defensively-parsed, best-effort field rather than a guaranteed one.
  - `errorDetails` on a canceled/errored request was **not observed** in any
    real local file searched - parsed defensively, same convention as
    Codex's tool-error string-sniffing, not empirically confirmed.

**Decision on `OP-003`:** Copilot's real per-request tokens, resolved model,
and premium-credit cost signal are already zero-config data in
`chatSessions`. Building a second, opt-in OTel tier to obtain them - the
original plan - would have shipped real data as if it needed a setup step it
doesn't. **The OTel reader is deferred, not built in this packet.** Its only
remaining potential value is cache-read/write token granularity, which this
packet's zero-config tier cannot provide; whether that alone justifies the
`sql.js` dependency and a second tier is a decision for a future packet, once
it's clear whether users actually want cache-level detail Copilot doesn't
even use the same way Claude/Codex do (Copilot's own prompt-cache mechanism
is an internal LLM API optimization, not a user-facing cost lever the way
Claude's cache-write/cache-read pricing is).

`OP-003` closes here as **resolved-zero-config-suffices**, evidence recorded
above. `OP-004` closes as **resolved-jsonl-confirmed**.

**New durable rule adopted from Round 1** (already added to
`specification/surfaces-and-privacy.md` under Privacy, during planning, not
deferred to close-out, because the maintainer asked for it directly while
scoping this packet - kept even though the OTel tier itself is now
deferred, because it is a general rule, not a Copilot-specific one):

- The extension must never programmatically write to VS Code settings (its
  own excluded, another extension's, or a provider's) or invoke a command to
  unlock richer data. It may detect state and explain what enabling it would
  unlock, never perform the enabling step itself. Directly motivated by
  Copilot Cost Tracker auto-enabling `dbSpanExporter.enabled` on activation.
- **Data Retention**: any artifact the extension itself persists gets a
  3-month default retention window, user-configurable, pruned only for the
  extension's own artifacts, never touching provider-owned files. **This
  rule stays dormant for this packet**: the zero-config tier below persists
  nothing to disk (same in-memory mtime-cache pattern as Claude/Codex), so
  there is no artifact for it to govern yet. The **Storage Footer** UI
  element the maintainer asked for (see `surfaces-and-privacy.md`) still
  ships in this packet's panel work, in its static "no local data stored"
  state, since the spec now requires it to always be visible regardless of
  which adapter is active.

## Starting Evidence

From `plans/2026-07/05/conversation-meta/survey.md` (superseded on tokens/
cost by Round 2 above, still accurate on the rest):

- Copilot Chat sessions live under VS Code
  `workspaceStorage/<hash>/chatSessions/*.jsonl`.
- Per request: prompt text, `timestamp`, `modelId` (a router alias, e.g.
  `copilot/auto`) alongside the real resolved model in
  `result.metadata.resolvedModel`, `result.details` (display string, e.g.
  `"GPT-5 mini • 1.4 credits"`), `result.timings.firstProgress` /
  `.totalElapsed`, `errorDetails`.
- `result.metadata.toolCallRounds[]`: round id, response text, `toolCalls`,
  `thinking.tokens`.
- `response[]` parts typed by `kind` (`thinking`, `toolInvocationSerialized`,
  `mcpServersStarting`, `inlineReference`, plain-text parts with no `kind`),
  with `toolId`/`toolCallId`; `codeBlocks`.
- `~/.copilot` (Copilot CLI) also exists locally: SQLite `data.db` + `logs/`
  - unexplored, separate lead, not pursued in this packet.

Current repo check:

- `src/providers/claude/*` and `src/providers/codex/*` exist.
- No `src/providers/copilot/*` exists.
- `src/panel/panelController.ts` lists `copilot` as a provider tab but
  supplies an empty list; `src/webview/main.ts` renders the explicit
  "not implemented yet" message.
- The domain model already has optional provider-conditional fields from the
  Codex packet: reasoning output tokens, time to first token, optional USD
  cost, and the Current Status shapes - Copilot's chatSessions tier reuses
  these rather than inventing new ones.
- No existing code path persists anything to disk on the extension's behalf -
  the Codex discovery cache (`src/providers/codex/discover.ts`) is a plain
  in-memory `Map`, cleared on restart. Copilot's chatSessions discovery keeps
  that pattern; this packet adds no disk-persisted artifact.
- `package.json` has no SQLite dependency, and none is added by this packet
  (the OTel reader that would have needed it is deferred).

## Scope Boundaries

- The Copilot table is a conversation list, not a workspace-level aggregation.
  `workspaceStorage` is inherently per-workspace; discovery maps the current
  workspace to its storage folder and reads only that - no cross-workspace
  scanning, no workspace totals.
- **Real data, not blanket unavailability.** Input tokens, output tokens,
  resolved model, and an `estimated` BYOT USD cost are populated directly
  from chatSessions - no tier gating, no setup step.
- **Cache tokens stay honestly unavailable.** No cache-read/write count
  exists anywhere in chatSessions. This is not a missing feature to work
  around; it is what the data actually contains.
- `copilotCredits` (premium-request credits, real and fractional) is a
  plan-quota/economic signal distinct from USD cost - shown as its own
  field, never converted into or merged with the USD estimate, matching the
  existing rule that rate-limit/quota-style signals stay separate from cost.
- `thinking.tokens` maps to the shared `reasoningOutputTokens` field (same
  shape Codex already populates); there is no second, competing source in
  this packet, so `OP-002` (from the original draft, "does OTel supersede
  chatSessions' thinking tokens") is now moot - it closes as **not
  applicable**, since the OTel tier that would have introduced a second
  source is deferred.
- Copilot CLI (`~/.copilot` SQLite) is out of scope for this packet; it stays
  a recorded lead.
- **No settings auto-enablement, ever, for Copilot's own settings or
  commands** - unaffected by deferring the OTel tier; this rule is durable
  regardless (see `surfaces-and-privacy.md`).
- **No new persisted artifacts.** ChatSessions discovery stays in-memory-only,
  matching Codex. The Storage Footer therefore renders its static "no local
  data stored" state for this packet.

## Parity Scope (real, zero-configuration data)

Implement these Claude/Codex-equivalent fields for Copilot:

- conversation id, title, first/last timestamps (from `kind:0` session
  metadata plus each finished request's `timestamp`);
- request boundaries and request count (`kind:2` entries map one-to-one to
  the domain's prompt requests - simpler than Codex's event grouping, and
  simpler than the originally-planned OTel span correlation);
- prompt text per request (`message.text`);
- resolved model per request and model switches
  (`result.metadata.resolvedModel`, falling back to `modelId` when absent);
- **input tokens (`promptTokens`) and output tokens (`completionTokens`)**,
  real, per request;
- **estimated USD cost**, computed the same BYOT way as Codex: real tokens x
  a maintained per-model rate table (new `copilot` section in
  `config/tokens-cost.yaml`, keyed by `resolvedModel`, with a fallback rate
  for internal/non-public codenames like `oswe-vscode-prime` - never
  `unavailable` merely for being an unrecognized model, per the project's
  existing BYOT precedent);
- request wall time (`result.timings.totalElapsed` / `elapsedMs`) and time to
  first token (`result.timings.firstProgress`);
- tool calls with identity, count, arguments, and result/error detail from
  `toolCallRounds[]` + `toolCallResults` (real error strings, not
  string-sniffed like Codex);
- error/interruption state from `errorDetails` (parsed defensively - not
  empirically observed on this machine, see "External Research");
- conversation table rows and detail loading through the existing provider
  tab.

Map unavailable fields honestly (no cache data exists in this source):

- cache-read, cache-write tokens: unavailable;
- cache diagnostics, TTL splits, cache-miss reasons: unavailable;
- subagent attribution: unavailable (VS Code subagents remain a lead);
- rate-limit snapshots: unavailable (no equivalent field found).

## Copilot-Native Scope

Add Copilot-only value where the data exposes it:

- **premium-request credits** (`copilotCredits`, real fractional value) -
  shown as a request-level chip and, summed, a conversation-level total;
  always distinct from the USD cost estimate per the spec;
- **thinking tokens** per request (`toolCallRounds[].thinking.tokens`, into
  the shared `reasoningOutputTokens` field);
- **edited-file events** - files changed per request, as an enriched request
  detail row when the source data has them (best-effort field; not observed
  in either real sample gathered for this packet);
- **explicit first-progress latency** - Copilot is the second provider (after
  Codex) with a provider-reported, not derived, value;
- model `maxInputTokens` / `maxOutputTokens` (from the session's model
  selection metadata) as model-capacity facts in request detail, feeding the
  same context-fill-percentage shape Codex already has.

UI rules:

- These fields appear only for providers that expose them; the panel must not
  add a cross-provider chart implying Claude/Codex have premium credits.
- Current Status for Copilot shows real context-fill once `maxInputTokens`
  and `promptTokens` are both available; otherwise it says so plainly rather
  than showing empty gauges.
- The status bar, when the latest workspace conversation is Copilot, shows
  real per-request/conversation cost like Claude and Codex do (no fallback
  path needed, since cost is real data now, not gated behind a tier).

## Copilot Cost Enrichment (deferred, not built in this packet)

The OTel/`agent-traces.db` reader from the original draft - real schema
already captured from `microsoft/vscode-copilot-chat` source, `sql.js`
selected as the WASM SQLite reader to avoid native bindings - is **not
implemented in this packet**. It is parked here, not deleted, because the
research remains valid for a future decision:

- Its only remaining potential value over the zero-config tier is
  cache-read/cache-write token granularity (the one thing chatSessions
  genuinely does not expose).
- Building it would still require: the three-step user-driven opt-in flow
  (enable `github.copilot.chat.otel.dbSpanExporter.enabled`, run **Chat:
  Export Agent Traces DB**, point this extension at the file), the `sql.js`
  dependency, and - because parsing a large SQLite export repeatedly is real
  overhead - a disk-persisted derived cache, which would be this extension's
  first persisted artifact and would activate the (already-written, still
  dormant) Data Retention rule and its active-enforcement requirements in
  `surfaces-and-privacy.md`.
- Revisit only if cache-level detail turns out to matter to users, given
  Copilot's prompt-cache is an internal LLM API optimization rather than a
  user-facing pricing lever the way Claude's cache-write/cache-read tiers
  are.

## README Documentation (required deliverable, not optional polish)

Add a short "Copilot support" section to `README.md`:

1. What's shown: real prompts, models, tokens, tool calls, timings, premium
   credits, and an estimated USD cost - all read from VS Code's own
   `chatSessions` log, the same file Copilot Chat already writes for its own
   history UI. No setting to flip, no command to run, no export step.
2. What's not shown and why: cache-read/cache-write token counts, because
   Copilot's local log does not record them (unlike Claude and Codex).
3. Cost is `estimated` (bring-your-own-token rate table), not
   provider-reported, same convention as Claude and Codex - GitHub does not
   publish a token-to-USD rate for Copilot, so this extension estimates
   against the resolved underlying model's public API rate where known.
4. The real premium-credit figure Copilot itself reports
   (`copilotCredits`) is shown alongside the estimate as its own, more
   authoritative economic signal for users on a premium-request plan.

## Proposed Implementation Phases

1. **Copilot discovery**
   - Add `src/providers/copilot/discover.ts`.
   - Resolve the current workspace's `workspaceStorage/<hash>` folder (match
     via each folder's `workspace.json`, same technique used to find this
     project's own real session data), then enumerate `chatSessions/*.jsonl`.
   - Produce `ConversationListItem[]` with title, timestamps, request count,
     real token totals, and real estimated cost totals.
   - Reuse the in-memory mtime-caching pattern from Claude/Codex discovery;
     no disk persistence.

2. **Copilot parser**
   - Add `src/providers/copilot/parser.ts`.
   - Stream each `.jsonl` file line by line; keep `kind:0`'s session metadata
     (id, creation date, model capacity facts); for each `kind:2` line,
     append every entry in its `v` array (in order) as a finished request.
     Ignore `kind:1` lines (in-flight streaming deltas - see "External
     Research").
   - Map each finished request to `PromptRequest`: prompt text, timestamp,
     resolved model, real input/output tokens, timings, tool calls (with
     real per-call error text from `toolCallResults`), thinking tokens,
     premium credits, edited-file events when present.
   - Parse `result.details` defensively as a display-string fallback only
     (format `"<model> • <n> credits"` observed, not documented); the
     authoritative fields are `resolvedModel` and `copilotCredits` directly.

3. **Cost estimation**
   - Add a `copilot` section to `config/tokens-cost.yaml` keyed by
     `resolvedModel`, sourced from the same public API pricing pages already
     used for Codex where the underlying model matches (e.g. GPT-5-family
     models), plus a fallback rate for internal/non-public codenames.
   - Extend `PricingService` with `estimateCopilotCost(model, usage)`,
     mirroring `estimateCodexCost` (no cache-write tier, since none exists).

4. **Domain extensions**
   - Extend `PromptRequest` for request-scoped fields not already
     Claude/Codex-shaped: `premiumCredits` (number), `editedFiles` (string
     list). Reasoning tokens, time-to-first-token, and cost/token fields
     reuse the existing optional fields from the Codex packet.
   - Keep every new field optional.

5. **Panel integration**
   - Update `PanelController.sendInit()` to load Copilot list items and
     `loadDetail()` to dispatch to the Copilot parser.
   - Replace the "not implemented yet" message with real rows when data
     exists; keep an explicit empty state when it does not.
   - Update `src/status/statusBar.ts` so a Copilot-latest conversation shows
     real cost like Claude/Codex (no special-case fallback needed).
   - Add the panel's Storage Footer (see `surfaces-and-privacy.md`) in its
     static "no local data stored" state - this packet does not add a
     disk-persisted artifact, but the footer itself is now a required panel
     element regardless of adapter.

6. **D - Enriched UI additions**
   - Provider-conditional chips/rows: premium credits, thinking/reasoning
     tokens, edited-file events, model capacity facts, context fill.
   - Keep premium credits visually separate from the USD cost column.

7. **Documentation**
   - Write the README section described above.

8. **Verification**
   - Parser proof against the real local Copilot chatSessions files on this
     machine (`workspaceStorage/f7c4183b4b7387d739ea08adb234cc7e/chatSessions`
     - already confirmed to contain real, non-trivial sessions during
       planning).
   - `npm run typecheck`, `npm run build`.
   - Webview smoke check: Claude and Codex still render fully; Copilot
     renders real rows/detail; cache-token rows read as unavailable, never
     zero.
   - Status bar smoke check with a Copilot conversation as latest.
   - Confirm no code path writes `github.copilot.*` settings or invokes any
     Copilot command (grep for configuration `update(` calls and
     `executeCommand` calls touching Copilot's command ids) - still true
     even with the OTel tier deferred, since this rule is general.
   - Confirm the Storage Footer renders "no local data stored" (no
     disk-persisted artifact ships in this packet).

## Open Decisions

- `OP-005` (from the original draft): empirically confirming the OTel export
  file's on-disk location and `chat_session_id`/`turn_index` correlation is
  **no longer a blocker for this packet**, since the OTel tier is deferred.
  Recorded as a lead for whenever "Copilot Cost Enrichment (deferred)" above
  is revisited.
- `OP-007` (retention window units/default): moot for this packet - no
  disk-persisted artifact ships, so the Data Retention rule stays dormant.
  Recorded for whenever a future Copilot (or other provider) packet adds one.
- New: confirm the `copilot` rate-table fallback rate (for non-public
  codenames like `oswe-vscode-prime`) before implementation - propose reusing
  the existing `codex.fallback` rate (current-generation OpenAI mid-tier) as
  a reasonable default, on the same logic already applied to unrecognized
  Claude/Codex models.

## Resolved Decisions

- `OP-001` (was: should the OTel investigation gate this packet's scope): no
  - the chatSessions tier ships unconditionally; the OTel tier is deferred
    entirely rather than gating anything.
- `OP-002` (was: does OTel's `reasoning_tokens` supersede chatSessions'
  `thinking.tokens`): **not applicable** - the OTel tier that would have
  introduced a second source is deferred, so `thinking.tokens` is the only
  source in this packet.
- `OP-003` (inherited id from `conversation-meta`): resolved
  **zero-config-suffices** - real tokens, resolved model, and a premium-credit
  cost signal are already in chatSessions; the OTel opt-in tier is deferred
  (parked, not built). See "External Research."
- `OP-004`: resolved - the real chatSessions format on current VS Code
  builds is `.jsonl` (an append log of `kind:0`/`kind:1`/`kind:2`
  operations), confirmed by direct inspection of real local files.
- `OP-006` (was: SQLite reader choice for the OTel tier): resolved **`sql.js`
  (WASM)** if/when the deferred OTel tier is ever built - recorded for that
  future decision, not consumed by this packet.

## Specification Checkpoint

Reviewed `specification/product-scope.md`, `provider-and-cost.md`, and
`surfaces-and-privacy.md` before work, and updated `surfaces-and-privacy.md`
during planning (not deferred to close-out) because the maintainer directly
asked for these durable rules while scoping this packet - **kept even though
this packet's own OTel tier (the thing that prompted them) is now
deferred**, because both rules are general, not Copilot-specific:

- **Added** - Privacy: the extension must never programmatically write VS
  Code settings or invoke a command to unlock richer data; detection and
  explanation only. Motivated by Copilot Cost Tracker auto-enabling
  `dbSpanExporter.enabled` on activation - still the right general rule even
  though this packet never touches that setting at all.
- **Added** - Data Retention: any extension-persisted artifact gets a
  3-month default retention window, user-configurable, actively pruned on
  every write, logged, with a live-reported total. **Stays dormant for this
  packet** - no disk-persisted artifact ships.
- **Added** - Storage Footer: a non-collapsible footer at the bottom of the
  panel page reporting the extension's own on-disk footprint. This packet
  implements it in its static "no local data stored" state, since it is now
  a required panel element regardless of which adapter is active.
- Respected: local-first - chatSessions is a file Copilot Chat already
  writes for its own history UI; no network calls, no telemetry, no new
  configuration.
- Respected: no workspace totals - discovery reads exactly the current
  workspace's own `workspaceStorage` folder.
- Respected: `provider-and-cost.md` "never fabricate missing data" - cache
  fields render unavailable, never zero or guessed.
- Respected: `provider-and-cost.md`'s BYOT rule - Copilot cost is
  `estimated`, never `provider-reported`; falls back to a generic rate for
  unrecognized/internal model codenames rather than going `unavailable`,
  matching existing Claude/Codex precedent.
- Candidate spec update once shipped: reword `provider-and-cost.md`'s
  Copilot paragraph, which currently frames richer telemetry as "out of
  scope until separately investigated" - this packet is that investigation,
  and its conclusion is "real tokens and cost are already zero-config; only
  cache-token detail remains a genuinely deferred gap."
- Respected: rate-limit/quota-style signals (premium credits) shown as
  separate status/detail fields, never merged with USD cost.
- Respected: `surfaces-and-privacy.md` panel order and in-place selection are
  unchanged; Copilot slots into the existing grouped conversations table.

## Exit Criteria

- Copilot tab lists real conversations for the current workspace, with real
  tokens, resolved model, and estimated cost, and loads request detail
  through the shared panel.
- No Copilot surface shows a zero where the data is absent (cache tokens,
  rate limits, subagent attribution stay `unavailable`).
- No code path writes Copilot/VS Code settings or invokes any Copilot
  command.
- README documents what's real (tokens/cost/model/credits, zero-config) and
  what isn't (cache detail) clearly enough that a user with no prior context
  understands both.
- The panel's Storage Footer renders and reads "no local data stored."
- Claude and Codex surfaces are visually and behaviorally unchanged.
- Typecheck, build, and a chatSessions parse pass against this machine's real
  local data are recorded in `test.md`.
