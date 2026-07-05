# Agent Context Trail - Surfaces And Privacy Specification

Durable UI surface and privacy contract for Agent Context Trail.

## Status Bar

The status bar is the only persistent, always-visible surface. It must:

- Show two figures side by side: the **last request's** cost and the **current
  conversation's total** cost, both in USD.
- Never show token counts. Token-level detail belongs to the panel only.
- Never carry a unit toggle or any other persistent control beyond the two cost
  figures and the click target below.
- Open the panel when clicked. Its tooltip may restate the same two figures and
  the conversation title, and may link to opening the panel, but must not expose
  functionality the status bar item itself does not.
- Show an explicit "no activity" state when no conversation is found for the
  current workspace, rather than a stale or blank figure.

## Panel

The extension must never add a permanent activity-bar icon or permanent sidebar
view. Its detailed surface, the panel, opens only on demand by clicking the
status bar item or invoking a command, and closes like any other editor tab.

The panel must provide, at minimum:

- A conversation list scoped to the current workspace, grouped by provider
  (Copilot, Codex, Claude), showing **titles only** as the respective CLI or VS
  Code would label them. No token or cost figures appear in the list.
- A single-conversation view, the thread view, for whichever conversation is
  selected, containing:
  - a chart with one visual unit per request, showing that request's token
    composition and cost, scaled to the conversation's own range rather than a
    fixed or cross-conversation scale;
  - a way to select any individual request from that chart and see its full
    detail: model, input/output/cache-read/cache-write tokens, tool call count,
    cost with confidence label, and timestamp.
- A way to collapse the conversation list so the thread view can use the full
  width. The list must not be permanently reserved space.

The panel is the only place token counts, tool-call counts, and per-request
detail are shown. The status bar must never duplicate this detail.

## Privacy

- Local-first: all data is read from local files the provider CLIs already
  write. The extension does not run its own server process to do so.
- No telemetry, no analytics backend, no upload of prompts, transcripts, or
  file contents, under any configuration.
- Any data the extension retains beyond a single read, such as for a future
  feature needing state the provider does not persist itself, must be stored
  locally, scoped to the extension, and never synced off-machine.
