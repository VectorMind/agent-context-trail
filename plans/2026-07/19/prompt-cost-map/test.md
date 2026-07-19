# Test Proof - Prompt Cost Map

## Status

Planning only. No implementation exists and no product tests have been run.

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

## Planned Verification

When implementation is approved, record:

1. pure derivation tests for start, end, negative delta, one-call prompts,
   iteration count, min/max and single-value gradient bounds, context work,
   cost confidence, and exclusion reasons;
2. scale/layout tests for zero cost, one point, identical points, large
   outliers, mixed models, and large prompt counts;
3. keyboard focus and Enter/Space selection behavior with no scroll jump;
4. light, dark, and high-contrast rendered checks, including legends and
   tooltip text;
5. scope-toggle and rolling All time / day / week / month boundary tests using
   prompt `startedAt`, constrained to current workspace and selected provider;
6. real Claude, Codex, and Copilot conversations, with missing values never
   rendered as zero;
7. All time performance and overlap checks without transporting full prompt or
   call payloads;
8. `npm run typecheck` and `npm run build`.

## Known Gaps

- SR-001 remains open for a durable product-scope and panel-contract amendment.
- No real-session distribution probe has been run yet; that belongs after the
  accepted design is reconciled with the durable scope contract.
- No rendered visual exists in this discussion-only packet.
