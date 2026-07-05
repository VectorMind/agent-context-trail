# Test Proof

Part 1 (survey): proof is the provenance of the inventories.
Part 2 (implementation of Layout D): commands, smoke test, and visual
verification below.

## Implementation verification (2026-07-05, Layout D)

- `npm run typecheck`, `npm run build`, `npm run reinstall` all pass
  ("Extension 'agent-context-trail.vsix' was successfully installed").
- **Parser smoke test against real sessions** (scratchpad esbuild bundle
  running `parseClaudeSession` directly):
  - this repo's previous session (12 requests): tools matched with derived
    latency (`Edit … 1133ms (derived)`), explicit `durationMs` honored where
    present (`Glob 584ms (reported)`), cache breaks surfaced with real
    reasons (`model_changed`, `tools_changed`, `system_changed`,
    `previous_message_not_found`) and missed-token counts;
  - a session with subagents: both `subagents/agent-*.jsonl` transcripts
    found and totaled (858K tokens · $0.7053 and 1.72M tokens · $0.9936).
- **Accuracy bug found and fixed by this smoke test**: assistant JSONL lines
  sharing one `message.id` repeat the same `usage`; the previous per-line
  summing overcounted (79,108,469 naive vs 47,749,912 deduplicated on the
  measured session — ~65% high). After the fix, duplicated cache-miss
  entries also collapsed to one per API call and `apiCallCount` counts real
  API calls. Verified content blocks are NOT repeated across those lines
  (tool/thinking scanning stays per-line).
- **Headless-Edge harness screenshots** (mock data with a sonnet→fable model
  switch, per-request durations, a cache break on #7, an error tool, an
  Agent call with subagent totals):
  - Layout D, request #11: design bar `B · Current | D · Enriched`; thread
    chart with MODEL lane (yellow sonnet-5 run → blue fable-5 run, run
    labels, legend entries) and WALL TIME lane (direct label `55min` on the
    longest only); ▲ cache-break marker above bar #7; enriched card with
    chips (wall time 41min · idle before 54min · API calls 24 · tool calls
    35 · tier standard · web searches 2), prompt preview + size, cache-write
    `5m TTL` note, `● cache hit — 18,000,000 tokens reused`, output
    composition, tools table with `≈` derived latencies and a subagent
    attribution row, share bars.
  - Layout D, request #7: `▲ cache break — tools changed · 58,454 tokens
    missed the cache` in the Cache block; ⚠ on the errored Grep row;
    selection outline spans all lanes.
  - Layout B: unchanged baseline (no lanes, original card) — the comparison
    target renders as before.



## Commands / scans run (2026-07-05)

- Node walker script (session scratchpad, disposable) inventoried every JSON
  key path with occurrence counts and example values over:
  - 12 most recent Claude Code session files ≥10 KB across
    `~/.claude/projects/*` (3 168 lines, 0 unparsable; 3 workspaces;
    CLI versions 2.1.198–2.1.201);
  - `~/.codex/sessions/2026/07/05/rollout-2026-07-05T14-20-11-*.jsonl`
    (411 lines, Codex CLI 0.142.5) + `session_index.jsonl` head;
  - largest local Copilot Chat session
    (`workspaceStorage/*/chatSessions/*.json`, 30 MB, 19 requests, Copilot
    Chat 0.35.2) + a recent small `.jsonl`-variant session.
- Subagent existence check: `Select-String '"isSidechain":true'` across all
  Claude project files → hits only in `<sessionId>/subagents/agent-*.jsonl`.
- Directory checks: `~/.codex` (sessions + sqlite stores), `~/.copilot`
  (Copilot CLI: `data.db`, logs) both exist on this machine.
- Web checks (2026-07-05) for request-level competitor claims: Argus,
  agent-flow, official Claude Code usage dialog / `/context` docs, VS Code
  subagents docs.

## Expected vs actual

- Expected the JSONL to carry usage + tools; actually found substantially
  more than any listing claims: `diagnostics.cache_miss_reason` with missed
  token counts, `usage.speed` (fast mode), 5m/1h cache-write TTL split,
  `compact_boundary` markers, full subagent transcripts joined by `agentId`.
- Expected Copilot chatSessions to be weak on tokens; confirmed — zero
  usage fields (only `thinking.tokens`), but explicit `timings` and the
  premium multiplier in `result.details`.
- Codex surprise: explicit `reasoning_output_tokens`,
  `time_to_first_token_ms`, per-turn rate-limit snapshots, and
  `model_context_window` — context occupancy is exact there.

## Known gaps

- Single Codex rollout and single large Copilot session sampled; schema
  variance across versions not measured (both formats are unversioned).
- Copilot OTel path (`github.copilot.chat.otel.dbSpanExporter.enabled`,
  `agent-traces.db`) and `~/.copilot` CLI SQLite not opened — recorded as
  OP-003.
- Marketplace claims quoted from listings, not from installing competitors.

## Environment

Windows 11; raw scan outputs in the session scratchpad (disposable, per
WORKFLOW.md not committed to `plans/`).

## Round 2 Verdict Verification - 2026-07-05

- `src/webview/main.ts` now has `LAYOUT_EXPERIMENTS = false`,
  `DEFAULT_LAYOUT = 'D'`, and only `D - Enriched` in `LAYOUTS`.
- `specification/surfaces-and-privacy.md` now records the selected enriched
  request-detail fields and timeline metadata lanes as durable panel
  requirements.
- `plans/open.md` no longer lists the B-vs-D verdict as open; it records D as
  the selected layout and adds `plans/2026-07/05/codex-parity` as the next
  active provider-parity plan.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
