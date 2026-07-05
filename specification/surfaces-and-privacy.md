# Agent Context Trail - Surfaces And Privacy Specification

Durable UI surface and privacy contract for Agent Context Trail.

## Status Bar

The status bar is the only persistent, always-visible surface. It must:

- Show two figures side by side: the **last request's** cost and the **current
  conversation's total** cost, both in USD.
- Never show token counts in the status bar item itself.
- Never carry a unit toggle or any other persistent control beyond the two cost
  figures and the click target below.
- Open the panel when clicked. Its tooltip may restate the same two figures and
  the conversation title. It may also show a passive current-context readout
  for the last prompted conversation when available: total context capacity,
  current fill percentage, reserved-for-output budget, and long-context or
  expensive-context mode. The tooltip may link to opening the panel, but must
  not expose functionality the status bar item itself does not.
- Show an explicit "no activity" state when no conversation is found for the
  current workspace, rather than a stale or blank figure.

## Panel

The extension must never add a permanent activity-bar icon or permanent sidebar
view. Its detailed surface, the panel, opens only on demand by clicking the
status bar item or invoking a command, and closes like any other editor tab.

The panel is one vertically scrollable page of stacked panels plus a VS
Code-style side app bar. It must provide, at minimum, these panels in this
order:

- **Tokens per conversation** - one horizontal stacked token bar per
  conversation (per-kind composition, no cost on the token axis; cost may
  appear in tooltips).
- **Conversations table** - scoped to the current workspace, grouped by
  provider (Copilot, Codex, Claude), titled as the respective CLI or VS Code
  would label them, with per-conversation metadata columns: request count,
  first message, last message, total tokens, estimated cost. Every column
  sorts on heading click; default order is last message, newest first. A
  title filter narrows the table without stealing focus.
- **Current Status** - live status for the current provider and selected
  conversation. This surface may combine provider-global status such as
  rate-limit windows with selected-conversation status such as context
  occupancy, total context capacity, reserved-for-output budget, and
  long-context or expensive-context mode when available. The section may be
  collapsible, but it must stay distinct from both the conversation table and
  request detail.
- **Conversation (thread view)** - the selected conversation, containing:
  - a chart with one visual unit per request, showing that request's token
    composition and cost, scaled to the conversation's own range rather than a
    fixed or cross-conversation scale;
  - aligned request-level lanes for provider metadata when available, at
    minimum model and wall time, without merging unlike units onto one axis;
  - a way to select any individual request from that chart.
- **Request detail** - the selected request's full detail: model,
  input/output/cache-read/cache-write tokens, tool call count, cost with
  confidence label, and timestamp.

  The request detail surface must also expose the enriched fields when the
  provider has them: model path when multiple models were used, cache-write TTL
  split, cache diagnostics, prompt text, per-tool target preview/input
  size/output size/latency/error status, subagent attribution, API-call count,
  stop reason, service tier or speed flags, output composition, wall time,
  idle-before timing, conversation-share indicators, reasoning output tokens,
  time-to-first-token, and provider-specific request metadata such as model
  path or context-window facts when the provider exposes them. Fields that a
  provider cannot expose remain unavailable rather than being shown as zero.

Panel interaction rules:

- Selecting a conversation (table row or overview bar) or a request (thread
  chart bar) updates the panels below **in place** on the same page. No
  navigation to another page, no scroll jump, no scroll animation; a collapsed
  panel that a selection targets auto-expands.
- Current Status must follow the selected conversation for conversation-scoped
  context state. It must not stay pinned to an unrelated latest conversation
  once the user has selected a different conversation in the panel.
- Current context status is related to the selected request's token
  composition, but it is not identical to it. Request detail explains the
  request's own token parts; Current Status may additionally show total context
  capacity, reserved-for-output budget, fill percentage, and long-context or
  expensive-context mode for the selected conversation.
- Every panel collapses/expands from two equivalent controls: its own
  contrasted heading bar and the matching icon in the side app bar. A
  collapsed panel keeps showing a live status summary in its heading (counts,
  selected conversation totals, selected request cost). Collapse state
  persists across panel reloads.
- No level of aggregation above one conversation is computed or displayed
  (see `product-scope.md`): the overview chart and table show per-conversation
  rows only, never cross-conversation totals.

The panel is the only place full token counts, tool-call counts, and per-request
detail are shown. The status bar may surface only the limited passive
current-context readout described above; it must not duplicate full panel
detail.

## Privacy

- Local-first: all data is read from local files the provider CLIs already
  write. The extension does not run its own server process to do so.
- No telemetry, no analytics backend, no upload of prompts, transcripts, or
  file contents, under any configuration.
- Any data the extension retains beyond a single read, such as for a future
  feature needing state the provider does not persist itself, must be stored
  locally, scoped to the extension, and never synced off-machine.
