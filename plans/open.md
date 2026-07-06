# Open Packets

- `plans/2026-07/06/tool-timeline` - planned 2026-07-06: per-tool-call chart
  in the enriched request card - one column per call (matching the Tools
  table's `#` order), aligned In/Out/Time lanes in the existing Layout D
  lane language, plus a section title rename. Verified against real local
  files: Claude and Codex have per-call timing already parsed into
  `ToolCallInfo`; Copilot has round-granular starts and no per-call
  durations, so its Time lane is honestly unavailable. No parser or domain
  changes needed. OP-001..OP-004 resolved same day by maintainer: sequence
  lanes; a **new "Prompt timeline" section** ("Prompt detail" stays exactly
  as is); breakdown/chart/table stack preserved; linear scale. Ready to
  implement. See `plan.md`.

- `plans/2026-07/06/copilot-parity` - planned and implemented 2026-07-06,
  revised same day after empirical correction: Copilot support from local VS Code
  `workspaceStorage/*/chatSessions/*.jsonl` data - zero configuration.
  Original draft assumed real tokens/cost required Copilot's opt-in
  OpenTelemetry export (`agent-traces.db` via `sql.js`); direct inspection
  of this workspace's own real chatSessions files (VS Code + Copilot Chat
  0.55.0) falsified that - real `promptTokens`/`completionTokens`,
  `result.metadata.resolvedModel`, and a real fractional `copilotCredits`
  premium-cost signal are already in the always-on log (`OP-004` also
  resolved: format is `.jsonl`, an append log of `kind:0` snapshot +
  `kind:2` finished-request entries; `kind:1` in-flight streaming deltas are
  ignored). Cache-read/write tokens remain the one genuine gap (not present
  anywhere in the source). The OTel/`sql.js` tier is deferred, not built -
  parked in `plan.md` for a future packet if cache-level detail ever
  matters. Because no disk-persisted artifact ships in this revision, the
  Data Retention rule added to `surfaces-and-privacy.md` earlier in planning
  stays dormant; the new Storage Footer panel element still ships, in its
  static "no local data stored" state, since it's now a required panel
  element regardless of adapter. `provider-and-cost.md`'s Copilot paragraph
  updated to match (was "out of scope until separately investigated"). See
  `plan.md`.

- `plans/2026-07/05/marketplace-release` - implemented and validated
  2026-07-05: marketplace packaging (icon + gallery banner + homepage/bugs in
  `package.json`, marketplace-facing README, `DEVELOPMENT.md`,
  `CHANGELOG.md`, eleven icon candidates explored in
  `images/icon-variants/` - icon **I** (bars + cost trend) picked and
  rendered as `icon.png`; bordered `images/screenshot.png` generated from the
  maintainer's raw panel capture to match the reference extension's frame;
  `.vscodeignore` tightened; VSIX verified with `vsce ls` + `npm run
  package`; full readiness audit done. Only remaining blocker: maintainer's
  own `npx vsce login vectormind` (publisher + PAT), then `npx vsce publish`.

- `plans/2026-07/05/codex-parity` - planned 2026-07-05: implement Codex
  support against local Codex session data, first matching the Claude-backed
  panel where Codex exposes equivalent fields, then adding Codex-native
  signals Claude does not currently expose such as reasoning output tokens,
  time to first token, rate-limit snapshots, and exact context-window
  occupancy. See `plan.md`.

- `plans/2026-07/05/conversation-meta` - surveyed and implemented
  2026-07-05: ground-truth inventory of request-level metadata in
  Claude/Codex/Copilot local logs (capability x provider table in
  `survey.md`), then implemented for Claude as the selected **D - Enriched**
  layout. D is now the only active layout; the multi-layout switcher is
  disabled. The selected surface includes model + wall-time lanes,
  cache-break markers, and a deep request card (timing/idle chips, prompt
  text, cache-write TTL split, cache-miss diagnostics with reasons, output
  composition, tools table with per-call latency and error flags, exact
  subagent attribution). Includes an accuracy fix: usage deduplicated per
  `message.id` (old per-line summing overcounted about 65% on a measured
  session). Open: OP-003 Copilot OTel investigation.

- `plans/2026-07/05/panel-chart-upgrade` - implemented and validated
  2026-07-05: thread chart redesign (legend, split token/cost plots on one
  request axis, tooltips, keyboard access) and visual request-detail card.
  Awaiting maintainer review of one candidate specification topic (no
  dual-axis in the panel chart); close into `plans/closed.md` after review.

- `plans/2026-07/06/initial-design` - Phase 1 & 2 implemented and validated
  2026-07-04: Claude Code JSONL parsing, config/tokens-cost.yaml, status bar
  (USD only - the AIC unit was tried then dropped), and a webview panel
  (conversation list + provider tabs, SVG thread chart, request-detail
  card). VSIX packages and installs locally. Specification Checkpoint
  recorded; see `specification/*.md`. Phase 3 (Codex adapter) is next.
