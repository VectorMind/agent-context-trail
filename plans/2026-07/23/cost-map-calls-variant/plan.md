# Cost Map Calls Variant

## Problem Summary

The Prompt cost map plots start vs end context with cost as bubble area and
LLM-call count as bubble color. The maintainer wants a second view of the same
data that shows how cost correlates with the number of LLM calls — without
adding another panel section.

## Goal and Objectives

Add a chart variant toggle inside the existing Prompt cost map panel:

- **Context growth** (existing): x = start context, y = end context,
  area = cost, color = LLM-call count.
- **Calls vs work** (new): x = LLM calls, y = context work (sum of per-call
  context tokens), area = cost, color = cache-write share of the prompt's
  tokens.

Design rationale (from the maintainer conversation, 2026-07-23):

- Cost stays encoded as bubble area in both variants, so a given prompt is
  the same bubble either way and the toggle reads as a re-projection, not a
  different chart. Cost is deliberately **not** doubled onto an axis.
- Context work is the cost driver (cost ≈ price × tokens processed), so
  bubble size vs y-position exposes cost anomalies; iso tokens-per-call rays
  through the origin (same dashed-guide language as the `end = start`
  diagonal) make average context per call readable.
- Color = cache-write share because an expensive token mix (cache writes vs
  cheap cache reads) is the usual culprit when cost outruns context work.

## Scope and Non-Goals

In scope: domain helpers, chart rendering branch, webview toggle + persisted
state, unit tests, spec refresh.

Non-goals: no new panel section; no change to point derivation, exclusion
rules, scope tabs (conversation/period), model filter, selection path, or the
detail panel layout beyond variant-aware coloring and one added row; no
charting library (hand-built SVG like all sibling charts, DD-018).

## Specification Checkpoint (pre-work)

- `specification/surfaces-and-privacy.md` ("Prompt cost map" bullet) fixes
  the current encoding: start/end context axes, cost area, LLM-call-count
  color, scope toggle, exclusion reporting, mark activation. Adding a second
  in-panel chart variant changes user-visible behavior described there, so
  that bullet needs an update when this packet closes (maintainer-initiated
  feature, so the spec change is expected, not speculative).
- `specification/product-scope.md` narrow period exception is untouched: the
  variant reuses the same points and scopes.
- `specification/ui-design.md` rules that carry over: units never mixed on
  one plot (x = calls, y = tokens are separate axes, not a dual-axis
  overlay); identity never color-alone; no zero fabrication (points already
  excluded when data is missing).

## Open Points

- OP-001 (resolved): color channel for the new variant = cache-write share
  min→max gradient over the visible scope, with the OP-004-style
  single-value fallback. Context delta was the alternative; maintainer
  accepted the recommendation by asking to proceed.
- OP-002 (resolved): x axis uses a nice integer scale from 0; overlap at
  identical (calls, work) positions is handled by the existing DD-013
  offsets.

## Phases

1. Domain helpers + tests (`src/domain/costMap.ts`, `costMap.test.ts`).
2. Chart variant (`src/webview/chart.ts`), webview toggle (`src/webview/main.ts`).
3. Validation (typecheck/build/test), spec refresh, packet close.

## Exit Criteria

- Toggle switches the panel between the two charts; choice persists like the
  other cost-map state; both scopes and the model filter work in both
  variants; selection ring and detail panel behave identically.
- `npm run typecheck`, `npm run build`, `npm test` clean.
- `surfaces-and-privacy.md` cost-map bullet describes both variants.
