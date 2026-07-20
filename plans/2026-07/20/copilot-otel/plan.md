# Copilot OTel Enrichment Plan

## Status

Planned on 2026-07-20 at the maintainer's request. Implementation has not
started. The immediate zero-cost display and request-level Copilot context
projection fixes remain recorded in `plans/2026-07/06/copilot-parity`.

## Problem Summary

Copilot's zero-configuration
`workspaceStorage/.../chatSessions/*.jsonl` source stores request-level
`promptTokens` and model-capacity metadata, but not the input/cache/output
usage of each LLM call represented by the Prompt timeline diamonds. The
timeline therefore cannot show the context lane that Claude and Codex expose.

The context number visible inside VS Code's own Chat UI is not exposed through
the public VS Code extension API. Copilot Chat can calculate it while building
and sending a request without persisting the same per-call snapshot in
`chatSessions`; scraping the UI, intercepting traffic, or guessing from request
totals is not an acceptable integration.

Current Copilot Chat has an official opt-in OpenTelemetry surface that emits
one `chat` span per LLM API call. This creates a supported path to the missing
data, subject to correlation, privacy, enterprise-policy, and file-lifecycle
proof.

## Goal And Objectives

Add optional, local Copilot OTel enrichment that:

1. populates Copilot's per-LLM-call context timeline from provider-emitted data;
2. preserves `chatSessions` as the zero-configuration discovery/history source;
3. never enables or changes Copilot settings on the user's behalf;
4. works without capturing prompts, code, tool arguments, or tool results;
5. fails honestly when telemetry is disabled, managed off, unreadable, or
   ambiguously correlated;
6. remains usable in enterprise installations where policy may own OTel
   configuration.

## Source Contract

Use Copilot Chat's supported file exporter as the first enrichment source:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "<user-selected-path>"
}
```

Keep `github.copilot.chat.otel.captureContent` disabled. Metadata-only spans
can provide:

- `gen_ai.conversation.id` for session correlation;
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` per call;
- `gen_ai.usage.cache_read.input_tokens` and
  `gen_ai.usage.cache_creation.input_tokens` when the provider supplies them;
- requested/resolved model, finish reason, time to first token, and max output
  tokens.

Official references:

- [Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [AI settings reference](https://code.visualstudio.com/docs/agents/reference/ai-settings#_observability-settings)
- [Debug chat interactions](https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view)

## Scope

### In scope

- Detect resolved Copilot OTel enablement, exporter type, and outfile path
  without modifying configuration.
- Explain the enrichment and setup when a usable file exporter is absent.
- Parse/tail Copilot's JSON-lines OTLP file defensively.
- Correlate OTel conversations, requests, and child `chat` spans with the
  existing Copilot session/request/round model.
- Enrich `LlmCallInfo` with per-call token composition and other supported
  metadata.
- Surface unmatched, incomplete, stale, and ambiguous telemetry explicitly.
- Validate with content capture disabled.

### Non-goals

- Automatically enabling OTel or writing any `github.copilot.*` setting.
- Scraping the Chat UI, intercepting Copilot network traffic, or invoking
  private Copilot commands.
- Replacing `chatSessions` as the conversation discovery source.
- Requiring an OTLP backend or cloud observability service.
- Capturing or displaying prompts, responses, code, tool inputs, or tool
  results from OTel.
- Shipping SQLite ingestion in the first implementation pass.

## Proposed Implementation Phases

1. **Fixture and correlation proof**
   - Capture a content-disabled file-export trace and matching `chatSessions`
     record from the same conversation.
   - Verify exact `gen_ai.conversation.id` mapping and request/round ordering.
   - Repeat with at least two Copilot Chat versions, including an
     enterprise-managed installation.

2. **Configuration detection and UX contract**
   - Read resolved settings only.
   - Distinguish disabled, managed-disabled, wrong exporter, missing path,
     unreadable path, empty export, and usable export states.
   - Add an explanation/link surface; do not add an automatic enable action.

3. **OTLP JSON-lines reader**
   - Parse incrementally and tolerate partial trailing lines, rotation,
     truncation, duplicate exports, unknown signal types, and schema additions.
   - Keep the initial implementation in memory and read the caller-owned file
     in place.

4. **Correlation and enrichment**
   - Join by stable IDs and trace hierarchy, not timestamp alone.
   - Prefer OTel per-call values over skeletal `chatSessions` round metadata.
   - Preserve the existing request-level values when no confident per-call
     match exists.

5. **Panel integration**
   - Populate Copilot Prompt timeline context bars and Call detail from enriched
     `LlmCallInfo` records.
   - Show cache parts only when emitted; missing conditional fields remain
     unavailable, never zero.
   - Make the source and freshness of OTel enrichment visible.

6. **Validation and documentation**
   - Add parser/correlation fixtures with content fields absent or redacted.
   - Verify disabled and enterprise-managed states.
   - Run unit tests, typecheck, build, and an in-VS Code visual pass.
   - Update README and the specification checkpoint after validation.

## Alternative Sources

The SQLite DB exporter is a supported fallback
(`github.copilot.chat.otel.dbSpanExporter.enabled` plus **Chat: Export Agent
Traces DB**), but it adds an explicit export step and a SQLite/WASM dependency.
The Agent Debug Log can also manually export OTLP JSON. Both are useful for
fixtures and one-off analysis; neither is the preferred first automatic
integration while the continuous file exporter is available.

## Enterprise Constraints

Enterprise policy can force or lock OTel configuration and takes precedence
over environment and user settings. A managed-off configuration is an honest
unavailable state controlled by the administrator, not an error that the
extension should bypass.

## Open Points

- `OP-001` — Prove the exact conversation/request/round correlation keys with
  real matching exports. Timestamp-only matching is explicitly insufficient.
- `OP-002` — Confirm whether per-call `gen_ai.usage.input_tokens` matches the
  Chat UI context figure or differs because of reserved output or budgeting.
- `OP-003` — Confirm cache attributes across personal and enterprise accounts;
  official fields are conditional and cannot be assumed present.
- `OP-004` — Establish file exporter rotation, truncation, flush, and partial
  write behavior before implementing a long-running tailer.
- `OP-005` — Determine whether resolved enterprise-managed settings expose
  enough information to distinguish policy-disabled from ordinary disabled.

## Dependencies And Risks

- Copilot OTel is opt-in by default and can be controlled by enterprise policy.
- The exporter and attributes may vary across Copilot Chat versions.
- Incorrect correlation would silently attach usage to the wrong prompt, which
  is worse than leaving it unavailable.
- Export files can grow or rotate. The reader must not assume append-only
  lifetime behavior without proof.
- Any future derived cache would be the extension's first persisted artifact
  and must implement retention, pruning, logging, and Storage Footer reporting
  in the same packet.

## Specification Checkpoint

Reviewed `specification/product-scope.md`, `provider-and-cost.md`, and
`surfaces-and-privacy.md` on 2026-07-20.

- The plan stays within product scope: it enriches one selected conversation
  and its requests, with no organizational or cross-workspace analytics.
- It follows the privacy rule forbidding programmatic writes to provider
  settings and keeps content capture disabled.
- It follows the provider rule that absent cache/per-call data remains
  unavailable rather than fabricated.
- Candidate maintainer review: `provider-and-cost.md` currently describes
  cache tokens as Copilot's one durable gap. If OTel fixtures prove those
  conditional attributes usable, revise that statement to distinguish the
  zero-configuration `chatSessions` gap from optional OTel enrichment.
- No specification change is applied during planning; refresh this checkpoint
  before the packet is marked done.

## Exit Criteria

- A content-disabled Copilot OTel file can enrich the correct session, request,
  and LLM calls with proven stable correlation.
- Copilot Prompt timeline and Call detail show real per-call context/token data
  when available and explicit unavailable states otherwise.
- The extension never writes Copilot settings or bypasses enterprise policy.
- Missing cache attributes, unmatched spans, and stale exports are not shown as
  zero or silently attached elsewhere.
- File lifecycle behavior and two-version/enterprise compatibility are covered
  by fixtures or recorded manual proof.
- Unit tests, typecheck, build, documentation, visual verification, and the
  closing specification checkpoint pass.

