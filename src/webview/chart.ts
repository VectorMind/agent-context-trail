import { PromptRequest } from '../domain/types';

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

const COLORS = {
  cacheRead: 'var(--vscode-charts-blue)',
  cacheWrite: 'var(--vscode-charts-purple)',
  input: 'var(--vscode-charts-orange)',
  output: 'var(--vscode-charts-green)',
  cost: 'var(--vscode-charts-red)',
  selection: 'var(--vscode-focusBorder)',
  label: 'var(--vscode-descriptionForeground)'
};

const BAR_WIDTH = 22;
const BAR_GAP = 10;
const CHART_HEIGHT = 220;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 22;

/**
 * Stacked bar per request (cache read / cache write / fresh input / output),
 * scaled to the conversation's own max, plus a cost polyline scaled to the
 * conversation's own max cost. Deliberately plain SVG, no charting library —
 * see plan.md DD-002: at conversation scale (tens to low hundreds of
 * requests) a library buys nothing and costs bundle weight and theming
 * fights.
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

  const plotHeight = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const totals = requests.map(
    (r) => r.usage.cacheReadTokens + r.usage.cacheCreationTokens + r.usage.inputTokens + r.usage.outputTokens
  );
  const maxTotal = Math.max(1, ...totals);
  const maxCost = Math.max(0.0001, ...requests.map((r) => r.cost.usd));

  const width = requests.length * (BAR_WIDTH + BAR_GAP) + BAR_GAP;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
    width: '100%',
    height: CHART_HEIGHT,
    role: 'img',
    'aria-label': 'Token usage and cost per request'
  });

  const costPoints: string[] = [];

  requests.forEach((request, index) => {
    const x = BAR_GAP + index * (BAR_WIDTH + BAR_GAP);
    const segments: Array<[number, string]> = [
      [request.usage.cacheReadTokens, COLORS.cacheRead],
      [request.usage.cacheCreationTokens, COLORS.cacheWrite],
      [request.usage.inputTokens, COLORS.input],
      [request.usage.outputTokens, COLORS.output]
    ];

    const group = svgEl('g', { style: 'cursor:pointer' });
    group.addEventListener('click', () => onSelect(index));

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent =
      `#${index + 1} · in ${request.usage.inputTokens.toLocaleString()} · ` +
      `cacheRead ${request.usage.cacheReadTokens.toLocaleString()} · ` +
      `cacheWrite ${request.usage.cacheCreationTokens.toLocaleString()} · ` +
      `out ${request.usage.outputTokens.toLocaleString()} · $${request.cost.usd.toFixed(4)}`;
    group.appendChild(title);

    // Full-column, invisible hit target first so short bars are still easy to click.
    group.appendChild(
      svgEl('rect', { x, y: MARGIN_TOP, width: BAR_WIDTH, height: plotHeight, fill: 'transparent' })
    );

    let yCursor = CHART_HEIGHT - MARGIN_BOTTOM;
    for (const [value, color] of segments) {
      const segmentHeight = (value / maxTotal) * plotHeight;
      if (segmentHeight > 0) {
        yCursor -= segmentHeight;
        group.appendChild(svgEl('rect', { x, y: yCursor, width: BAR_WIDTH, height: segmentHeight, fill: color }));
      }
    }

    if (index === selectedIndex) {
      group.appendChild(
        svgEl('rect', {
          x: x - 2,
          y: MARGIN_TOP - 2,
          width: BAR_WIDTH + 4,
          height: plotHeight + 4,
          fill: 'none',
          stroke: COLORS.selection,
          'stroke-width': 2
        })
      );
    }

    const label = svgEl('text', {
      x: x + BAR_WIDTH / 2,
      y: CHART_HEIGHT - 6,
      'text-anchor': 'middle',
      'font-size': 10,
      fill: COLORS.label
    });
    label.textContent = `#${index + 1}`;
    group.appendChild(label);

    svg.appendChild(group);

    const costY = MARGIN_TOP + plotHeight - (request.cost.usd / maxCost) * plotHeight;
    costPoints.push(`${x + BAR_WIDTH / 2},${costY}`);
  });

  svg.appendChild(
    svgEl('polyline', {
      points: costPoints.join(' '),
      fill: 'none',
      stroke: COLORS.cost,
      'stroke-width': 2,
      style: 'pointer-events:none'
    })
  );

  container.appendChild(svg);
}
