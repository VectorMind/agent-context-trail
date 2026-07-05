# Implementation Log

[######] Done - implemented and validated; maintainer picked Layout B
(OP-001/OP-002 resolved 2026-07-05), switcher shelved behind
`LAYOUT_EXPERIMENTS = false`, spec Panel section rewritten.

## Files Changed

- `src/domain/types.ts` â€” `ConversationListItem` grew `firstAt?`, `lastAt`,
  `requestCount`, `totalUsage`, `totalTokens`, `totalCostUsd`.
- `src/providers/claude/parser.ts` â€” `peekClaudeSessionTitle` replaced by
  `scanClaudeSessionMeta`: same single streaming pass, now also returning
  first/last timestamps, request count (same grouping rules as
  `parseClaudeSession`), and running usage/cost totals.
- `src/providers/claude/discover.ts` â€” `listClaudeConversations` takes a
  `PricingService`, fills the new fields, and caches scan results per file
  path keyed by mtime so re-opening the panel only rescans changed files.
- `src/panel/panelController.ts` â€” passes pricing into the list call; CSS for
  the design switcher, sidebar sort row, two-line list items, overview
  toolbar/filter/table, and drill-in breadcrumb.
- `src/webview/chart.ts` â€” `legendEl(includeCost)`; new `renderOverviewChart`:
  horizontal stacked token bars, one row per conversation (â‰¤ 12, note points
  to the table for the rest), same series order/colors as the thread chart,
  2px surface gaps, rounded data-end, selective direct label on the largest
  bar only, tooltip with per-kind tokens + requests + estimated cost,
  keyboard-focusable rows. Tokens only in the plot â€” cost never shares the
  axis (no dual axis).
- `src/webview/main.ts` â€” rewritten around three switchable layout
  experiments with a persistent design-bar (webview `getState`/`setState`):
  - **A Â· Sidebar**: previous masterâ€“detail; sidebar adds Sort Last/First/
    Title buttons and a meta line (`N req Â· first â†’ last`).
  - **B Â· App bar** and **C Â· Panels** (second + third iteration, same day):
    one vertically stacked scrollable page of four panels â€” overview chart,
    conversations table, selected conversation thread, request detail. Each
    panel is a bounded block (border, radius, gap) with a contrasted heading
    bar (`sideBarSectionHeader` theme tokens; chevron + icon + title +
    live status summary) that collapses/expands it (`aria-expanded`). The
    summary stays visible when collapsed: counts + current sort for
    chart/table, conversation totals for thread, request cost for detail.
    B additionally renders a VS Code-style side app bar
    (`activityBar` theme tokens) whose icons mirror and toggle the same
    collapse state (`aria-pressed`; muted = collapsed, accent = expanded) â€”
    third iteration merged the earlier show/hide-sections behavior into the
    shared collapse state at the maintainer's request. Selecting a row/bar
    updates the panels below strictly in place: scroll position is restored
    exactly on re-render and the smooth-scroll-into-view from the second
    iteration was removed (page shifting on click was rejected as a UX
    no-go). Collapsed panels auto-expand when a selection targets them.
    Collapse state persists with the layout choice.
  Shared sort state (default: last message, newest first), title filter that
  re-renders only the chart+table so the input keeps focus, relative times
  with exact timestamps on hover, `aria-sort` on table headers.
  The first B/C iteration (overview page â†’ separate thread page with an
  "â† All conversations" breadcrumb) was replaced after maintainer feedback:
  the page swap felt like a jump; the stacked-panels concept keeps table and
  details on one page.

## Decisions

- Per-kind token totals (`totalUsage`) ride in the list payload so the
  overview chart can be genuinely stacked; a single-hue bar under a
  four-series legend would misrepresent the data.
- Cost figure in tables/tooltips uses 2 decimals (conversation totals);
  request-level surfaces keep 4.
- The scan cache is in-memory only, keyed `filePath â†’ mtimeMs`; no
  persistence, consistent with the privacy spec.
- Timestamps sort as ISO strings (chronological by construction); missing
  `firstAt` sinks to the bottom regardless of direction.
- The overview chart's in-plot caption was dropped in the stacked layouts:
  the section heading bar already names the chart, and the duplicate read as
  noise.
- Section heads are `position: sticky` inside the stack scroll, so the
  active section's title/summary stays visible while its content scrolls.

## Deviations From Plan

None of substance. `updatedAt` was kept on the list item for compatibility
even though `lastAt` supersedes it in the UI.

## Close-Out (2026-07-05)

- Maintainer verdict: **Layout B (App bar)** wins; the experiment stops but
  the switcher is kept on the shelf as a comparison tool for future layout
  variants. Implemented as a `LAYOUT_EXPERIMENTS = false` module constant in
  `src/webview/main.ts`: while false the layout is forced to
  `DEFAULT_LAYOUT = 'B'` (persisted layout choice ignored) and the design bar
  never renders; flipping the flag restores the full A/B/C switcher. Layout
  A and C code paths remain compiled and untouched.
- Specification Checkpoint (close): the Panel section of
  `specification/surfaces-and-privacy.md` was rewritten to the winner â€”
  stacked panels page (overview chart Â· conversations table with metadata
  columns Â· thread view Â· request detail), dual collapse controls (heading
  bar + side app bar), in-place selection with no scroll animation, collapsed
  panels keep live summaries. The "titles only" list rule is retired;
  `product-scope.md`'s no-aggregation-above-conversation rule is restated in
  the Panel section and remains respected.

## Follow-Ups

- Codex/Copilot lists stay empty until their adapters exist (Phase 3 of
  `plans/2026-07/06/initial-design`).
- Request-level metadata enrichment continues in
  `plans/2026-07/05/conversation-meta`.


