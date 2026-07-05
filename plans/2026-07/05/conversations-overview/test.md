# Test Proof

## Commands Run

- `npm run typecheck` — pass, no errors.
- `npm run build` — pass (esbuild).
- `npm run reinstall` — VSIX packaged and installed into local VS Code
  ("Extension 'agent-context-trail.vsix' was successfully installed").

## Visual Verification (headless browser harness)

A scratchpad harness (session temp dir, not committed) stubbed
`acquireVsCodeApi`, inlined the panel CSS with dark-theme variable fallbacks,
loaded the built `dist/webview.js`, injected a mock `init` message (8
conversations with varied first/last times, request counts, per-kind token
totals, costs; one 12-request detail), and was screenshotted at 1150×850 with
headless Edge — one page per layout plus the drill-in view.

Observed (third iteration — bounded panels, no scroll animation; earlier
iterations' shots superseded):

- **Layout A**: sort row shows `Last ▼` active by default; list ordered
  newest-last-message first; two-line items (`title` / `N req · 3 Jul → 1h
  ago`); active item highlighted; thread view unchanged on the right.
- **Panel blocks (B and C)**: each panel renders as a clearly bounded block —
  contrasted heading bar (sideBarSectionHeader tokens) with chevron, icon,
  uppercase title, and live summary; 1px border, 6px radius, 10px gap between
  panels. Collapsed = heading bar only, summary still readable ("8
  conversations by last message", "…— 12 req · 79.7M tokens · $28.05",
  "#8 · 26 tools · $3.2600").
- **Layout B (App bar)**: side app bar with activity-bar styling; with the
  chart panel collapsed its ▦ icon renders muted while the other three carry
  the accent background + left border. Heading-bar clicks and side-icon
  clicks toggle the same state. Clicking thread-chart bar #8 auto-expanded
  the request panel and its card rendered below.
- **Layout C (Panels)**: same blocks without the side bar; chart + table
  collapsed to heading bars leaves the conversation panel expanded and
  clearly delimited.
- **Overview chart**: stacked horizontal token bars (thread-chart series
  order/colors), legend above, vertical gridlines, direct value label only on
  the largest bar (71.2M); in-plot caption removed (section heading names it).
- **Table**: sorted by Last message desc, `aria-sort` set, numeric columns
  right-aligned tabular-nums, active row highlighted, filter input + count.
- **Selection flow**: table row click → thread panel fills in place; thread
  bar click → request card fills in place. No page swap, no scroll movement,
  no animation: `scrollTop` is restored exactly on re-render and the earlier
  `scrollIntoView({behavior:'smooth'})` was removed after maintainer
  feedback (page shifting up/down on click was a UX no-go).

## Close-Out Verification (2026-07-05, after OP-001 verdict)

- `LAYOUT_EXPERIMENTS = false` forces Layout B and hides the design bar;
  a persisted `layout: 'A'` webview state is ignored by construction
  (`state.layout` reads the persisted value only when the flag is true).
- `npm run typecheck`, `npm run build`, `npm run reinstall` all pass after
  the change ("Extension 'agent-context-trail.vsix' was successfully
  installed").

## Chart Method Compliance (dataviz)

- One axis per plot; the overview plot encodes tokens only, cost lives in the
  tooltip and table (no dual axis).
- Series colors are the VS Code theme's chart tokens, identical identities to
  the thread chart, fixed order, never cycled. Palette hex values are
  theme-owned so the six-check validator cannot run against arbitrary user
  themes; identity is never color-alone (legend, tooltips, and the table
  carry names and exact values), which is the compensating control.
- Thin marks, 2px surface gaps between stacked segments, rounded data-end,
  selective direct labels, recessive grid, text in text tokens.
- A table view of the same data always accompanies the chart (Layout C).

## Known Gaps

- Live VS Code interaction (clicking inside the real webview, theme
  light/dark switching, sort toggling) not exercised by the harness;
  maintainer's comparison pass covers this.
- Relative-time labels ("1h ago") are computed at render; the panel does not
  yet re-render on a timer, so they age until the next init/interaction.
- Codex/Copilot tabs show empty states only.

## Environment

- Windows 11, Node from repo toolchain, headless Microsoft Edge for
  screenshots, VS Code stable via `code --install-extension`.
