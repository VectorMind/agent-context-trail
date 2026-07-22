# Changelog

## 0.3.1 - 22.07.2026

- Fixed Copilot OTel enrichment when enterprise and other backend variants
  emit different `server_request_id` and `responseId` UUID versions. The
  extension now preserves both OTel response identifiers, prefers exact
  correlation, and permits a UUID-version-nibble fallback only when it is
  unambiguous within the conversation. Existing schema-v1 local history
  remains readable.
- Fixed Codex tool-call tracking for the `custom_tool_call` /
  `custom_tool_call_output` event shape (e.g. `exec`): these are now counted
  and shown in tool metrics and the Call detail panel like other tool calls.
  The Prompt timeline's IN lane also now shows an honest "no tool call
  recorded" note instead of an empty lane when a request truly has none.

## 0.3.0 - 21.07.2026

- **Copilot per-call context (opt-in OpenTelemetry)**: GitHub Copilot's
  zero-config log records only request-level usage, so the Prompt timeline
  could not show per-call context from it. If you turn on Copilot Chat's own
  OpenTelemetry export and point it at a loopback endpoint, Agent Context
  Trail now receives those spans locally and fills the timeline with real
  per-LLM-call input, **cache-read**, output, and reasoning tokens.
- Privacy-first receiver: the extension binds only the loopback port you
  choose, keeps allowlisted usage and correlation fields, and drops prompts,
  code, tool payloads, and repository metadata before writing — even if
  content capture is left on. Spans are stored as the extension's own daily
  JSONL, pruned to the current plus two preceding calendar months, and it
  never edits your VS Code settings for you. See the README for setup.
- **Prompt cost map** now shows a selected prompt in a persistent side detail
  panel instead of a floating tooltip: hover a bubble to preview it, click to
  pin it, with cost and LLM-call count as headline stats. Iso-growth guide
  lines now span the whole plotted range so the scale reads clearly even when
  no data point reaches the top.

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
