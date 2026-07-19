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
the current coding-agent conversation, surfaces the current provider/session
status that affects that conversation, and explains the work prompt by prompt:
tokens, cache reuse, tool calls, and cost.

It observes and explains. It is not a chat client, not an agent, and not a
general usage-analytics dashboard.

## Data Scope

The extension reasons about exactly three logical surfaces of data. No level
above conversation is ever computed, stored, or displayed, with the single
narrow exception defined below for the Prompt Cost Map period view.

- **Current Status**: live status facts that affect reading the current agent
  state, but are not conversation aggregation. This includes provider-global
  status such as rate-limit windows and selected-conversation status such as
  context occupancy, total context capacity, reserved-for-output budget, and
  long-context or expensive-context mode when the provider exposes them.
- **Request**: one prompt iteration, bounded by one user prompt and the agent
  activity that follows it, up to the next user prompt.
- **Conversation**: an ordered sequence of requests, identified by a
  provider-specific session id, with a title and running totals.

Binding rules:

- No day, week, month, or other time-window aggregation.
- No folder, project-portfolio, or cross-workspace aggregation.
- Current Status may expose provider-global status or selected-conversation
  status, but it must not compute summaries across conversations.
- A conversation's totals are always the sum of its own requests, never an
  independently reported or externally aggregated figure.

### Narrow exception: Prompt Cost Map period view

The panel's Prompt Cost Map may compare request-level points across
conversations, only within the current workspace and the currently selected
provider. That comparison may be filtered by All time or a rolling day, week,
or month window over each request's own start timestamp.

Bounds of the exception:

- The period is a view filter over local request-level points. No day, week,
  or month totals, trend series, budgets, grades, or cross-workspace /
  cross-provider summaries are computed, stored, or displayed.
- The only aggregate the view may show is the plain sum and count of the
  currently visible request points in its own heading.
- The exception applies to the Prompt Cost Map only. Conversation totals and
  every other surface keep the conversation-level rules above.

## Non-Goals

The following are explicitly out of scope, not merely deferred:

- Usage dashboards: budgets, grades, efficiency scores, streaks, leaderboards.
- Cross-developer or organizational reporting of any kind.
- A replacement chat UI, or any way to submit prompts through the extension.
- Automatic prompt rewriting or coaching actions taken on the user's behalf.
- Cloud sync of history, settings, or cost data.
