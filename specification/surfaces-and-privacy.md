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

- **Workspace scope** - shown once near the top of the panel, naming the
  current workspace path explicitly and making clear that every conversation
  row below is already filtered to that workspace only.
- **Tokens per conversation** - one horizontal stacked token bar per
  conversation (per-kind composition, no cost on the token axis; cost may
  appear in tooltips).
- **Conversations table** - scoped to the current workspace, grouped by
  provider (Copilot, Codex, Claude), titled as the respective CLI or VS Code
  would label them, with per-conversation metadata columns: request count,
  first message, last message, session duration, total tokens, estimated cost.
  Do not repeat per-conversation workspace-path labels in this table once the
  top workspace scope is shown. Every column sorts on heading click; default
  order is last message, newest first. A title filter and last-activity window
  filter narrow the table without stealing focus. The table must page in
  batches of at most 100 conversations and keep its own bounded vertical
  scroll rather than expanding without limit.
- **Provider Limits** - a distinct panel above context status for
  provider-global status such as rate-limit windows or plan usage. The meter
  header must place used on the left and remaining on the right, and the bar
  itself must still read only as used/fill rather than as two competing
  fills. Providers that do not expose real provider-limit data do not render
  a placeholder Provider Limits panel.
- **Last Context Status** - a distinct panel for the last recorded
  selected-conversation context occupancy, total context capacity,
  reserved-for-output budget, and long-context or expensive-context mode when
  available. It sits directly below Provider Limits. Its header should present
  both token and percentage values for used and remaining when the provider
  exposes them. Providers that do not expose a real current-context surface do
  not render a placeholder Last Context Status panel.
- **Conversation (thread view)** - the selected conversation, containing:
  - a chart with one visual unit per request, showing that request's token
    composition and cost, scaled to the conversation's own range rather than a
    fixed or cross-conversation scale;
  - aligned request-level lanes for provider metadata when available, at
    minimum model and wall time, without merging unlike units onto one axis
    (see `ui-design.md`);
  - a way to select any individual request from that chart.
- **Request detail** - the selected request's full detail: model,
  input/output/cache-read/cache-write tokens, tool call count, cost with
  confidence label, and timestamp.

  The request detail surface must also expose the enriched fields when the
  provider has them: model path when multiple models were used, cache-write TTL
  split, cache diagnostics, prompt text, per-tool target preview/input
  size/output size/latency/error status, subagent attribution, LLM-call count,
  stop reason, service tier or speed flags, output composition, wall time,
  idle-before timing, conversation-share indicators, reasoning output tokens,
  time-to-first-token, and provider-specific request metadata such as model
  path or context-window facts when the provider exposes them. Fields that a
  provider cannot expose remain unavailable rather than being shown as zero.
- **Prompt cost map** - a collapsible panel after the request's call-level
  drill-down surfaces and before the storage footer: one scatter mark per
  request, encoding context tokens at the request's first LLM call (x),
  context tokens at its last LLM call (y), USD cost (mark area), and LLM-call
  count (mark color with a labeled gradient legend). It carries a two-state
  scope toggle: **Selected conversation** (default; the current conversation's
  requests) and **Selected period** (requests of the current workspace and
  currently selected provider whose start time falls inside an All time /
  rolling day / week / month filter — the narrow exception defined in
  `product-scope.md`). Requests whose endpoints or cost are unavailable are
  reported as explicit exclusion counts with reasons, never plotted as
  zero-valued marks. Activating a mark selects that request (and, in period
  mode, its conversation first) through the normal in-place selection path.

Panel interaction rules:

- Selecting a conversation (table row or overview bar) or a request (thread
  chart bar) updates the panels below **in place** on the same page. No
  navigation to another page, no scroll jump, no scroll animation; a collapsed
  panel that a selection targets auto-expands.
- Current Status must follow the selected conversation for conversation-scoped
  context state. It must not stay pinned to an unrelated latest conversation
  once the user has selected a different conversation in the panel.
- Last context status is related to the selected request's token composition,
  but it is not identical to it. Request detail explains the request's own
  token parts; this panel may additionally show total context capacity,
  reserved-for-output budget, fill percentage, and long-context or
  expensive-context mode for the selected conversation.
- Every panel collapses/expands from two equivalent controls: its own
  contrasted heading bar and the matching icon in the side app bar. A
  collapsed panel keeps showing a live status summary in its heading (counts,
  selected conversation totals, selected request cost). Collapse state
  persists across panel reloads.
- No level of aggregation above one conversation is computed or displayed
  (see `product-scope.md`): the overview chart and table show per-conversation
  rows only, never cross-conversation totals. The one narrow exception is the
  Prompt cost map's Selected period mode, bounded exactly as defined in
  `product-scope.md`: request-level points across the current workspace and
  selected provider, filtered by a rolling window, with no persisted or
  displayed period totals beyond the visible points' plain sum and count in
  that panel's own heading.

The panel is the only place full token counts, tool-call counts, and per-request
detail are shown. The status bar may surface only the limited passive
current-context readout described above; it must not duplicate full panel
detail.

### Storage Footer

Below Request Detail, at the bottom of the page, the panel shows a small,
non-collapsible footer reporting the extension's own on-disk footprint - not
one of the "at minimum" panels above, and not subject to their collapse
rules. It exists so the retention contract below is a visible fact, not a
buried policy.

- Reports total bytes currently used by artifacts the extension itself wrote
  (see "Data Retention"), the active retention window, and a link to change
  it in settings.
- Reads "no local data stored" (or equivalent) when the extension has
  written nothing, which is the default state as long as every adapter stays
  in-memory-only.
- Never includes the size of provider-owned files the extension merely reads
  (a provider's session logs, a user's own OTel export) - only what the
  extension created.

## Privacy

- Local-first: all data is read from local files the provider CLIs already
  write. The extension does not run its own server process to do so.
- **Payload excerpts are bounded and trimmed host-side; full payloads never
  cross into the webview.** When a surface needs the content of a tool
  payload (a tool call's input arguments or result), the extension host
  reads the provider log on demand, locates the one call, and ships only a
  bounded excerpt (fixed head/tail line counts, capped line and field
  lengths, plus honest totals such as size and skipped-character counts).
  The webview never receives, caches, or renders a full payload under any
  interaction. Text recovered indirectly (for example reassembled from a
  serialized display tree rather than a literal logged string) is labeled
  as reconstructed, never presented as the exact logged content. The user's
  own prompt text is not a tool payload and is exempt from this rule.
- No telemetry, no analytics backend, no upload of prompts, transcripts, or
  file contents, under any configuration.
- Any data the extension retains beyond a single read, such as for a future
  feature needing state the provider does not persist itself, must be stored
  locally, scoped to the extension, and never synced off-machine.
- The extension must never programmatically write to VS Code settings (its
  own, another extension's, or a provider's, such as Copilot's OTel exporter
  settings) to unlock richer data. Enabling such a setting is the user's
  decision alone. The extension may detect that a setting is off and explain
  what turning it on would unlock, but it must stop at detection and
  explanation, never write the setting itself.

### Data Retention

Any artifact the extension persists beyond a single read (a derived cache, an
index, an exported copy of provider telemetry) is bounded, not indefinite.

- Default retention is **3 months** from the data's own timestamp, not from
  when the extension last read or touched it.
- The retention window is user-configurable; the 3-month default holds until
  the user changes it.
- The extension prunes only artifacts it created itself. It never deletes or
  modifies a provider's own files (session logs, another extension's export,
  a provider-written telemetry database) even once they are past the
  configured window - retention pruning is scoped strictly to the extension's
  own persisted state.
- This rule is dormant until the extension's first persisted artifact ships;
  purely in-memory caches that clear on restart (the discovery mtime caches
  used by the Claude and Codex adapters today) do not trigger it.
- Enforcement is active, not aspirational: every write path prunes entries
  past the configured window before or immediately after writing, so total
  footprint cannot grow unbounded between prunes ("no leak" - size is
  bounded by retention window x write rate, never by how long the extension
  has been installed).
- Every prune action is logged to the extension's output channel (what was
  removed, its age, bytes freed) so retention is observable, not silent.
- The current total footprint is surfaced in the panel's Storage Footer
  (see "Panel" above), not just internal logs.
