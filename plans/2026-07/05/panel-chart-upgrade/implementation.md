# Implementation — Panel Chart Upgrade

[######] Done - implemented and validated; follow-ups noted below.

## Files Changed

- `src/webview/chart.ts` — rewritten. Exports `TOKEN_SERIES` (series key /
  label / theme color), `COST_COLOR`, `formatTokens`, `formatTokensCompact`,
  `tokenTotal`, and `renderChart`.
- `src/webview/main.ts` — thread meta line now includes total tokens; detail
  card rebuilt as visual breakdown (see below).
- `src/panel/panelController.ts` — CSS for legend, tooltip, hover/focus
  states, breakdown bars, share meters, badge.

## Implementation Facts

- One SVG holds two aligned plots sharing the x layout: stacked token bars
  (nice-stepped gridlines, compact tick labels, 4px top-rounded caps, 2px
  surface gaps between segments) and a cost line strip below (2px line, 4px
  markers with 2px surface ring, direct label on the max-cost request only).
- Each request column is one focusable SVG group (`tabindex=0`,
  `role=button`, aria-label with all values): pointer hover shows an HTML
  tooltip (built with `textContent`, values right-aligned), Enter/Space or
  click selects, focus shows the tooltip anchored to the column.
- Markers thin out past 50 requests (first/last/max only); x labels thin to
  ~25.
- Detail card: header (title + cost with confidence badge), meta line
  (model · timestamp · tool calls), four horizontal token bars with exact
  values, a cost bar scaled to the conversation's max request cost, and two
  share-of-conversation meters (cost, tokens).
- Colors remain VS Code theme chart tokens (`--vscode-charts-*`), so light
  and dark themes are inherited; identity is never color-alone (legend,
  labels, tooltip, exact values everywhere).

## Decisions Taken

- DD-001: removed the cost-line overlay on the token scale (dual-axis
  anti-pattern) in favor of two plots on one request axis.
- DD-002 (initial-design) reaffirmed: still plain SVG, no chart library.
- Cost keeps `--vscode-charts-red` for continuity with the previous surface;
  it is drawn as a line (distinct mark type from the token bars).

## Follow-Up Risks

- `color-mix()` is used for breakdown tracks/meters; requires the webview's
  Chromium ≥ 111 (VS Code ≥ 1.78) — engine floor is 1.90, so fine.
- Tooltip is positioned against the chart wrapper; if the panel ever nests
  the chart in another scroll container, re-check clamping.
