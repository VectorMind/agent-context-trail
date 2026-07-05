# Panel Chart Upgrade

## Problem Summary

The panel's thread view was functional but bare: a stacked-bar SVG with no
legend, a cost line overlaid on the token scale (a dual-axis reading), native
`<title>` tooltips only, and a plain text table as the request detail view.
The maintainer asked for a richer surface: a legend, and a visual breakdown
instead of a text table when a request is selected.

## Goal And Objectives

Make the thread view read like a designed chart surface:

- legend identifying the four token series and the cost line;
- token bars and cost line split into two aligned plots on one shared request
  axis (no dual-axis overlay);
- gridlines with compact tick labels on the token plot; a selective direct
  label on the most expensive request in the cost strip;
- hover tooltip per request column showing all series values plus cost;
- keyboard access (focusable columns, Enter/Space to select);
- request detail card rebuilt as a visual token breakdown with horizontal
  bars, a cost bar scaled against the conversation's most expensive request,
  and share-of-conversation meters, replacing the label/value text table.

## Scope And Non-Goals

- Scope: `src/webview/chart.ts`, `src/webview/main.ts`, panel CSS in
  `src/panel/panelController.ts`. Webview only; no parser, pricing, status
  bar, or protocol changes.
- Non-goals: charting libraries (DD-002 of the initial-design packet stands);
  new data fields; provider work.

## Specification Checkpoint (pre-implementation)

Reviewed `specification/product-scope.md`, `specification/provider-and-cost.md`,
`specification/surfaces-and-privacy.md`:

- `surfaces-and-privacy.md` panel contract is satisfied and strengthened: one
  visual unit per request, scaled to the conversation's own range; selecting a
  request still exposes full detail (model, all four token counts, tool call
  count, cost with confidence label, timestamp) — now visually rather than as
  a table, with exact values kept as text beside each bar.
- `provider-and-cost.md`: USD-only display kept; the confidence label is kept
  visible as a badge next to the cost figure and inside the tooltip.
- `product-scope.md`: no new aggregation level introduced.
- Candidate specification topic for maintainer review (not added): the thread
  chart must never overlay cost on the token scale (no dual-axis plot); cost
  and tokens are separate plots sharing the request axis.

## Exit Criteria

- `npm run typecheck` and `npm run build` pass.
- Rendered surface visually verified (legend, gridlines, gaps, tooltip,
  selection, detail card) against mock data.
