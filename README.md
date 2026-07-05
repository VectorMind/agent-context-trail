<h1 align="center">Agent Context Trail</h1>

<p align="center">
See how one agent conversation's context evolves, prompt by prompt: tokens,
cache reuse, and cost — for Claude Code, Codex, and GitHub Copilot.
</p>

<p align="center">
<img src="https://raw.githubusercontent.com/VectorMind/agent-context-trail/main/images/panel-screenshot.png" alt="Agent Context Trail panel: per-conversation token bars, conversations table, per-request token/cost chart, and request detail card" width="100%"/>
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
| **GitHub Copilot** | Planned |

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
