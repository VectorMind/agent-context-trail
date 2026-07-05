# Conversation Meta — Request-Level Metadata Assessment

## Problem Summary

The request detail card currently shows model, input/output/cache tokens,
tool call count, cost, and timestamp. The maintainer asked: what else is
there? Tools (each with inputs, outputs, latency), subagents, model switches,
timing between requests, and the `/context`-style composition (what part of
input is prompt vs system prompt vs files) — which of these are actually
available in Claude Code / Codex / Copilot local logs, what do competing
extensions claim, and which charts would carry them?

This packet is an **assessment**, not an implementation: its deliverable is
`survey.md` (ground-truth field inventories from real local logs of all three
providers, competitor claims, and a capability × provider table) plus the
chart proposals below. Implementation happens in follow-up packets after the
maintainer picks.

## Goal and Objectives

- Inventory every metadata field in real local logs: Claude Code session
  JSONL (incl. `subagents/agent-*.jsonl`), Codex rollout JSONL, Copilot
  chatSessions JSON. Done — see `survey.md` §2–4.
- Survey what competitors show/claim at request level. Done — `survey.md` §1.
- Produce the capability × provider table. Done — `survey.md` §5.
- Answer the input/cache composition question honestly (what is exact, what
  is estimable, what does not exist). Done — `survey.md` §6.
- Propose the two requested chart additions (tool stats; model/time state
  lane) plus the context-occupancy section, all dataviz-rule compliant.

## Chart Proposals (for maintainer selection)

1. **Tool lane + tool summary** — per-request tool-call bars stacked by tool
   name, sharing the thread chart's request axis; tooltip with per-tool
   calls, in/out sizes, errors, latency (derived; labeled). A per-conversation
   tool summary table (tool · calls · output volume · errors · median
   latency) accompanies the chart.
2. **Model & timing state lane** — two thin aligned lanes under the thread
   chart: categorical model-per-request strip (color per model, switches
   visible) and wall-time-per-request bars; gap since previous request in the
   tooltip. One axis per plot; alignment carries the reading.
3. **Context occupancy lane** — derived context per request
   (`cache_read + cache_creation + input`), step/area over the request axis;
   carried vs new split; compaction boundaries marked (Claude
   `compact_boundary`); context-window ceiling where known (Codex exact).
   The `/context` category breakdown (system prompt/tools/skills/memory) is
   live-only and not in logs — anything beyond carried/new is an estimate
   from stored content and must wear an "estimated" label.
4. **Request detail card growth** — cache-miss reason + missed tokens
   (Claude `diagnostics`), time-to-first-token/wall time, per-tool list with
   latency, subagent attribution (link to `agentId` transcript totals),
   service tier / fast-mode flag.

## Scope and Non-Goals

- No implementation in this packet; no parser or webview changes.
- Everything stays within one conversation (no cross-conversation
  aggregation, per `specification/product-scope.md`); tool stats and model
  lanes are per-conversation surfaces.
- Copilot's OTel/`agent-traces.db` path and `~/.copilot` CLI SQLite are
  recorded as investigation leads, not explored here.

## Specification Checkpoint (start)

Reviewed `specification/product-scope.md`, `provider-and-cost.md`,
`surfaces-and-privacy.md`.

- **Respected**: assessment only — no surface or data change ships from this
  packet. All proposed charts stay per-conversation (product-scope). All data
  is read from local files already written by the providers (privacy).
- **Future spec impact flagged**: implementing proposal 1/2/3 will extend the
  Panel section's request-detail field list in `surfaces-and-privacy.md`
  (updated 2026-07-05 for Layout B); showing full tool inputs/outputs would
  be a *new* kind of content (text, not counts) in the panel and needs a
  deliberate maintainer decision (OP-002). `provider-and-cost.md`'s
  confidence-label rule extends naturally: absent fields are "unavailable",
  never 0; derived latency and content-based composition estimates must be
  labeled estimated.

## Open Points

- OP-001 — **superseded 2026-07-05**: the maintainer requested immediate
  implementation with everything analytically exposable, shipped as a new
  test layout **D · Enriched** competing against baseline **B · Current**
  via the round-1 switcher. New decision: pick B or D (round-2 verdict).
- OP-002 — **resolved by the same instruction** ("tools details … literally
  not miss anything"): the request card shows short tool target previews
  (command/file/pattern) alongside counts/sizes/latency; full payloads stay
  out.
- OP-003: Copilot economics — invest in the OTel/`dbSpanExporter` +
  `agent-traces.db` investigation, or ship Copilot with structure-only
  metadata (tools, timings, multiplier) first?

## Phases

1. Ground-truth inventories + competitor check + capability table
   (`survey.md`) — **done 2026-07-05**.
2. Implementation as Layout D vs baseline B — **done 2026-07-05**; see
   `implementation.md` (includes the message.id usage-dedup accuracy fix
   the smoke test uncovered) and `test.md`.
3. Maintainer round-2 verdict (B vs D), then disable the switcher again and
   refresh the specification checkpoint (request-detail field list in
   `surfaces-and-privacy.md` must be extended if D wins).

## Exit Criteria

- `survey.md` answers all five maintainer questions (tools, subagents,
  latency, input/cache composition, context section, model timeline) with
  provider-verbatim field names and honest exact/derived/absent labels.
- Maintainer has enough to select proposals and resolve OP-001..003.

## Plan Update - 2026-07-05

- Round-2 verdict resolved: **D - Enriched** is selected.
- The multi-layout switcher should be disabled again and persisted non-D
  layouts ignored.
- The selected D fields should be reflected in
  `specification/surfaces-and-privacy.md`.
- Codex parity is split into the follow-up packet
  `plans/2026-07/05/codex-parity`.
