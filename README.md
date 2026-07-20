<h1 align="center">Agent Context Trail</h1>

<p align="center">
See how one agent conversation's context evolves, prompt by prompt: tokens,
cache reuse, and cost — for Claude Code, Codex, and GitHub Copilot.
</p>

<p align="center">
<img src="https://raw.githubusercontent.com/VectorMind/agent-context-trail/main/images/screenshot.png" alt="Agent Context Trail panel: per-conversation token bars, conversations table, per-request token/cost chart, and request detail card" width="100%"/>
</p>

Your coding agent reads far more than you type. Every prompt re-sends the
conversation context, caches parts of it, and burns tokens you never see.
Agent Context Trail reads the session files your agent CLIs already write on
your machine and turns them into a readable trail: what each prompt actually
cost, how much context it carried, and how much the cache saved.

## Features

- **Status bar cost** — the last request's cost and the conversation's running
  total, in USD, always visible. Click it to open the panel.
- **Conversation panel** — one scrollable page, opened on demand (no permanent
  sidebar icon):
  - per-conversation stacked **token bars** showing each conversation's token
    composition at a glance;
  - a sortable **conversations table** for the current workspace, grouped by
    provider, with request count, first/last message, total tokens, and cost;
  - a **thread chart** with one bar per request — token composition and cost,
    scaled to the conversation itself;
  - a **request detail card**: model, input / output / cache-read /
    cache-write tokens, tool calls with per-call latency, prompt text, wall
    time, and more when the provider exposes it.
- **Cache reuse made visible** — cache reads and writes are first-class
  everywhere, so you can see when a long conversation is paying off and when
  a cache break made it expensive again.
- **Honest numbers** — every cost is labeled `provider-reported` or
  `estimated`; fields a provider does not expose are shown as unavailable,
  never as a fake zero.

## Supported providers

| Provider | Depth |
|---|---|
| **Claude Code** | Full: tokens, cache read/write, cost, tool calls, titles, request detail |
| **Codex** | Best-effort from local session data, including Codex-native signals |
| **GitHub Copilot** | Real tokens, model, tool calls, and estimated cost from VS Code's own chat log — no setup step (see below) |

## Getting started

1. Install the extension and open a workspace where you use Claude Code or
   Codex.
2. The status bar item appears automatically with the latest conversation's
   cost.
3. Click it — or run **Agent Context Trail: Open Conversation Panel** from the
   Command Palette (`Ctrl+Shift+P`) — to explore the trail.

Other commands: **Agent Context Trail: Refresh** and **Agent Context Trail:
Show Conversation Summary (Text)** (plain-text summary in the output channel).

## Privacy

Local-first, by contract:

- Everything is read from the local session files the agent CLIs already
  write. No server process, no account, no sign-in.
- No telemetry, no analytics, no upload of prompts, transcripts, or file
  contents — under any configuration.

## Copilot support

Copilot's numbers come from the same `chatSessions` log VS Code's own Chat
view already writes for its history UI — nothing to enable, no command to
run, no export step.

- **What's shown**: real prompts, resolved model, input/output tokens, tool
  calls, timings, and an `estimated` USD cost, plus Copilot's own real
  premium-request credit figure (`copilotCredits`) shown alongside the cost
  estimate as its own signal — never merged with it. When the session log
  includes model capacity, the latest request's input and context-window size
  also feed Current Context Status.
- **What's not shown, and why**: cache-read/cache-write token counts.
  Unlike Claude and Codex, Copilot's local log does not record them at all —
  this is a real gap in the data, not something this extension chose to
  hide. The Prompt timeline likewise cannot show context for each Copilot LLM
  call from this zero-configuration source; the log stores only request-level
  usage. Copilot Chat's opt-in OpenTelemetry exporter can expose per-call token
  data, but Agent Context Trail does not ingest that export yet.
- Cost is `estimated`, the same bring-your-own-token convention used for
  Claude and Codex: GitHub does not publish a Copilot token-to-USD rate, so
  this extension estimates against the resolved underlying model's public
  API rate where known, falling back to a generic current-generation rate
  for models it doesn't recognize (including internal Copilot routing
  codenames) rather than reporting no cost at all.

## Cost estimation

When a provider reports cost directly, that value is used and labeled
`provider-reported`. Otherwise cost is `estimated` from token counts against a
hand-maintained rate table that cites the official pricing page and the date
it was last checked. Subscription-billed providers still get an estimate: the
dollar-equivalent of the same tokens at the vendor's public API rates, so
opaque rate-limit plans become legible too.

## Development

Build, packaging, and contribution notes live in
[DEVELOPMENT.md](https://github.com/VectorMind/agent-context-trail/blob/main/DEVELOPMENT.md).
