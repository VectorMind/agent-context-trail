# Implementation Log

[#-----] Phase 2/6 started - configuration detection implemented and unit
tested. Phase 1 (real fixture + correlation proof) is blocked pending the
maintainer enabling the opt-in exporter: Copilot OTel is not configured on this
machine (verified), so no real content-disabled export exists to prove
OP-001..OP-005 against.

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

## Validation (this pass)

- `npm run typecheck` - clean.
- `npm test` - 37 pass / 0 fail (11 new).
- `npm run build` - clean.
- No live VS Code visual pass (no UX wired yet, and no real export to display).
