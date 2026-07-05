import { PromptRequest, UsageTokens } from '../domain/types';

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
const XLABEL_Y = COST_BOTTOM + 15;
const CHART_HEIGHT = XLABEL_Y + 8;

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

function legendEl(): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  for (const series of TOKEN_SERIES) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = series.color;
    const label = document.createElement('span');
    label.textContent = series.label;
    item.append(swatch, label);
    legend.appendChild(item);
  }
  const costItem = document.createElement('span');
  costItem.className = 'legend-item';
  const line = document.createElement('span');
  line.className = 'legend-line';
  line.style.background = COST_COLOR;
  const costLabel = document.createElement('span');
  costLabel.textContent = 'Cost (USD)';
  costItem.append(line, costLabel);
  legend.appendChild(costItem);
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
  onSelect: (index: number) => void
): void {
  container.innerHTML = '';

  if (requests.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No requests in this conversation yet.';
    container.appendChild(empty);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-wrapper';
  wrapper.appendChild(legendEl());

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

  const costs = requests.map((r) => r.cost.usd);
  const maxCost = Math.max(0.0001, ...costs);
  const maxCostIndex = costs.indexOf(Math.max(...costs));
  const costY = (usd: number): number => COST_BOTTOM - (usd / maxCost) * COST_H;

  const svg = svgEl('svg', {
    width,
    height: CHART_HEIGHT,
    viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
    role: 'img',
    'aria-label': 'Token usage per request with cost per request below, sharing one request axis'
  });
  scroll.appendChild(svg);

  // ---- captions -----------------------------------------------------------
  const captionTokens = svgEl('text', { x: M_LEFT, y: CAPTION_TOKENS_Y, class: 'chart-caption', fill: TEXT_MUTED });
  captionTokens.textContent = 'TOKENS';
  const captionCost = svgEl('text', { x: M_LEFT, y: CAPTION_COST_Y, class: 'chart-caption', fill: TEXT_MUTED });
  captionCost.textContent = 'COST (USD)';
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
    tooltip.appendChild(
      tooltipRow(COST_COLOR, true, `Cost (${request.cost.source})`, `$${request.cost.usd.toFixed(4)}`)
    );
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
        ` tokens, cost $${request.cost.usd.toFixed(4)}. Press Enter for details.`
    );

    // Full-height invisible hit target spanning both plots, wider than the bar.
    const hit = svgEl('rect', {
      class: 'hit',
      x: x - BAR_GAP / 2,
      y: TOKEN_TOP,
      width: BAR_WIDTH + BAR_GAP,
      height: COST_BOTTOM - TOKEN_TOP,
      rx: 3,
      fill: 'transparent'
    });
    group.appendChild(hit);

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
  const costLayer = svgEl('g', { style: 'pointer-events:none' });
  const points = requests.map((r, i) => `${colX(i) + BAR_WIDTH / 2},${costY(r.cost.usd)}`);
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
  // selective direct label: only the most expensive request
  const maxCx = colX(maxCostIndex) + BAR_WIDTH / 2;
  const labelLeft = maxCx > plotRight - 64;
  const costLabel = svgEl('text', {
    x: labelLeft ? maxCx - 9 : maxCx + 9,
    y: costY(costs[maxCostIndex]) + 3,
    'text-anchor': labelLeft ? 'end' : 'start',
    class: 'chart-value-label',
    fill: TEXT
  });
  costLabel.textContent = `$${costs[maxCostIndex].toFixed(2)}`;
  costLayer.appendChild(costLabel);
  svg.appendChild(costLayer);

  // ---- x labels + selection ---------------------------------------------------
  const labelStep = Math.max(1, Math.ceil(n / 25));
  requests.forEach((_, index) => {
    if (index % labelStep !== 0 && index !== n - 1) return;
    const label = svgEl('text', {
      x: colX(index) + BAR_WIDTH / 2,
      y: XLABEL_Y,
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
        height: COST_BOTTOM - TOKEN_TOP + 6,
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
