# Agent Context Trail - Product Scope Specification

Durable contract for the VS Code extension that observes AI coding-agent
conversations. This describes binding, logical-level behavior, not
implementation structure. Implementation choices such as webview architecture,
message formats, file layout, and build tooling live in the relevant `plans/`
packet instead.

This file covers product identity and data boundaries. Related durable
contracts live beside it in `specification/`.

## Product Identity

Agent Context Trail is a local-first VS Code extension that shows the state of
the current coding-agent conversation and explains it prompt by prompt: tokens,
cache reuse, tool calls, and cost.

It observes and explains. It is not a chat client, not an agent, and not a
general usage-analytics dashboard.

## Data Scope

The extension reasons about exactly two levels of data. No level above
conversation is ever computed, stored, or displayed.

- **Request**: one prompt iteration, bounded by one user prompt and the agent
  activity that follows it, up to the next user prompt.
- **Conversation**: an ordered sequence of requests, identified by a
  provider-specific session id, with a title and running totals.

Binding rules:

- No day, week, month, or other time-window aggregation.
- No folder, project-portfolio, or cross-workspace aggregation.
- A conversation's totals are always the sum of its own requests, never an
  independently reported or externally aggregated figure.

## Non-Goals

The following are explicitly out of scope, not merely deferred:

- Usage dashboards: budgets, grades, efficiency scores, streaks, leaderboards.
- Cross-developer or organizational reporting of any kind.
- A replacement chat UI, or any way to submit prompts through the extension.
- Automatic prompt rewriting or coaching actions taken on the user's behalf.
- Cloud sync of history, settings, or cost data.
