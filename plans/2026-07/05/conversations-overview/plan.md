# Conversations Overview Experiments

## Problem Summary

The panel's conversation sidebar shows titles only, with no way to sort or to
see when a conversation started or was last active. The maintainer asked for
first/last-message metadata with click-to-sort, and suspects the real direction
is a richer all-conversations surface (table with metadata, filtering, maybe
charts) that coexists with the single-conversation thread view. Rather than
committing to one layout, this packet ships two/three competing designs side by
side so the maintainer can pick by looking at real data.

## Goal and Objectives

- Enrich the conversation list data with per-conversation metadata: first
  message time, last message time, request count, total tokens, total cost.
- Implement three switchable layout experiments inside the existing panel:
  - **A — Sortable sidebar**: current master–detail layout; sidebar gains a
    sort control (Last / First / Title) and a two-line item with time metadata.
  - **B — App bar** *(reworked twice 2026-07-05 after maintainer feedback)*:
    one vertically stacked page of panels (chart · table · thread · request
    detail); every panel collapses/expands from its own heading bar AND from a
    VS Code-style side app bar whose icons mirror the same state (muted =
    collapsed, accent highlight = expanded).
  - **C — Panels** *(reworked 2026-07-05)*: the same stacked page without the
    side bar; heading bars only. A collapsed panel keeps showing its status
    summary (counts, selected conversation totals, selected request cost) in
    the heading.
  - Shared stacked-page behavior (B and C): panels are clearly bounded blocks
    (contrasted heading bar, border, gap); no navigation jump — selecting a
    table row or chart bar updates the thread/request panels lower on the
    same page **in place, with no scroll movement or animation** (a
    smooth-scroll-into-view was tried and rejected as a UX no-go); collapsed
    panels auto-expand when a selection targets them. The first drill-in
    iteration (overview → separate thread page with back breadcrumb) was also
    tried and replaced at the maintainer's request.
- Default sort everywhere: last message, newest first.
- A design-switcher (A · B · C) at the top of the webview so designs can be
  compared live; the choice persists across panel reloads via webview state.

## Scope and Non-Goals

- Claude provider only gets real data; Codex/Copilot tabs keep empty states.
- No cross-conversation totals or time-window aggregation anywhere (see
  `specification/product-scope.md`); the overview shows per-conversation rows
  and marks only.
- The design switcher is a temporary experiment surface; once a winner is
  picked, the losers and the switcher are removed in a follow-up packet.
- No caching beyond an in-memory mtime-keyed scan cache; no persistence of
  computed metadata.

## Specification Checkpoint (start)

Reviewed `specification/product-scope.md`, `provider-and-cost.md`,
`surfaces-and-privacy.md`.

- **Deliberate deviation**: `surfaces-and-privacy.md` requires the conversation
  list to show "titles only" with "no token or cost figures". This packet
  violates that on purpose, at the maintainer's explicit request, as a UI
  experiment. The spec is NOT updated yet: which layout (and which columns)
  survives is exactly what the experiment decides. Once the maintainer picks a
  design, the Panel section of `surfaces-and-privacy.md` must be rewritten to
  match the winner — that is the expected close-out of this experiment.
- **Respected**: no level above conversation is computed or displayed (no
  all-conversations totals, no time windows); panel remains on-demand only;
  status bar untouched; all data stays local.
- No other durable contract is affected.

## Open Points

- OP-001 — **resolved 2026-07-05**: the maintainer picked **B (App bar)**.
  B is now the only active layout; the switcher and layouts A/C stay in the
  code shelved behind a `LAYOUT_EXPERIMENTS = false` flag so future layout
  variants can be compared the same way (maintainer explicitly asked to keep
  the tool rather than delete it).
- OP-002 — **resolved 2026-07-05** by the same verdict: B's table keeps all
  columns (requests, first/last message, tokens, cost). The Panel section of
  `specification/surfaces-and-privacy.md` was rewritten accordingly; the
  "titles only" rule is retired.

## Phases

1. Data layer: single-pass session meta scan (title, first/last timestamps,
   request count, total usage, estimated cost) with an mtime cache; extend
   `ConversationListItem` and the init payload.
2. Webview: design switcher, shared sort/filter state, Layouts A, B, C.
3. Build, package, install locally; record proof.

## Exit Criteria

- All three layouts render against the real workspace's Claude sessions.
- Sorting by first/last/title (and in the table: requests, tokens, cost) works
  with a click on the heading; default is last-message-desc.
- `npm run typecheck` and `npm run build` pass; VSIX packages.
- Maintainer can flip designs from inside the panel and give a verdict
  (OP-001/OP-002).
