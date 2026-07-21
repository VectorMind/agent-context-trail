import { ConversationListItem, LlmCallInfo, PromptRequest, ToolCallInfo, UsageTokens } from '../domain/types';
import {
  CostMapPoint,
  costBubbleRadius,
  isoGrowthDeltas,
  iterationScale,
  iterationT,
  overlapOffsets
} from '../domain/costMap';
import { formatUsd } from '../shared/format';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

export type TokenSeriesKey = 'cacheReadTokens' | 'cacheCreationTokens' | 'inputTokens' | 'outputTokens';

export interface TokenSeriesMeta {
  key: TokenSeriesKey;
  label: string;
  color: string;
}

/**
 * Stack order (bottom → top). Token bars use a fixed higher-chroma palette
 * so the series stay clean in both light and dark themes; this avoids some
 * theme oranges reading muddy/brown in the webview. Identity is never
 * color-alone: the legend, tooltips, and the detail breakdown all carry the
 * series names and exact values.
 */
export const TOKEN_SERIES: readonly TokenSeriesMeta[] = [
  { key: 'cacheReadTokens', label: 'Cache read', color: '#72B4FF' },
  { key: 'cacheCreationTokens', label: 'Cache write', color: '#C18CFF' },
  { key: 'inputTokens', label: 'Input', color: '#FF8FB1' },
  { key: 'outputTokens', label: 'Output', color: '#7FD88F' }
];

export const COST_COLOR = 'var(--vscode-charts-red)';

const SURFACE = 'var(--vscode-editor-background)';
const GRID = 'var(--vscode-panel-border)';
const TEXT_MUTED = 'var(--vscode-descriptionForeground)';
const TEXT = 'var(--vscode-foreground)';

const BAR_WIDTH = 22;
const BAR_GAP = 10;
const SEGMENT_GAP = 2;
const M_LEFT = 48;
const M_RIGHT = 14;
const CAPTION_TOKENS_Y = 10;
const TOKEN_TOP = 20;
const TOKEN_H = 168;
const TOKEN_BOTTOM = TOKEN_TOP + TOKEN_H;
const CAPTION_COST_Y = TOKEN_BOTTOM + 24;
const COST_TOP = CAPTION_COST_Y + 10;
const COST_H = 46;
const COST_BOTTOM = COST_TOP + COST_H;
// Optional aligned lanes below the cost strip (Layout D): model state strip
// and wall-time bars, sharing the same request axis.
const MODEL_CAPTION_Y = COST_BOTTOM + 24;
const MODEL_TOP = MODEL_CAPTION_Y + 8;
const MODEL_H = 14;
const MODEL_BOTTOM = MODEL_TOP + MODEL_H;
const DUR_CAPTION_Y = MODEL_BOTTOM + 22;
const DUR_TOP = DUR_CAPTION_Y + 8;
const DUR_H = 40;
const DUR_BOTTOM = DUR_TOP + DUR_H;
// Tool-call and LLM-call count lanes, same treatment as the wall-time bars.
const TOOLS_CAPTION_Y = DUR_BOTTOM + 22;
const TOOLS_TOP = TOOLS_CAPTION_Y + 8;
const TOOLS_H = 40;
const TOOLS_BOTTOM = TOOLS_TOP + TOOLS_H;
const LLM_CAPTION_Y = TOOLS_BOTTOM + 22;
const LLM_TOP = LLM_CAPTION_Y + 8;
const LLM_H = 40;
const LLM_BOTTOM = LLM_TOP + LLM_H;

/**
 * Fixed categorical order for identity in timeline lanes and category
 * breakdowns. Assigned by first appearance and never cycled/re-ranked; starts
 * on yellow so the first entry does not collide with the token stack's blue
 * baseline. Identity is never color-alone: labels, legends, and tooltips
 * carry the names alongside the color.
 */
export const CATEGORY_COLORS = [
  'var(--vscode-charts-yellow)',
  'var(--vscode-charts-blue)',
  'var(--vscode-charts-purple)',
  'var(--vscode-charts-orange)',
  'var(--vscode-charts-green)',
  'var(--vscode-charts-red)'
];
/** Neutral single-series hue for the wall-time lane (time, not an economic series). */
const DURATION_COLOR = 'var(--vscode-charts-lines, var(--vscode-descriptionForeground))';
/** Single-series hues for the tool-call and LLM-call count lanes. */
const TOOL_CALLS_COLOR = 'var(--vscode-charts-green)';
const LLM_CALLS_COLOR = 'var(--vscode-charts-purple)';
/** Reserved status color for cache-break markers; ships with a glyph + legend, never color alone. */
const WARN_COLOR = 'var(--vscode-editorWarning-foreground, var(--vscode-charts-orange))';

// ---- label-on-color contrast (specification/ui-design.md "Text over color") ---------------
// A label's fill is never a fixed white/foreground: it is picked per WCAG
// relative-luminance contrast against whatever it actually sits on, resolved
// from the live theme (not assumed light/dark).

const LABEL_DARK: [number, number, number] = [20, 20, 20];
const LABEL_LIGHT: [number, number, number] = [245, 245, 245];

/** Resolve any CSS `<color>` (var(), keyword, hex...) to RGB via a throwaway attached probe. */
function resolveRgb(cssColor: string): [number, number, number] | undefined {
  const probe = document.createElement('span');
  probe.style.color = cssColor;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = resolved.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances (1:1 to 21:1). */
function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text color for a label that may land on `onColor` (e.g. a bar fill) or spill
 * onto the plot surface behind it: never assume, resolve both and pick
 * whichever of a dark/light ink maximizes the worst-case contrast across the
 * two possible backgrounds — a codified middle choice, not a fixed white.
 */
function contrastingLabelColor(onColor: string): string {
  const bg = resolveRgb(onColor);
  const surface = resolveRgb(SURFACE);
  if (!bg || !surface) return TEXT;
  const bgL = relativeLuminance(bg);
  const surfaceL = relativeLuminance(surface);
  const darkWorst = Math.min(contrastRatio(relativeLuminance(LABEL_DARK), bgL), contrastRatio(relativeLuminance(LABEL_DARK), surfaceL));
  const lightWorst = Math.min(contrastRatio(relativeLuminance(LABEL_LIGHT), bgL), contrastRatio(relativeLuminance(LABEL_LIGHT), surfaceL));
  return darkWorst >= lightWorst ? 'rgb(20, 20, 20)' : 'rgb(245, 245, 245)';
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}min`;
  const h = m / 60;
  return `${h >= 10 ? h.toFixed(0) : h.toFixed(1)}h`;
}

export function shortModelName(model: string): string {
  return model.replace(/^claude-/, '');
}

/**
 * Direct value label for a lane bar: above the bar when there's room below
 * the caption, otherwise inside the bar (near its top) so it never collides
 * with the caption text — this triggers whenever the busiest bar fills (or
 * nearly fills) the lane, which a two-column chart hits constantly. Either
 * way the label may land on `barColor` or spill onto the plot surface, so its
 * fill is contrast-resolved against both rather than fixed to TEXT.
 */
function laneValueLabel(cx: number, barTop: number, laneTop: number, text: string, barColor: string): SVGTextElement {
  const fitsAbove = barTop - laneTop >= 12;
  const label = svgEl('text', {
    x: cx,
    y: fitsAbove ? barTop - 4 : barTop + 12,
    'text-anchor': 'middle',
    class: 'chart-value-label',
    fill: fitsAbove ? TEXT : contrastingLabelColor(barColor)
  });
  label.textContent = text;
  return label;
}

/** One bar-per-request lane for a small integer count (tool calls, LLM calls, ...). */
function renderCountLane(
  laneLayer: SVGGElement,
  requests: PromptRequest[],
  colX: (i: number) => number,
  plotRight: number,
  layout: { captionY: number; bottom: number; height: number },
  caption: string,
  color: string,
  getValue: (r: PromptRequest) => number | undefined
): void {
  const captionEl = svgEl('text', { x: M_LEFT, y: layout.captionY, class: 'chart-caption', fill: TEXT_MUTED });
  captionEl.textContent = caption;
  laneLayer.appendChild(captionEl);
  laneLayer.appendChild(
    svgEl('line', { x1: M_LEFT, y1: layout.bottom, x2: plotRight, y2: layout.bottom, stroke: GRID, 'stroke-width': 1 })
  );
  const values = requests.map((r) => getValue(r) ?? 0);
  const maxValue = Math.max(1, ...values);
  const maxIndex = values.indexOf(Math.max(...values));
  requests.forEach((_, i) => {
    const v = values[i];
    if (v <= 0) return;
    const h = Math.max(1.5, (v / maxValue) * layout.height);
    const bar = topRoundedRect(colX(i), layout.bottom - h, BAR_WIDTH, h, 3);
    bar.setAttribute('fill', color);
    laneLayer.appendChild(bar);
  });
  // selective direct label: only the busiest request
  if (values[maxIndex] > 0) {
    const cx = colX(maxIndex) + BAR_WIDTH / 2;
    const barTop = layout.bottom - (values[maxIndex] / maxValue) * layout.height;
    const laneTop = layout.bottom - layout.height;
    laneLayer.appendChild(laneValueLabel(cx, barTop, laneTop, String(values[maxIndex]), color));
  }
}

/** Idle time between the end of the previous request and the start of this one. */
export function gapBeforeMs(requests: PromptRequest[], index: number): number | undefined {
  if (index <= 0) return undefined;
  const prev = requests[index - 1];
  const prevEnd = prev.endedAt ?? prev.startedAt;
  const ms = Date.parse(requests[index].startedAt) - Date.parse(prevEnd);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** Stable key → color assignment by first appearance in `keys`, from `CATEGORY_COLORS`. */
export function categoryColorMap(keys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of keys) {
    if (!map.has(key)) {
      map.set(key, CATEGORY_COLORS[Math.min(map.size, CATEGORY_COLORS.length - 1)]);
    }
  }
  return map;
}

/** Stable model → lane color assignment by first appearance across the requests. */
export function modelColorMap(requests: PromptRequest[]): Map<string, string> {
  return categoryColorMap(requests.map((r) => r.model).filter((m): m is string => !!m));
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatTokensCompact(n: number): string {
  const trim = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return String(n);
}

export function tokenTotal(usage: UsageTokens): number {
  return usage.cacheReadTokens + usage.cacheCreationTokens + usage.inputTokens + usage.outputTokens;
}

/** Smallest "nice" step (1/2/5 × 10^k) that is ≥ rough. */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= rough) return m * pow;
  }
  return 10 * pow;
}

/** Rect with only the top corners rounded: data-end rounded, baseline square. */
function topRoundedRect(x: number, yTop: number, w: number, h: number, r: number): SVGPathElement {
  const radius = Math.min(r, w / 2, h / 2);
  const d =
    `M ${x} ${yTop + h} ` +
    `L ${x} ${yTop + radius} ` +
    `Q ${x} ${yTop} ${x + radius} ${yTop} ` +
    `L ${x + w - radius} ${yTop} ` +
    `Q ${x + w} ${yTop} ${x + w} ${yTop + radius} ` +
    `L ${x + w} ${yTop + h} Z`;
  return svgEl('path', { d });
}

function legendItem(color: string, label: string, kind: 'swatch' | 'line' | 'glyph' = 'swatch', glyphChar = '▲'): HTMLElement {
  const item = document.createElement('span');
  item.className = 'legend-item';
  if (kind === 'glyph') {
    const glyph = document.createElement('span');
    glyph.className = 'legend-glyph';
    glyph.style.color = color;
    glyph.textContent = glyphChar;
    item.appendChild(glyph);
  } else {
    const key = document.createElement('span');
    key.className = kind === 'line' ? 'legend-line' : 'legend-swatch';
    key.style.background = color;
    item.appendChild(key);
  }
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  item.appendChild(labelEl);
  return item;
}

function legendEl(includeCost = true, models?: Map<string, string>, hasCacheBreaks = false): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  for (const series of TOKEN_SERIES) {
    legend.appendChild(legendItem(series.color, series.label));
  }
  if (includeCost) legend.appendChild(legendItem(COST_COLOR, 'Cost (USD)', 'line'));
  if (models) {
    for (const [model, color] of models) {
      legend.appendChild(legendItem(color, shortModelName(model)));
    }
  }
  if (hasCacheBreaks) legend.appendChild(legendItem(WARN_COLOR, 'Cache break', 'glyph'));
  return legend;
}

/**
 * Two aligned plots sharing one x layout — stacked token bars on top, a cost
 * line strip below. Deliberately two plots on one x-axis instead of a cost
 * line overlaid on the token scale: two measures of different units never
 * share a plot (dual-axis reads as fake correlation). Deliberately plain SVG,
 * no charting library — see plan.md DD-002 of the initial-design packet.
 */
export function renderChart(
  container: HTMLElement,
  requests: PromptRequest[],
  selectedIndex: number | undefined,
  onSelect: (index: number) => void,
  opts?: { timeline?: boolean }
): void {
  container.innerHTML = '';

  if (requests.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No prompts in this conversation yet.';
    container.appendChild(empty);
    return;
  }

  const timeline = !!opts?.timeline;
  const hasCost = requests.some((request) => request.cost.usd !== undefined);
  const models = timeline ? modelColorMap(requests) : undefined;
  const hasCacheBreaks = timeline && requests.some((r) => (r.cacheMisses?.length ?? 0) > 0);
  const plotBottom = timeline ? LLM_BOTTOM : COST_BOTTOM;
  const xLabelY = plotBottom + 15;
  const chartHeight = xLabelY + 8;

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  wrapper.appendChild(legendEl(hasCost, models, hasCacheBreaks));

  const scroll = document.createElement('div');
  scroll.className = 'chart-scroll';
  wrapper.appendChild(scroll);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.display = 'none';
  wrapper.appendChild(tooltip);

  const n = requests.length;
  const colX = (i: number): number => M_LEFT + BAR_GAP + i * (BAR_WIDTH + BAR_GAP);
  const width = colX(n - 1) + BAR_WIDTH + BAR_GAP + M_RIGHT;
  const plotRight = width - M_RIGHT;

  const totals = requests.map((r) => tokenTotal(r.usage));
  const maxTotal = Math.max(1, ...totals);
  const step = niceStep(maxTotal / 4);
  const tickCount = Math.ceil(maxTotal / step);
  const scaleMax = tickCount * step;
  const tokenY = (value: number): number => TOKEN_BOTTOM - (value / scaleMax) * TOKEN_H;

  const costs = requests.map((r) => r.cost.usd ?? 0);
  const maxCost = hasCost ? Math.max(0.0001, ...costs) : 0.0001;
  const maxCostIndex = costs.indexOf(Math.max(...costs));
  const costY = (usd: number): number => COST_BOTTOM - (usd / maxCost) * COST_H;

  const svg = svgEl('svg', {
    width,
    height: chartHeight,
    viewBox: `0 0 ${width} ${chartHeight}`,
    role: 'img',
    'aria-label':
      'Token usage per prompt with cost per prompt below, sharing one prompt axis' +
      (timeline ? ', plus aligned model, wall-time, tool-call, and LLM-call lanes' : '')
  });
  scroll.appendChild(svg);

  // ---- captions -----------------------------------------------------------
  const captionTokens = svgEl('text', { x: M_LEFT, y: CAPTION_TOKENS_Y, class: 'chart-caption', fill: TEXT_MUTED });
  captionTokens.textContent = 'TOKENS';
  const captionCost = svgEl('text', { x: M_LEFT, y: CAPTION_COST_Y, class: 'chart-caption', fill: TEXT_MUTED });
  captionCost.textContent = hasCost ? 'COST (USD)' : 'USD COST UNAVAILABLE';
  svg.append(captionTokens, captionCost);

  // ---- token gridlines + ticks --------------------------------------------
  for (let t = 0; t <= tickCount; t++) {
    const value = t * step;
    const y = tokenY(value);
    svg.appendChild(
      svgEl('line', { x1: M_LEFT, y1: y, x2: plotRight, y2: y, stroke: GRID, 'stroke-width': 1 })
    );
    const tick = svgEl('text', {
      x: M_LEFT - 8,
      y: y + 3,
      'text-anchor': 'end',
      class: 'chart-tick',
      fill: TEXT_MUTED
    });
    tick.textContent = formatTokensCompact(value);
    svg.appendChild(tick);
  }
  // cost strip baseline only; the max point carries a direct label instead of ticks
  svg.appendChild(
    svgEl('line', { x1: M_LEFT, y1: COST_BOTTOM, x2: plotRight, y2: COST_BOTTOM, stroke: GRID, 'stroke-width': 1 })
  );

  // ---- tooltip plumbing -----------------------------------------------------
  const fillTooltip = (index: number): void => {
    const request = requests[index];
    tooltip.textContent = '';

    const header = document.createElement('div');
    header.className = 'tooltip-header';
    header.textContent = `Prompt #${index + 1}`;
    if (request.model) {
      const model = document.createElement('span');
      model.className = 'tooltip-model';
      model.textContent = request.model;
      header.appendChild(model);
    }
    tooltip.appendChild(header);

    for (const series of TOKEN_SERIES) {
      tooltip.appendChild(tooltipRow(series.color, false, series.label, formatTokens(request.usage[series.key])));
    }
    tooltip.appendChild(tooltipRow(undefined, false, 'Total', formatTokens(tokenTotal(request.usage))));
    if (request.cost.usd !== undefined) {
      tooltip.appendChild(tooltipRow(COST_COLOR, true, `Cost (${request.cost.source})`, formatUsd(request.cost.usd)));
    } else {
      tooltip.appendChild(tooltipRow(undefined, false, 'Cost', 'unavailable'));
    }

    if (timeline) {
      if (request.durationMs !== undefined) {
        tooltip.appendChild(tooltipRow(DURATION_COLOR, false, 'Wall time', formatDurationMs(request.durationMs)));
      }
      const gap = gapBeforeMs(requests, index);
      if (gap !== undefined) {
        tooltip.appendChild(tooltipRow(undefined, false, 'Idle before', formatDurationMs(gap)));
      }
      if (request.toolCallCount > 0) {
        tooltip.appendChild(tooltipRow(TOOL_CALLS_COLOR, false, 'Tool calls', String(request.toolCallCount)));
      }
      if (request.llmCallCount !== undefined && request.llmCallCount > 0) {
        tooltip.appendChild(tooltipRow(LLM_CALLS_COLOR, false, 'LLM calls', String(request.llmCallCount)));
      }
      for (const miss of request.cacheMisses ?? []) {
        tooltip.appendChild(
          tooltipRow(
            WARN_COLOR,
            false,
            `Cache break (${miss.reason.replace(/_/g, ' ')})`,
            miss.missedTokens !== undefined ? `${formatTokensCompact(miss.missedTokens)} missed` : ''
          )
        );
      }
    }
  };

  const positionTooltip = (clientX: number, clientY: number): void => {
    tooltip.style.display = 'block';
    const rect = wrapper.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top - 10;
    if (x + tooltip.offsetWidth > rect.width - 4) x = clientX - rect.left - tooltip.offsetWidth - 14;
    if (x < 4) x = 4;
    if (y + tooltip.offsetHeight > rect.height - 4) y = rect.height - tooltip.offsetHeight - 4;
    if (y < 4) y = 4;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  const hideTooltip = (): void => {
    tooltip.style.display = 'none';
  };

  // ---- one interactive group per request ------------------------------------
  requests.forEach((request, index) => {
    const x = colX(index);
    const group = svgEl('g', { class: 'bar-group', tabindex: 0, role: 'button' });
    group.setAttribute(
      'aria-label',
      `Prompt ${index + 1}: ` +
        TOKEN_SERIES.map((s) => `${s.label} ${formatTokens(request.usage[s.key])}`).join(', ') +
        ` tokens, cost ${formatUsd(request.cost.usd)}. Press Enter for details.`
    );

    // Full-height invisible hit target spanning both plots, wider than the bar.
    const hit = svgEl('rect', {
      class: 'hit',
      x: x - BAR_GAP / 2,
      y: TOKEN_TOP,
      width: BAR_WIDTH + BAR_GAP,
      height: plotBottom - TOKEN_TOP,
      rx: 3,
      fill: 'transparent'
    });
    group.appendChild(hit);

    // cache-break marker: reserved warning color + glyph, above the token bar
    if (timeline && (request.cacheMisses?.length ?? 0) > 0) {
      const markY = tokenY(totals[index]) - 6;
      const marker = svgEl('text', {
        x: x + BAR_WIDTH / 2,
        y: Math.max(TOKEN_TOP + 8, markY),
        'text-anchor': 'middle',
        class: 'chart-warn-marker',
        fill: WARN_COLOR
      });
      marker.textContent = '▲';
      group.appendChild(marker);
    }

    const nonZero = TOKEN_SERIES.filter((s) => request.usage[s.key] > 0);
    const topKey = nonZero.length > 0 ? nonZero[nonZero.length - 1].key : undefined;
    let yBottom = TOKEN_BOTTOM;
    let isBottomSegment = true;
    for (const series of TOKEN_SERIES) {
      const value = request.usage[series.key];
      const h = (value / scaleMax) * TOKEN_H;
      if (value <= 0) continue;
      const yTop = yBottom - h;
      // 2px surface gap carved from the bottom of every non-baseline segment
      const inset = isBottomSegment || h < 2 * SEGMENT_GAP ? 0 : SEGMENT_GAP;
      const visibleH = Math.max(h - inset, Math.min(h, 1));
      if (visibleH >= 0.5) {
        const mark =
          series.key === topKey
            ? topRoundedRect(x, yTop, BAR_WIDTH, visibleH, 4)
            : svgEl('rect', { x, y: yTop, width: BAR_WIDTH, height: visibleH });
        mark.setAttribute('class', 'seg');
        mark.setAttribute('fill', series.color);
        group.appendChild(mark);
      }
      yBottom = yTop;
      isBottomSegment = false;
    }

    group.addEventListener('pointermove', (ev: PointerEvent) => {
      fillTooltip(index);
      positionTooltip(ev.clientX, ev.clientY);
    });
    group.addEventListener('pointerleave', hideTooltip);
    group.addEventListener('click', () => onSelect(index));
    group.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onSelect(index);
      }
    });
    group.addEventListener('focus', () => {
      fillTooltip(index);
      const hitRect = hit.getBoundingClientRect();
      positionTooltip(hitRect.right, hitRect.top + 20);
    });
    group.addEventListener('blur', hideTooltip);

    svg.appendChild(group);
  });

  // ---- cost line strip (drawn above groups, pointer-transparent) -------------
  if (hasCost) {
    const costLayer = svgEl('g', { style: 'pointer-events:none' });
    const points = requests.map((r, i) => `${colX(i) + BAR_WIDTH / 2},${costY(r.cost.usd ?? 0)}`);
    if (n > 1) {
      costLayer.appendChild(
        svgEl('polyline', {
          points: points.join(' '),
          fill: 'none',
          stroke: COST_COLOR,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round'
        })
      );
    }
    requests.forEach((request, index) => {
      if (request.cost.usd === undefined) return;
      const drawMarker = n <= 50 || index === 0 || index === n - 1 || index === maxCostIndex;
      if (!drawMarker) return;
      costLayer.appendChild(
        svgEl('circle', {
          cx: colX(index) + BAR_WIDTH / 2,
          cy: costY(request.cost.usd),
          r: 4,
          fill: COST_COLOR,
          stroke: SURFACE,
          'stroke-width': 2
        })
      );
    });
    const maxCx = colX(maxCostIndex) + BAR_WIDTH / 2;
    const labelLeft = maxCx > plotRight - 64;
    const costLabel = svgEl('text', {
      x: labelLeft ? maxCx - 9 : maxCx + 9,
      y: costY(costs[maxCostIndex]) + 3,
      'text-anchor': labelLeft ? 'end' : 'start',
      class: 'chart-value-label',
      fill: TEXT
    });
    costLabel.textContent = formatUsd(costs[maxCostIndex]);
    costLayer.appendChild(costLabel);
    svg.appendChild(costLayer);
  }

  // ---- timeline lanes: model state strip + wall-time bars (Layout D) ---------
  if (timeline && models) {
    const laneLayer = svgEl('g', { style: 'pointer-events:none' });

    const captionModel = svgEl('text', { x: M_LEFT, y: MODEL_CAPTION_Y, class: 'chart-caption', fill: TEXT_MUTED });
    captionModel.textContent = 'MODEL';
    laneLayer.appendChild(captionModel);

    // one colored cell per request; a label per run of consecutive same-model requests
    let runStart = 0;
    for (let i = 0; i <= n; i++) {
      const boundary = i === n || (requests[i].model ?? '') !== (requests[runStart].model ?? '');
      if (!boundary) continue;
      const model = requests[runStart].model;
      const runX = colX(runStart);
      const runEnd = colX(i - 1) + BAR_WIDTH;
      if (model) {
        const runW = runEnd - runX;
        if (runW >= 46) {
          const runLabel = svgEl('text', {
            x: runX + runW / 2,
            y: MODEL_TOP - 3,
            'text-anchor': 'middle',
            class: 'chart-tick',
            fill: TEXT
          });
          runLabel.textContent = shortModelName(model);
          laneLayer.appendChild(runLabel);
        }
      }
      runStart = i;
    }
    requests.forEach((request, i) => {
      const color = request.model ? models.get(request.model) : undefined;
      if (!color) return;
      const cell = svgEl('rect', { x: colX(i), y: MODEL_TOP, width: BAR_WIDTH, height: MODEL_H, rx: 2 });
      cell.setAttribute('fill', color);
      // model switch: 2px surface ring on the first cell of a new run
      if (i > 0 && requests[i - 1].model && requests[i - 1].model !== request.model) {
        cell.setAttribute('stroke', SURFACE);
        cell.setAttribute('stroke-width', '2');
      }
      laneLayer.appendChild(cell);
    });

    const captionDur = svgEl('text', { x: M_LEFT, y: DUR_CAPTION_Y, class: 'chart-caption', fill: TEXT_MUTED });
    captionDur.textContent = 'WALL TIME';
    laneLayer.appendChild(captionDur);
    laneLayer.appendChild(
      svgEl('line', { x1: M_LEFT, y1: DUR_BOTTOM, x2: plotRight, y2: DUR_BOTTOM, stroke: GRID, 'stroke-width': 1 })
    );
    const durations = requests.map((r) => r.durationMs ?? 0);
    const maxDur = Math.max(1, ...durations);
    const maxDurIndex = durations.indexOf(Math.max(...durations));
    requests.forEach((request, i) => {
      const ms = request.durationMs;
      if (ms === undefined || ms <= 0) return;
      const h = Math.max(1.5, (ms / maxDur) * DUR_H);
      const bar = topRoundedRect(colX(i), DUR_BOTTOM - h, BAR_WIDTH, h, 3);
      bar.setAttribute('fill', DURATION_COLOR);
      laneLayer.appendChild(bar);
    });
    // selective direct label: only the longest request
    if (durations[maxDurIndex] > 0) {
      const cx = colX(maxDurIndex) + BAR_WIDTH / 2;
      const barTop = DUR_BOTTOM - (durations[maxDurIndex] / maxDur) * DUR_H;
      laneLayer.appendChild(laneValueLabel(cx, barTop, DUR_TOP, formatDurationMs(durations[maxDurIndex]), DURATION_COLOR));
    }

    renderCountLane(
      laneLayer,
      requests,
      colX,
      plotRight,
      { captionY: TOOLS_CAPTION_Y, bottom: TOOLS_BOTTOM, height: TOOLS_H },
      'TOOL CALLS',
      TOOL_CALLS_COLOR,
      (r) => r.toolCallCount
    );
    renderCountLane(
      laneLayer,
      requests,
      colX,
      plotRight,
      { captionY: LLM_CAPTION_Y, bottom: LLM_BOTTOM, height: LLM_H },
      'LLM CALLS',
      LLM_CALLS_COLOR,
      (r) => r.llmCallCount
    );

    svg.appendChild(laneLayer);
  }

  // ---- x labels + selection ---------------------------------------------------
  const labelStep = Math.max(1, Math.ceil(n / 25));
  requests.forEach((_, index) => {
    if (index % labelStep !== 0 && index !== n - 1) return;
    const label = svgEl('text', {
      x: colX(index) + BAR_WIDTH / 2,
      y: xLabelY,
      'text-anchor': 'middle',
      class: 'chart-tick' + (index === selectedIndex ? ' selected' : ''),
      fill: index === selectedIndex ? TEXT : TEXT_MUTED
    });
    label.textContent = `#${index + 1}`;
    svg.appendChild(label);
  });

  if (selectedIndex !== undefined && selectedIndex >= 0 && selectedIndex < n) {
    svg.appendChild(
      svgEl('rect', {
        x: colX(selectedIndex) - 3,
        y: TOKEN_TOP - 3,
        width: BAR_WIDTH + 6,
        height: plotBottom - TOKEN_TOP + 6,
        rx: 4,
        fill: 'none',
        stroke: 'var(--vscode-focusBorder)',
        'stroke-width': 1.5,
        style: 'pointer-events:none'
      })
    );
  }

  container.appendChild(wrapper);

  if (selectedIndex === undefined) {
    const hint = document.createElement('div');
    hint.className = 'chart-hint';
    hint.textContent = 'Click a bar (or focus it and press Enter) to inspect that prompt.';
    container.appendChild(hint);
  }
}

// ---- prompt timeline: interleaved LLM + tool call events ---------------------------
// One column per event — LLM calls interleaved with the tool calls they
// requested (plans/2026-07/07/call-details OP-201), ordered by timestamp with
// ties resolved LLM-first (the LLM response is what carries the tool
// requests). Lanes share the x-axis but never a scale (ui-design.md):
//   CONTEXT (tokens)  — LLM columns only; stacked cache-read / cache-write /
//                       fresh segments (one unit, so stacking is honest).
//   IN / OUT (chars)  — tool columns only, colored by tool name via the same
//                       categoryColorMap assignment as "Tool activity".
//   TIME (ms)         — tool durations plus Claude LLM streaming spans; one
//                       unit, ≈-labeled wherever derived (OP-203).
// A lane with no defined value anywhere collapses to a caption-only
// unavailable note — never zero-height bars (provider-and-cost.md).

const TC_BAR_WIDTH = 12;
const TC_BAR_GAP = 6;
const TC_M_LEFT = 48;
const TC_M_RIGHT = 14;
const TC_LANE_H = 64;
const TC_UNAVAILABLE_H = 14;
/** Guarantees room for the longest "— unavailable (…)" caption even when very few calls make for a narrow plot. */
const TC_MIN_WIDTH = 460;

/** Which call a timeline column (or Tools-table row) selects. */
export interface TimelineSelection {
  kind: 'tool' | 'llm';
  /** Index into request.tools / request.llmCalls respectively. */
  index: number;
}

export type TimelineEvent =
  | { kind: 'tool'; tool: ToolCallInfo; toolIndex: number }
  | { kind: 'llm'; call: LlmCallInfo; llmIndex: number };

/** Carry-forward sort keys: each source list is chronological, so a missing timestamp inherits its predecessor's. */
function carryForwardKeys<T>(list: T[], ts: (item: T) => string | undefined): number[] {
  let last = Number.NEGATIVE_INFINITY;
  return list.map((item) => {
    const t = Date.parse(ts(item) ?? '');
    if (Number.isFinite(t)) last = t;
    return last;
  });
}

/**
 * The request's event sequence: LLM calls and tool calls merged on their
 * timestamps (both arrays are already in log order), ties LLM-first. Shared
 * by the timeline chart and the Call detail prev/next steppers so "the trail"
 * is one ordering everywhere.
 */
export function timelineEvents(request: PromptRequest): TimelineEvent[] {
  const llmCalls = request.llmCalls ?? [];
  const tools = request.tools ?? [];
  const llmKeys = carryForwardKeys(llmCalls, (c) => c.startedAt);
  const toolKeys = carryForwardKeys(tools, (t) => t.startedAt);
  const events: TimelineEvent[] = [];
  let li = 0;
  let ti = 0;
  while (li < llmCalls.length || ti < tools.length) {
    const takeLlm = li < llmCalls.length && (ti >= tools.length || llmKeys[li] <= toolKeys[ti]);
    if (takeLlm) {
      events.push({ kind: 'llm', call: llmCalls[li], llmIndex: li });
      li += 1;
    } else {
      events.push({ kind: 'tool', tool: tools[ti], toolIndex: ti });
      ti += 1;
    }
  }
  return events;
}

/** Claude only: streaming span of an LLM call (first → last record), ≈ by nature. */
export function llmCallSpanMs(call: LlmCallInfo): number | undefined {
  if (!call.startedAt || !call.endedAt) return undefined;
  const ms = Date.parse(call.endedAt) - Date.parse(call.startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * Context composition segments that provably sum to contextTokens: cache read
 * and cache write are taken as reported; "fresh" is the remainder. This stays
 * correct for both Claude semantics (input + cacheRead + cacheWrite) and
 * Codex semantics (input_tokens already includes the cached subset).
 */
function contextSegments(call: LlmCallInfo): { label: string; value: number; color: string }[] {
  const total = call.contextTokens ?? 0;
  const cacheRead = Math.min(call.cacheReadTokens ?? 0, total);
  const cacheWrite = Math.min(call.cacheCreationTokens ?? 0, Math.max(0, total - cacheRead));
  const fresh = Math.max(0, total - cacheRead - cacheWrite);
  return [
    { label: 'Cache read', value: cacheRead, color: TOKEN_SERIES[0].color },
    { label: 'Cache write', value: cacheWrite, color: TOKEN_SERIES[1].color },
    { label: 'Fresh', value: fresh, color: TOKEN_SERIES[2].color }
  ].filter((s) => s.value > 0);
}

interface ToolLaneLayout {
  captionY: number;
  top: number;
  bottom: number;
  height: number;
}

function toolLaneLayout(captionY: number, top: number, available: boolean): ToolLaneLayout {
  const height = available ? TC_LANE_H : 0;
  return { captionY, top, bottom: top + (available ? TC_LANE_H : TC_UNAVAILABLE_H), height };
}

interface LaneBar {
  value?: number;
  color: string;
}

/** One lane of per-event bars; absent values leave a gap, never a zero bar. */
function renderEventLane(
  laneLayer: SVGGElement,
  colX: (i: number) => number,
  plotRight: number,
  layout: ToolLaneLayout,
  caption: string,
  bars: LaneBar[],
  formatValue: (v: number) => string
): void {
  const captionEl = svgEl('text', { x: TC_M_LEFT, y: layout.captionY, class: 'chart-caption', fill: TEXT_MUTED });
  captionEl.textContent = caption;
  laneLayer.appendChild(captionEl);
  laneLayer.appendChild(
    svgEl('line', { x1: TC_M_LEFT, y1: layout.bottom, x2: plotRight, y2: layout.bottom, stroke: GRID, 'stroke-width': 1 })
  );
  const maxValue = Math.max(1, ...bars.map((b) => b.value).filter((v): v is number => v !== undefined && v > 0));
  let maxIndex = -1;
  let maxSeen = -Infinity;
  bars.forEach((bar, i) => {
    if (bar.value === undefined || bar.value <= 0) return;
    const h = Math.max(1.5, (bar.value / maxValue) * layout.height);
    const rect = topRoundedRect(colX(i), layout.bottom - h, TC_BAR_WIDTH, h, 2);
    rect.setAttribute('fill', bar.color);
    laneLayer.appendChild(rect);
    if (bar.value > maxSeen) {
      maxSeen = bar.value;
      maxIndex = i;
    }
  });
  if (maxIndex >= 0) {
    const cx = colX(maxIndex) + TC_BAR_WIDTH / 2;
    const barTop = layout.bottom - (maxSeen / maxValue) * layout.height;
    laneLayer.appendChild(laneValueLabel(cx, barTop, layout.top, formatValue(maxSeen), bars[maxIndex].color));
  }
}

/** CONTEXT lane: stacked single-unit token segments on the LLM columns only. */
function renderContextLane(
  laneLayer: SVGGElement,
  events: TimelineEvent[],
  colX: (i: number) => number,
  plotRight: number,
  layout: ToolLaneLayout
): void {
  const captionEl = svgEl('text', { x: TC_M_LEFT, y: layout.captionY, class: 'chart-caption', fill: TEXT_MUTED });
  captionEl.textContent = 'CONTEXT (tokens)';
  laneLayer.appendChild(captionEl);
  laneLayer.appendChild(
    svgEl('line', { x1: TC_M_LEFT, y1: layout.bottom, x2: plotRight, y2: layout.bottom, stroke: GRID, 'stroke-width': 1 })
  );
  const totals = events.map((e) => (e.kind === 'llm' ? e.call.contextTokens : undefined));
  const maxValue = Math.max(1, ...totals.filter((v): v is number => v !== undefined && v > 0));
  let maxIndex = -1;
  let maxSeen = -Infinity;
  events.forEach((event, i) => {
    if (event.kind !== 'llm') return;
    const total = event.call.contextTokens;
    if (total === undefined || total <= 0) return;
    let y = layout.bottom;
    for (const segment of contextSegments(event.call)) {
      const h = Math.max(0.75, (segment.value / maxValue) * layout.height);
      const rect = svgEl('rect', { x: colX(i), y: y - h, width: TC_BAR_WIDTH, height: h, fill: segment.color });
      laneLayer.appendChild(rect);
      y -= h;
    }
    if (total > maxSeen) {
      maxSeen = total;
      maxIndex = i;
    }
  });
  if (maxIndex >= 0) {
    const cx = colX(maxIndex) + TC_BAR_WIDTH / 2;
    const barTop = layout.bottom - (maxSeen / maxValue) * layout.height;
    laneLayer.appendChild(laneValueLabel(cx, barTop, layout.top, formatTokensCompact(maxSeen), TOKEN_SERIES[0].color));
  }
}

function unavailableLaneNote(laneLayer: SVGGElement, captionY: number, caption: string, reason: string): void {
  const el = svgEl('text', { x: TC_M_LEFT, y: captionY, class: 'chart-caption', fill: TEXT_MUTED });
  el.textContent = `${caption} — unavailable (${reason})`;
  laneLayer.appendChild(el);
}

function fillToolTooltip(
  tooltip: HTMLElement,
  tool: ToolCallInfo,
  toolIndex: number,
  color: string
): void {
  tooltip.textContent = '';
  const header = document.createElement('div');
  header.className = 'tooltip-header';
  header.textContent = `#${toolIndex + 1} ${tool.name}`;
  tooltip.appendChild(header);

  if (tool.inputPreview) tooltip.appendChild(tooltipRow(undefined, false, 'Target', tool.inputPreview));
  tooltip.appendChild(tooltipRow(color, false, 'In', `${formatTokens(tool.inputChars)} chars`));
  tooltip.appendChild(
    tooltipRow(color, false, 'Out', tool.outputChars !== undefined ? `${formatTokens(tool.outputChars)} chars` : 'unavailable')
  );
  tooltip.appendChild(
    tooltipRow(
      color,
      false,
      'Time',
      tool.durationMs !== undefined ? `${tool.durationSource === 'derived' ? '≈ ' : ''}${formatDurationMs(tool.durationMs)}` : 'unavailable'
    )
  );
  if (tool.isError) tooltip.appendChild(tooltipRow(WARN_COLOR, false, 'Error', 'tool returned an error'));
  if (tool.agentId) {
    const bits = [`subagent ${tool.agentId.slice(0, 10)}…`];
    if (tool.subagentModel) bits.push(shortModelName(tool.subagentModel));
    if (tool.subagentTokens !== undefined) bits.push(`${formatTokensCompact(tool.subagentTokens)} tokens`);
    if (tool.subagentCostUsd !== undefined) bits.push(formatUsd(tool.subagentCostUsd));
    tooltip.appendChild(tooltipRow(undefined, false, 'Delegated', bits.join(' · ')));
  }
}

function fillLlmTooltip(tooltip: HTMLElement, call: LlmCallInfo, llmIndex: number): void {
  tooltip.textContent = '';
  const header = document.createElement('div');
  header.className = 'tooltip-header';
  header.textContent = `LLM call L${llmIndex + 1}`;
  if (call.model) {
    const modelEl = document.createElement('span');
    modelEl.className = 'tooltip-model';
    modelEl.textContent = shortModelName(call.model);
    header.appendChild(modelEl);
  }
  tooltip.appendChild(header);

  if (call.contextTokens !== undefined) {
    tooltip.appendChild(tooltipRow(undefined, false, 'Context', `${formatTokens(call.contextTokens)} tokens`));
    for (const segment of contextSegments(call)) {
      tooltip.appendChild(tooltipRow(segment.color, false, segment.label, formatTokens(segment.value)));
    }
  } else {
    tooltip.appendChild(tooltipRow(undefined, false, 'Usage', 'unavailable in this log'));
  }
  if (call.outputTokens !== undefined) {
    tooltip.appendChild(tooltipRow(TOKEN_SERIES[3].color, false, 'Output', `${formatTokens(call.outputTokens)} tokens`));
  }
  if (call.reasoningOutputTokens !== undefined && call.reasoningOutputTokens > 0) {
    tooltip.appendChild(tooltipRow(undefined, false, 'Reasoning', `${formatTokens(call.reasoningOutputTokens)} tokens`));
  }
  if (call.thinkingTokens !== undefined && call.thinkingTokens > 0) {
    tooltip.appendChild(tooltipRow(undefined, false, 'Thinking', `${formatTokens(call.thinkingTokens)} tokens`));
  }
  const span = llmCallSpanMs(call);
  if (span !== undefined) tooltip.appendChild(tooltipRow(LLM_CALLS_COLOR, false, 'Time', `≈ ${formatDurationMs(span)}`));
  if (call.costUsd !== undefined) tooltip.appendChild(tooltipRow(COST_COLOR, false, 'Cost (est.)', formatUsd(call.costUsd)));
  if (call.stopReason) tooltip.appendChild(tooltipRow(undefined, false, 'Stop', call.stopReason.replace(/_/g, ' ')));
}

/**
 * The "Prompt timeline" section body: the interleaved event-sequence chart
 * (plans/2026-07/07/call-details Concept, OP-201/OP-202/OP-203). Hand-built
 * SVG like the sibling charts. Clicking a column selects that call for the
 * Call detail section below.
 */
export function renderPromptTimeline(
  container: HTMLElement,
  request: PromptRequest,
  selected: TimelineSelection | undefined,
  onSelect: (selection: TimelineSelection) => void
): void {
  container.innerHTML = '';
  const events = timelineEvents(request);

  if (events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No LLM or tool calls recorded for this prompt.';
    container.appendChild(empty);
    return;
  }

  const tools = request.tools ?? [];
  const colors = categoryColorMap(tools.map((t) => t.name));
  const colorFor = (tool: ToolCallInfo): string => colors.get(tool.name) ?? COST_COLOR;
  const hasErrors = tools.some((t) => t.isError);
  const hasLlm = events.some((e) => e.kind === 'llm');
  const hasContext = events.some((e) => e.kind === 'llm' && e.call.contextTokens !== undefined);
  const hasIn = tools.length > 0;
  const hasOut = tools.some((t) => t.outputChars !== undefined);
  const timeBars: LaneBar[] = events.map((event) => {
    if (event.kind === 'tool') return { value: event.tool.durationMs, color: colorFor(event.tool) };
    return { value: llmCallSpanMs(event.call), color: LLM_CALLS_COLOR };
  });
  const hasTime = timeBars.some((b) => b.value !== undefined);

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  if (hasLlm) legend.appendChild(legendItem(LLM_CALLS_COLOR, 'LLM call', 'glyph', '◆'));
  if (hasContext) {
    legend.appendChild(legendItem(TOKEN_SERIES[0].color, 'Cache read'));
    legend.appendChild(legendItem(TOKEN_SERIES[1].color, 'Cache write'));
    legend.appendChild(legendItem(TOKEN_SERIES[2].color, 'Fresh context'));
  }
  for (const [name, color] of colors) legend.appendChild(legendItem(color, name));
  if (hasErrors) legend.appendChild(legendItem(WARN_COLOR, 'Error', 'glyph'));
  wrapper.appendChild(legend);

  const scroll = document.createElement('div');
  scroll.className = 'chart-scroll';
  wrapper.appendChild(scroll);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.display = 'none';
  wrapper.appendChild(tooltip);

  const n = events.length;
  const colX = (i: number): number => TC_M_LEFT + TC_BAR_GAP + i * (TC_BAR_WIDTH + TC_BAR_GAP);
  const width = Math.max(colX(n - 1) + TC_BAR_WIDTH + TC_BAR_GAP + TC_M_RIGHT, TC_MIN_WIDTH);
  const plotRight = width - TC_M_RIGHT;

  // marker row (LLM ◆ / error ▲) sits above the first lane
  const markerY = 16;
  const firstLaneCaptionY = markerY + 12;
  const contextLayout = hasLlm ? toolLaneLayout(firstLaneCaptionY, firstLaneCaptionY + 10, hasContext) : undefined;
  const afterContext = contextLayout ? contextLayout.bottom : firstLaneCaptionY - 24 + 10;
  const inLayout = toolLaneLayout(afterContext + 24, afterContext + 24 + 8, hasIn);
  const outLayout = toolLaneLayout(inLayout.bottom + 24, inLayout.bottom + 24 + 8, hasOut);
  const timeLayout = toolLaneLayout(outLayout.bottom + 24, outLayout.bottom + 24 + 8, hasTime);
  const plotBottom = timeLayout.bottom;
  const xLabelY = plotBottom + 15;
  const chartHeight = xLabelY + 8;

  const svg = svgEl('svg', {
    width,
    height: chartHeight,
    viewBox: `0 0 ${width} ${chartHeight}`,
    role: 'img',
    'aria-label':
      'Prompt timeline: LLM calls and tool calls in sequence, with context tokens, in/out chars, and time lanes' +
      (hasContext ? '' : hasLlm ? ', per-call usage unavailable for this provider' : '') +
      (hasTime ? '' : ', time unavailable for this provider')
  });
  scroll.appendChild(svg);

  // selected-column highlight behind the lanes, matching the thread chart's treatment
  if (selected) {
    const selectedIndex = events.findIndex(
      (e) => (e.kind === 'tool' && selected.kind === 'tool' && e.toolIndex === selected.index) ||
        (e.kind === 'llm' && selected.kind === 'llm' && e.llmIndex === selected.index)
    );
    if (selectedIndex >= 0) {
      svg.appendChild(
        svgEl('rect', {
          x: colX(selectedIndex) - TC_BAR_GAP / 2,
          y: markerY - 12,
          width: TC_BAR_WIDTH + TC_BAR_GAP,
          height: plotBottom - (markerY - 12),
          rx: 3,
          class: 'overview-selected'
        })
      );
    }
  }

  const laneLayer = svgEl('g');
  svg.appendChild(laneLayer);

  if (contextLayout) {
    if (hasContext) {
      renderContextLane(laneLayer, events, colX, plotRight, contextLayout);
    } else {
      unavailableLaneNote(laneLayer, contextLayout.captionY, 'CONTEXT (tokens)', 'no per-call usage in this log');
    }
  }

  const inBars: LaneBar[] = events.map((e) => (e.kind === 'tool' ? { value: e.tool.inputChars, color: colorFor(e.tool) } : { color: '' }));
  renderEventLane(laneLayer, colX, plotRight, inLayout, 'IN (chars)', inBars, formatTokensCompact);

  if (hasOut) {
    const outBars: LaneBar[] = events.map((e) =>
      e.kind === 'tool' ? { value: e.tool.outputChars, color: colorFor(e.tool) } : { color: '' }
    );
    renderEventLane(laneLayer, colX, plotRight, outLayout, 'OUT (chars)', outBars, formatTokensCompact);
  } else {
    unavailableLaneNote(laneLayer, outLayout.captionY, 'OUT (chars)', 'no result recorded');
  }

  if (hasTime) {
    renderEventLane(laneLayer, colX, plotRight, timeLayout, 'TIME', timeBars, formatDurationMs);
  } else {
    unavailableLaneNote(laneLayer, timeLayout.captionY, 'TIME', 'no per-call duration in this log');
  }

  // marker row: ◆ on LLM columns, ▲ on errored tool columns (reserved warn color)
  events.forEach((event, i) => {
    if (event.kind === 'llm') {
      const marker = svgEl('text', {
        x: colX(i) + TC_BAR_WIDTH / 2,
        y: markerY,
        'text-anchor': 'middle',
        class: 'chart-warn-marker',
        fill: LLM_CALLS_COLOR
      });
      marker.textContent = '◆';
      laneLayer.appendChild(marker);
    } else if (event.tool.isError) {
      const marker = svgEl('text', {
        x: colX(i) + TC_BAR_WIDTH / 2,
        y: markerY,
        'text-anchor': 'middle',
        class: 'chart-warn-marker',
        fill: WARN_COLOR
      });
      marker.textContent = '▲';
      laneLayer.appendChild(marker);
    }
  });

  // ---- tooltip plumbing ----
  const positionTooltip = (clientX: number, clientY: number): void => {
    tooltip.style.display = 'block';
    const rect = wrapper.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top - 10;
    if (x + tooltip.offsetWidth > rect.width - 4) x = clientX - rect.left - tooltip.offsetWidth - 14;
    if (x < 4) x = 4;
    if (y + tooltip.offsetHeight > rect.height - 4) y = rect.height - tooltip.offsetHeight - 4;
    if (y < 4) y = 4;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  const hideTooltip = (): void => {
    tooltip.style.display = 'none';
  };
  const fillTooltip = (index: number): void => {
    const event = events[index];
    if (event.kind === 'tool') fillToolTooltip(tooltip, event.tool, event.toolIndex, colorFor(event.tool));
    else fillLlmTooltip(tooltip, event.call, event.llmIndex);
  };

  // ---- one hover/focus/click target per column --------------------------------
  events.forEach((event, index) => {
    const x = colX(index);
    const group = svgEl('g', { class: 'bar-group', tabindex: 0, role: 'button' });
    group.setAttribute(
      'aria-label',
      event.kind === 'tool'
        ? `Tool call ${event.toolIndex + 1}: ${event.tool.name}, in ${formatTokens(event.tool.inputChars)} chars, ` +
            `out ${event.tool.outputChars !== undefined ? `${formatTokens(event.tool.outputChars)} chars` : 'unavailable'}, ` +
            `time ${event.tool.durationMs !== undefined ? formatDurationMs(event.tool.durationMs) : 'unavailable'}` +
            (event.tool.isError ? ', error' : '') +
            '. Activate to inspect.'
        : `LLM call ${event.llmIndex + 1}` +
            (event.call.model ? `, ${shortModelName(event.call.model)}` : '') +
            (event.call.contextTokens !== undefined
              ? `, context ${formatTokens(event.call.contextTokens)} tokens`
              : ', usage unavailable') +
            '. Activate to inspect.'
    );

    const hit = svgEl('rect', {
      class: 'hit',
      x: x - TC_BAR_GAP / 2,
      y: markerY - 12,
      width: TC_BAR_WIDTH + TC_BAR_GAP,
      height: plotBottom - (markerY - 12),
      rx: 2,
      fill: 'transparent'
    });
    group.appendChild(hit);

    const select = (): void =>
      onSelect(event.kind === 'tool' ? { kind: 'tool', index: event.toolIndex } : { kind: 'llm', index: event.llmIndex });
    group.addEventListener('click', select);
    group.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select();
      }
    });
    group.addEventListener('pointermove', (ev: PointerEvent) => {
      fillTooltip(index);
      positionTooltip(ev.clientX, ev.clientY);
    });
    group.addEventListener('pointerleave', hideTooltip);
    group.addEventListener('focus', () => {
      fillTooltip(index);
      const hitRect = hit.getBoundingClientRect();
      positionTooltip(hitRect.right, hitRect.top + 20);
    });
    group.addEventListener('blur', hideTooltip);

    svg.appendChild(group);
  });

  // ---- x labels: '#k' tool columns (matching the Tools table '#'), 'Lk' LLM columns ----
  const labelStep = Math.max(1, Math.ceil(n / 25));
  events.forEach((event, index) => {
    if (index % labelStep !== 0 && index !== n - 1) return;
    const label = svgEl('text', {
      x: colX(index) + TC_BAR_WIDTH / 2,
      y: xLabelY,
      'text-anchor': 'middle',
      class: 'chart-tick',
      fill: event.kind === 'llm' ? LLM_CALLS_COLOR : TEXT_MUTED
    });
    label.textContent = event.kind === 'llm' ? `L${event.llmIndex + 1}` : `#${event.toolIndex + 1}`;
    svg.appendChild(label);
  });

  container.appendChild(wrapper);
}

/** Rect with only the right corners rounded: data-end rounded, baseline square. */
function rightRoundedRect(x: number, y: number, w: number, h: number, r: number): SVGPathElement {
  const radius = Math.min(r, h / 2, w / 2);
  const d =
    `M ${x} ${y} ` +
    `L ${x + w - radius} ${y} ` +
    `Q ${x + w} ${y} ${x + w} ${y + radius} ` +
    `L ${x + w} ${y + h - radius} ` +
    `Q ${x + w} ${y + h} ${x + w - radius} ${y + h} ` +
    `L ${x} ${y + h} Z`;
  return svgEl('path', { d });
}

const OV_LABEL_W = 168;
const OV_ROW_H = 26;
const OV_BAR_H = 14;
const OV_TOP = 10;
const OV_WIDTH = 700;
const OV_RIGHT = 54;
export const OVERVIEW_CHART_MAX_ROWS = 12;

function truncateLabel(text: string, max = 24): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Horizontal stacked token bars, one row per conversation, in the caller's
 * (sorted, filtered) order. Same series identities and stack order as the
 * thread chart; tokens only — cost stays in the tooltip and the table so the
 * plot never mixes units. Clicking a row opens that conversation.
 */
export function renderOverviewChart(
  container: HTMLElement,
  items: ConversationListItem[],
  onSelect: (id: string) => void,
  selectedConversationId?: string
): void {
  container.innerHTML = '';
  if (items.length === 0) return;

  const shown = items.slice(0, OVERVIEW_CHART_MAX_ROWS);

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  wrapper.appendChild(legendEl(false));

  const scroll = document.createElement('div');
  scroll.className = 'chart-scroll';
  wrapper.appendChild(scroll);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.display = 'none';
  wrapper.appendChild(tooltip);

  const plotLeft = OV_LABEL_W;
  const plotRight = OV_WIDTH - OV_RIGHT;
  const plotW = plotRight - plotLeft;

  const maxTokens = Math.max(1, ...shown.map((item) => item.totalTokens));
  const step = niceStep(maxTokens / 4);
  const tickCount = Math.ceil(maxTokens / step);
  const scaleMax = tickCount * step;
  const xFor = (tokens: number): number => plotLeft + (tokens / scaleMax) * plotW;

  const axisY = OV_TOP + shown.length * OV_ROW_H;
  const height = axisY + 22;

  const svg = svgEl('svg', {
    width: OV_WIDTH,
    height,
    viewBox: `0 0 ${OV_WIDTH} ${height}`,
    role: 'img',
    'aria-label': 'Token totals per conversation, stacked by token kind. Each row opens its conversation.'
  });
  scroll.appendChild(svg);

  // no in-chart caption: the section heading bar already names this chart

  // vertical gridlines + bottom ticks
  for (let t = 0; t <= tickCount; t++) {
    const x = xFor(t * step);
    svg.appendChild(svgEl('line', { x1: x, y1: OV_TOP - 4, x2: x, y2: axisY, stroke: GRID, 'stroke-width': 1 }));
    const tick = svgEl('text', { x, y: axisY + 14, 'text-anchor': 'middle', class: 'chart-tick', fill: TEXT_MUTED });
    tick.textContent = formatTokensCompact(t * step);
    svg.appendChild(tick);
  }

  const fillTooltip = (item: ConversationListItem): void => {
    tooltip.textContent = '';
    const header = document.createElement('div');
    header.className = 'tooltip-header';
    header.textContent = item.title;
    tooltip.appendChild(header);
    for (const series of TOKEN_SERIES) {
      tooltip.appendChild(tooltipRow(series.color, false, series.label, formatTokens(item.totalUsage[series.key])));
    }
    tooltip.appendChild(tooltipRow(undefined, false, 'Total', formatTokens(item.totalTokens)));
    tooltip.appendChild(tooltipRow(undefined, false, 'Prompts', String(item.requestCount)));
    if (item.totalCostUsd !== undefined) {
      tooltip.appendChild(tooltipRow(COST_COLOR, true, 'Cost (estimated)', formatUsd(item.totalCostUsd)));
    }
  };

  const positionTooltip = (clientX: number, clientY: number): void => {
    tooltip.style.display = 'block';
    const rect = wrapper.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top - 10;
    if (x + tooltip.offsetWidth > rect.width - 4) x = clientX - rect.left - tooltip.offsetWidth - 14;
    if (x < 4) x = 4;
    if (y + tooltip.offsetHeight > rect.height - 4) y = rect.height - tooltip.offsetHeight - 4;
    if (y < 4) y = 4;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  const hideTooltip = (): void => {
    tooltip.style.display = 'none';
  };

  const maxIndex = shown.reduce((best, item, i) => (item.totalTokens > shown[best].totalTokens ? i : best), 0);

  shown.forEach((item, i) => {
    const rowTop = OV_TOP + i * OV_ROW_H;
    const barY = rowTop + (OV_ROW_H - OV_BAR_H) / 2;
    const isSelected = item.id === selectedConversationId;
    const group = svgEl('g', { class: `bar-group${isSelected ? ' selected' : ''}`, tabindex: 0, role: 'button' });
    group.setAttribute(
      'aria-label',
      `${item.title}: ${formatTokens(item.totalTokens)} tokens, ${item.requestCount} prompts,` +
        ` ${item.totalCostUsd !== undefined ? `estimated ${formatUsd(item.totalCostUsd)}` : 'cost unavailable'}. Press Enter to open.`
    );

    if (isSelected) {
      group.appendChild(
        svgEl('rect', {
          class: 'overview-selected',
          x: 2,
          y: rowTop + 1,
          width: OV_WIDTH - 4,
          height: OV_ROW_H - 2,
          rx: 4
        })
      );
    }

    const hit = svgEl('rect', {
      class: 'hit',
      x: 2,
      y: rowTop + 1,
      width: OV_WIDTH - 4,
      height: OV_ROW_H - 2,
      rx: 3,
      fill: 'transparent'
    });
    group.appendChild(hit);

    const label = svgEl('text', {
      x: plotLeft - 8,
      y: rowTop + OV_ROW_H / 2 + 3,
      'text-anchor': 'end',
      class: 'chart-tick',
      fill: TEXT
    });
    label.textContent = truncateLabel(item.title);
    group.appendChild(label);

    // stacked segments left→right, 2px surface gap between fills, data-end rounded
    const nonZero = TOKEN_SERIES.filter((s) => item.totalUsage[s.key] > 0);
    const endKey = nonZero.length > 0 ? nonZero[nonZero.length - 1].key : undefined;
    let cursor = plotLeft;
    let isFirstSegment = true;
    for (const series of TOKEN_SERIES) {
      const value = item.totalUsage[series.key];
      if (value <= 0) continue;
      const w = (value / scaleMax) * plotW;
      // 2px surface gap carved from the left of every non-baseline segment
      const inset = isFirstSegment || w < 2 * SEGMENT_GAP ? 0 : SEGMENT_GAP;
      const visibleW = Math.max(w - inset, Math.min(w, 1));
      if (visibleW >= 0.5) {
        const mark =
          series.key === endKey
            ? rightRoundedRect(cursor + w - visibleW, barY, visibleW, OV_BAR_H, 4)
            : svgEl('rect', { x: cursor + w - visibleW, y: barY, width: visibleW, height: OV_BAR_H });
        mark.setAttribute('class', 'seg');
        mark.setAttribute('fill', series.color);
        group.appendChild(mark);
      }
      cursor += w;
      isFirstSegment = false;
    }
    const totalW = cursor - plotLeft;

    if (i === maxIndex && totalW > 0) {
      const valueLabel = svgEl('text', {
        x: Math.min(cursor + 6, OV_WIDTH - 4),
        y: rowTop + OV_ROW_H / 2 + 3,
        class: 'chart-value-label',
        fill: TEXT
      });
      valueLabel.textContent = formatTokensCompact(item.totalTokens);
      group.appendChild(valueLabel);
    }

    group.addEventListener('pointermove', (ev: PointerEvent) => {
      fillTooltip(item);
      positionTooltip(ev.clientX, ev.clientY);
    });
    group.addEventListener('pointerleave', hideTooltip);
    group.addEventListener('click', () => onSelect(item.id));
    group.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onSelect(item.id);
      }
    });
    group.addEventListener('focus', () => {
      fillTooltip(item);
      const hitRect = hit.getBoundingClientRect();
      positionTooltip(hitRect.left + OV_LABEL_W + 40, hitRect.top + 10);
    });
    group.addEventListener('blur', hideTooltip);

    svg.appendChild(group);
  });

  container.appendChild(wrapper);

  if (items.length > shown.length) {
    const note = document.createElement('div');
    note.className = 'chart-hint';
    note.textContent = `Showing ${shown.length} of ${items.length} conversations — the table below has all of them.`;
    container.appendChild(note);
  }
}

// ---- Prompt cost map (plans/2026-07/19/prompt-cost-map, Option A) -----------------
// Start/end context scatter: x = context tokens at the prompt's first LLM
// call, y = at its last, bubble AREA = USD cost, bubble color = LLM-call
// count on a min→max gradient scaled to the visible scope. Hand-built SVG
// like every sibling chart (DD-018); axes share one token scale (same unit),
// so this is a deliberate multidimensional scatter, not a dual-axis overlay
// (ui-design.md).

const CM_WIDTH = 660;
const CM_M_LEFT = 56;
const CM_M_RIGHT = 20;
const CM_CAPTION_Y = 12;
const CM_PLOT_TOP = 22;
const CM_PLOT_H = 360;
const CM_PLOT_BOTTOM = CM_PLOT_TOP + CM_PLOT_H;
const CM_X_LABEL_Y = CM_PLOT_BOTTOM + 16;
const CM_X_CAPTION_Y = CM_PLOT_BOTTOM + 32;
const CM_HEIGHT = CM_X_CAPTION_Y + 8;
const CM_PLOT_RIGHT = CM_WIDTH - CM_M_RIGHT;
const CM_PLOT_W = CM_PLOT_RIGHT - CM_M_LEFT;

/** Iteration gradient endpoints, resolved from the live theme at render time. */
const ITERATIONS_LOW_COLOR = 'var(--vscode-charts-blue)';
const ITERATIONS_HIGH_COLOR = 'var(--vscode-charts-red)';

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

export interface CostMapSelection {
  conversationId?: string;
  promptIndex: number;
}

export interface CostMapChartArgs {
  points: CostMapPoint[];
  selected?: CostMapSelection;
  onSelect: (point: CostMapPoint) => void;
  /** Period mode: points span conversations, so tooltips name the conversation. */
  showConversation?: boolean;
}

function costMapPointLabel(point: CostMapPoint, overlap: number, showConversation: boolean): string {
  const delta = `${point.contextDelta >= 0 ? '+' : '−'}${formatTokens(Math.abs(point.contextDelta))}`;
  return (
    `Prompt ${point.promptIndex + 1}` +
    (showConversation && point.conversationTitle ? ` of ${point.conversationTitle}` : '') +
    `: start context ${formatTokens(point.startContext)} tokens, end ${formatTokens(point.endContext)} tokens, ` +
    `delta ${delta}, ${point.iterations} LLM call${point.iterations === 1 ? '' : 's'}, ` +
    `${point.toolCalls} tool call${point.toolCalls === 1 ? '' : 's'}, cost ${formatUsd(point.costUsd)} (${point.costSource})` +
    (overlap > 1 ? `, overlaps ${overlap - 1} other prompt${overlap === 2 ? '' : 's'} at this position` : '') +
    '. Activate to select this prompt.'
  );
}

/** Resting state of the side panel: nothing hovered and nothing pinned yet. */
function costMapDetailPlaceholder(panel: HTMLElement): void {
  panel.textContent = '';
  panel.classList.add('is-empty');
  const msg = document.createElement('div');
  msg.className = 'costmap-detail-empty';
  msg.textContent = 'Hover a bubble to preview it, or click one to pin its details here.';
  panel.appendChild(msg);
}

/** A headline stat block: big value over a muted label; `valueColor` tints the value (else foreground). */
function costMapHero(value: string, label: string, valueColor: string | undefined): HTMLElement {
  const hero = document.createElement('div');
  hero.className = 'costmap-detail-hero';
  const valueEl = document.createElement('div');
  valueEl.className = 'costmap-detail-hero-value';
  if (valueColor) valueEl.style.color = valueColor;
  valueEl.textContent = value;
  const labelEl = document.createElement('div');
  labelEl.className = 'costmap-detail-hero-label';
  labelEl.textContent = label;
  hero.append(valueEl, labelEl);
  return hero;
}

/** One [swatch · label · value] line; `display:contents` lets it inherit the panel's 3-col grid. */
function costMapDetailRow(keyColor: string | undefined, label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'costmap-detail-row';
  const key = document.createElement('span');
  key.className = 'costmap-detail-key';
  key.style.background = keyColor ?? 'transparent';
  const labelEl = document.createElement('span');
  labelEl.className = 'costmap-detail-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'costmap-detail-value';
  valueEl.textContent = value;
  row.append(key, labelEl, valueEl);
  return row;
}

/**
 * The persistent side panel for one prompt: cost leads as a prominent "hero"
 * value (the headline of this map), then everything else in a plain aligned
 * table. `pinned` flags the currently selected prompt so a hover-preview reads
 * differently from a click-pinned selection.
 */
function fillCostMapDetail(
  panel: HTMLElement,
  point: CostMapPoint,
  overlap: number,
  color: string,
  showConversation: boolean,
  pinned: boolean
): void {
  panel.textContent = '';
  panel.classList.remove('is-empty');

  const head = document.createElement('div');
  head.className = 'costmap-detail-head';
  const title = document.createElement('span');
  title.className = 'costmap-detail-title';
  title.textContent = `Prompt #${point.promptIndex + 1}`;
  head.appendChild(title);
  if (pinned) {
    const badge = document.createElement('span');
    badge.className = 'costmap-detail-pin';
    badge.textContent = 'pinned';
    head.appendChild(badge);
  }
  panel.appendChild(head);

  const models = point.modelsUsed?.length ? point.modelsUsed : point.model ? [point.model] : [];
  if (models.length > 0) {
    const modelEl = document.createElement('div');
    modelEl.className = 'costmap-detail-model';
    modelEl.textContent = models.map(shortModelName).join(' → ');
    panel.appendChild(modelEl);
  }
  if (showConversation && point.conversationTitle) {
    const conv = document.createElement('div');
    conv.className = 'costmap-detail-model';
    conv.textContent = point.conversationTitle;
    panel.appendChild(conv);
  }

  // two headline stats side by side, set apart from the table so they read
  // first: cost (encoded as bubble AREA — shown neutral so it doesn't borrow
  // the LLM-count gradient's hue) and LLM calls (encoded as bubble COLOR —
  // shown in that same per-point gradient color).
  const heroes = document.createElement('div');
  heroes.className = 'costmap-detail-heroes';
  heroes.appendChild(costMapHero(formatUsd(point.costUsd), `Cost (${point.costSource})`, undefined));
  heroes.appendChild(
    costMapHero(String(point.iterations), point.iterations === 1 ? 'LLM call' : 'LLM calls', color)
  );
  panel.appendChild(heroes);

  // everything else, in a plain aligned table
  const table = document.createElement('div');
  table.className = 'costmap-detail-table';
  table.appendChild(costMapDetailRow(undefined, 'Start context', `${formatTokens(point.startContext)} tok`));
  table.appendChild(costMapDetailRow(undefined, 'End context', `${formatTokens(point.endContext)} tok`));
  table.appendChild(
    costMapDetailRow(
      undefined,
      'Context delta',
      `${point.contextDelta >= 0 ? '+' : '−'}${formatTokens(Math.abs(point.contextDelta))} tok`
    )
  );
  table.appendChild(costMapDetailRow(TOOL_CALLS_COLOR, 'Tool calls', String(point.toolCalls)));
  table.appendChild(costMapDetailRow(undefined, 'Context work', `${formatTokens(point.contextWork)} tok`));
  for (const series of TOKEN_SERIES) {
    const value = point.usage[series.key];
    if (value > 0) table.appendChild(costMapDetailRow(series.color, series.label, formatTokens(value)));
  }
  if (overlap > 1) {
    table.appendChild(costMapDetailRow(undefined, 'Overlap', `${overlap} prompts at this position`));
  }
  panel.appendChild(table);
}

/**
 * Legend for the cost map: example bubble sizes (area = cost) and the
 * iteration gradient with labeled min/max endpoints — or a single-value
 * swatch when every visible prompt has the same count, rather than a false
 * range (OP-004). Identity is never color-alone: exact counts stay in
 * tooltips, focus text, and aria labels.
 */
function costMapLegend(
  maxCost: number,
  scale: { min: number; max: number; single: boolean },
  lowRgb: [number, number, number],
  highRgb: [number, number, number]
): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'chart-legend';

  const sizeItem = document.createElement('span');
  sizeItem.className = 'legend-item';
  const rSmall = costBubbleRadius(maxCost / 4, maxCost);
  const rLarge = costBubbleRadius(maxCost, maxCost);
  const svg = svgEl('svg', { width: rLarge * 2 + rSmall * 2 + 8, height: rLarge * 2 + 2, role: 'presentation' });
  const midColor = mixRgb(lowRgb, highRgb, 0.5);
  svg.appendChild(svgEl('circle', { cx: rSmall + 1, cy: rLarge + 1, r: rSmall, fill: midColor, 'fill-opacity': 0.6, stroke: SURFACE }));
  svg.appendChild(
    svgEl('circle', { cx: rSmall * 2 + rLarge + 5, cy: rLarge + 1, r: rLarge, fill: midColor, 'fill-opacity': 0.6, stroke: SURFACE })
  );
  sizeItem.appendChild(svg);
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = `area = cost (${formatUsd(maxCost / 4)} → ${formatUsd(maxCost)})`;
  sizeItem.appendChild(sizeLabel);
  legend.appendChild(sizeItem);

  const iterItem = document.createElement('span');
  iterItem.className = 'legend-item';
  if (scale.single) {
    const key = document.createElement('span');
    key.className = 'legend-swatch';
    key.style.background = mixRgb(lowRgb, highRgb, 0.5);
    iterItem.appendChild(key);
    const label = document.createElement('span');
    label.textContent = `${scale.min} LLM call${scale.min === 1 ? '' : 's'} (all prompts)`;
    iterItem.appendChild(label);
  } else {
    const low = document.createElement('span');
    low.textContent = String(scale.min);
    const bar = document.createElement('span');
    bar.className = 'gradient-bar';
    bar.style.background = `linear-gradient(90deg, ${mixRgb(lowRgb, highRgb, 0)}, ${mixRgb(lowRgb, highRgb, 1)})`;
    const high = document.createElement('span');
    high.textContent = `${scale.max} LLM calls`;
    iterItem.append(low, bar, high);
  }
  legend.appendChild(iterItem);

  const selItem = document.createElement('span');
  selItem.className = 'legend-item';
  const ring = document.createElement('span');
  ring.className = 'legend-swatch';
  ring.style.background = 'transparent';
  ring.style.border = '2px solid var(--vscode-focusBorder)';
  ring.style.borderRadius = '50%';
  selItem.appendChild(ring);
  const selLabel = document.createElement('span');
  selLabel.textContent = 'selected prompt';
  selItem.appendChild(selLabel);
  legend.appendChild(selItem);

  return legend;
}

export function renderCostMapChart(container: HTMLElement, args: CostMapChartArgs): void {
  const { points, selected, onSelect } = args;
  const showConversation = !!args.showConversation;
  if (points.length === 0) return;

  const scale = iterationScale(points.map((p) => p.iterations));
  const lowRgb = resolveRgb(ITERATIONS_LOW_COLOR) ?? [86, 156, 214];
  const highRgb = resolveRgb(ITERATIONS_HIGH_COLOR) ?? [209, 105, 105];
  const colorFor = (point: CostMapPoint): string => mixRgb(lowRgb, highRgb, iterationT(point.iterations, scale));

  const maxCost = Math.max(...points.map((p) => p.costUsd));

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  wrapper.appendChild(costMapLegend(maxCost, scale, lowRgb, highRgb));

  // Chart on the left, a persistent detail panel on the right (no floating
  // popover): hover previews a bubble, click pins it there until another is
  // hovered/clicked. Wraps the panel below the chart when the section is narrow.
  const body = document.createElement('div');
  body.className = 'costmap-body';
  wrapper.appendChild(body);

  const scroll = document.createElement('div');
  scroll.className = 'chart-scroll';
  body.appendChild(scroll);

  const detail = document.createElement('div');
  detail.className = 'costmap-detail';
  body.appendChild(detail);

  // Both axes carry the same unit (context tokens), so they share one scale:
  // 0 → the nice ceiling of the largest start/end value on screen. The
  // end = start diagonal is then geometrically honest.
  const maxToken = Math.max(1, ...points.map((p) => Math.max(p.startContext, p.endContext)));
  const step = niceStep(maxToken / 4);
  const tickCount = Math.ceil(maxToken / step);
  const scaleMax = tickCount * step;
  const xFor = (tokens: number): number => CM_M_LEFT + (tokens / scaleMax) * CM_PLOT_W;
  const yFor = (tokens: number): number => CM_PLOT_BOTTOM - (tokens / scaleMax) * CM_PLOT_H;

  const svg = svgEl('svg', {
    width: CM_WIDTH,
    height: CM_HEIGHT,
    viewBox: `0 0 ${CM_WIDTH} ${CM_HEIGHT}`,
    role: 'img',
    'aria-label':
      'Prompt cost map: context tokens at each prompt’s first LLM call (x) versus its last (y); ' +
      'bubble area is USD cost, bubble color is LLM-call count. Prompts on one diagonal grew their context by the same amount.'
  });
  scroll.appendChild(svg);

  const captionY = svgEl('text', { x: CM_M_LEFT, y: CM_CAPTION_Y, class: 'chart-caption', fill: TEXT_MUTED });
  captionY.textContent = 'END CONTEXT (tokens)';
  svg.appendChild(captionY);
  const captionX = svgEl('text', { x: CM_PLOT_RIGHT, y: CM_X_CAPTION_Y, 'text-anchor': 'end', class: 'chart-caption', fill: TEXT_MUTED });
  captionX.textContent = 'START CONTEXT (tokens)';
  svg.appendChild(captionX);

  // gridlines + ticks on both axes (compact labels; exact values live in tooltips)
  for (let t = 0; t <= tickCount; t++) {
    const value = t * step;
    const y = yFor(value);
    svg.appendChild(svgEl('line', { x1: CM_M_LEFT, y1: y, x2: CM_PLOT_RIGHT, y2: y, stroke: GRID, 'stroke-width': 1 }));
    const yTick = svgEl('text', { x: CM_M_LEFT - 8, y: y + 3, 'text-anchor': 'end', class: 'chart-tick', fill: TEXT_MUTED });
    yTick.textContent = formatTokensCompact(value);
    svg.appendChild(yTick);
    const x = xFor(value);
    svg.appendChild(svgEl('line', { x1: x, y1: CM_PLOT_TOP, x2: x, y2: CM_PLOT_BOTTOM, stroke: GRID, 'stroke-width': 1 }));
    if (t > 0) {
      const xTick = svgEl('text', { x, y: CM_X_LABEL_Y, 'text-anchor': 'middle', class: 'chart-tick', fill: TEXT_MUTED });
      xTick.textContent = formatTokensCompact(value);
      svg.appendChild(xTick);
    }
  }

  // ---- equal-growth guides (DD-005): end = start plus nice positive parallels ----
  const guideLayer = svgEl('g', { style: 'pointer-events:none' });
  guideLayer.appendChild(
    svgEl('line', {
      x1: xFor(0),
      y1: yFor(0),
      x2: xFor(scaleMax),
      y2: yFor(scaleMax),
      stroke: TEXT_MUTED,
      'stroke-width': 1,
      'stroke-dasharray': '5 3'
    })
  );
  const diagLabel = svgEl('text', {
    x: xFor(scaleMax * 0.94),
    y: yFor(scaleMax * 0.94) + 12,
    'text-anchor': 'end',
    class: 'chart-tick',
    fill: TEXT_MUTED
  });
  diagLabel.textContent = 'end = start';
  guideLayer.appendChild(diagLabel);
  // parallels span the whole plotted range (ceiling = scaleMax), not just the
  // deltas data points reach; drawn stronger than the faint gridlines but still
  // below the bubble layer appended later.
  for (const delta of isoGrowthDeltas(points, 3, scaleMax)) {
    if (delta >= scaleMax) continue;
    guideLayer.appendChild(
      svgEl('line', {
        x1: xFor(0),
        y1: yFor(delta),
        x2: xFor(scaleMax - delta),
        y2: yFor(scaleMax),
        stroke: TEXT_MUTED,
        'stroke-opacity': 0.55,
        'stroke-width': 1,
        'stroke-dasharray': '4 4'
      })
    );
    const label = svgEl('text', {
      x: xFor(0) + 4,
      y: yFor(delta) - 4,
      class: 'chart-iso-label',
      fill: TEXT_MUTED
    });
    label.textContent = `+${formatTokensCompact(delta)}`;
    guideLayer.appendChild(label);
  }
  svg.appendChild(guideLayer);

  // ---- bubbles ----
  const positions = points.map((p) => ({ x: xFor(p.startContext), y: yFor(p.endContext) }));
  const offsets = overlapOffsets(positions);
  const placed = points.map((point, i) => ({
    point,
    i,
    cx: positions[i].x + offsets[i].dx,
    cy: positions[i].y + offsets[i].dy,
    r: costBubbleRadius(point.costUsd, maxCost),
    overlap: offsets[i].overlap
  }));

  // fills big-first so small bubbles stay visible; hit targets are separate
  const bubbleLayer = svgEl('g', { style: 'pointer-events:none' });
  for (const b of [...placed].sort((a, z) => z.r - a.r)) {
    bubbleLayer.appendChild(
      svgEl('circle', {
        cx: b.cx,
        cy: b.cy,
        r: b.r,
        fill: colorFor(b.point),
        'fill-opacity': 0.7,
        stroke: SURFACE,
        'stroke-width': 1
      })
    );
  }
  // overlap count next to each cluster (DD-013), drawn once per position
  const labeledClusters = new Set<string>();
  for (const b of placed) {
    if (b.overlap < 2) continue;
    const key = `${Math.round(positions[b.i].x)}|${Math.round(positions[b.i].y)}`;
    if (labeledClusters.has(key)) continue;
    labeledClusters.add(key);
    const label = svgEl('text', {
      x: positions[b.i].x + b.r + 8,
      y: positions[b.i].y - b.r - 2,
      class: 'chart-tick',
      fill: TEXT
    });
    label.textContent = `×${b.overlap}`;
    bubbleLayer.appendChild(label);
  }
  svg.appendChild(bubbleLayer);

  // selection ring: existing outline language, never color-alone (DD-014)
  const selectedPlaced = selected
    ? placed.find(
        (b) => b.point.promptIndex === selected.promptIndex && b.point.conversationId === selected.conversationId
      )
    : undefined;
  if (selectedPlaced) {
    svg.appendChild(
      svgEl('circle', {
        cx: selectedPlaced.cx,
        cy: selectedPlaced.cy,
        r: selectedPlaced.r + 3,
        fill: 'none',
        stroke: 'var(--vscode-focusBorder)',
        'stroke-width': 2,
        style: 'pointer-events:none'
      })
    );
  }

  // ---- side detail panel: preview on hover, pinned selection otherwise ----
  // With no hover, the panel shows the pinned (selected) prompt if there is
  // one, else an invitation. Leaving a bubble reverts to that resting state.
  const showResting = (): void => {
    if (selectedPlaced) {
      fillCostMapDetail(detail, selectedPlaced.point, selectedPlaced.overlap, colorFor(selectedPlaced.point), showConversation, true);
    } else {
      costMapDetailPlaceholder(detail);
    }
  };
  showResting();

  // ---- one focusable hit target per prompt, in prompt order (DD-013) ----
  for (const b of placed) {
    const group = svgEl('g', { class: 'bar-group', tabindex: 0, role: 'button' });
    group.setAttribute('aria-label', costMapPointLabel(b.point, b.overlap, showConversation));
    const hit = svgEl('circle', {
      class: 'hit',
      cx: b.cx,
      cy: b.cy,
      r: Math.max(b.r + 2, 9),
      fill: 'transparent'
    });
    group.appendChild(hit);

    const preview = (): void =>
      fillCostMapDetail(detail, b.point, b.overlap, colorFor(b.point), showConversation, b === selectedPlaced);
    const select = (): void => onSelect(b.point);
    group.addEventListener('click', select);
    group.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select();
      }
    });
    group.addEventListener('pointerenter', preview);
    group.addEventListener('pointerleave', showResting);
    group.addEventListener('focus', preview);
    group.addEventListener('blur', showResting);
    svg.appendChild(group);
  }

  container.appendChild(wrapper);
}

function tooltipRow(keyColor: string | undefined, isLine: boolean, label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tooltip-row';
  const key = document.createElement('span');
  key.className = 'tooltip-key' + (isLine ? ' line' : '');
  if (keyColor) key.style.background = keyColor;
  else key.style.background = 'transparent';
  const labelEl = document.createElement('span');
  labelEl.className = 'tooltip-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'tooltip-value';
  valueEl.textContent = value;
  row.append(key, labelEl, valueEl);
  return row;
}
