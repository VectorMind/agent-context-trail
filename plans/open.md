# Open Packets

- `plans/2026-07/06/copilot-parity` - planned 2026-07-06: implement Copilot
  support in two tiers. Tier 1 (zero-config): parse local VS Code
  `workspaceStorage/*/chatSessions` data for prompts, models, timings, tool
  calls, errors, titles, premium-request multiplier, thinking tokens,
  edited-file events. Tier 2 (opt-in): read the real token/cache data from
  Copilot's own OpenTelemetry SQLite export (`agent-traces.db`, real schema
  captured from `microsoft/vscode-copilot-chat` source in `plan.md`) via
  `sql.js` (WASM, resolved `OP-006`) to get Claude/Codex-equivalent tokens
  and `estimated` USD cost - gated entirely behind the user enabling
  `github.copilot.chat.otel.dbSpanExporter.enabled` and running `Chat:
  Export Agent Traces DB` themselves; the extension never flips that
  setting or runs that command (contrast: Copilot Cost Tracker auto-enables
  it). README documents the three manual setup steps. Adds the packet's
  first disk-persisted artifact (an OTel span cache under
  `context.globalStorageUri`), so `surfaces-and-privacy.md` gained active
  retention enforcement (prune-on-write, logged, default 90 days /
  `agentContextTrail.retentionDays`, configurable) and a new Storage Footer
  requirement at the bottom of the panel reporting the extension's own
  on-disk footprint - both added per the maintainer's direct request, not
  deferred. `OP-005` (export file location + `chat_session_id`/`turn_index`
  correlation) is maintainer-assisted: maintainer enables the setting and
  runs the export, assistant inspects the resulting file read-only. See
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
