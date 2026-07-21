# Implementation Log

[######] Done (2026-07-21) - Opt-in Copilot OTLP/HTTP enrichment implemented,
unit-validated (70 tests, clean typecheck/build), and documented. OP-001
correlation proven on real data. Full history below, newest sections last;
closure note and follow-ups are at the end. Live in-VS-Code visual pass and
OP-002/005/009 are noted follow-ups the maintainer chose to close on.

The sections below are kept in chronological order (first pass first) as the
work record; this top marker is the authoritative current status.

## Environment Finding (2026-07-20)

Before writing any parser, checked this machine for real OTel data per the
project's standing "verify against real local data" rule:

- No `github.copilot.chat.otel.*` keys in `%APPDATA%/Code/User/settings.json`.
- No exported OTLP file exists anywhere under `%APPDATA%/Code` (the only
  `*otel*` matches are unrelated bundled `HTMLSlotElement` files).

Consequence: the plan's Phase 1 correlation proof and the reader/correlation/
enrichment phases (3-5) cannot be built against real data yet, and the plan is
explicit that guessed correlation is worse than an honest unavailable state.
Implementation therefore starts with Phase 2, which needs no exported data.

## Phase 2 - Configuration Detection (this pass)

Detect the resolved Copilot OTel configuration and classify it into one honest
state, without ever writing a `github.copilot.*` setting.

### Files added

- `src/providers/copilot/otel/config.ts` - pure classifier
  `classifyCopilotOtel(probe)` returning a `CopilotOtelStatus` discriminated by
  `kind`: `disabled`, `managed-disabled`, `wrong-exporter`, `missing-outfile`,
  `unreadable`, `empty`, `usable`. No `vscode`/`fs` import, so it is fully unit
  tested. Fabricates no defaults (unset `enabled` = off; unset `exporterType` =
  not the file exporter). Surfaces `contentCaptureEnabled` for the privacy
  warning and a docs link for the UX - never an automatic enable action.
- `src/providers/copilot/otel/config.test.ts` - 11 tests covering every state,
  policy precedence, the "no fabricated default" rules, and the content-capture
  flag.
- `src/providers/copilot/otel/detect.ts` - thin extension-host adapter
  `detectCopilotOtel()`. Reads resolved `github.copilot.chat.otel.*` via
  `getConfiguration(...).get/inspect`, probes the outfile with `fs.statSync`,
  and defers all branching to the pure classifier. Read-only. Kept out of the
  unit bundle because the test runner externalizes `vscode`.

Not yet wired into `extension.ts` / the panel UX - the explanation/link surface
(rest of Phase 2) lands with the panel-integration work so there is one place
that renders both the unavailable states and, later, the enrichment.

### Decisions

- Enterprise policy precedence is honored first: a policy-forced `enabled:false`
  yields `managed-disabled`, distinct from an ordinary user `disabled`. Because
  `@types/vscode@1.90` does not yet declare `inspect().policyValue`, the adapter
  reads it defensively through `unknown`; OP-005 (can resolved settings reliably
  distinguish policy-off from user-off) stays open until confirmed on a real
  managed install.
- An unset `exporterType` while enabled is reported as `wrong-exporter` (naming
  the current value), not silently assumed to be `file`, matching the source
  contract that the file exporter must be explicitly selected.

## Blocked / Not Started

- Phase 1 fixture + correlation proof (OP-001..OP-005): needs the maintainer to
  enable the content-disabled file exporter and run a Copilot chat so a real
  export + matching `chatSessions` record can be captured.
- Phases 3-5 (OTLP JSON-lines reader, correlation, panel enrichment): gated on
  the Phase 1 fixture. The reader's exact line framing and rotation behavior
  (OP-004) must be observed, not guessed.

## Validation (Phase 2 pass)

- `npm run typecheck` - clean.
- `npm test` - 37 pass / 0 fail (11 new).
- `npm run build` - clean.
- No live VS Code visual pass (no UX wired yet, and no real export to display).

## v2 Replan (OTLP/HTTP) - Phase 1 Capture Complete - 2026-07-20

Plan superseded by `plan_v2.md` (loopback OTLP/HTTP receiver + extension-owned
daily JSONL storage). The maintainer enabled the exporter against a loopback
capture receiver; Phase 1's real fixture + correlation proof is now DONE (the
blocker from the first pass is cleared). Full evidence in `test.md`.

Headline results:

- Wire format observed: OTLP/JSON, uncompressed, three signals (traces/logs/
  metrics); only `/v1/traces` is needed.
- Real per-LLM-call usage confirmed: input/output/cache_read/reasoning tokens
  per `chat` span. `cache_creation` never emitted (Copilot cache-write gap
  confirmed; cache-read is available over OTLP).
- Correlation PROVEN (OP-001): `gen_ai.conversation.id` == `chatSessions`
  filename; `server_request_id` == that file's `responseId`; rounds = spans
  sharing `traceId` + `server_request_id`, ordered by start time.
- CRITICAL: `captureContent:false` does NOT strip content or repo/git metadata
  from spans - the receiver allowlist is mandatory and unconditional.

### Files added this pass

- `scripts/otel-capture.js`, `scripts/otel-analyze.js`, `scripts/otel-usage.js`,
  `scripts/otel-make-fixture.js` - capture receiver + analysis + fixture builder
  (raw captures stay under gitignored `.tmp/`).
- `src/providers/copilot/otel/fixtures/real-trace-redacted.json` - committed,
  content-stripped real 6-span trace fixture (0 content strings; 18 content/
  repo/git attribute types removed).

### Spec checkpoint update (candidate for maintainer)

`provider-and-cost.md` calls cache tokens Copilot's durable gap. Real OTLP data
shows **cache-read** IS available per call (only cache-write is absent). When
Phase 6/7 ship, that paragraph should distinguish the zero-config `chatSessions`
gap from OTLP enrichment. Not applied yet.

### Next (to plan with maintainer)

Phases 3-8 of `plan_v2.md`: production receiver + allowlist normalizer (against
the real attribute set), daily JSONL writer, retention, read-time correlation,
panel status + enrichment. Progress marker below reflects Phase 1 done, Phase 2
core done, Phases 3+ pending.

## v2 Data Plane + Enrichment + Panel Status - 2026-07-21

Built the full OTLP/HTTP data plane per `plan_v2.md`, on the maintainer's
decision: own the loopback port, allowlist incoming spans, never persist raw
OTLP, store our own daily JSONL, surface storage size in the panel footer.

### New modules (`src/providers/copilot/otel/`)

- `types.ts` - `NormalizedCall` (the only persisted shape) + schema version.
- `normalize.ts` (+test) - pure allowlist normalizer: one OTLP/JSON trace export
  -> `NormalizedCall[]`, reading ONLY allowlisted usage/correlation attributes
  (content/repo/git never read, so never persisted). Big-nanosecond-safe time
  conversion. Tested against the committed real fixture, incl. a content-leak
  guard and the emitted-zero vs absent distinction.
- `storage.ts` (+test) - daily UTC-partitioned JSONL writer/reader; partial-line
  tolerance, spanId dedupe, schema-version skip, `storageBytes` for the footer.
- `retention.ts` (+test) - pure `planRetention` (current + 2 preceding calendar
  months, then hard size cap dropping oldest-first) + `runRetention` executor
  that deletes whole partitions and logs every removal (Data Retention rule).
- `receiver.ts` (+test) - loopback OTLP/HTTP server: `/v1/traces` parsed ->
  normalized -> appended -> raw discarded; `/v1/logs` & `/v1/metrics` accepted
  and ignored; body-size cap; EADDRINUSE surfaces cleanly. Live round-trip test.
- `enrich.ts` (+test) - read-time correlation: joins OTel calls to requests by
  `server_request_id == result.metadata.responseId`, replaces skeletal round
  marks with real per-call context. Fresh vs cache split (OpenAI input_tokens is
  cache-inclusive: fresh = input - cache_read; contextTokens = input). Unmatched
  requests untouched; nothing force-attached.
- `config.ts` (+test) - repurposed from the v1 file-exporter model to the v2
  otlp-http + loopback-endpoint states (disabled / managed-disabled /
  wrong-exporter / endpoint-missing / endpoint-elsewhere / loopback).
- `footer.ts` (+test) - pure panel-footer formatter (the plan's "Copilot detail:
  …" lines) + `formatBytes`.
- `detect.ts` - `vscode` adapter reading resolved settings (read-only).
- `service.ts` - host lifecycle: detect -> start receiver on the user's loopback
  port -> retention at startup/after ingest -> footer lines. Never writes a
  Copilot setting; only binds the port the user pointed Copilot at (OP-004).

### Wiring

- `parser.ts` - captures `result.metadata.responseId` (join key) and applies OTel
  enrichment when an `otelBaseDir` is passed and stored calls match the session.
- `extension.ts` - constructs `CopilotOtelService` on `context.globalStorageUri`,
  starts it on activation (dormant unless the user opted into a loopback
  endpoint), stops on dispose, passes `otelBaseDir` to the Copilot parse.
- `panelController.ts` - takes the service, passes `otelBaseDir` to the Copilot
  parse, and includes `storageFooter` lines in the `init` message.
- `protocol.ts` / `webview/main.ts` - `init.storageFooter` renders in the
  existing Storage Footer (falls back to the "no local data stored" guarantee).

### Decisions

- Storage lives in `globalStorage` (extension-scoped, not settings-synced),
  satisfying the privacy rule for extension-persisted state.
- Only `chat` spans are persisted; tool/embeddings/agent spans are ignored
  (tools already come from `chatSessions`).
- Auxiliary helper spans (no `conversation.id`) are stored but never correlate to
  a user turn, so they cannot mis-attach usage.

### Validation (this pass)

- `npm run typecheck` clean; `npm test` 70 pass / 0 fail (34 new); `npm run
  build` clean.
- NOT yet done: a live in-VS-Code pass (receiver binding the real port, a real
  chat enriching the timeline, the footer showing "active · local usage history
  …"). Requires reinstalling the extension and running a Copilot chat. Per the
  plan, README + the provider-and-cost.md cache revision land AFTER that pass.

### Spec checkpoint (applied 2026-07-21, maintainer-authorized)

Real OTLP data shows per-call **cache-read** IS available; only cache-write is
absent. `specification/provider-and-cost.md` revised: the Copilot paragraph now
distinguishes the zero-config `chatSessions` gap (no per-call/cache tokens) from
the opt-in OTLP export that adds per-call context including cache-read, and
states cache-write stays unavailable because Copilot never emits it. The binding
rule's example changed from "Copilot cache tokens" to "Copilot cache-write
tokens". README update still deferred until the live pass.

### Packaging hygiene

`.vscodeignore` now excludes `scripts/**` so the dev-only capture/analysis
scripts (and run-tests) no longer ship in the VSIX.

## Closure - 2026-07-21

Closed at the maintainer's request. README updated (opt-in OTel enrichment
section, including the required user settings the extension never writes) and
the provider-and-cost.md spec revision applied; `.vscodeignore` now excludes dev
scripts from the VSIX.

Delivered and unit-validated: OP-001 correlation proven against real data; the
full OTLP/HTTP data plane (loopback receiver, allowlist normalizer, daily JSONL
store, retention, read-time enrichment, panel footer) with 70 passing tests,
clean typecheck and build. Raw OTLP is never persisted and content/repo/git
attributes are dropped by construction.

Follow-ups the maintainer chose to close on (not blockers, tracked here):

- Live in-VS-Code visual pass not yet run: receiver binding the real port, a
  Copilot chat enriching the Prompt timeline/Call detail, and the footer showing
  "Copilot detail: active · local usage history …". All unit-proven; the live
  render remains unverified in this packet.
- `OP-002` open: whether a call's `gen_ai.usage.input_tokens` equals the Chat UI
  context figure (needs a UI glance during the live pass).
- `OP-005` (policy-off vs user-off) and `OP-009` (multiple windows sharing the
  receiver port/store) remain as noted risks, not yet exercised on real managed
  or multi-window setups.

[######] Done - v2 OTLP/HTTP Copilot OTel enrichment implemented, unit-validated,
documented; live in-VS-Code visual pass + OP-002/005/009 noted as follow-ups.
