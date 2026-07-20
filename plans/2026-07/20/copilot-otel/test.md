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

