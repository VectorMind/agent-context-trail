# Agent Context Trail - UI Design Specification

Cross-cutting visual rules for the panel's charts and any other rendered
surface. These rules are binding wherever they apply, not just where they were
first written; when a new chart or lane is added, it must be checked against
every rule below, not just copied from the nearest existing example.

## Chart implementation baseline

Charts are hand-built SVG, not a charting library (accepted as DD-002 of the
initial-design packet; workload is one conversation's worth of requests,
stacked bars/points, click-to-select, VS Code theming - a library buys nothing
here). Colors are VS Code theme CSS variables (`var(--vscode-charts-*)`,
`var(--vscode-editor-*)`, ...), never hardcoded hex, so every chart repaints
correctly across light, dark, and high-contrast themes without extra code.

## Two measures never share a plot

Two measures of different units (tokens vs. cost, tokens vs. wall time, ...)
never share one plot with a dual axis. Dual-axis reads as fake correlation:
two unrelated scales drawn to the same height look related when they are not.
Instead, related measures get their own aligned lane or strip on a shared
x-axis (one column per request/conversation), stacked vertically so they line
up but are never visually fused into one scale.

## Identity is never color-alone

Wherever color carries identity (which model served a request, which token
kind a segment is, which category a row belongs to), that identity is also
available as text: a legend entry, a tooltip line, a direct label, or a table
column. Color alone (hue/lightness) is not an accessible identity channel by
itself and must never be the only way to distinguish two things.

## Text over color: contrast is computed, never assumed

A label that is drawn on top of a colored element (inside a bar, on a swatch,
on a colored strip) must never use a fixed "white" or fixed theme-foreground
fill chosen by eye. Bar/series colors are theme variables — their actual
rendered lightness varies by theme and is not known at the time the code is
written, so "this looks fine in dark mode" is not sufficient: it silently
breaks in the next theme, or the next color added to the palette.

The rule:

1. **Resolve the actual color, don't guess it.** At render time, resolve the
   CSS color value (including `var()` chains) to concrete RGB via the DOM
   (`getComputedStyle` on an attached probe element), not from the source
   string or a remembered swatch.
2. **Compute contrast with the WCAG formula**, not a lightness eyeball:
   relative luminance per channel-linearized sRGB, then the standard
   `(L_lighter + 0.05) / (L_darker + 0.05)` contrast ratio. This is the only
   rule strong enough to catch pastel colors that look "light enough" but
   still fail contrast against a light label, or "dark enough" but fail
   against a dark one.
3. **Pick whichever of a dark/light ink wins**, per the computed ratio — not
   a fixed choice of white or the theme foreground color.
4. **When it is not known whether the label lands on the colored element or
   spills onto the plot surface behind it** (e.g. a value label positioned
   near a bar's edge, or a lane whose bar height varies with data and can
   leave the label above *or* have it fall inside the bar depending on scale),
   do not pick for one case and hope: compute the contrast ratio against
   **both** possible backgrounds (the color and the surface) and choose the
   ink that maximizes the **worst-case (minimum)** of the two ratios. This is
   the "middle color that contrasts both" — it is derived per-render from the
   live theme, not a single hardcoded gray meant to look okay everywhere.

Reference implementation: `contrastingLabelColor` in `src/webview/chart.ts`
(with `resolveRgb`, `relativeLuminance`, `contrastRatio`) — reused by every
lane that draws a value label inside a bar (wall time, tool calls, LLM calls
lanes as of this writing). Any new bar-with-inline-label chart must call
through the same helper rather than re-deciding a fill color locally.
