# Test Proof - Prompt Cost Map

## Status

Implemented and machine-validated on 2026-07-19. The rendered in-VS Code
visual pass is the one remaining verification (see Known Gaps).

## Completed Planning Checks

- Reviewed `WORKFLOW.md` and the active plan/specification rules.
- Reviewed the existing panel order, prompt selection path, call-detail
  placement, chart implementation baseline, and `PromptRequest` /
  `LlmCallInfo` data shape.
- Reviewed the four relevant durable specifications for scope, cost confidence,
  provider honesty, chart rules, and panel interaction.
- Confirmed that the current data model can derive the selected-conversation
  chart for Claude and Codex. Selected period mode requires a new host-side
  cross-conversation chart-point projection and a durable scope amendment.
- Confirmed that Copilot lacks per-LLM-call context data and therefore needs an
  explicit unavailable state.

## Specification Checkpoint (post-implementation)

- SR-001 was approved by the maintainer instructing implementation of the
  full plan (phase 1 = "approve and apply") and is now applied:
  `product-scope.md` gained the bounded Prompt Cost Map period-view
  exception, `surfaces-and-privacy.md` gained the Prompt cost map panel
  contract and the matching exception wording, and `ui-design.md` now
  distinguishes dual-axis overlays from labeled multidimensional scatters.
- No other durable rule is touched. Provider honesty
  (`provider-and-cost.md`) is met by per-criterion exclusion counts and the
  explicit unavailable state — nothing missing is rendered as zero.

## Commands Run And Results (2026-07-19, this machine)

1. `npm run typecheck` — expected clean; actual clean.
2. `npm test` — expected all derivation/scale tests green; actual 22/22 pass
   (`src/domain/costMap.test.ts` via `scripts/run-tests.js`, esbuild +
   `node --test`, Node v22.21.1).
3. `npm run build` — expected clean host + webview bundles; actual clean.
4. Real-data probe (`.tmp/probe.ts`, production parsers + production
   derivation, workspace `c:\dev\VectorMind\agent-context-trail`):
   - Claude: 14 conversations, 78 prompts, 43 charted; exclusions all
     `noLlmCalls` (35); contexts 0-322K; deltas -306K..+263K with 1 negative;
     iterations 1-120; cost $0-$27.88; 3 models; guides 100K/200K; 0
     pixel-scale overlaps; rolling windows all/day/week/month = 43/1/1/43.
   - Codex: 15 conversations, 30 prompts, 30 charted; iterations 1-129; cost
     $0-$0.66; 5 models; windows 30/3/3/30.
   - Copilot: 2 conversations, 4 prompts, 0 charted — `missing first
     context ×4, missing last context ×4` → the explicit unavailable state.

## Unit-Test Coverage Map (plan's planned-verification list)

- Pure derivation: start, end, negative delta, one-call prompts, iteration
  count, min/max and single-value gradient bounds, context work, cost
  confidence (zero cost chartable, unavailable excluded), and every
  exclusion reason including multi-reason counting — covered.
- Scale/layout math: zero cost minimum radius, all-zero scope, bounded
  maximum, area proportionality, identical-point offsets (deterministic,
  distinct, first centered), nice steps and guide selection — covered.
- Rolling-window boundaries: All time, inclusive 7-day boundary, 1ms-older
  rejection, unparsable timestamps — covered against prompt `startedAt`.
- Period query scoping (workspace + selected provider only, chart-point
  projection only, no full payload transport) — by construction in
  `loadCostMapPeriod` (reuses the workspace-filtered list functions and ships
  `CostMapPoint[]`); exercised end-to-end by the probe's equivalent path.

## Known Gaps

- Rendered visual checks in the live VS Code panel — light, dark,
  high-contrast themes; legends; tooltip clipping at narrow widths; keyboard
  focus walk and Enter/Space selection with no scroll jump; period-mode
  cross-conversation activation — need the extension loaded in VS Code
  (`npm run reinstall`, then open the panel). Not run in this pass.
- All-time period performance beyond this machine's volumes (tens of
  conversations) is untested; the host re-parses in-window conversations per
  query (see implementation.md follow-ups).

## Environment

- Windows 11, Node v22.21.1, npm scripts as in `package.json`.
- Real provider logs read in place from `~/.claude/projects`, `~/.codex`, and
  Copilot `chatSessions`; nothing was written to provider directories.
