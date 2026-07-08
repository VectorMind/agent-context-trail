# Changelog

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
