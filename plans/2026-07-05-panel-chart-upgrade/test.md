# Test Proof — Panel Chart Upgrade

## Commands Run

- `npm run typecheck` — pass (no output).
- `npm run build` — pass.

## Visual Verification

Rendered `dist/webview.js` in a standalone harness page (scratchpad, not in
repo): VS Code API shimmed, dark-theme `--vscode-*` variables stubbed, 11
mock requests posted via the `init` message, request #10 programmatically
selected, hover simulated on request #7. Screenshots taken with headless
Edge.

Observed, matching expectations:

- legend row (4 swatches + cost line key) above the chart;
- token plot with 0/200K/400K/600K gridlines and compact tick labels;
- stacked bars with rounded caps and visible 2px segment gaps;
- separate cost strip below, aligned per request, max point directly
  labeled `$1.62`;
- selection ring spanning both plots on the selected column, bold `#10`
  x-label;
- hover tooltip with per-series swatches, total row, cost row with
  confidence, values right-aligned;
- detail card with cost + `estimated` badge, meta line, four token bars
  with exact values, cost bar, and both share meters.

## Known Gaps

- Palette not run through the dataviz palette validator: colors are the
  active VS Code theme's `--vscode-charts-*` tokens, so concrete hex values
  are theme-owned and vary per user theme. Legend/labels/tooltips keep
  identity non-color-dependent regardless.
- Not exercised inside a live VS Code webview in this pass (`npm run
  reinstall` not run); harness reproduces the same DOM, CSS, and bundle.
- Keyboard focus path verified by code review only (focus/blur/Enter
  handlers), not by interactive tabbing.

## Specification Checkpoint (closing)

Re-checked `specification/*.md` after implementation: panel contract of
`surfaces-and-privacy.md` still satisfied (request selection exposes model,
token counts, tool calls, cost with confidence label, timestamp); USD-only
with confidence badge per `provider-and-cost.md`; no new aggregation levels
per `product-scope.md`. Candidate topic left for maintainer review: forbid
dual-axis (cost overlaid on token scale) in the panel chart contract.
