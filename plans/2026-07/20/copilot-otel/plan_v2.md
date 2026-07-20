# Copilot OTLP/HTTP Enrichment Plan

## Status

Replanned on 2026-07-20 at the maintainer's request. Implementation has not
started.

This revision replaces the file-exporter-first design with a local OTLP/HTTP
receiver and extension-owned, daily-partitioned JSONL storage. The immediate
zero-cost display and request-level Copilot context projection fixes remain
recorded in `plans/2026-07/06/copilot-parity`.

## Problem Summary

Copilot's zero-configuration
`workspaceStorage/.../chatSessions/*.jsonl` source stores request-level
`promptTokens` and model-capacity metadata, but not the input/cache/output usage
of each LLM call represented by the Prompt timeline diamonds. The timeline
therefore cannot show the context lane that Claude and Codex expose.

The context number visible inside VS Code's own Chat UI is not exposed through
the public VS Code extension API. Copilot Chat can calculate it while building
and sending a request without persisting the same per-call snapshot in
`chatSessions`; scraping the UI, intercepting traffic, or guessing from request
totals is not an acceptable integration.

Copilot Chat has an official opt-in OpenTelemetry surface that emits one `chat`
span per LLM API call. Direct OTLP/HTTP export provides the missing data without
requiring a continuously growing raw telemetry file.

## Decision Summary

The first production implementation will use:

1. Copilot OTLP/HTTP export to a loopback receiver owned by the extension.
2. Immediate parsing and allowlist-based normalization of incoming spans.
3. No persistence of raw OTLP requests or unknown attributes.
4. Daily JSONL partitions for normalized per-call usage records.
5. A default retention policy covering the current calendar month and the two
   preceding calendar months.
6. A hard storage-size safety cap in addition to time-based retention.
7. Copilot OTel disabled until the user or administrator configures it.
8. No automatic writes to any `github.copilot.*` setting.
9. A compact status line at the end of the panel showing activation state and
   local usage-storage size.

The existing `chatSessions` source remains the zero-configuration conversation
discovery and request-history source.

## Goal And Objectives

Add optional, local Copilot OTel enrichment that:

1. populates Copilot's per-LLM-call context timeline from provider-emitted data;
2. preserves `chatSessions` as the zero-configuration discovery/history source;
3. never enables, disables, redirects, or otherwise modifies Copilot settings;
4. works without retaining prompts, responses, code, tool arguments, tool
   results, repository metadata, or arbitrary telemetry attributes;
5. stores only normalized usage and correlation records;
6. fails honestly when telemetry is disabled, managed off, sent elsewhere,
   unreadable, stale, or ambiguously correlated;
7. remains usable in enterprise installations where policy may own OTel
   configuration;
8. keeps lifecycle behavior simple, visible, and bounded.

## Source Contract

The preferred enrichment source is Copilot Chat's supported OTLP/HTTP exporter:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:<receiver-port>",
  "github.copilot.chat.otel.captureContent": false
}
```

The extension must only read the resolved configuration and runtime state. It
must not write this configuration on the user's behalf.

Metadata-only spans may provide:

- `gen_ai.conversation.id` for session correlation;
- trace, span, and parent-span identifiers;
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` per call;
- `gen_ai.usage.cache_read.input_tokens` and
  `gen_ai.usage.cache_creation.input_tokens` when supplied;
- requested and resolved model;
- finish reason;
- latency and time to first token;
- max output tokens;
- provider-specific optional usage fields.

Missing conditional fields remain unavailable and must never be represented as
zero.

Official references:

- [Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [AI settings reference](https://code.visualstudio.com/docs/agents/reference/ai-settings#_observability-settings)
- [Debug chat interactions](https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view)

## Privacy And Data Minimization

`captureContent: false` is required, but it is not the only privacy boundary.
Copilot may still emit non-content metadata that the product does not need.

The receiver must use an explicit allowlist and discard all other attributes.

Persisted records may contain only fields needed for correlation and display,
such as:

- timestamp;
- conversation, trace, span, and parent-span identifiers;
- request or round correlation identifiers when proven;
- operation name;
- requested and resolved model;
- input, output, cache-read, cache-creation, and other supported token counts;
- duration, time to first token, and finish reason;
- source and schema version.

The receiver must discard:

- prompts and responses;
- code or document content;
- tool arguments and tool results;
- repository URLs;
- branch and commit information;
- local file paths;
- user-entered content;
- unknown or unapproved attributes;
- the raw OTLP request body after normalization.

The implementation must remain safe even when an enterprise policy enables
content capture. Content fields must still be discarded before persistence.

## Local Receiver Architecture

```text
Copilot Chat
    |
    | OTLP/HTTP over loopback
    v
Extension-owned receiver
    |
    | validate, normalize, allowlist, deduplicate
    v
Daily normalized JSONL partitions
    |
    | correlate at read time
    v
Copilot Prompt timeline and call detail
```

The receiver should:

- bind to `127.0.0.1` only;
- accept the OTLP trace endpoint required by Copilot;
- reject unsupported payloads defensively;
- normalize supported `chat` spans immediately;
- discard raw request content after parsing;
- tolerate duplicate exports and retried HTTP requests;
- avoid exposing a general-purpose network service;
- stop cleanly with the extension lifecycle;
- report incompatible or conflicting endpoint configuration honestly.

A fixed receiver port may be used only if collision handling is reliable.
Otherwise the implementation must establish a stable local endpoint without
silently rewriting Copilot configuration.

## Storage Format

Normalized records are stored as immutable daily JSONL partitions:

```text
storage/
  copilot-otel/
    2026-07-18.jsonl
    2026-07-19.jsonl
    2026-07-20.jsonl
```

A normalized line may resemble:

```json
{
  "timestamp": "2026-07-20T14:32:18.421Z",
  "conversationId": "...",
  "traceId": "...",
  "spanId": "...",
  "parentSpanId": "...",
  "operation": "chat",
  "requestedModel": "...",
  "resolvedModel": "...",
  "inputTokens": 42153,
  "outputTokens": 1834,
  "cacheReadTokens": 32768,
  "cacheCreationTokens": null,
  "durationMs": 8421,
  "finishReason": "stop",
  "sourceVersion": "..."
}
```

Storage rules:

- append only to the current UTC or explicitly chosen local-calendar partition;
- never rewrite historical partitions during normal ingestion;
- tolerate a partial trailing line after interruption;
- deduplicate by stable span identity where possible;
- keep correlation rebuildable from JSONL;
- avoid an additional persistent database;
- permit a small rebuildable index or manifest only when it contains no
  irreplaceable data.

## Retention And Cleanup

Retention configuration is optional. The product must provide safe defaults and
work without requiring the user to configure lifecycle settings.

### Default time policy

Retain:

- the current calendar month;
- the previous complete calendar month;
- one additional complete calendar month as a safety period.

This is expressed as three calendar periods, not a fixed 90-day duration.

For example:

- on 2026-07-20, retain partitions from 2026-05-01 onward;
- on 2026-08-01, remove May partitions and retain June, July, and August.

This supports the product's intended display of the current period, the
previous comparison period, and one safety period for delayed correlation or
reprocessing.

### Default size policy

A hard storage cap must protect against abnormal traffic, exporter loops, or
unexpected span volume. The initial default should be validated with fixtures;
a provisional value of 250 MB is reasonable for normalized metadata-only
records.

Time retention is the normal policy. The size cap is an emergency safeguard.

When the cap is exceeded:

1. remove expired partitions;
2. remove the oldest safety-period partitions;
3. preserve the current and previous reporting periods where possible;
4. continue deleting oldest partitions only when required to return below the
   cap;
5. record that size-based pruning occurred.

### Cleanup ownership

The extension owns the normalized JSONL files and therefore owns cleanup.

Cleanup runs:

- at extension or receiver startup;
- when a new daily partition is opened;
- once per day while active;
- after ingestion when the storage cap may have been crossed.

Cleanup deletes whole expired daily partitions. It must not modify arbitrary
user-selected files or telemetry owned by another product.

Optional advanced overrides may later expose retention periods and maximum
storage size, but neither setting is required for normal setup or use.

## Activation And User Awareness

Copilot OTel enrichment is opt-in.

The extension must not:

- enable Copilot OTel automatically;
- redirect an existing exporter automatically;
- overwrite a user or enterprise endpoint;
- bypass a managed-off policy;
- infer consent merely because an endpoint is reachable.

The zero-configuration product remains functional without enrichment.

### Effective states

The implementation should distinguish:

- OTel disabled;
- OTel enabled and pointing to the local receiver;
- OTel enabled and pointing elsewhere;
- OTel controlled by environment configuration;
- OTel controlled by enterprise policy;
- receiver active but receiving no compatible spans;
- receiver receiving and persisting normalized usage;
- persistence unavailable because of storage errors.

When OTel points elsewhere, the extension leaves that configuration untouched
and reports enrichment as unavailable unless a compatible integration is
explicitly supported.

When OTel is enterprise-managed, the extension respects the managed state and
still applies its own allowlist before retaining any local record.

### Panel status

The only persistent user-facing awareness surface is a compact status line at
the end of the panel.

Examples:

```text
Copilot detail: inactive
```

```text
Copilot detail: active · local usage history 14.2 MB
```

```text
Copilot detail: active · no compatible spans received
```

```text
Copilot detail: managed by organization · local usage history 14.2 MB
```

```text
Copilot detail: storage unavailable
```

The status must make activation and local storage visible without adding
command-palette actions, recurring prompts, or intrusive setup notifications.

## Scope

### In scope

- Detect resolved Copilot OTel enablement, exporter type, and endpoint without
  modifying configuration.
- Run a loopback OTLP/HTTP receiver.
- Accept and normalize supported Copilot `chat` spans.
- Enforce a strict persisted-field allowlist.
- Store normalized records in daily JSONL partitions.
- Correlate OTel conversations, requests, rounds, and child `chat` spans with
  the existing Copilot session/request/round model.
- Enrich `LlmCallInfo` with per-call token composition and supported metadata.
- Apply default time and size retention automatically.
- Surface unmatched, incomplete, stale, ambiguous, and unavailable states.
- Validate with content capture disabled and with content unexpectedly present.
- Show activation state and usage-storage size at the end of the panel.

### Non-goals

- Automatically enabling, disabling, or redirecting Copilot OTel.
- Writing any `github.copilot.*` setting.
- Scraping the Chat UI.
- Intercepting Copilot network traffic.
- Invoking private Copilot commands.
- Replacing `chatSessions` as the conversation discovery source.
- Persisting raw OTLP requests.
- Capturing prompts, responses, code, tool inputs, or tool results.
- Persisting repository, branch, commit, or file-path metadata.
- Shipping SQLite or another database.
- Requiring Jaeger, Tempo, Grafana, or a cloud observability backend.
- Adding user commands for telemetry management in the first implementation.
- Providing organizational or cross-workspace analytics.

## Proposed Implementation Phases

### 1. Fixture and correlation proof

- Capture content-disabled OTLP/HTTP traces and matching `chatSessions` records
  from the same conversations.
- Verify exact `gen_ai.conversation.id` mapping and request/round ordering.
- Prove trace hierarchy and stable span identifiers.
- Repeat with at least two Copilot Chat versions.
- Include an enterprise-managed installation where available.
- Confirm whether cache fields vary by account, provider, or model.

### 2. Configuration and state detection

- Read resolved settings and environment-visible state without modifying them.
- Distinguish disabled, managed-disabled, wrong exporter, conflicting endpoint,
  inactive receiver, empty stream, and usable stream.
- Define the panel-footer status mapping for every state.
- Verify that the extension remains fully functional when enrichment is absent.

### 3. Local OTLP/HTTP receiver

- Bind to loopback only.
- Implement the required OTLP trace endpoint.
- Validate payload shape and size defensively.
- Parse, allowlist, normalize, and discard the raw request.
- Tolerate duplicate delivery and retries.
- Add receiver health and shutdown tests.

### 4. Daily JSONL writer

- Append normalized records to daily partitions.
- Handle process interruption and partial trailing lines.
- Deduplicate stable span identities.
- Keep any index or manifest fully rebuildable.
- Verify behavior across Windows, macOS, and Linux.
- Ensure no raw or unknown fields reach disk.

### 5. Retention and pruning

- Implement three-calendar-period retention.
- Implement the hard storage cap.
- Delete whole oldest partitions.
- Run pruning at startup, daily rollover, and periodic lifecycle points.
- Record time-based and size-based pruning outcomes.
- Test month, year, daylight-saving, and clock-boundary behavior.

### 6. Correlation and enrichment

- Join by stable IDs and trace hierarchy, not timestamps alone.
- Prefer OTel per-call values over skeletal `chatSessions` round metadata.
- Preserve request-level values when no confident per-call match exists.
- Keep unmatched and ambiguous spans visible as unavailable rather than
  attaching them incorrectly.
- Correlate at read time without rewriting historical JSONL partitions.

### 7. Panel integration

- Populate Copilot Prompt timeline context bars and Call detail from enriched
  `LlmCallInfo` records.
- Show cache components only when emitted.
- Keep missing conditional fields unavailable rather than zero.
- Add the compact final-panel status for activation and local storage size.
- Avoid command-palette actions and recurring activation prompts.

### 8. Validation and documentation

- Add parser, allowlist, deduplication, retention, and correlation fixtures.
- Include fixtures where content fields are absent, redacted, and unexpectedly
  present.
- Verify disabled, redirected, and enterprise-managed states.
- Run unit tests, typecheck, build, and an in-VS Code visual pass.
- Update README and the specification checkpoint after validation.

## Alternative Sources

The Copilot file exporter remains useful for fixtures and one-off diagnostics,
but it is not the preferred production source because it creates a separate
raw lifecycle problem.

The SQLite DB exporter and Agent Debug Log manual export are also useful for
fixtures and investigation. They are not automatic production dependencies.

A compatible enterprise observability backend may become an optional future
source, but the first implementation does not require or query one.

Without OTel, the product continues to use `chatSessions` and exposes only the
request-level data that source can support.

## Enterprise Constraints

Enterprise policy can force or lock OTel configuration and takes precedence
over environment and user settings.

A managed-off configuration is an honest unavailable state controlled by the
administrator, not an error that the extension should bypass.

A managed endpoint that points elsewhere must not be overwritten. A managed
configuration that sends compatible spans to the local receiver can be used,
but the extension still applies its own allowlist and retention policy.

The panel status should distinguish organization-managed activation from
ordinary user-managed activation when that state can be resolved reliably.

## Open Points

- `OP-001` — Prove exact conversation/request/round correlation keys with real
  matching OTLP/HTTP exports.
- `OP-002` — Confirm whether per-call `gen_ai.usage.input_tokens` matches the
  Chat UI context figure or differs because of reserved output or budgeting.
- `OP-003` — Confirm cache attributes across personal and enterprise accounts.
- `OP-004` — Determine a reliable loopback endpoint strategy without silently
  rewriting Copilot configuration.
- `OP-005` — Confirm whether resolved enterprise-managed settings expose enough
  information to distinguish policy-disabled from ordinary disabled.
- `OP-006` — Validate UTC versus local-calendar partitioning against reporting
  semantics and user expectations.
- `OP-007` — Measure normalized record size and confirm the default hard cap.
- `OP-008` — Confirm duplicate-delivery behavior of the Copilot OTLP exporter.
- `OP-009` — Define behavior when multiple VS Code windows or extension hosts
  target the same local receiver and storage directory.

## Dependencies And Risks

- Copilot OTel is opt-in by default and can be controlled by enterprise policy.
- Exporter behavior and attributes may vary across Copilot Chat versions.
- Incorrect correlation would silently attach usage to the wrong prompt, which
  is worse than leaving it unavailable.
- A local endpoint can conflict with another process or another observability
  setup.
- Multiple VS Code windows may create receiver or writer coordination issues.
- JSONL needs explicit partial-write, duplicate, and concurrent-access handling.
- Time retention alone cannot protect against exceptional event volume.
- Size-based pruning may shorten the safety period and must be reported.
- Content capture may be enabled outside the extension's control, so the
  receiver's allowlist is mandatory.
- Any rebuildable manifest or index must not become a hidden second source of
  truth.

## Specification Checkpoint

Reviewed `specification/product-scope.md`, `provider-and-cost.md`, and
`surfaces-and-privacy.md` on 2026-07-20.

- The plan stays within product scope: it enriches selected conversations and
  requests, with no organizational or cross-workspace analytics.
- It follows the privacy rule forbidding programmatic writes to provider
  settings.
- It keeps content capture out of persisted data even when incoming spans
  unexpectedly contain content.
- It follows the provider rule that absent cache or per-call data remains
  unavailable rather than fabricated.
- It gives the extension explicit ownership of its normalized JSONL lifecycle.
- Candidate maintainer review: `provider-and-cost.md` currently describes cache
  tokens as Copilot's one durable gap. If OTLP fixtures prove the conditional
  attributes usable, revise that statement to distinguish the zero-
  configuration `chatSessions` gap from optional OTel enrichment.
- No specification change is applied during planning; refresh this checkpoint
  before the packet is marked done.

## Exit Criteria

- Content-disabled Copilot OTLP/HTTP spans enrich the correct session, request,
  and LLM calls with proven stable correlation.
- The receiver binds to loopback, persists only allowlisted normalized fields,
  and discards raw OTLP payloads.
- Daily JSONL partitions survive interruption and can be rebuilt without a
  database.
- Default cleanup retains the current calendar month and two preceding calendar
  months.
- A hard size cap prevents unbounded local storage growth.
- Cleanup is automatic and requires no mandatory retention configuration.
- The extension never writes Copilot settings or bypasses enterprise policy.
- Missing cache attributes, unmatched spans, and stale exports are not shown as
  zero or silently attached elsewhere.
- The final panel status shows activation state and local usage-storage size.
- No user commands are required for telemetry management in the first
  implementation.
- Unit tests, typecheck, build, documentation, visual verification, and the
  closing specification checkpoint pass.
