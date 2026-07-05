import { ConversationListItem, PromptRequest, UsageTokens } from '../domain/types';
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
 * Stack order (bottom → top). Colors come from the active VS Code theme's
 * chart tokens so the palette follows the user's theme in light and dark.
 * Identity is never color-alone: the legend, tooltips, and the detail
 * breakdown all carry the series names and exact values.
 */
export const TOKEN_SERIES: readonly TokenSeriesMeta[] = [
  { key: 'cacheReadTokens', label: 'Cache read', color: 'var(--vscode-charts-blue)' },
  { key: 'cacheCreationTokens', label: 'Cache write', color: 'var(--vscode-charts-purple)' },
  { key: 'inputTokens', label: 'Input', color: 'var(--vscode-charts-orange)' },
  { key: 'outputTokens', label: 'Output', color: 'var(--vscode-charts-green)' }
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
/** Reserved status color for cache-break markers; ships with a glyph + legend, never color alone. */
const WARN_COLOR = 'var(--vscode-editorWarning-foreground, var(--vscode-charts-orange))';

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

function legendItem(color: string, label: string, kind: 'swatch' | 'line' | 'glyph' = 'swatch'): HTMLElement {
  const item = document.createElement('span');
  item.className = 'legend-item';
  if (kind === 'glyph') {
    const glyph = document.createElement('span');
    glyph.className = 'legend-glyph';
    glyph.style.color = color;
    glyph.textContent = '▲';
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
    empty.textContent = 'No requests in this conversation yet.';
    container.appendChild(empty);
    return;
  }

  const timeline = !!opts?.timeline;
  const hasCost = requests.some((request) => request.cost.usd !== undefined);
  const models = timeline ? modelColorMap(requests) : undefined;
  const hasCacheBreaks = timeline && requests.some((r) => (r.cacheMisses?.length ?? 0) > 0);
  const plotBottom = timeline ? DUR_BOTTOM : COST_BOTTOM;
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
      'Token usage per request with cost per request below, sharing one request axis' +
      (timeline ? ', plus aligned model and wall-time lanes' : '')
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
    header.textContent = `Request #${index + 1}`;
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
        tooltip.appendChild(tooltipRow(undefined, false, 'Tool calls', String(request.toolCallCount)));
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
      `Request ${index + 1}: ` +
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
      const durLabel = svgEl('text', {
        x: cx,
        y: DUR_BOTTOM - (durations[maxDurIndex] / maxDur) * DUR_H - 4,
        'text-anchor': 'middle',
        class: 'chart-value-label',
        fill: TEXT
      });
      durLabel.textContent = formatDurationMs(durations[maxDurIndex]);
      laneLayer.appendChild(durLabel);
    }

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
    hint.textContent = 'Click a bar (or focus it and press Enter) to inspect that request.';
    container.appendChild(hint);
  }
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
  onSelect: (id: string) => void
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
    tooltip.appendChild(tooltipRow(undefined, false, 'Requests', String(item.requestCount)));
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
    const group = svgEl('g', { class: 'bar-group', tabindex: 0, role: 'button' });
    group.setAttribute(
      'aria-label',
      `${item.title}: ${formatTokens(item.totalTokens)} tokens, ${item.requestCount} requests,` +
        ` ${item.totalCostUsd !== undefined ? `estimated ${formatUsd(item.totalCostUsd)}` : 'cost unavailable'}. Press Enter to open.`
    );

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
