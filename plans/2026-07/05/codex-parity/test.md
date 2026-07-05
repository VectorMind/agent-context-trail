# Test Proof

## Plan Validation - 2026-07-05

No implementation has happened in this packet yet.

Plan rewrite review on 2026-07-05:

- Re-read `WORKFLOW.md`.
- Re-read `plans/2026-07/05/codex-parity/plan.md`.
- Re-read `specification/product-scope.md`,
  `specification/provider-and-cost.md`, and
  `specification/surfaces-and-privacy.md`.
- Updated the plan to treat Codex as a conversation list rather than a
  workspace aggregation.
- Moved rate-limit state and current context fill into a proposed Current
  Status section, while flagging the required specification review before those
  fields ship.
- Clarified that request token composition already represents the request's
  parts; a separate context-composition concept should only be added if Codex
  exposes a materially different context snapshot.

Follow-up plan/spec review update on 2026-07-05:

- Updated `WORKFLOW.md` and `AGENTS.md` so specification checkpoints treat
  plan/spec tension as open specification-review points instead of overstating
  them as plan failures.
- Reworked this packet's specification checkpoint into explicit `SR-*` open
  points and candidate specification additions for maintainer review.
- No product specification files were rewritten in this step.

Specification rewrite update on 2026-07-05:

- Rewrote `specification/product-scope.md` to add `Current Status` as a third
  durable surface with no new aggregation level.
- Rewrote `specification/surfaces-and-privacy.md` to allow a passive
  current-context tooltip on the status bar for the last prompted conversation
  and to define a panel `Current Status` section that follows the selected
  conversation.
- Updated `specification/provider-and-cost.md` to state that the product should
  take maximum practical advantage of provider-specific telemetry rather than a
  lowest-common-denominator model, and to keep rate-limit status separate from
  USD cost.
- Updated this packet plan to replace open `SR-*` review points with resolved
  specification decisions.

Implementation-readiness update on 2026-07-05:

- Resolved `OD-001` in favor of a user-facing path filter in the Codex
  conversation list.
- Resolved `OD-002` in favor of a `Current Context Status` section above the
  request chart, with last-request auto-selection for the lower request-detail
  section when the conversation changes.
- The packet now has no remaining plan-level open decisions blocking
  implementation.

Current-state checks performed before writing the plan:

- `rg` over `plans/2026-07/05/conversation-meta/survey.md`, `src/`, and
  `specification/` confirmed the prior survey already recorded Codex fields:
  `reasoning_output_tokens`, `time_to_first_token_ms`, rate-limit snapshots,
  and `model_context_window`.
- `Get-ChildItem -Recurse -File src/providers` confirmed only Claude provider
  files exist today.
- `src/panel/panelController.ts` confirms the panel declares `codex` as a
  provider tab but currently supplies an empty Codex list and only loads
  Claude detail.

Expected next proof after implementation:

- parser proof against at least one real Codex rollout file;
- `npm run typecheck`;
- `npm run build`;
- webview smoke proof that Claude still renders D - Enriched and Codex renders
  real conversation rows/detail when local Codex data exists.

Known gaps:

- The prior Codex evidence came from one sampled rollout, so parser work must
  tolerate schema variance and record any newly observed fields in the packet.

## Implementation Verification - 2026-07-05

Implementation completed in this packet.

Verification performed:

- `npm.cmd run typecheck` - passed.
- `npm.cmd run build` - passed.
- `npx.cmd tsc -p tsconfig.json --outDir .tmp/tsproof` - emitted a disposable
  proof build for direct parser checks.
- Real-data Codex parser proof against the current workspace:
  - `listCodexConversations(process.cwd())` returned `7` Codex conversations
    for `c:\dev\VectorMind\agent-context-trail`.
  - The newest parsed conversation resolved as:
    - id `019f32e5-2e9b-7e51-b8f8-792baab24010`
    - title `Revise codex parity plan`
    - path `.`
    - request count `6`
    - total tokens `1002111`
  - The same conversation's detail parse resolved:
    - provider `codex`
    - latest current-status context window `258400`
    - latest current-status input fill `222976` tokens (`86.29%`)
    - provider plan type `plus`
    - primary rate-limit window `100%`
    - latest request tool-call count `90`
    - latest request cost source `unavailable`

Behavioral checks covered by the proof:

- Codex conversation discovery is workspace-scoped and no longer renders as
  "support is not implemented yet".
- Codex cost stays unavailable rather than collapsing to zero.
- Current Status is populated from real Codex rate-limit and context fields.
- Last-request auto-selection is wired through the webview message handler.

Remaining gaps:

- No live VS Code panel screenshot or manual hover check was run in this turn,
  so visual layout and interaction were verified only indirectly through the
  build and parser outputs.
