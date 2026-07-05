import { COST_COLOR, formatTokens, formatTokensCompact, renderChart, TOKEN_SERIES, tokenTotal } from './chart';
import { ConversationDetailPayload, HostToWebviewMessage, WebviewToHostMessage } from '../panel/protocol';
import { ConversationListItem, ProviderId } from '../domain/types';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot'
};

interface State {
  providers: ProviderId[];
  conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>;
  selectedProvider: ProviderId;
  detail?: ConversationDetailPayload;
  listCollapsed: boolean;
  selectedRequestIndex?: number;
}

const state: State = {
  providers: ['claude', 'codex', 'copilot'],
  conversationsByProvider: {},
  selectedProvider: 'claude',
  listCollapsed: false
};

function post(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function root(): HTMLElement {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app root');
  return app;
}

function renderTabs(container: HTMLElement): void {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const provider of state.providers) {
    const button = document.createElement('button');
    button.className = 'tab' + (provider === state.selectedProvider ? ' active' : '');
    button.textContent = PROVIDER_LABELS[provider];
    button.addEventListener('click', () => {
      state.selectedProvider = provider;
      render();
    });
    tabs.appendChild(button);
  }
  container.appendChild(tabs);
}

function renderList(container: HTMLElement): void {
  const items = state.conversationsByProvider[state.selectedProvider] ?? [];
  const list = document.createElement('div');
  list.className = 'conversation-list';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      state.selectedProvider === 'claude'
        ? 'No Claude Code conversation found for this workspace yet.'
        : `${PROVIDER_LABELS[state.selectedProvider]} support is not implemented yet.`;
    list.appendChild(empty);
  }

  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'conversation-item' + (item.id === state.detail?.id ? ' active' : '');
    row.textContent = item.title;
    row.title = item.title;
    row.addEventListener('click', () => {
      if (item.id === state.detail?.id) return;
      state.selectedRequestIndex = undefined;
      post({ type: 'selectConversation', provider: state.selectedProvider, id: item.id });
    });
    list.appendChild(row);
  }

  container.appendChild(list);
}

function renderHeader(container: HTMLElement): void {
  const detail = state.detail;
  const header = document.createElement('div');
  header.className = 'thread-header';

  if (!detail) {
    header.textContent = 'Select a conversation.';
    container.appendChild(header);
    return;
  }

  const title = document.createElement('h2');
  title.textContent = detail.title ?? '(untitled)';

  const meta = document.createElement('div');
  meta.className = 'thread-meta';
  meta.textContent = `${detail.requests.length} request${detail.requests.length === 1 ? '' : 's'} · ${formatTokensCompact(
    tokenTotal(detail.totalUsage)
  )} tokens · total ${formatCost(detail.totalCost.usd)}`;

  header.append(title, meta);
  container.appendChild(header);
}

function renderChartSection(container: HTMLElement): void {
  const chartHost = document.createElement('div');
  chartHost.className = 'chart-host';
  container.appendChild(chartHost);

  const detail = state.detail;
  if (!detail) return;

  renderChart(chartHost, detail.requests, state.selectedRequestIndex, (index) => {
    state.selectedRequestIndex = index;
    render();
  });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Label · horizontal bar · exact value; the bar wears the series color, text wears text tokens. */
function breakdownRow(label: string, value: number, max: number, color: string, formatted?: string): HTMLElement[] {
  const labelEl = document.createElement('div');
  labelEl.className = 'breakdown-label';
  labelEl.textContent = label;

  const track = document.createElement('div');
  track.className = 'breakdown-track';
  track.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
  if (value > 0) {
    const bar = document.createElement('div');
    bar.className = 'breakdown-bar';
    bar.style.background = color;
    bar.style.width = `${Math.max((value / max) * 100, 1)}%`;
    track.appendChild(bar);
  }

  const valueEl = document.createElement('div');
  valueEl.className = 'breakdown-value' + (value === 0 ? ' zero' : '');
  valueEl.textContent = formatted ?? formatTokens(value);

  return [labelEl, track, valueEl];
}

function shareRow(label: string, part: number, whole: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'share-row';

  const pct = whole > 0 ? (part / whole) * 100 : 0;
  const head = document.createElement('div');
  head.className = 'share-head';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const pctEl = document.createElement('span');
  pctEl.className = 'share-pct';
  pctEl.textContent = pct > 0 && pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`;
  head.append(labelEl, pctEl);

  const track = document.createElement('div');
  track.className = 'share-track';
  const fill = document.createElement('div');
  fill.className = 'share-fill';
  fill.style.width = `${Math.min(100, Math.max(pct, pct > 0 ? 1 : 0))}%`;
  track.appendChild(fill);

  row.append(head, track);
  return row;
}

function renderDetailCard(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail || state.selectedRequestIndex === undefined) return;
  const request = detail.requests[state.selectedRequestIndex];
  if (!request) return;

  const card = document.createElement('div');
  card.className = 'detail-card';

  const header = document.createElement('div');
  header.className = 'detail-header';
  const title = document.createElement('h3');
  title.textContent = `Request #${state.selectedRequestIndex + 1}`;
  const cost = document.createElement('div');
  cost.className = 'detail-cost';
  cost.textContent = formatCost(request.cost.usd);
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = request.cost.source;
  cost.appendChild(badge);
  header.append(title, cost);
  card.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  meta.textContent = [
    request.model ?? 'unknown model',
    formatTimestamp(request.startedAt),
    `${request.toolCallCount} tool call${request.toolCallCount === 1 ? '' : 's'}`
  ].join(' · ');
  card.appendChild(meta);

  const values = TOKEN_SERIES.map((series) => request.usage[series.key]);
  const max = Math.max(1, ...values);
  const breakdown = document.createElement('div');
  breakdown.className = 'breakdown';
  TOKEN_SERIES.forEach((series, i) => {
    breakdown.append(...breakdownRow(series.label, values[i], max, series.color));
  });
  breakdown.append(
    ...breakdownRow(
      'Cost',
      request.cost.usd,
      Math.max(0.0001, ...detail.requests.map((r) => r.cost.usd)),
      COST_COLOR,
      formatCost(request.cost.usd)
    )
  );
  card.appendChild(breakdown);

  const shares = document.createElement('div');
  shares.className = 'shares';
  shares.appendChild(shareRow('Share of conversation cost', request.cost.usd, detail.totalCost.usd));
  shares.appendChild(shareRow('Share of conversation tokens', tokenTotal(request.usage), tokenTotal(detail.totalUsage)));
  card.appendChild(shares);

  container.appendChild(card);
}

function render(): void {
  const app = root();
  app.innerHTML = '';

  const collapseButton = document.createElement('button');
  collapseButton.className = 'collapse-toggle';
  collapseButton.textContent = state.listCollapsed ? '»' : '«';
  collapseButton.title = state.listCollapsed ? 'Show conversation list' : 'Hide conversation list';
  collapseButton.addEventListener('click', () => {
    state.listCollapsed = !state.listCollapsed;
    render();
  });

  const listPane = document.createElement('div');
  listPane.className = 'list-pane' + (state.listCollapsed ? ' collapsed' : '');
  if (!state.listCollapsed) {
    renderTabs(listPane);
    renderList(listPane);
  }

  const threadPane = document.createElement('div');
  threadPane.className = 'thread-pane';
  renderHeader(threadPane);
  renderChartSection(threadPane);
  renderDetailCard(threadPane);

  app.append(collapseButton, listPane, threadPane);
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    state.providers = message.providers;
    state.conversationsByProvider = message.conversationsByProvider;
    state.detail = message.selected;
    state.selectedRequestIndex = undefined;
    render();
  } else if (message.type === 'conversationDetail') {
    state.detail = message.detail;
    state.selectedRequestIndex = undefined;
    render();
  }
});

render();
post({ type: 'ready' });
