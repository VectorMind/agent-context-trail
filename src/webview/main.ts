import { renderChart } from './chart';
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
  usdPerCredit: number;
  listCollapsed: boolean;
  selectedRequestIndex?: number;
}

const state: State = {
  providers: ['claude', 'codex', 'copilot'],
  conversationsByProvider: {},
  selectedProvider: 'claude',
  usdPerCredit: 0.01,
  listCollapsed: false
};

function post(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)} (${(usd / state.usdPerCredit).toFixed(2)} AIC)`;
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
  meta.textContent = `${detail.requests.length} request${detail.requests.length === 1 ? '' : 's'} · total ${formatCost(
    detail.totalCost.usd
  )}`;

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

function renderDetailCard(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail || state.selectedRequestIndex === undefined) return;
  const request = detail.requests[state.selectedRequestIndex];
  if (!request) return;

  const card = document.createElement('div');
  card.className = 'detail-card';

  const title = document.createElement('h3');
  title.textContent = `Request #${state.selectedRequestIndex + 1}`;
  card.appendChild(title);

  const rows: Array<[string, string]> = [
    ['Model', request.model ?? 'unknown'],
    ['Input', request.usage.inputTokens.toLocaleString()],
    ['Cache read', request.usage.cacheReadTokens.toLocaleString()],
    ['Cache write', request.usage.cacheCreationTokens.toLocaleString()],
    ['Output', request.usage.outputTokens.toLocaleString()],
    ['Tool calls', String(request.toolCallCount)],
    ['Cost', `${formatCost(request.cost.usd)} · ${request.cost.source}`],
    ['Started', request.startedAt]
  ];

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  for (const [label, value] of rows) {
    const labelEl = document.createElement('div');
    labelEl.className = 'detail-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'detail-value';
    valueEl.textContent = value;

    grid.append(labelEl, valueEl);
  }
  card.appendChild(grid);
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
    state.usdPerCredit = message.usdPerCredit;
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
