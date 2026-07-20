# Changelog

## 0.2.0 - 19.07.2026

- New **Prompt cost map**: an accessible context-growth scatter plot for each
  prompt, showing first versus final context size, cost by bubble area, and
  LLM-call iterations by colour.
- Compare the selected conversation or a rolling day, week, month, or
  all-time period for the selected provider and workspace; choose a model to
  narrow multi-model views, then activate any point to inspect its prompt.
- Honest chartability reporting: prompts without usable LLM-call context are
  counted with their reason rather than plotted as zeros; Copilot shows an
  explicit unavailable state where that context is not exposed.

## 0.1.1 - 09.07.2026

- Conversations table: session duration column, title plus last-activity
  filters, paging capped at 100 conversations per page, and a bounded
  vertically scrollable table with sticky headers for larger workspaces.
- Status surfaces now distinguish **Provider Limits (Last seen)** from
  **Last Context Status**, keep the context panel directly under provider
  limits, and mark stale rate-limit snapshots after a reset instead of
  presenting them as if they were still current.
- Cost-unavailable providers now fall back more cleanly to their own latest
  provider signal in the status bar and panel, including Codex's latest
  workspace rate-limit snapshot.

## 0.1.0 - 08.07.2026

- GitHub Copilot support: real prompts, tokens, resolved model, and tool
  calls read directly from VS Code's own chat log — no setup step — plus
  Copilot's own premium-request credit figure shown alongside the
  `estimated` cost as its own signal.
- Request detail: a per-request tool-call and model-call timeline with
  per-call latency, and a call detail card for inspecting any single call.
- Panel now keeps the selected call and timeline scroll position across
  conversation refreshes instead of resetting them.

## 0.0.1 - 05.07.2026

First marketplace release.

- Status bar item: last request cost | conversation total, in USD, for the
  current workspace's latest agent conversation.
- Conversation panel (opens from the status bar or the
  **Agent Context Trail: Open Conversation Panel** command): per-conversation
  token bars, sortable conversations table grouped by provider, per-request
  token/cost thread chart, and an enriched request detail card (timing, cache
  read/write with TTL split, prompt text, tool calls with per-call latency,
  subagent attribution).
- Providers: Claude Code at full depth; Codex from local session data,
  including reasoning tokens, rate-limit snapshots, and context-window
  occupancy where exposed. GitHub Copilot is planned.
- Cost: `provider-reported` when the provider states it, otherwise
  `estimated` from a hand-maintained rate table (`config/tokens-cost.yaml`)
  citing the official pricing pages; unavailable fields are shown as
  unavailable, never as zero.
- Local-first: reads only the session files the agent CLIs already write; no
  telemetry, no uploads.
