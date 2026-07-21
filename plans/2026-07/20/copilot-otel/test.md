# Test Proof

## Planning Evidence - 2026-07-20

- Reviewed the existing Copilot `chatSessions` parser and confirmed it has only
  request-level token usage plus skeletal LLM round markers.
- Reviewed the current official VS Code Copilot OTel documentation, settings
  reference, file/SQLite exporters, Agent Debug Log export, GenAI per-call
  token attributes, content-capture behavior, and enterprise-managed setting
  precedence. Links are recorded in `plan.md`.
- No runtime implementation exists yet; parser fixtures, correlation proof,
  automated tests, and visual validation remain required by the plan.

## Phase 2 Implementation Evidence - 2026-07-20

### Real-data probe (why Phase 1 is blocked)

- `%APPDATA%/Code/User/settings.json` grepped for `otel`: no
  `github.copilot.chat.otel.*` keys present.
- Recursive search for `*otel*` files under `%APPDATA%/Code`: only unrelated
  bundled `HTMLSlotElement` files matched; no exported OTLP outfile exists.
- Conclusion: Copilot OTel is not enabled on this machine, so no real
  content-disabled export or matching `chatSessions` record is available to
  prove OP-001..OP-005. Correlation/enrichment stays unbuilt rather than guessed.

### Automated tests

- Command: `npm test` (node built-in runner via esbuild bundle).
- Expected: every configuration state classifies correctly, policy-off beats
  user-on, no fabricated defaults, content-capture surfaced.
- Actual: 37 pass / 0 fail (11 new in `config.test.ts` covering disabled,
  managed-disabled, wrong-exporter, missing-outfile, unreadable, empty, usable,
  and the content-capture flag).

### Typecheck and build

- `npm run typecheck`: clean.
- `npm run build`: clean.

### Known gaps

- `detect.ts` (the `vscode`/`fs` adapter) is not in the unit bundle by design;
  its only logic is reading resolved settings + an `fs.statSync` probe, both
  deferred to the tested pure classifier. Not exercised against a real managed
  install, so OP-005 (policy-off vs user-off distinction) is unconfirmed.
- No panel/UX surface wired yet; no live VS Code visual pass.

## v2 (OTLP/HTTP) Phase 1 - Real Capture & Correlation Proof - 2026-07-20

Maintainer enabled the opt-in exporter and pointed it at the loopback receiver:
`enabled:true, exporterType:otlp-http, otlpEndpoint:http://127.0.0.1:9876,
captureContent:false`. Copilot logged `[OTel] Instrumentation enabled` and
exported real spans from a live multi-turn chat.

### Tooling (disposable, under .tmp/ and scripts/)

- `scripts/otel-capture.js` - loopback OTLP/HTTP capture receiver (any path/
  encoding); saved raw + decoded + headers to `.tmp/copilot-otel-capture/`.
- `scripts/otel-analyze.js` - span-name / attribute-key / hierarchy summary.
- `scripts/otel-usage.js` - privacy-safe per-`chat`-span report (usage &
  correlation in full; content fields reported by LENGTH only, never printed).
- `scripts/otel-make-fixture.js` - built the committed content-stripped fixture.

### Observed wire format

- Encoding: **OTLP/JSON, uncompressed** (`content-type: application/json`, no
  protobuf, no gzip). Three signals exported: `POST /v1/traces`, `/v1/logs`,
  `/v1/metrics`. Only `/v1/traces` is needed; metrics tick ~every 10s.
- Trace payloads up to ~390 KB; scope name `copilot-chat`; resource attrs
  `service.name`, `service.version`, `session.id`.
- Span names: `chat <model>`, `execute_tool <name>`, `embeddings <model>`,
  `invoke_agent GitHub Copilot Chat`.

### Per-call usage attributes present (the missing context lane) - OP-003

On `chat` spans: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.usage.cache_read.input_tokens` (real, e.g. 13184 / 28416 / 29440 - not
always zero), `gen_ai.usage.reasoning.output_tokens` / `reasoning_tokens` on
reasoning models. **`gen_ai.usage.cache_creation.input_tokens` was never
emitted** - Copilot's cache-write gap is confirmed from real data, cache-read
is NOT a gap over OTLP. Also present: `gen_ai.request.max_tokens`,
`gen_ai.response.finish_reasons`, `gen_ai.response.time_to_first_chunk`,
`copilot_chat.time_to_first_token`, `copilot_chat.request.max_prompt_tokens`,
`copilot_chat.copilot_usage_nano_aiu` (premium-usage signal).

### Correlation proof - OP-001 PROVEN

For the real user turn (conversation `bf40277b-…`):

- `gen_ai.conversation.id` == `copilot_chat.chat_session_id` ==
  `copilot_chat.session_id` == the `chatSessions/bf40277b-….jsonl` **filename**
  (exact). Conversation join is a direct stable key.
- `copilot_chat.server_request_id` (== `gen_ai.response.id`, e.g. `bd1af91e-…`)
  appears inside that session file as **`responseId`** (once per request). This
  is the request/turn join key.
- The three `mai-code-1-flash` spans shared one `traceId`, one
  `parentSpanId` (the `invoke_agent` span), and one `server_request_id`, with
  distinct `spanId`s and **growing input context** (23800 -> 29582 -> 30020 as
  tool results accumulate) = the request's successive rounds/LLM calls. Round
  order = span start-time order.
- Auxiliary `gpt-4o-mini` spans are separate traces with NO `conversation.id`
  (title/intent helpers); they must not be shown as the user turn's LLM calls.

### CRITICAL privacy finding

`captureContent:false` does **not** strip content. On the captured spans, these
were fully POPULATED: `gen_ai.input.messages`, `gen_ai.output.messages`,
`gen_ai.system_instructions`, `gen_ai.tool.definitions`,
`gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`,
`copilot_chat.user_request`, `copilot_chat.reasoning_content`, plus repo/git
metadata (`copilot_chat.repo.remote_url`, `head_branch_name`,
`head_commit_hash`, `github.copilot.git.*`, `github.copilot.github.org`). The
receiver's persisted-field allowlist is therefore **mandatory and unconditional**
- stronger than the plan assumed (it must apply even with content capture off,
  not only when a policy turns it on). Raw captures live only under gitignored
`.tmp/`.

### Committed fixture

`src/providers/copilot/otel/fixtures/real-trace-redacted.json` - a real 6-span
trace envelope with all 18 content/repo/git attribute types dropped
(verified: 0 content strings remain). 21 KB. Feeds Phase 3/6 tests with
real-shaped OTLP without sensitive data.

### Still open

- OP-002 (does per-call `input_tokens` equal the Chat UI context figure): have
  real numbers but need the Chat UI value to compare.
- OP-008 (duplicate delivery): no duplicate `spanId`s seen across the 5 trace
  envelopes; retry behavior not yet forced.
- Exact `responseId` nesting path inside `chatSessions` metadata to finalize the
  request-level join in Phase 6.

## v2 Phases 3-7 - Data Plane, Enrichment, Panel Status - 2026-07-21

### Join key finalized (OP-001 closed)

`scripts/otel-find-path.js` reconstructed the real session
`bf40277b-….jsonl`: 1 request, model mai-code-1-flash, 6 toolCallRounds. The
OTel `server_request_id` (`bd1af91e-…`) equals `result.metadata.responseId` in
that request (a distinct top-level `responseId = "response_…"` exists but is not
the OTel key). Request-level join key confirmed: `result.metadata.responseId`.

### Automated tests

- Command: `npm test`. Result: **70 pass / 0 fail** (34 new this pass).
- New coverage: normalizer vs the real fixture (usage + correlation mapping,
  fresh-vs-cache split, emitted-zero vs absent, big-nanosecond timestamps, a
  content-leak guard, junk tolerance); JSONL storage (per-day partitions,
  dedupe, partial-line/corruption tolerance, schema skip, byte sizing); retention
  (calendar cutoff incl. year boundary, time + size pruning, real-file executor
  with logging); receiver (pure ingest, live loopback round-trip ingesting
  `/v1/traces` and ignoring `/v1/metrics`, EADDRINUSE rejection); enrichment
  (grouping/order, real per-call context onto the matched request, no-match and
  empty passthrough); config (all six v2 states, endpoint parsing); footer (every
  status line, formatBytes, persisted vs guarantee sub-line).
- `npm run typecheck` clean; `npm run build` clean.

### Privacy re-verification

The normalizer reads only allowlisted keys by construction; `normalize.test.ts`
asserts no content/repo/git substring appears in any normalized record built
from the real fixture. The receiver discards the raw body after parsing and
never writes `/v1/logs` or `/v1/metrics`.

### Not yet validated (needs the maintainer)

- Live in-VS-Code pass: reinstall the extension, reload (receiver binds
  127.0.0.1:9876 since OTel is still pointed there), run a Copilot chat, open the
  panel — expect the Prompt timeline/Call detail to show real per-call context
  and the footer to read "Copilot detail: active · local usage history …".
- OP-002 (per-call input_tokens vs the Chat UI context figure): needs a UI
  glance during that pass.

