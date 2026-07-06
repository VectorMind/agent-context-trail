# Copilot Parity Plan

## Problem Summary

The panel already has a Copilot tab, but there is no Copilot provider adapter
under `src/providers/`. Copilot currently renders as "Copilot support is not
implemented yet" while Claude has the full D - Enriched surface and Codex
reached parity in `plans/2026-07/05/codex-parity`.

This packet plans Phase 4: implement Copilot support from local VS Code
Copilot Chat session data, reaching honest parity where Copilot exposes
equivalent request and conversation fields, surfacing Copilot-native
signals, **and** implementing real token/cache/cost data via Copilot's own
OpenTelemetry SQLite export - gated entirely behind the user's own explicit
setup, which the README documents step by step. The extension never enables
that setup itself.

## Goal

Make Copilot conversations usable in the same panel as Claude and Codex,
including real economics, without ever taking an action on the user's VS Code
configuration that the user didn't take themselves.

1. Show a Copilot conversation list from local VS Code `chatSessions` data,
   scoped to the current workspace, using only data already written by normal
   Copilot Chat use - zero configuration required for this tier.
2. Parse Copilot requests into the same `ConversationSummary` / `PromptRequest`
   domain model where fields are equivalent: prompts, models, timings, tool
   calls, errors, titles.
3. Surface Copilot-native fields: premium-request multiplier, per-round
   thinking tokens, explicit first-progress latency, edited-file events.
4. Implement an opt-in second tier: read the OTel SQLite export
   (`agent-traces.db`) the user produces via Copilot Chat's own
   `dbSpanExporter` setting and export command, to get real input/output/
   cache/reasoning tokens and a BYOT-estimated USD cost - the same fields
   Claude and Codex already have. This tier is fully documented in the
   README: which setting to flip, which command to run, and how to point
   this extension at the resulting file. The extension performs none of
   those three steps itself.
5. Keep every field honestly unavailable when its data source (chatSessions
   alone, or chatSessions + OTel export) doesn't cover it. Never show zero
   for missing data, and never imply the OTel-derived figures are live when
   they are a point-in-time export.
6. Resolve `OP-003` from `plans/2026-07/05/conversation-meta` (the Copilot
   OTel / `agent-traces.db` lead) - see "External Research" below.

## External Research

Checked (a) our own competitive survey and (b) Microsoft's docs and source
for how Copilot token/cost data is actually obtained, to answer the
maintainer's question: is this passive-read-only, or does it require active
configuration - and if it does, who performs that configuration, us or the
user?

**From `plans/2026-07/04/initial-design/survey-short-list.md`:** Copilot Cost
Tracker is "the only surveyed product with real per-turn economics (cache %,
context resend, cost per turn)" and its `dbSpanExporter` telemetry lead is
flagged as "the most promising path to Copilot per-turn data." That lead is
fully investigated below.

**Microsoft's docs and source**
(`code.visualstudio.com/docs/agents/guides/monitoring-agents`,
`github.com/microsoft/vscode-copilot-chat`) establish:

- `github.copilot.chat.otel.dbSpanExporter.enabled` is a real setting,
  **default `false`**: "Persist OTel spans to a local SQLite database for the
  **Chat: Export Agent Traces DB** command. Implicitly enables OTel."
- OTel overall is "off by default and emits no data until you explicitly
  enable it" - "Data goes only where you point it. There is no phone-home
  behavior."
- Producing the db file is an **export action**, not a continuously-updated
  log the way Claude's JSONL or Codex's rollout files are: the user must (1)
  enable the setting and (2) run **Chat: Export Agent Traces DB**. Reading it
  is therefore always reading a snapshot as of the last time the user ran
  that command, not a live feed.
- Real schema, read directly from
  `src/platform/otel/node/sqlite/otelSqliteStore.ts` in
  `microsoft/vscode-copilot-chat` (repository since archived, 2026-05-20, but
  the source remains readable):

  ```sql
  CREATE TABLE IF NOT EXISTS spans (
    span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
    name TEXT NOT NULL, start_time_ms INTEGER NOT NULL, end_time_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 0, status_message TEXT,
    operation_name TEXT, provider_name TEXT, agent_name TEXT, conversation_id TEXT,
    request_model TEXT, response_model TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, reasoning_tokens INTEGER,
    tool_name TEXT, tool_call_id TEXT, tool_type TEXT,
    chat_session_id TEXT, turn_index INTEGER, ttft_ms REAL
  );
  CREATE TABLE IF NOT EXISTS span_attributes (
    span_id TEXT NOT NULL REFERENCES spans(span_id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT, PRIMARY KEY (span_id, key)
  );
  CREATE TABLE IF NOT EXISTS span_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    span_id TEXT NOT NULL REFERENCES spans(span_id) ON DELETE CASCADE,
    name TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, attributes TEXT
  );
  ```

  This confirms: `chat_session_id` (from `copilot_chat.chat_session_id`) and
  `conversation_id` (from `gen_ai.conversation.id`) are the correlation keys
  back to a `chatSessions.json` conversation; `turn_index` is the likely
  per-request ordinal; `input_tokens`/`output_tokens`/`cached_tokens`/
  `reasoning_tokens` are real, per-span token counts on `chat`-operation
  spans. **There is no cost column anywhere in this schema** - confirming
  Copilot cost must be `estimated` (BYOT), never `provider-reported`, exactly
  like Claude and Codex.

- Gaps Microsoft's public docs and source do not answer, left as
  implementation-time investigation (`OP-005` below): the exact on-disk path
  of the live (pre-export) db and the destination of an exported copy (an
  "export" command plausibly opens a save-location picker rather than
  writing to a fixed path); the exact command id (observed command title
  only: **Chat: Export Agent Traces DB**); and empirical confirmation that
  `chat_session_id`/`turn_index` line up with a given workspace's
  `chatSessions.json` `sessionId`/request ordinal on this machine's real
  data.

  **How `OP-005` gets resolved:** the maintainer offered to help, which is
  the right way to close this - only the maintainer can perform the two
  Copilot-side steps without the extension doing them. The maintainer (1)
  enables `github.copilot.chat.otel.dbSpanExporter.enabled` themselves in
  VS Code settings, and (2) runs **Chat: Export Agent Traces DB** themselves
  from the Command Palette, noting where it landed (fixed path vs. a save
  dialog). Once a real `agent-traces.db`-equivalent file exists on this
  machine, the assistant inspects it directly with local shell tools
  (reading the SQLite file's schema/rows, e.g. via a throwaway `sql.js`/
  Node script or the `sqlite3` CLI if present) to confirm the schema above
  matches reality and that `chat_session_id`/`turn_index` correlate to a
  real `chatSessions.json` conversation on disk - all read-only inspection,
  never re-running the enable/export steps on the maintainer's behalf.

**Copilot Cost Tracker's own listing** confirms it depends on exactly this
setting, and goes further than "requires configuration": *"The extension
attempts to enable this automatically on activation. If VS Code policy/
settings scope blocks automatic updates, set it manually."* That is, it
programmatically flips `dbSpanExporter.enabled` in the user's `settings.json`
without a per-use consent step. This packet does the opposite: real
enrichment, zero auto-configuration.

GitHub's official spend-tracking docs
(`docs.github.com/en/copilot/how-tos/manage-and-track-spending`) are
org/admin-facing and API/network-based - out of scope for a local-first,
no-server extension regardless of this decision.

**Decision on `OP-003`:** build the OTel/`agent-traces.db` reader, as a
second, explicitly opt-in tier, and document the three manual steps in the
README. The extension performs none of them on the user's behalf:

1. The user enables `github.copilot.chat.otel.dbSpanExporter.enabled` in
   their own VS Code settings.
2. The user runs **Chat: Export Agent Traces DB** themselves, whenever they
   want fresh data (this is a manual, repeatable action - not automatic).
3. The user points this extension at the resulting file (a new
   `agentContextTrail.copilot.otelTracesDbPath` setting, or a companion
   "Agent Context Trail: Locate Copilot Traces Export" command that opens a
   file picker). The extension only reads a path the user gave it; it does
   not scan the filesystem hunting for `agent-traces.db` copies.

`OP-003` closes here as resolved-implement-opt-in, evidence recorded above.

**New durable rules adopted from this research** (added to
`specification/surfaces-and-privacy.md` under Privacy, during planning, not
deferred to close-out, because the maintainer asked for them directly while
scoping this packet):

- The extension must never programmatically write to VS Code settings (its
  own excluded - see below - another extension's, or a provider's) or invoke
  a command like **Chat: Export Agent Traces DB** to unlock richer data. It
  may detect state and explain what enabling it would unlock, never perform
  the enabling step itself. (Our own `otelTracesDbPath` setting is written by
  the *user*, via VS Code's normal settings UI or our file-picker command -
  the extension only reads whatever value is already there.)
- **Data Retention**: any artifact the extension itself persists gets a
  3-month default retention window, user-configurable, pruned only for the
  extension's own artifacts, never provider- or Copilot-owned files
  (including the user's own exported `agent-traces.db`, which the extension
  must never delete or modify - only read).

## Starting Evidence

From `plans/2026-07/05/conversation-meta/survey.md` (section 4 and the
capability table):

- Copilot Chat sessions live under VS Code
  `workspaceStorage/<hash>/chatSessions/*.json` - one JSON per session
  (recent builds also write a `.jsonl` variant). A 30 MB real local sample
  with 19 requests was surveyed.
- Session level: `sessionId`, `creationDate`, `lastMessageDate`,
  `customTitle`, selected model metadata including `maxInputTokens` /
  `maxOutputTokens`.
- Per request: prompt text + `variableData` (attached context references),
  `timestamp`, `modelId` (e.g. `copilot/gpt-5.2`), `result.details` =
  `"GPT-5.2 • 1x"` (model + **premium-request multiplier**, Copilot's only
  chatSessions-native economic signal), `result.timings.firstProgress` /
  `totalElapsed` (explicit latency), `errorDetails` (`Canceled`,
  `responseIsIncomplete`).
- `result.metadata.toolCallRounds[]`: round id, response text, `toolCalls`,
  and `thinking.tokens` - the only token number in `chatSessions` itself.
- `response[]` parts typed by `kind` (`thinking`, `toolInvocationSerialized`,
  `mcpServersStarting`, ...) with `toolId`/`toolCallId`;
  `editedFileEvents[]`; `codeBlocks` with language.
- **No input/output/cache token usage in `chatSessions`.** That data lives in
  the opt-in OTel SQLite export - see "External Research" for its real
  schema and correlation keys (`chat_session_id`, `conversation_id`,
  `turn_index`).
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
  cost, and the Current Status shapes - the OTel tier reuses these rather
  than inventing new ones.
- No existing code path persists anything to disk on the extension's behalf -
  the Codex discovery cache (`src/providers/codex/discover.ts`) is a plain
  in-memory `Map`, cleared on restart. Copilot's chatSessions discovery keeps
  that pattern. The OTel reader may keep an in-memory correlation cache too;
  if it ever needs a disk-persisted cache, that falls under the new
  retention rule.
- `package.json` has no SQLite dependency today. Reading `agent-traces.db`
  needs one - see `OP-006`.

## Scope Boundaries

The Copilot surface must stay honest about the level of data it represents,
and honest about which tier a given figure came from.

- The Copilot table is a conversation list, not a workspace-level aggregation.
  `workspaceStorage` is inherently per-workspace; discovery maps the current
  workspace to its storage folder and reads only that - no cross-workspace
  scanning, no workspace totals.
- **Tiered honesty, not blanket unavailability.** Without an OTel export
  configured, input/output/cache tokens and USD cost are `unavailable` (not
  `$0`, not guessed from the premium multiplier). With one configured and
  correlated, those fields become real (`estimated` cost via BYOT, exactly
  like Claude/Codex - Copilot has no cost column in its own schema either).
  The UI must make clear which tier is active, not present OTel-derived
  numbers as if they were always-on.
- **OTel data is a snapshot, not a live feed.** Every OTel-derived figure is
  labeled with the export's own file mtime ("as of your last export, 3 days
  ago"). If a conversation has requests newer than the export, those newer
  requests' economics stay `unavailable` until the user re-exports - never
  silently backfilled from an older average.
- The premium-request multiplier is a plan-quota signal, not cost. It is
  shown as its own field, never converted into or merged with USD.
- `thinking.tokens` (chatSessions) and `reasoning_tokens` (OTel span) are
  both per-request reasoning-output counts; when both exist, the OTel value
  wins as the more precise source, matching the "provider-reported beats
  estimated" precedence already used for cost.
- Model `maxInputTokens` is a capacity fact; context-fill percentage becomes
  possible once real input token counts exist via the OTel tier, using the
  same current-context-status shape Codex already has.
- Copilot CLI (`~/.copilot` SQLite) is out of scope for this packet; it stays
  a recorded lead.
- **No settings auto-enablement, ever, for Copilot's own settings or
  commands.** This packet does not write
  `github.copilot.chat.otel.dbSpanExporter.enabled`, does not invoke **Chat:
  Export Agent Traces DB**, and does not scan the filesystem guessing at
  export locations. It only reads a path the user explicitly supplied.
  Contrast: Copilot Cost Tracker auto-enables the setting on activation.
- **No new persisted artifacts beyond what's declared here.** ChatSessions
  discovery stays in-memory-only, matching Codex. If the OTel reader adds a
  disk-persisted derived cache for performance, it must implement the
  3-month default retention window from `specification/surfaces-and-privacy.md`
  from the start, not as a follow-up.

## Parity Scope (chatSessions tier - zero configuration)

Implement these Claude/Codex-equivalent fields for Copilot when present:

- conversation id, title (`customTitle`), first/last timestamps;
- request boundaries and request count (`requests[]` maps one-to-one to the
  domain's prompt requests - simpler than Codex's event grouping);
- prompt text per request;
- model per request and model switches (`modelId`);
- request wall time (`timings.totalElapsed`) and time to first token
  (`timings.firstProgress`) - reusing the timing fields added for Codex;
- tool calls with identity, count, and available detail from
  `toolCallRounds[]` / `toolInvocationSerialized` parts;
- error/interruption state from `errorDetails`;
- conversation table rows and detail loading through the existing provider
  tab.

Map unavailable fields honestly when the OTel tier is not configured:

- input, output, cache-read, cache-write tokens: unavailable;
- USD cost: unavailable - no usable token counts exist without the OTel
  tier, so the BYOT rule cannot apply yet;
- cache diagnostics, TTL splits, cache-miss reasons: unavailable (no TTL/
  miss-reason equivalent exists even in the OTel schema);
- subagent attribution: unavailable (VS Code subagents remain a lead);
- rate-limit snapshots: unavailable (no equivalent field found in either
  source);
- conversation token totals: unavailable (a total of unavailable parts is
  not zero).

## Copilot-Native Scope

Add Copilot-only value where the sampled session exposes it:

- **premium-request multiplier** parsed from `result.details` - shown as a
  request-level chip and, if cleanly summable, a conversation-level premium
  request count; always distinct from cost per the spec;
- **thinking tokens** per request (chatSessions `toolCallRounds[].thinking.tokens`,
  superseded by the OTel `reasoning_tokens` column when available);
- **edited-file events** - files changed per request, as an enriched request
  detail row (Claude/Codex show diffs/patches; Copilot's `editedFileEvents`
  is the equivalent);
- **explicit first-progress latency** - already a shared timing field; Copilot
  is the second provider with a provider-reported (not derived) value;
- model `maxInputTokens` / `maxOutputTokens` as model-capacity facts in
  request detail.

UI rules:

- These fields appear only for providers that expose them; the panel must not
  add a cross-provider chart implying Claude/Codex have a premium multiplier.
- The Tokens-per-conversation overview and the thread chart's token plot must
  handle token-less conversations/requests explicitly (an "unavailable"
  row/state), not render an empty or zero-height bar indistinguishable from
  zero usage.
- Current Status for Copilot shows only real fields for the active tier; if
  the OTel tier isn't configured, the section says so with a link to the
  README setup steps instead of showing empty gauges.
- The status bar, when the latest workspace conversation is Copilot, uses the
  existing no-cost fallback path (prompt count) when the OTel tier is not
  configured, and the real per-request/conversation cost figures once it is.

## Copilot Cost/Cache Enrichment (OTel tier, opt-in)

- Add a `src/providers/copilot/otelReader.ts` that opens a user-supplied
  SQLite file read-only and queries the `spans` table (see schema above) for
  `operation_name = 'chat'` (and related tool/hook spans) rows.
- Correlate each span to a `chatSessions.json` request via `chat_session_id`
  → conversation `sessionId`, and `turn_index` → request ordinal; verify this
  correlation against a real local export before relying on it (`OP-005`).
- Populate `PromptRequest.inputTokens` / `outputTokens` /
  `cacheReadTokens` / reasoning tokens from the matched span's
  `input_tokens`/`output_tokens`/`cached_tokens`/`reasoning_tokens` columns.
- Compute cost via the existing BYOT rate-table mechanism
  (`PricingService`), keyed by `request_model`/`response_model` - reusing
  Claude/Codex/OpenAI rate entries already in `config/tokens-cost.yaml` when
  the underlying model matches, rather than maintaining a separate Copilot
  rate table. Confidence label: `estimated` (there is no cost column in
  Copilot's own schema, matching Claude and Codex precedent).
- Every OTel-derived value carries the export file's mtime so the panel can
  show "as of <date>" rather than implying a live read.
- Requests with no matching span (created after the last export, or from a
  session predating OTel being enabled) keep their chatSessions-only fields
  and stay `unavailable` for tokens/cost - never backfilled or interpolated.
- SQLite access needs a new dependency. **Resolved (`OP-006`): `sql.js`**
  (WASM, no native binary) - this extension is packaged via `esbuild` +
  `vsce` for cross-platform install, and a native binding
  (`better-sqlite3`) would need per-platform prebuilt `.node` binaries that
  complicate that packaging story. `sql.js`'s WASM blob bundles as a plain
  asset with no native compilation step.
- Add `agentContextTrail.copilot.otelTracesDbPath` (string setting, default
  unset) and an "Agent Context Trail: Locate Copilot Traces Export" command
  with a file picker that writes only this setting - never Copilot's own
  settings.
- Parsing a large SQLite export (or the 30 MB `chatSessions` sample) on
  every panel refresh is real, measured overhead worth avoiding. The OTel
  reader keeps one small derived-cache file under the extension's own
  `context.globalStorageUri` (e.g. `copilot-otel-cache.json`): per source
  file identity (path + mtime + size), the parsed span index it produced.
  This is the packet's one disk-persisted artifact, and the reason the
  retention/disk-usage rules below stop being dormant.

## Disk Usage Monitoring & Retention Enforcement

This packet introduces the extension's first disk-persisted artifact (the
OTel cache above), so `specification/surfaces-and-privacy.md`'s Data
Retention rule and Storage Footer requirement become live here, not
theoretical. Concretely:

- **Bounded by construction, not just by policy.** The cache stores one
  entry per source file the user has pointed at (realistically: one Copilot
  OTel export, occasionally a handful across workspaces); each entry is
  replaced, not appended, when its source file's mtime changes. There is no
  per-request or per-span row growth over time - re-exporting doesn't grow
  the cache, it overwrites the relevant entry. This keeps footprint
  proportional to "how many distinct export files the user has ever pointed
  us at," not to usage volume.
- **Active pruning on every write.** Whenever the cache is written (a new or
  updated entry), the writer first drops any entry whose source-file
  timestamp is older than the configured retention window (default 90 days
  / ~3 months, `agentContextTrail.retentionDays` setting) before saving -
  never accumulates entries for files the user stopped pointing us at.
- **Logged, not silent.** Each prune (what was dropped, its age, bytes
  freed) is written to the extension's output channel, matching the
  durable rule.
- **Reported disk usage, live.** A small storage-accounting helper
  (`src/storage/retention.ts`) computes the cache file's current size and
  the configured retention window on demand; `PanelController` threads this
  into the webview so the panel's Storage Footer (see
  `surfaces-and-privacy.md`) can render it - e.g. "Local data: 4 KB · oldest
  entry: 12 days · retention: 90 days (configurable)", or "No local data
  stored" before the OTel tier is ever used.
- **Never touches provider files.** Retention pruning only ever deletes rows
  inside the extension's own cache file. It never deletes, moves, or
  modifies the user's `chatSessions` files or their `agent-traces.db`
  export - those remain entirely the user's / Copilot's own to manage.
- This module is written generically enough (path-keyed entries, mtime-based
  invalidation, size accounting) that if Claude or Codex ever need a
  disk-persisted cache too, they reuse it rather than duplicating retention
  logic per provider.

## README Documentation (required deliverable, not optional polish)

Add a "Copilot cost and cache data (optional)" section to `README.md`
covering, in order:

1. Why this is opt-in: Copilot's default local logs (`chatSessions`) don't
   contain token counts, so real cost/cache numbers require Copilot's own
   OpenTelemetry export - a feature this extension does not and will not
   enable on the user's behalf.
2. Exact step 1: open VS Code settings, search for
   `github.copilot.chat.otel.dbSpanExporter.enabled`, turn it on.
3. Exact step 2: run **Chat: Export Agent Traces DB** from the Command
   Palette whenever the user wants fresh cost/cache data (explain this is
   manual and repeatable, not automatic/continuous).
4. Exact step 3: point Agent Context Trail at the exported file, either by
   setting `agentContextTrail.copilot.otelTracesDbPath` directly or running
   **Agent Context Trail: Locate Copilot Traces Export**.
5. What changes once configured (real tokens, cache, `estimated` USD cost,
   context fill) versus the always-on baseline (titles, prompts, tool calls,
   multiplier, timings) - so a user who skips this section still understands
   what they're seeing.
6. A note that this data is a snapshot as of the last export, not live.
7. A short note on the local cache this feature creates (size-bounded,
   90-day default retention, visible in the panel's storage footer,
   configurable, never touching the user's own export file).

## Proposed Implementation Phases

1. **Copilot discovery (chatSessions tier)**
   - Add `src/providers/copilot/discover.ts`.
   - Resolve the current workspace's `workspaceStorage/<hash>` folder (match
     via each folder's `workspace.json`), then enumerate
     `chatSessions/*.json` (and the `.jsonl` variant when present).
   - Produce `ConversationListItem[]` with title, timestamps, request count;
     token totals and cost marked unavailable absent an OTel match.
   - Reuse the in-memory mtime-caching pattern from the Codex discover; no
     disk persistence.

2. **Copilot parser (chatSessions tier)**
   - Add `src/providers/copilot/parser.ts`.
   - Map `requests[]` directly to `PromptRequest`: prompt text, timestamp,
     model, timings, tool calls, errors, thinking tokens, multiplier,
     edited-file events.
   - Parse `result.details` defensively (format `"<model> • <n>x"` is
     observed, not documented); absent or unparsable → field absent.

3. **OTel reader (opt-in tier)**
   - Add `src/providers/copilot/otelReader.ts` and the
     `otelTracesDbPath` setting plus locate-file command (see above), using
     `sql.js` for read-only SQLite access.
   - Empirically verify the `chat_session_id`/`turn_index` correlation
     against a real local export (`OP-005`, maintainer-assisted - see
     "External Research") before wiring it into the panel; if correlation
     doesn't hold cleanly on real data, degrade to conversation-level (not
     request-level) token/cost aggregation and record that as a known gap
     rather than mis-attributing figures to the wrong request.
   - Wire matched spans' tokens into `PromptRequest` and cost via
     `PricingService`, per "Copilot Cost/Cache Enrichment" above.

4. **Storage accounting**
   - Add `src/storage/retention.ts`: a small generic module keyed by source
     file identity (path + mtime + size) that reads/writes the OTel cache
     under `context.globalStorageUri`, prunes entries past
     `agentContextTrail.retentionDays` (default 90) on every write, logs
     prunes to the output channel, and reports total cache size on demand.
   - Wire the OTel reader to use it instead of ad hoc file I/O.

5. **Domain extensions**
   - Extend `PromptRequest` only for request-scoped fields not already
     Claude/Codex-shaped: premium-request multiplier, edited-file events
     (count + file names). Reasoning tokens and cost/token fields reuse the
     existing optional fields from the Codex packet.
   - Keep every new field optional.

6. **Panel integration**
   - Update `PanelController.sendInit()` to load Copilot list items and
     `loadDetail()` to dispatch to the Copilot parser, merging OTel data when
     the configured db path resolves and correlates.
   - Replace the "not implemented yet" message with real rows when data
     exists; keep an explicit empty state when it does not.
   - Make the overview token bars, thread chart, and totals columns render
     the unavailable-token state honestly when the OTel tier is absent, and
     the "as of <export date>" note when it is present.
   - Update `src/status/statusBar.ts` so a Copilot-latest conversation uses
     the no-cost fallback text (no OTel tier) or real cost (OTel tier
     present) as appropriate.
   - Add the panel's Storage Footer (see `surfaces-and-privacy.md`), fed by
     `src/storage/retention.ts`'s reported size and retention window.

7. **D - Enriched UI additions**
   - Provider-conditional chips/rows: multiplier, thinking/reasoning tokens,
     edited-file events, model capacity facts, context fill (OTel tier).
   - Keep the multiplier visually separate from any cost column.

8. **Documentation**
   - Write the README section described above.

9. **Verification**
   - Parser proof against at least one real local Copilot chatSessions file
     (the surveyed 30 MB session exists on this machine).
   - If feasible on this machine: enable the OTel setting, run the export
     command, and parser-proof the OTel reader against the real resulting
     `agent-traces.db`, recording actual file location and correlation
     results as evidence for `OP-005`.
   - `npm run typecheck`, `npm run build`.
   - Webview smoke check: Claude and Codex still render fully; Copilot
     renders real rows/detail in both tiers; token-less states read as
     unavailable when the OTel tier is absent.
   - Status bar smoke check with a Copilot conversation as latest, in both
     tiers.
   - Confirm no code path writes `github.copilot.*` settings or invokes the
     traces-export command (grep for workspace/global configuration
     `update(` calls and `executeCommand` calls touching Copilot's command
     ids).
   - Confirm retention actually prunes: seed the cache with an artificially
     aged entry, trigger a write, and verify it's dropped and logged; confirm
     the Storage Footer's reported size changes accordingly and reads "no
     local data stored" before the OTel tier is ever configured.

## Open Decisions

- `OP-002`: Once the OTel `reasoning_tokens` column is wired in, does it
  fully replace chatSessions' `thinking.tokens` in the UI, or show both when
  they disagree? Proposed: OTel value is authoritative per the
  provider-reported-beats-estimated precedent; chatSessions value only shown
  when no OTel match exists for that request.
- `OP-004`: Support the `.jsonl` chatSessions variant in this packet or
  detect-and-skip with a logged note? Depends on whether local data includes
  one to test against.
- `OP-005`: Empirically confirm, on a real local OTel export, (a) where the
  live/pre-export db and the exported copy actually land on disk, (b) that
  `chat_session_id` and `turn_index` correlate cleanly to a specific
  `chatSessions.json` conversation and request, and (c) the exact command id
  behind "Chat: Export Agent Traces DB". Maintainer-assisted (see "External
  Research"): the maintainer performs the enable + export steps themselves;
  the assistant inspects the resulting file read-only via local shell tools.
  Not resolved by documentation alone - genuinely needs a real file on this
  machine.
- `OP-007`: Retention window units and default - this plan uses
  `agentContextTrail.retentionDays` (default `90`) as the concrete setting
  implementing `surfaces-and-privacy.md`'s "3 months" default; confirm `90`
  days is an acceptable reading of "3 months" (vs. calendar months) before
  implementation.

## Resolved Decisions

- `OP-001` (was: should the OTel investigation gate this packet's scope):
  no - both tiers ship in this packet; the chatSessions tier is unconditional
  and the OTel tier is unconditional-to-build but conditional-to-activate
  (only lights up once the user has done their three steps).
- `OP-003` (inherited id from `conversation-meta`): resolved
  implement-as-opt-in. See "External Research."
- `OP-006`: SQLite reader for `otelReader.ts` is **`sql.js`** (WASM) -
  confirmed by the maintainer. No native binding, avoiding per-platform
  prebuilt binary packaging through `esbuild` + `vsce`.

## Specification Checkpoint

Reviewed `specification/product-scope.md`, `provider-and-cost.md`, and
`surfaces-and-privacy.md` before work, and updated `surfaces-and-privacy.md`
twice during planning (not deferred to close-out) because the maintainer
directly asked for these durable rules while scoping this packet:

- **Added** - Privacy: the extension must never programmatically write VS
  Code settings (its own excluded, another extension's, or a provider's) or
  invoke a command to unlock richer data; detection and explanation only.
  Directly motivated by finding that a real competitor (Copilot Cost
  Tracker) auto-enables `dbSpanExporter.enabled` on activation.
- **Added** - Data Retention: any extension-persisted artifact gets a
  3-month default retention window, user-configurable, pruned by the
  extension for its own artifacts only, never touching provider-owned files
  (including the user's own `agent-traces.db` export). Strengthened on the
  maintainer's follow-up to require active enforcement on every write (not
  just a stated policy), logged prune actions, and a live-reported total.
- **Added** - Storage Footer: a non-collapsible footer at the bottom of the
  panel page reporting the extension's own on-disk footprint and retention
  window, distinct from the five required panels. This packet is the first
  to populate it (the OTel cache); every other adapter still reports "no
  local data stored."
- This packet is the first to make the Data Retention rule non-dormant: the
  OTel cache is the extension's first disk-persisted artifact, so
  `src/storage/retention.ts` is the reference implementation of that rule,
  not just a description of it.
- Respected: local-first - the OTel tier still only reads local files the
  user already produced via Copilot Chat's own export feature; no network
  calls, no telemetry.
- Respected: no workspace totals - discovery reads exactly the current
  workspace's own `workspaceStorage` folder.
- Respected: `provider-and-cost.md` "never fabricate missing data" - fields
  render unavailable, never zero, in whichever tier is active.
- Respected: `provider-and-cost.md`'s BYOT rule - Copilot cost is
  `estimated`, never `provider-reported`, since no cost column exists even
  in the richer OTel schema.
- Candidate spec update once shipped: reword `provider-and-cost.md`'s
  Copilot paragraph, which currently says richer telemetry is "out of scope
  until separately investigated" - this packet is that investigation and its
  conclusion is "implement it, opt-in, user-configured," so the wording
  should describe the two-tier model (chatSessions always-on,
  OTel-export opt-in) rather than a single "structure only" tier.
- Respected: rate-limit/quota-style signals (premium multiplier) shown as
  separate status/detail fields, never merged with USD cost.
- Respected: `surfaces-and-privacy.md` panel order and in-place selection are
  unchanged; Copilot slots into the existing grouped conversations table.

## Exit Criteria

- Copilot tab lists real conversations for the current workspace and loads
  request detail through the shared panel, in both tiers.
- No Copilot surface shows a zero where the data is absent.
- No code path writes Copilot/VS Code settings or invokes the traces-export
  command; the extension's own `otelTracesDbPath` setting is only ever read,
  set by the user.
- README documents the three-step opt-in clearly enough that a user with no
  prior context could follow it end to end.
- The OTel cache never grows unbounded: a seeded-aged-entry test proves
  pruning actually removes expired entries on write, and the removal is
  logged.
- The panel's Storage Footer reports real, current figures (size, retention
  window) and reads "no local data stored" when the OTel tier is unused.
- Claude and Codex surfaces are visually and behaviorally unchanged.
- Typecheck, build, a chatSessions parse pass, and (if feasible on this
  machine) an OTel export parse pass are recorded in `test.md`.
