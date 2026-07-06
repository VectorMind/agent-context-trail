import {
  categoryColorMap,
  COST_COLOR,
  formatDurationMs,
  formatTokens,
  formatTokensCompact,
  gapBeforeMs,
  renderChart,
  renderOverviewChart,
  renderToolCallLanes,
  shortModelName,
  OVERVIEW_CHART_MAX_ROWS,
  TOKEN_SERIES,
  tokenTotal
} from './chart';
import { ConversationDetailPayload, HostToWebviewMessage, WebviewToHostMessage } from '../panel/protocol';
import { ConversationListItem, CurrentStatusSnapshot, ProviderId, ToolCallInfo } from '../domain/types';
import { formatUsd } from '../shared/format';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot'
};

/**
 * Layout experiments switcher. Round 1 picked B (App bar). Round 2 picked D
 * (Enriched): the same stacked-panel shell plus model/wall-time timeline
 * lanes, cache-break markers, and a deep request card.
 *
 * Keep the switcher off in normal builds. Re-enable it only when a future
 * packet explicitly needs side-by-side layout comparison.
 */
const LAYOUT_EXPERIMENTS = false;
type LayoutId = 'A' | 'B' | 'C' | 'D';
const DEFAULT_LAYOUT: LayoutId = 'D';
type SortKey = 'title' | 'firstAt' | 'lastAt' | 'requestCount' | 'totalTokens' | 'totalCostUsd';
type SortDir = 'asc' | 'desc';
type SectionId = 'chart' | 'table' | 'limits' | 'context' | 'thread' | 'request' | 'toolTimeline';
/** Tools table (Layout D request card): '#' is call order, not a sortable metric. */
type ToolSortKey = 'order' | 'name' | 'target' | 'in' | 'out' | 'time';

const LAYOUTS: { id: LayoutId; label: string; hint: string }[] = [
  { id: 'D', label: 'D · Enriched', hint: 'Stacked panels plus timeline lanes, cache breaks, and a deep prompt card' }
];

const SECTIONS: { id: SectionId; title: string; icon: string; hint: string }[] = [
  { id: 'limits', title: 'Provider Limits', icon: '≡', hint: 'Provider plan and rate-limit usage' },
  { id: 'chart', title: 'Tokens per conversation', icon: '▦', hint: 'Token totals per conversation' },
  { id: 'table', title: 'Conversations', icon: '☰', hint: 'Sortable, filterable conversations table' },
  { id: 'context', title: 'Current Context Status', icon: '≣', hint: 'Selected conversation context occupancy' },
  { id: 'thread', title: 'Conversation', icon: '∿', hint: 'Selected conversation, prompt by prompt' },
  { id: 'request', title: 'Prompt detail', icon: '◎', hint: 'Selected prompt breakdown' },
  { id: 'toolTimeline', title: 'Prompt timeline', icon: '▥', hint: 'Per-call in/out/time bars for the selected prompt' }
];

interface PersistedState {
  layout?: LayoutId;
  sectionsCollapsed?: Partial<Record<SectionId, boolean>>;
}

interface State {
  providers: ProviderId[];
  conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>;
  selectedProvider: ProviderId;
  workspacePath?: string;
  detail?: ConversationDetailPayload;
  listCollapsed: boolean;
  selectedRequestIndex?: number;
  layout: LayoutId;
  /** Conversation requested but whose detail has not arrived yet. */
  loadingId?: string;
  sortKey: SortKey;
  sortDir: SortDir;
  filter: string;
  /** Layouts B and C: panels collapsed to their heading bar. */
  sectionsCollapsed: Partial<Record<SectionId, boolean>>;
  /** Layout D: tools table sort, shared across whichever request is selected. */
  toolsSortKey: ToolSortKey;
  toolsSortDir: SortDir;
  /** Layout D: whether the current request's full prompt is expanded. Lives in
   * state (not a local DOM closure) so it survives the full re-render any
   * other in-card control (e.g. sorting the tools table) triggers. */
  promptExpanded: boolean;
}

const persisted = vscodeApi.getState<PersistedState>();

const state: State = {
  providers: ['claude', 'codex', 'copilot'],
  conversationsByProvider: {},
  selectedProvider: 'claude',
  listCollapsed: false,
  // restore the persisted layout only when it is part of the active comparison
  layout:
    LAYOUT_EXPERIMENTS && persisted?.layout && LAYOUTS.some((l) => l.id === persisted.layout)
      ? persisted.layout
      : DEFAULT_LAYOUT,
  sortKey: 'lastAt',
  sortDir: 'desc',
  filter: '',
  sectionsCollapsed: persisted?.sectionsCollapsed ?? {},
  toolsSortKey: 'order',
  toolsSortDir: 'asc',
  promptExpanded: false
};

function persistState(): void {
  vscodeApi.setState({
    layout: state.layout,
    sectionsCollapsed: state.sectionsCollapsed
  } satisfies PersistedState);
}

function post(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

function formatExact(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function formatShortDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(iso);
}

function formatConversationTotal(detail: ConversationDetailPayload): string {
  const costText = detail.totalCost.usd !== undefined ? `total ${formatUsd(detail.totalCost.usd)}` : 'cost unavailable';
  return `${detail.requests.length} prompt${detail.requests.length === 1 ? '' : 's'} · ${formatTokensCompact(
    tokenTotal(detail.totalUsage)
  )} tokens · ${costText}`;
}

function formatContextPercent(fillPercent: number | undefined): string {
  return fillPercent === undefined ? 'unavailable' : `${fillPercent.toFixed(1)}%`;
}

function formatContextTokens(used: number | undefined, window: number | undefined): string {
  if (used === undefined || window === undefined) return 'unavailable';
  return `${formatTokensCompact(used)} / ${formatTokensCompact(window)}`;
}

function formatWindowDuration(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined;
  if (minutes >= 24 * 60) {
    const days = minutes / (24 * 60);
    const rounded = Number.isInteger(days) ? days.toFixed(0) : days.toFixed(days < 10 ? 1 : 0);
    const value = rounded.replace(/\.0$/, '');
    return `${value} day${value === '1' ? '' : 's'}`;
  }
  if (minutes >= 60) {
    const hours = minutes / 60;
    const rounded = Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(hours < 10 ? 1 : 0);
    return `${rounded.replace(/\.0$/, '')} h`;
  }
  return `${minutes} min`;
}

function formatPercentValue(percent: number | undefined): string | undefined {
  return percent === undefined ? undefined : `${percent.toFixed(1)}%`;
}

function limitsSummaryText(status: CurrentStatusSnapshot | undefined): string {
  if (!status?.rateLimits) return 'unavailable';
  const parts: string[] = [];
  if (status.rateLimits.planType) parts.push(status.rateLimits.planType);
  if (status.rateLimits.primary?.usedPercent !== undefined) {
    parts.push(`${status.rateLimits.primary.usedPercent.toFixed(0)}% used`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'unavailable';
}

function activeConversationId(): string | undefined {
  return state.loadingId ?? state.detail?.id;
}

function contextSummaryText(status: CurrentStatusSnapshot | undefined): string {
  if (!status?.context) return 'unavailable';
  const used = status.context.contextUsedTokens;
  const fill = status.context.contextFillPercent;
  if (used !== undefined && fill !== undefined) {
    return `${formatTokensCompact(used)} used · ${fill.toFixed(1)}%`;
  }
  if (fill !== undefined) return `${fill.toFixed(1)}% used`;
  return 'unavailable';
}

function workspaceScopePath(): string | undefined {
  return state.workspacePath ?? state.detail?.workspacePath;
}

function hasProviderLimits(provider: ProviderId, status: CurrentStatusSnapshot | undefined): boolean {
  return provider !== 'claude' && !!status?.rateLimits;
}

function hasContextStatus(provider: ProviderId, status: CurrentStatusSnapshot | undefined): boolean {
  return provider !== 'claude' && !!status?.context;
}

function visibleSections(): { id: SectionId; title: string; icon: string; hint: string }[] {
  const status = state.detail?.currentStatus;
  return SECTIONS.filter((section) => {
    if (section.id === 'limits') return hasProviderLimits(state.selectedProvider, status);
    if (section.id === 'context') return hasContextStatus(state.selectedProvider, status);
    return true;
  });
}

// ---- sorting / filtering ----------------------------------------------------

const DEFAULT_DESC: ReadonlySet<SortKey> = new Set(['firstAt', 'lastAt', 'requestCount', 'totalTokens', 'totalCostUsd']);

const SORT_LABELS: Record<SortKey, string> = {
  title: 'title',
  firstAt: 'first message',
  lastAt: 'last message',
  requestCount: 'prompts',
  totalTokens: 'tokens',
  totalCostUsd: 'cost'
};

function compareItems(a: ConversationListItem, b: ConversationListItem): number {
  const { sortKey, sortDir } = state;
  const sign = sortDir === 'asc' ? 1 : -1;
  if (sortKey === 'title') return sign * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  if (sortKey === 'firstAt' || sortKey === 'lastAt') {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    if (!av && !bv) return 0;
    if (!av) return 1; // missing timestamps sink to the bottom either way
    if (!bv) return -1;
    return sign * av.localeCompare(bv); // ISO strings sort chronologically
  }
  const av = a[sortKey];
  const bv = b[sortKey];
  if (typeof av !== 'number' && typeof bv !== 'number') return 0;
  if (typeof av !== 'number') return 1;
  if (typeof bv !== 'number') return -1;
  return sign * (av - bv);
}

function setSort(key: SortKey): void {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = DEFAULT_DESC.has(key) ? 'desc' : 'asc';
  }
  render();
}

const TOOLS_DEFAULT_DESC: ReadonlySet<ToolSortKey> = new Set(['in', 'out', 'time']);

function setToolsSort(key: ToolSortKey): void {
  if (state.toolsSortKey === key) {
    state.toolsSortDir = state.toolsSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.toolsSortKey = key;
    state.toolsSortDir = TOOLS_DEFAULT_DESC.has(key) ? 'desc' : 'asc';
  }
  render();
}

function toolsSortArrow(key: ToolSortKey): string {
  if (state.toolsSortKey !== key) return '';
  return state.toolsSortDir === 'asc' ? ' ▲' : ' ▼';
}

function visibleItems(): ConversationListItem[] {
  const items = [...(state.conversationsByProvider[state.selectedProvider] ?? [])];
  items.sort(compareItems);
  const titleNeedle = state.filter.trim().toLowerCase();
  return items.filter((item) => !titleNeedle || item.title.toLowerCase().includes(titleNeedle));
}

function openConversation(id: string): void {
  // Make sure the thread panel is expanded; the page itself must not move.
  state.sectionsCollapsed.limits = false;
  state.sectionsCollapsed.context = false;
  state.sectionsCollapsed.thread = false;
  persistState();

  if (state.detail?.id === id) {
    state.loadingId = undefined;
    render();
    return;
  }
  state.loadingId = id;
  state.selectedRequestIndex = undefined;
  post({ type: 'selectConversation', provider: state.selectedProvider, id });
  render();
}

function selectRequest(index: number): void {
  state.selectedRequestIndex = index;
  state.sectionsCollapsed.request = false;
  state.sectionsCollapsed.toolTimeline = false;
  state.promptExpanded = false;
  persistState();
  render();
}

function selectProvider(provider: ProviderId): void {
  state.selectedProvider = provider;
  const items = state.conversationsByProvider[provider] ?? [];
  if (state.detail?.provider !== provider) {
    state.detail = undefined;
    state.selectedRequestIndex = undefined;
    state.loadingId = undefined;
    if (items[0]) {
      openConversation(items[0].id);
      return;
    }
  }
  render();
}

function switchLayout(layout: LayoutId): void {
  state.layout = layout;
  persistState();
  render();
}

function root(): HTMLElement {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app root');
  return app;
}

// ---- design switcher ---------------------------------------------------------

function renderDesignBar(container: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'design-bar';

  const label = document.createElement('span');
  label.className = 'design-label';
  label.textContent = 'Layout';
  bar.appendChild(label);

  for (const layout of LAYOUTS) {
    const button = document.createElement('button');
    button.className = 'design-tab' + (layout.id === state.layout ? ' active' : '');
    button.textContent = layout.label;
    button.title = layout.hint;
    button.addEventListener('click', () => switchLayout(layout.id));
    bar.appendChild(button);
  }

  const hint = document.createElement('span');
  hint.className = 'design-hint';
  hint.textContent = 'UI experiments — compare, then pick one to keep';
  bar.appendChild(hint);

  container.appendChild(bar);
}

// ---- provider tabs -------------------------------------------------------------

function renderTabs(container: HTMLElement): void {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  for (const provider of state.providers) {
    const count = (state.conversationsByProvider[provider] ?? []).length;
    const button = document.createElement('button');
    button.className = 'tab' + (provider === state.selectedProvider ? ' active' : '');
    button.textContent = count > 0 ? `${PROVIDER_LABELS[provider]} (${count})` : PROVIDER_LABELS[provider];
    button.addEventListener('click', () => {
      selectProvider(provider);
    });
    tabs.appendChild(button);
  }
  container.appendChild(tabs);
}

function renderWorkspaceScope(container: HTMLElement): void {
  const workspacePath = workspaceScopePath();
  if (!workspacePath) return;

  const block = document.createElement('div');
  block.className = 'workspace-scope';

  const label = document.createElement('div');
  label.className = 'workspace-scope-label';
  label.textContent = 'Workspace scope';

  const path = document.createElement('div');
  path.className = 'workspace-scope-path';
  path.textContent = workspacePath;
  path.title = workspacePath;

  const note = document.createElement('div');
  note.className = 'workspace-scope-note';
  note.textContent = 'Showing only conversations from this workspace.';

  block.append(label, path, note);
  container.appendChild(block);
}

function emptyMessage(): string {
  return `No ${PROVIDER_LABELS[state.selectedProvider]} conversations found for this workspace yet.`;
}

// ---- layout A: sortable sidebar ------------------------------------------------

const SIDEBAR_SORTS: { key: SortKey; label: string }[] = [
  { key: 'lastAt', label: 'Last' },
  { key: 'firstAt', label: 'First' },
  { key: 'title', label: 'Title' }
];

function sortArrow(key: SortKey): string {
  if (state.sortKey !== key) return '';
  return state.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function renderSidebarSortRow(container: HTMLElement): void {
  const row = document.createElement('div');
  row.className = 'sort-row';
  const caption = document.createElement('span');
  caption.className = 'sort-caption';
  caption.textContent = 'Sort';
  row.appendChild(caption);
  for (const sort of SIDEBAR_SORTS) {
    const button = document.createElement('button');
    button.className = 'sort-button' + (state.sortKey === sort.key ? ' active' : '');
    button.textContent = sort.label + sortArrow(sort.key);
    button.title = `Sort by ${sort.label.toLowerCase()} message`;
    button.addEventListener('click', () => setSort(sort.key));
    row.appendChild(button);
  }
  container.appendChild(row);
}

function renderSidebarList(container: HTMLElement): void {
  const items = visibleItems();
  const list = document.createElement('div');
  list.className = 'conversation-list';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyMessage();
    list.appendChild(empty);
  }

  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'conversation-item' + (item.id === activeConversationId() ? ' active' : '');
    row.title = `${item.title}\nFirst: ${formatExact(item.firstAt)}\nLast: ${formatExact(item.lastAt)}`;

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `${item.requestCount} prompt${item.requestCount === 1 ? '' : 's'} · ${formatShortDate(item.firstAt)} → ${formatRelative(item.lastAt)}`;

    row.append(title, meta);
    row.addEventListener('click', () => {
      if (item.id === state.detail?.id) return;
      state.selectedRequestIndex = undefined;
      state.loadingId = item.id;
      post({ type: 'selectConversation', provider: state.selectedProvider, id: item.id });
    });
    list.appendChild(row);
  }

  container.appendChild(list);
}

function renderLayoutA(container: HTMLElement): void {
  const shell = document.createElement('div');
  shell.className = 'split';

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
    renderSidebarSortRow(listPane);
    renderSidebarList(listPane);
  }

  const threadPane = document.createElement('div');
  threadPane.className = 'thread-pane';
  if (state.loadingId && state.detail?.id !== state.loadingId) {
    const loading = document.createElement('div');
    loading.className = 'empty';
    loading.textContent = 'Loading conversation…';
    threadPane.appendChild(loading);
  } else {
    renderThreadHeader(threadPane);
    renderThreadChart(threadPane);
    renderDetailCard(threadPane);
  }

  shell.append(collapseButton, listPane, threadPane);
  container.appendChild(shell);
}

// ---- shared thread pieces --------------------------------------------------------

function renderThreadHeader(container: HTMLElement): void {
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
  meta.textContent = formatConversationTotal(detail);
  meta.textContent = `${detail.requests.length} prompt${detail.requests.length === 1 ? '' : 's'} · ${formatTokensCompact(
    tokenTotal(detail.totalUsage)
  )} tokens · total ${formatUsd(detail.totalCost.usd)}`;

  header.append(title, meta);
  container.appendChild(header);
}

function renderThreadChart(container: HTMLElement): void {
  const chartHost = document.createElement('div');
  chartHost.className = 'chart-host';
  container.appendChild(chartHost);

  const detail = state.detail;
  if (!detail) return;

  renderChart(
    chartHost,
    detail.requests,
    state.selectedRequestIndex,
    (index) => {
      if (state.layout === 'A') {
        state.selectedRequestIndex = index;
        render();
      } else {
        selectRequest(index);
      }
    },
    // Layout D: aligned model + wall-time lanes and cache-break markers
    { timeline: state.layout === 'D' }
  );
}

function renderCurrentStatusSection(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a conversation to inspect provider limits and context status.';
    container.appendChild(empty);
    return;
  }

  const status = detail.currentStatus;
  if (!status?.rateLimits && !status?.context) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No current status was recorded for ${PROVIDER_LABELS[detail.provider]}.`;
    container.appendChild(empty);
    return;
  }

  if (status.rateLimits) {
    const block = document.createElement('div');
    block.className = 'status-block';
    block.appendChild(subHeading('Provider Limits'));
    const body = document.createElement('div');
    body.className = 'status-card';
    if (status.rateLimits.planType || status.rateLimits.limitId || status.rateLimits.rateLimitReachedType) {
      const summary = document.createElement('div');
      summary.className = 'status-card-summary';
      const bits: string[] = [];
      if (status.rateLimits.planType) bits.push(`plan ${status.rateLimits.planType}`);
      if (status.rateLimits.limitId) bits.push(status.rateLimits.limitId);
      if (status.rateLimits.rateLimitReachedType) bits.push(`reached ${status.rateLimits.rateLimitReachedType}`);
      summary.textContent = bits.join(' · ');
      body.appendChild(summary);
    }
    for (const [label, window] of [
      ['Primary', status.rateLimits.primary],
      ['Secondary', status.rateLimits.secondary]
    ] as const) {
      if (!window) continue;
      const bits: string[] = [];
      const windowDuration = formatWindowDuration(window.windowMinutes);
      if (windowDuration) bits.push(windowDuration);
      if (window.resetsAt) bits.push(`resets ${formatExact(window.resetsAt)}`);
      body.appendChild(
        statusMeterRow({
          label,
          value: window.usedPercent !== undefined ? `${formatPercentValue(window.usedPercent)} used` : 'unavailable',
          fillPercent: window.usedPercent,
          tone: limitTone(window.usedPercent),
          meta: bits.join(' · ')
        })
      );
    }
    block.appendChild(body);
    container.appendChild(block);
  }

  if (status.context) {
    const block = document.createElement('div');
    block.className = 'status-block';
    block.appendChild(subHeading('Current Context Status'));
    const body = document.createElement('div');
    body.className = 'status-card';
    if (status.context.model) {
      const summary = document.createElement('div');
      summary.className = 'status-card-summary';
      summary.textContent = shortModelName(status.context.model);
      body.appendChild(summary);
    }
    body.appendChild(
      statusMeterRow({
        label: 'Context fill',
        value:
          status.context.contextFillPercent !== undefined
            ? `${formatPercentValue(status.context.contextFillPercent)} used`
            : 'unavailable',
        fillPercent: status.context.contextFillPercent,
        tone: limitTone(status.context.contextFillPercent),
        meta: formatContextTokens(status.context.contextUsedTokens, status.context.modelContextWindow)
      })
    );

    const facts = document.createElement('div');
    facts.className = 'status-facts';
    appendStatusFact(
      facts,
      'Window',
      status.context.modelContextWindow !== undefined ? formatTokensCompact(status.context.modelContextWindow) : undefined
    );
    appendStatusFact(
      facts,
      'In use',
      status.context.contextUsedTokens !== undefined ? formatTokensCompact(status.context.contextUsedTokens) : undefined
    );
    appendStatusFact(
      facts,
      'Available',
      status.context.contextAvailableTokens !== undefined ? formatTokensCompact(status.context.contextAvailableTokens) : undefined
    );
    appendStatusFact(
      facts,
      'Reserved output',
      status.context.reservedOutputTokens !== undefined ? formatTokensCompact(status.context.reservedOutputTokens) : undefined
    );
    appendStatusFact(facts, 'Mode', status.context.longContextMode);
    if (facts.childElementCount > 0) body.appendChild(facts);
    block.appendChild(body);
    container.appendChild(block);
  }
}

function renderProviderLimitsSection(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a conversation to inspect provider limits.';
    container.appendChild(empty);
    return;
  }

  const status = detail.currentStatus;
  if (!status?.rateLimits) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No provider limits were recorded for ${PROVIDER_LABELS[detail.provider]}.`;
    container.appendChild(empty);
    return;
  }

  const block = document.createElement('div');
  block.className = 'status-block';
  const body = document.createElement('div');
  body.className = 'status-card';
  if (status.rateLimits.planType || status.rateLimits.limitId || status.rateLimits.rateLimitReachedType) {
    const summary = document.createElement('div');
    summary.className = 'status-card-summary';
    const bits: string[] = [];
    if (status.rateLimits.planType) bits.push(`plan ${status.rateLimits.planType}`);
    if (status.rateLimits.limitId) bits.push(status.rateLimits.limitId);
    if (status.rateLimits.rateLimitReachedType) bits.push(`reached ${status.rateLimits.rateLimitReachedType}`);
    summary.textContent = bits.join(' · ');
    body.appendChild(summary);
  }

  for (const window of [status.rateLimits.primary, status.rateLimits.secondary]) {
    if (!window) continue;
    const bits: string[] = [];
    const windowDuration = formatWindowDuration(window.windowMinutes);
    if (windowDuration) bits.push(windowDuration);
    if (window.resetsAt) bits.push(`resets ${formatExact(window.resetsAt)}`);
    body.appendChild(
      compactStatusMeter({
        usedText: window.usedPercent !== undefined ? `${formatPercentValue(window.usedPercent)} used` : 'used unavailable',
        remainingText:
          window.usedPercent !== undefined ? `${formatPercentValue(Math.max(0, 100 - window.usedPercent))} remaining` : undefined,
        fillPercent: window.usedPercent,
        tone: limitTone(window.usedPercent),
        meta: bits.join(' · ')
      })
    );
  }

  block.appendChild(body);
  container.appendChild(block);
}

function renderContextStatusSection(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a conversation to inspect current context status.';
    container.appendChild(empty);
    return;
  }

  const status = detail.currentStatus;
  if (!status?.context) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No context status was recorded for ${PROVIDER_LABELS[detail.provider]}.`;
    container.appendChild(empty);
    return;
  }

  const block = document.createElement('div');
  block.className = 'status-block';
  const body = document.createElement('div');
  body.className = 'status-card';
  if (status.context.model) {
    const summary = document.createElement('div');
    summary.className = 'status-card-summary';
    summary.textContent = shortModelName(status.context.model);
    body.appendChild(summary);
  }

  const usedTokens = status.context.contextUsedTokens;
  const windowTokens = status.context.modelContextWindow;
  const remainingTokens =
    usedTokens !== undefined && windowTokens !== undefined ? Math.max(windowTokens - usedTokens, 0) : status.context.contextAvailableTokens;
  body.appendChild(
    compactStatusMeter({
      usedText:
        usedTokens !== undefined && status.context.contextFillPercent !== undefined
          ? `Used ${formatTokensCompact(usedTokens)} - ${formatPercentValue(status.context.contextFillPercent)}`
          : 'Used unavailable',
      remainingText:
        remainingTokens !== undefined && status.context.contextFillPercent !== undefined
          ? `Remaining ${formatTokensCompact(remainingTokens)} - ${formatPercentValue(
              Math.max(0, 100 - status.context.contextFillPercent)
            )}`
          : undefined,
      fillPercent: status.context.contextFillPercent,
      tone: limitTone(status.context.contextFillPercent),
      meta: formatContextTokens(status.context.contextUsedTokens, status.context.modelContextWindow)
    })
  );

  const facts = document.createElement('div');
  facts.className = 'status-facts';
  appendStatusFact(
    facts,
    'Window',
    status.context.modelContextWindow !== undefined ? formatTokensCompact(status.context.modelContextWindow) : undefined
  );
  appendStatusFact(
    facts,
    'In use',
    status.context.contextUsedTokens !== undefined ? formatTokensCompact(status.context.contextUsedTokens) : undefined
  );
  appendStatusFact(
    facts,
    'Available',
    status.context.contextAvailableTokens !== undefined ? formatTokensCompact(status.context.contextAvailableTokens) : undefined
  );
  appendStatusFact(
    facts,
    'Reserved output',
    status.context.reservedOutputTokens !== undefined ? formatTokensCompact(status.context.reservedOutputTokens) : undefined
  );
  appendStatusFact(facts, 'Mode', status.context.longContextMode);
  if (facts.childElementCount > 0) body.appendChild(facts);
  block.appendChild(body);
  container.appendChild(block);
}

function limitTone(percent: number | undefined): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (percent === undefined) return 'neutral';
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'ok';
}

function statusMeterRow(args: {
  label: string;
  value: string;
  fillPercent?: number;
  meta?: string;
  tone?: 'ok' | 'warn' | 'danger' | 'neutral';
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'status-meter';

  const head = document.createElement('div');
  head.className = 'status-meter-head';

  const label = document.createElement('span');
  label.className = 'status-meter-label';
  label.textContent = args.label;

  const value = document.createElement('span');
  value.className = 'status-meter-value';
  value.textContent = args.value;

  head.append(label, value);
  row.appendChild(head);

  const track = document.createElement('div');
  track.className = `status-meter-track ${args.tone ?? 'neutral'}`;
  const fill = document.createElement('div');
  fill.className = 'status-meter-fill';
  fill.style.width =
    args.fillPercent !== undefined ? `${Math.min(Math.max(args.fillPercent, 0), 100)}%` : '0%';
  track.appendChild(fill);
  row.appendChild(track);

  if (args.meta) {
    const footer = document.createElement('div');
    footer.className = 'status-meter-footer';

    const meta = document.createElement('div');
    meta.className = 'status-meter-meta';
    meta.textContent = args.meta;
    footer.appendChild(meta);

    if (args.fillPercent !== undefined) {
      const remaining = document.createElement('div');
      remaining.className = 'status-meter-remaining';
      remaining.textContent = `${formatPercentValue(Math.max(0, 100 - args.fillPercent))} remaining`;
      footer.appendChild(remaining);
    }

    row.appendChild(footer);
  } else if (args.fillPercent !== undefined) {
    const remaining = document.createElement('div');
    remaining.className = 'status-meter-remaining solo';
    remaining.textContent = `${formatPercentValue(Math.max(0, 100 - args.fillPercent))} remaining`;
    row.appendChild(remaining);
  }

  return row;
}

function compactStatusMeter(args: {
  usedText: string;
  remainingText?: string;
  fillPercent?: number;
  meta?: string;
  tone?: 'ok' | 'warn' | 'danger' | 'neutral';
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'status-meter compact';

  const head = document.createElement('div');
  head.className = 'status-meter-head';

  const used = document.createElement('span');
  used.className = 'status-meter-value status-meter-side';
  used.textContent = args.usedText;

  const remaining = document.createElement('span');
  remaining.className = 'status-meter-remaining top';
  remaining.textContent = args.remainingText ?? 'remaining unavailable';

  head.append(used, remaining);
  row.appendChild(head);

  const track = document.createElement('div');
  track.className = `status-meter-track ${args.tone ?? 'neutral'}`;
  const fill = document.createElement('div');
  fill.className = 'status-meter-fill';
  fill.style.width =
    args.fillPercent !== undefined ? `${Math.min(Math.max(args.fillPercent, 0), 100)}%` : '0%';
  track.appendChild(fill);
  row.appendChild(track);

  if (args.meta) {
    const meta = document.createElement('div');
    meta.className = 'status-meter-meta';
    meta.textContent = args.meta;
    row.appendChild(meta);
  }

  return row;
}

function appendStatusFact(container: HTMLElement, label: string, value: string | undefined): void {
  if (!value) return;
  const fact = document.createElement('div');
  fact.className = 'status-fact';

  const factLabel = document.createElement('span');
  factLabel.className = 'status-fact-label';
  factLabel.textContent = label;

  const factValue = document.createElement('span');
  factValue.className = 'status-fact-value';
  factValue.textContent = value;

  fact.append(factLabel, factValue);
  container.appendChild(fact);
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

function maybeShareRow(label: string, part: number | undefined, whole: number | undefined): HTMLElement | undefined {
  if (part === undefined || whole === undefined) return undefined;
  return shareRow(label, part, whole);
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
  title.textContent = `Prompt #${state.selectedRequestIndex + 1}`;
  const cost = document.createElement('div');
  cost.className = 'detail-cost';
  cost.textContent = formatUsd(request.cost.usd);
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
    formatExact(request.startedAt),
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
  if (request.cost.usd !== undefined) {
    breakdown.append(
      ...breakdownRow(
        'Cost',
        request.cost.usd,
        Math.max(0.0001, ...detail.requests.map((r) => r.cost.usd ?? 0)),
        COST_COLOR,
        formatUsd(request.cost.usd)
      )
    );
  }
  card.appendChild(breakdown);

  const shares = document.createElement('div');
  shares.className = 'shares';
  const costShare = maybeShareRow('Share of conversation cost', request.cost.usd, detail.totalCost.usd);
  if (costShare) shares.appendChild(costShare);
  shares.appendChild(shareRow('Share of conversation tokens', tokenTotal(request.usage), tokenTotal(detail.totalUsage)));
  card.appendChild(shares);

  container.appendChild(card);
}

// ---- enriched request card (Layout D) ---------------------------------------------

function formatChars(n: number): string {
  return `${formatTokensCompact(n)} chars`;
}

function chip(label: string, value: string, title?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'chip';
  const labelEl = document.createElement('span');
  labelEl.className = 'chip-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'chip-value';
  valueEl.textContent = value;
  el.append(labelEl, valueEl);
  if (title) el.title = title;
  return el;
}

function subHeading(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'detail-subheading';
  el.textContent = text;
  return el;
}

const PROMPT_COLLAPSE_AT = 240;

/**
 * Prompt text collapses to a short snippet with a hover title carrying the
 * full text (discoverable without a click); clicking or pressing
 * Enter/Space expands it in place, matching the panel's existing
 * collapse/expand convention rather than introducing a new popup pattern.
 * Expand state lives in `state.promptExpanded`, not a local DOM closure, so
 * it survives the full re-render any other control (e.g. sorting the tools
 * table below) triggers.
 */
function renderPromptBlock(full: string): HTMLElement {
  const isLong = full.length > PROMPT_COLLAPSE_AT;
  const collapsedText = isLong ? `${full.slice(0, PROMPT_COLLAPSE_AT)}…` : full;
  const expanded = isLong && state.promptExpanded;

  const wrap = document.createElement('div');
  wrap.className = 'prompt-preview-wrap';

  const prompt = document.createElement('div');
  prompt.className = 'prompt-preview' + (expanded ? ' expanded' : '');
  prompt.textContent = expanded ? full : collapsedText;
  prompt.title = expanded ? '' : full;
  wrap.appendChild(prompt);

  if (!isLong) return wrap;

  const toggleHint = document.createElement('button');
  toggleHint.type = 'button';
  toggleHint.className = 'prompt-toggle';
  toggleHint.textContent = expanded ? 'Show less' : 'Show full prompt';

  prompt.tabIndex = 0;
  prompt.setAttribute('role', 'button');
  prompt.setAttribute('aria-expanded', String(expanded));
  prompt.setAttribute('aria-label', `Prompt, ${expanded ? 'expanded' : 'collapsed'}. Activate to toggle the full text.`);

  const toggle = () => {
    state.promptExpanded = !state.promptExpanded;
    render();
  };
  prompt.addEventListener('click', toggle);
  prompt.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggle();
    }
  });
  toggleHint.addEventListener('click', toggle);

  wrap.appendChild(toggleHint);
  return wrap;
}

function toolDuration(tool: ToolCallInfo): string {
  if (tool.durationMs === undefined) return '—';
  const prefix = tool.durationSource === 'derived' ? '≈' : '';
  return prefix + formatDurationMs(tool.durationMs);
}

/** '#' sorts by original call order; the trailing error column isn't sortable. */
const TOOLS_COLUMNS: { key?: ToolSortKey; label: string; numeric?: boolean }[] = [
  { key: 'order', label: '#' },
  { key: 'name', label: 'Tool' },
  { key: 'target', label: 'Target' },
  { key: 'in', label: 'In', numeric: true },
  { key: 'out', label: 'Out', numeric: true },
  { key: 'time', label: 'Time', numeric: true },
  { label: '' }
];

interface OrderedTool {
  tool: ToolCallInfo;
  /** 1-based position in the request's actual call sequence, independent of sort. */
  order: number;
}

function compareTools(a: OrderedTool, b: OrderedTool): number {
  const { toolsSortKey: key, toolsSortDir: dir } = state;
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'order':
      return sign * (a.order - b.order);
    case 'name':
      return sign * a.tool.name.localeCompare(b.tool.name, undefined, { sensitivity: 'base' });
    case 'target':
      return sign * (a.tool.inputPreview ?? '').localeCompare(b.tool.inputPreview ?? '', undefined, { sensitivity: 'base' });
    case 'in':
      return sign * (a.tool.inputChars - b.tool.inputChars);
    case 'out':
      return sign * ((a.tool.outputChars ?? -1) - (b.tool.outputChars ?? -1));
    case 'time':
      return sign * ((a.tool.durationMs ?? -1) - (b.tool.durationMs ?? -1));
    default:
      return 0;
  }
}

function sortedTools(tools: ToolCallInfo[]): OrderedTool[] {
  return tools.map((tool, i) => ({ tool, order: i + 1 })).sort(compareTools);
}

interface ToolCategoryTotals {
  name: string;
  calls: number;
  inChars: number;
  outChars: number;
  durationMs: number;
  errors: number;
}

/** Groups a request's tool calls by tool name, in order of first appearance. */
function summarizeToolsByCategory(tools: ToolCallInfo[]): ToolCategoryTotals[] {
  const order: string[] = [];
  const totals = new Map<string, ToolCategoryTotals>();
  for (const tool of tools) {
    let entry = totals.get(tool.name);
    if (!entry) {
      entry = { name: tool.name, calls: 0, inChars: 0, outChars: 0, durationMs: 0, errors: 0 };
      totals.set(tool.name, entry);
      order.push(tool.name);
    }
    entry.calls += 1;
    entry.inChars += tool.inputChars;
    entry.outChars += tool.outputChars ?? 0;
    entry.durationMs += tool.durationMs ?? 0;
    if (tool.isError) entry.errors += 1;
  }
  return order.map((name) => totals.get(name)!);
}

/**
 * Same visual language as the Tokens breakdown (label · bar · value): one row
 * per tool name, bar scaled to call count, value combining calls/chars/time.
 * A plain summary line (not another bar, to avoid an axis mismatch against
 * the per-category max) totals everything underneath.
 */
function renderToolActivityChart(tools: ToolCallInfo[]): HTMLElement {
  const categories = summarizeToolsByCategory(tools);
  const colors = categoryColorMap(categories.map((c) => c.name));
  const maxCalls = Math.max(1, ...categories.map((c) => c.calls));

  const breakdown = document.createElement('div');
  breakdown.className = 'breakdown';
  for (const cat of categories) {
    const bits = [`${cat.calls} call${cat.calls === 1 ? '' : 's'}`];
    const chars = cat.inChars + cat.outChars;
    if (chars) bits.push(`${formatTokensCompact(chars)} chars`);
    if (cat.durationMs) bits.push(formatDurationMs(cat.durationMs));
    const formatted = (cat.errors > 0 ? '⚠ ' : '') + bits.join(' · ');
    const cells = breakdownRow(cat.name, cat.calls, maxCalls, colors.get(cat.name) ?? COST_COLOR, formatted);
    if (cat.errors > 0) cells[2].title = `${cat.errors} error${cat.errors === 1 ? '' : 's'} on this tool`;
    breakdown.append(...cells);
  }

  const totalCalls = categories.reduce((sum, c) => sum + c.calls, 0);
  const totalChars = categories.reduce((sum, c) => sum + c.inChars + c.outChars, 0);
  const totalDuration = categories.reduce((sum, c) => sum + c.durationMs, 0);
  const totalErrors = categories.reduce((sum, c) => sum + c.errors, 0);
  const note = document.createElement('div');
  note.className = 'breakdown-note';
  note.textContent =
    `Total — ${totalCalls} call${totalCalls === 1 ? '' : 's'}` +
    (totalChars ? ` · ${formatTokensCompact(totalChars)} chars` : '') +
    (totalDuration ? ` · ${formatDurationMs(totalDuration)}` : '') +
    (totalErrors ? ` · ${totalErrors} error${totalErrors === 1 ? '' : 's'}` : '');
  breakdown.appendChild(note);

  return breakdown;
}

/**
 * Everything the log exposes about one request, in analytical form:
 * timing chips, prompt size, token breakdown with the cache-write TTL split,
 * cache diagnostics, output composition, and a per-call tools table with
 * latency and subagent attribution. Absent fields are omitted, never shown
 * as zero (provider-and-cost.md).
 */
function renderEnrichedRequestCard(container: HTMLElement): void {
  const detail = state.detail;
  if (!detail || state.selectedRequestIndex === undefined) return;
  const request = detail.requests[state.selectedRequestIndex];
  if (!request) return;

  const card = document.createElement('div');
  card.className = 'detail-card enriched';

  // ---- header + identity ----
  const header = document.createElement('div');
  header.className = 'detail-header';
  const title = document.createElement('h3');
  title.textContent = `Prompt #${state.selectedRequestIndex + 1}`;
  const cost = document.createElement('div');
  cost.className = 'detail-cost';
  cost.textContent = formatUsd(request.cost.usd);
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = request.cost.source;
  cost.appendChild(badge);
  header.append(title, cost);
  card.appendChild(header);

  const models = request.modelsUsed?.length ? request.modelsUsed : request.model ? [request.model] : [];
  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  meta.textContent = [
    models.length > 0 ? models.map(shortModelName).join(' → ') : 'unknown model',
    formatExact(request.startedAt),
    request.stopReason ? `ended: ${request.stopReason.replace(/_/g, ' ')}` : undefined
  ]
    .filter(Boolean)
    .join(' · ');
  card.appendChild(meta);

  // ---- timing / shape chips ----
  const chips = document.createElement('div');
  chips.className = 'chips';
  if (request.durationMs !== undefined) chips.appendChild(chip('wall time', formatDurationMs(request.durationMs)));
  const gap = gapBeforeMs(detail.requests, request.index);
  if (gap !== undefined) chips.appendChild(chip('idle before', formatDurationMs(gap), 'Time since the previous request ended'));
  if (request.llmCallCount !== undefined) chips.appendChild(chip('LLM calls', String(request.llmCallCount)));
  chips.appendChild(chip('tool calls', String(request.toolCallCount)));
  if (request.serviceTier) chips.appendChild(chip('tier', request.serviceTier));
  if (request.speed && request.speed !== 'standard') chips.appendChild(chip('speed', request.speed));
  if (request.webSearchRequests) chips.appendChild(chip('web searches', String(request.webSearchRequests)));
  if (request.webFetchRequests) chips.appendChild(chip('web fetches', String(request.webFetchRequests)));
  if (request.timeToFirstTokenMs !== undefined) chips.appendChild(chip('first token', formatDurationMs(request.timeToFirstTokenMs)));
  if (request.reasoningOutputTokens !== undefined) {
    chips.appendChild(chip('reasoning output', formatTokensCompact(request.reasoningOutputTokens)));
  }
  if (request.modelContextWindow !== undefined) chips.appendChild(chip('context window', formatTokensCompact(request.modelContextWindow)));
  if (request.premiumCredits !== undefined) {
    chips.appendChild(
      chip('premium credits', request.premiumCredits.toFixed(request.premiumCredits < 10 ? 1 : 0), 'Copilot premium-request credits consumed — a plan-quota signal, separate from the USD cost estimate below')
    );
  }
  card.appendChild(chips);

  // ---- prompt (click or hover to see the full text; own input, not a tool payload) ----
  if (request.promptText) {
    card.appendChild(subHeading(`Prompt${request.promptChars !== undefined ? ` · ${formatChars(request.promptChars)}` : ''}`));
    card.appendChild(renderPromptBlock(request.promptText));
  }

  // ---- token breakdown, with the cache-write TTL split ----
  card.appendChild(subHeading('Tokens'));
  const values = TOKEN_SERIES.map((series) => request.usage[series.key]);
  const max = Math.max(1, ...values);
  const breakdown = document.createElement('div');
  breakdown.className = 'breakdown';
  TOKEN_SERIES.forEach((series, i) => {
    breakdown.append(...breakdownRow(series.label, values[i], max, series.color));
    if (series.key === 'cacheCreationTokens' && request.usage.cacheCreationTokens > 0) {
      const parts: string[] = [];
      if (request.usage.cacheCreation5mTokens > 0) parts.push(`5m TTL ${formatTokens(request.usage.cacheCreation5mTokens)}`);
      if (request.usage.cacheCreation1hTokens > 0) parts.push(`1h TTL ${formatTokens(request.usage.cacheCreation1hTokens)}`);
      if (parts.length > 0) {
        const note = document.createElement('div');
        note.className = 'breakdown-note';
        note.textContent = parts.join(' · ');
        breakdown.appendChild(note);
      }
    }
  });
  if (request.cost.usd !== undefined) {
    breakdown.append(
      ...breakdownRow(
        'Cost',
        request.cost.usd,
        Math.max(0.0001, ...detail.requests.map((r) => r.cost.usd ?? 0)),
        COST_COLOR,
        formatUsd(request.cost.usd)
      )
    );
  }
  card.appendChild(breakdown);

  // ---- cache diagnostics ----
  card.appendChild(subHeading('Cache'));
  const diag = document.createElement('div');
  diag.className = 'diag';
  if (request.cacheMisses?.length) {
    for (const miss of request.cacheMisses) {
      const row = document.createElement('div');
      row.className = 'diag-row warn';
      row.textContent =
        `▲ cache break — ${miss.reason.replace(/_/g, ' ')}` +
        (miss.missedTokens !== undefined ? ` · ${formatTokens(miss.missedTokens)} tokens missed the cache` : '');
      diag.appendChild(row);
    }
  } else if (request.usage.cacheReadTokens > 0) {
    const row = document.createElement('div');
    row.className = 'diag-row ok';
    row.textContent = `● cache hit — ${formatTokens(request.usage.cacheReadTokens)} tokens reused from cache`;
    diag.appendChild(row);
  } else {
    const row = document.createElement('div');
    row.className = 'diag-row';
    row.textContent = 'no cache activity recorded';
    diag.appendChild(row);
  }
  card.appendChild(diag);

  // ---- edited files (Copilot-native) ----
  if (request.editedFiles?.length) {
    card.appendChild(subHeading(`Edited files (${request.editedFiles.length})`));
    const list = document.createElement('div');
    list.className = 'diag';
    for (const filePath of request.editedFiles) {
      const row = document.createElement('div');
      row.className = 'diag-row';
      row.textContent = filePath;
      row.title = filePath;
      list.appendChild(row);
    }
    card.appendChild(list);
  }

  // ---- output composition ----
  if (request.thinkingChars !== undefined || request.textChars !== undefined) {
    card.appendChild(subHeading('Output composition'));
    const composition = document.createElement('div');
    composition.className = 'composition';
    const parts: string[] = [];
    if (request.thinkingBlocks) {
      const chars = request.thinkingChars ? ` · ${formatChars(request.thinkingChars)}` : '';
      parts.push(`${request.thinkingBlocks} thinking block${request.thinkingBlocks === 1 ? '' : 's'}${chars}`);
    }
    if (request.textChars) parts.push(`visible text · ${formatChars(request.textChars)}`);
    composition.textContent = parts.length > 0 ? parts.join('  ·  ') : 'tool calls only, no text output';
    card.appendChild(composition);
  }

  // ---- tool activity: per-category totals, same visual language as Tokens ----
  if (request.tools?.length) {
    card.appendChild(subHeading('Tool activity'));
    card.appendChild(renderToolActivityChart(request.tools));
  }

  // ---- tools table (sortable on heading click) ----
  if (request.tools?.length) {
    card.appendChild(subHeading(`Tools (${request.tools.length})`));
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll tools-scroll';
    const table = document.createElement('table');
    table.className = 'conv-table tools-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of TOOLS_COLUMNS) {
      const th = document.createElement('th');
      if (col.numeric) th.className = 'numeric';
      if (col.key) {
        th.setAttribute(
          'aria-sort',
          state.toolsSortKey === col.key ? (state.toolsSortDir === 'asc' ? 'ascending' : 'descending') : 'none'
        );
        const button = document.createElement('button');
        button.className = 'th-button' + (state.toolsSortKey === col.key ? ' active' : '');
        button.textContent = col.label + toolsSortArrow(col.key);
        button.title = `Sort by ${col.label.toLowerCase()}`;
        button.addEventListener('click', () => setToolsSort(col.key!));
        th.appendChild(button);
      } else {
        th.textContent = col.label;
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedTools(request.tools).forEach(({ tool, order }) => {
      const tr = document.createElement('tr');
      const cells: { text: string; numeric?: boolean; className?: string; tooltip?: string }[] = [
        { text: String(order), className: 'muted' },
        { text: tool.name },
        { text: tool.inputPreview ?? '—', className: 'cell-target', tooltip: tool.inputPreview },
        { text: formatTokensCompact(tool.inputChars), numeric: true, tooltip: `${formatTokens(tool.inputChars)} input chars` },
        {
          text: tool.outputChars !== undefined ? formatTokensCompact(tool.outputChars) : '—',
          numeric: true,
          tooltip: tool.outputChars !== undefined ? `${formatTokens(tool.outputChars)} output chars` : 'no result recorded'
        },
        {
          text: toolDuration(tool),
          numeric: true,
          tooltip: tool.durationSource === 'derived' ? 'Derived from tool_use → tool_result timestamps' : undefined
        },
        { text: tool.isError ? '⚠' : '', className: tool.isError ? 'tool-error' : undefined, tooltip: tool.isError ? 'Tool returned an error' : undefined }
      ];
      for (const cell of cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.numeric) td.classList.add('numeric');
        if (cell.className) td.classList.add(cell.className);
        if (cell.tooltip) td.title = cell.tooltip;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);

      if (tool.agentId) {
        const subRow = document.createElement('tr');
        subRow.className = 'subagent-row';
        const td = document.createElement('td');
        td.colSpan = 7;
        const bits = [`↳ subagent ${tool.agentId.slice(0, 10)}…`];
        if (tool.subagentModel) bits.push(shortModelName(tool.subagentModel));
        if (tool.subagentTokens !== undefined) bits.push(`${formatTokensCompact(tool.subagentTokens)} tokens`);
        if (tool.subagentCostUsd !== undefined) bits.push(formatUsd(tool.subagentCostUsd));
        td.textContent = bits.join(' · ');
        td.title = 'Delegated work: totals scanned from the subagent transcript, billed in addition to this conversation';
        subRow.appendChild(td);
        tbody.appendChild(subRow);
      }
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);
  }

  // ---- shares of the conversation ----
  const shares = document.createElement('div');
  shares.className = 'shares';
  const costShare = maybeShareRow('Share of conversation cost', request.cost.usd, detail.totalCost.usd);
  if (costShare) shares.appendChild(costShare);
  shares.appendChild(shareRow('Share of conversation tokens', tokenTotal(request.usage), tokenTotal(detail.totalUsage)));
  card.appendChild(shares);

  container.appendChild(card);
}

// ---- conversations table ------------------------------------------------------------

const TABLE_COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Conversation' },
  { key: 'requestCount', label: 'Prompts', numeric: true },
  { key: 'firstAt', label: 'First message' },
  { key: 'lastAt', label: 'Last message' },
  { key: 'totalTokens', label: 'Tokens', numeric: true },
  { key: 'totalCostUsd', label: 'Cost', numeric: true }
];

function renderTable(container: HTMLElement, items: ConversationListItem[]): void {
  container.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.filter.trim() ? 'No conversation matches the filter.' : emptyMessage();
    container.appendChild(empty);
    return;
  }

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'conv-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of TABLE_COLUMNS) {
    const th = document.createElement('th');
    if (column.numeric) th.className = 'numeric';
    th.setAttribute(
      'aria-sort',
      state.sortKey === column.key ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
    );
    const button = document.createElement('button');
    button.className = 'th-button' + (state.sortKey === column.key ? ' active' : '');
    button.textContent = column.label + sortArrow(column.key);
    button.title = `Sort by ${column.label.toLowerCase()}`;
    button.addEventListener('click', () => setSort(column.key));
    th.appendChild(button);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.className = item.id === activeConversationId() ? 'active' : '';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `Open conversation: ${item.title}`);

    const cells: { text: string; tooltip?: string; numeric?: boolean; className?: string }[] = [
      { text: item.title, tooltip: item.title, className: 'cell-title' },
      { text: String(item.requestCount), numeric: true },
      { text: formatShortDate(item.firstAt), tooltip: formatExact(item.firstAt) },
      { text: formatRelative(item.lastAt), tooltip: formatExact(item.lastAt) },
      { text: formatTokensCompact(item.totalTokens), tooltip: `${formatTokens(item.totalTokens)} tokens`, numeric: true },
      { text: formatUsd(item.totalCostUsd), numeric: true }
    ];
    for (const cell of cells) {
      const td = document.createElement('td');
      td.textContent = cell.text;
      if (cell.tooltip) td.title = cell.tooltip;
      if (cell.numeric) td.classList.add('numeric');
      if (cell.className) td.classList.add(cell.className);
      tr.appendChild(td);
    }

    tr.addEventListener('click', () => openConversation(item.id));
    tr.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openConversation(item.id);
      }
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  container.appendChild(scroll);
}

// ---- layouts B & C: stacked panels ---------------------------------------------------

/** Live references into the current stack render, for focus-preserving filter updates. */
interface StackRefs {
  chartBody?: HTMLElement;
  tableResults?: HTMLElement;
  tableCount?: HTMLElement;
  summaries: Partial<Record<SectionId, HTMLElement>>;
}
let stackRefs: StackRefs = { summaries: {} };

function sectionSummary(id: SectionId, items: ConversationListItem[]): string {
  if (id === 'chart') {
    if (items.length === 0) return 'no conversations';
    const shown = Math.min(items.length, OVERVIEW_CHART_MAX_ROWS);
    return shown === items.length
      ? `${items.length} conversation${items.length === 1 ? '' : 's'} by ${SORT_LABELS[state.sortKey]}`
      : `top ${shown} of ${items.length} by ${SORT_LABELS[state.sortKey]}`;
  }
  if (id === 'table') {
    const total = (state.conversationsByProvider[state.selectedProvider] ?? []).length;
    return items.length === total
      ? `${total} conversation${total === 1 ? '' : 's'}`
      : `${items.length} of ${total} conversations`;
  }
  if (id === 'limits') {
    return limitsSummaryText(state.detail?.currentStatus);
  }
  if (id === 'context') {
    return contextSummaryText(state.detail?.currentStatus);
  }
  if (id === 'thread') {
    if (state.loadingId && state.detail?.id !== state.loadingId) return 'loading…';
    const detail = state.detail;
    if (!detail) return 'none selected';
    return `${detail.title ?? '(untitled)'} — ${detail.requests.length} prompt${detail.requests.length === 1 ? '' : 's'} · ${formatTokensCompact(
      tokenTotal(detail.totalUsage)
    )} tokens · ${formatUsd(detail.totalCost.usd)}`;
  }
  if (id === 'toolTimeline') {
    const detail = state.detail;
    const request = detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
    if (!request) return 'none selected';
    if (!request.tools?.length) return 'no tool calls';
    const hasTime = request.tools.some((t) => t.durationMs !== undefined);
    return `${request.tools.length} call${request.tools.length === 1 ? '' : 's'}` + (hasTime ? '' : ' · time unavailable');
  }
  const detail = state.detail;
  const request = detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
  if (!request) return 'none selected';
  const time = state.layout === 'D' && request.durationMs !== undefined ? ` · ${formatDurationMs(request.durationMs)}` : '';
  return `#${request.index + 1} · ${request.toolCallCount} tools${time} · ${formatUsd(request.cost.usd)}`;
}

function renderSectionBody(id: SectionId, body: HTMLElement, items: ConversationListItem[]): void {
  if (id === 'chart') {
    stackRefs.chartBody = body;
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = emptyMessage();
      body.appendChild(empty);
      return;
    }
    renderOverviewChart(body, items, (convId) => openConversation(convId), activeConversationId());
    return;
  }

  if (id === 'table') {
    const toolbar = document.createElement('div');
    toolbar.className = 'overview-toolbar';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'filter-input';
    filter.placeholder = 'Filter by title…';
    filter.value = state.filter;
    filter.setAttribute('aria-label', 'Filter conversations by title');
    const count = document.createElement('span');
    count.className = 'overview-count';
    count.textContent = sectionSummary('table', items);
    toolbar.append(filter);
    toolbar.appendChild(count);
    body.appendChild(toolbar);

    const results = document.createElement('div');
    body.appendChild(results);
    renderTable(results, items);

    stackRefs.tableResults = results;
    stackRefs.tableCount = count;
    filter.addEventListener('input', () => {
      state.filter = filter.value;
      refreshStackData();
    });
    return;
  }

  if (id === 'limits') {
    renderProviderLimitsSection(body);
    return;
  }

  if (id === 'context') {
    renderContextStatusSection(body);
    return;
  }

  if (id === 'thread') {
    if (state.loadingId && state.detail?.id !== state.loadingId) {
      const loading = document.createElement('div');
      loading.className = 'empty';
      loading.textContent = 'Loading conversation…';
      body.appendChild(loading);
      return;
    }
    if (!state.detail) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Select a conversation in the table above.';
      body.appendChild(empty);
      return;
    }
    renderThreadHeader(body);
    renderThreadChart(body);
    return;
  }

  if (id === 'toolTimeline') {
    const detail = state.detail;
    const request = detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
    if (!request) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Click a bar in the conversation chart to inspect a prompt.';
      body.appendChild(empty);
      return;
    }
    renderToolCallLanes(body, request.tools ?? []);
    return;
  }

  // request
  const detail = state.detail;
  const request = detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
  if (!request) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Click a bar in the conversation chart to inspect a prompt.';
    body.appendChild(empty);
    return;
  }
  if (state.layout === 'D') renderEnrichedRequestCard(body);
  else renderDetailCard(body);
}

/** Re-render only the data-dependent stack pieces so the filter input keeps focus. */
function refreshStackData(): void {
  const items = visibleItems();
  if (stackRefs.chartBody) {
    stackRefs.chartBody.innerHTML = '';
    renderSectionBody('chart', stackRefs.chartBody, items);
  }
  if (stackRefs.tableResults) renderTable(stackRefs.tableResults, items);
  if (stackRefs.tableCount) stackRefs.tableCount.textContent = sectionSummary('table', items);
  for (const id of ['chart', 'table'] as SectionId[]) {
    const summary = stackRefs.summaries[id];
    if (summary) summary.textContent = sectionSummary(id, items);
  }
}

function toggleSection(id: SectionId): void {
  state.sectionsCollapsed[id] = !state.sectionsCollapsed[id];
  persistState();
  render();
}

function renderSideBar(container: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'side-bar';
  for (const section of visibleSections()) {
    const collapsed = !!state.sectionsCollapsed[section.id];
    const button = document.createElement('button');
    button.className = 'side-icon' + (collapsed ? '' : ' active');
    button.textContent = section.icon;
    button.title = `${section.title} — ${collapsed ? 'expand' : 'collapse'}`;
    button.setAttribute('aria-pressed', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} panel: ${section.title}`);
    button.addEventListener('click', () => toggleSection(section.id));
    bar.appendChild(button);
  }
  container.appendChild(bar);
}

function renderStack(container: HTMLElement, layout: 'B' | 'C' | 'D'): void {
  stackRefs = { summaries: {} };

  if (layout !== 'C') renderSideBar(container);

  const stack = document.createElement('div');
  stack.className = 'stack-pane';
  renderWorkspaceScope(stack);
  renderTabs(stack);

  const items = visibleItems();

  for (const section of visibleSections()) {
    const collapsed = !!state.sectionsCollapsed[section.id];

    const sectionEl = document.createElement('section');
    sectionEl.className = 'section' + (collapsed ? ' collapsed' : '');
    sectionEl.dataset.section = section.id;

    const summary = document.createElement('span');
    summary.className = 'section-summary';
    summary.textContent = sectionSummary(section.id, items);
    stackRefs.summaries[section.id] = summary;

    const title = document.createElement('span');
    title.className = 'section-title';
    title.textContent = section.title;

    const head = document.createElement('button');
    head.className = 'section-head';
    head.setAttribute('aria-expanded', String(!collapsed));
    head.title = collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`;
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = collapsed ? '▸' : '▾';
    const icon = document.createElement('span');
    icon.className = 'section-icon';
    icon.textContent = section.icon;
    head.append(chevron, icon, title, summary);
    head.addEventListener('click', () => toggleSection(section.id));
    sectionEl.appendChild(head);

    if (!collapsed) {
      const body = document.createElement('div');
      body.className = 'section-body';
      renderSectionBody(section.id, body, items);
      sectionEl.appendChild(body);
    }

    stack.appendChild(sectionEl);
  }

  container.appendChild(stack);
}

function applyDetail(detail: ConversationDetailPayload | undefined, preserveSelection: boolean): void {
  const sameConversation =
    preserveSelection &&
    !!detail &&
    !!state.detail &&
    detail.provider === state.detail.provider &&
    detail.id === state.detail.id;
  const previousRequestIndex = sameConversation ? state.selectedRequestIndex : undefined;
  state.detail = detail;
  state.selectedRequestIndex =
    detail && detail.requests.length > 0
      ? previousRequestIndex !== undefined
        ? Math.min(previousRequestIndex, detail.requests.length - 1)
        : detail.requests.length - 1
      : undefined;
  state.loadingId = undefined;
  state.promptExpanded = false;
  if (detail) state.selectedProvider = detail.provider;
}

// ---- storage footer -----------------------------------------------------------------

/**
 * Non-collapsible, always at the bottom of the page (surfaces-and-privacy.md
 * "Storage Footer"). Every adapter today stays in-memory-only, so this
 * always reads "no local data stored" — it exists so that fact is a visible
 * guarantee, not just a policy, the moment any adapter ever does persist
 * something to disk.
 */
function renderStorageFooter(container: HTMLElement): void {
  const footer = document.createElement('div');
  footer.className = 'storage-footer';
  footer.textContent = 'No local data stored — Agent Context Trail reads provider logs directly and writes nothing of its own to disk.';
  container.appendChild(footer);
}

// ---- root render ------------------------------------------------------------------

function render(): void {
  const app = root();
  const previousStack = app.querySelector('.stack-pane');
  const previousScroll = previousStack ? previousStack.scrollTop : 0;

  app.innerHTML = '';
  if (LAYOUT_EXPERIMENTS) renderDesignBar(app);

  const body = document.createElement('div');
  body.className = 'layout-body';
  if (state.layout === 'A') {
    renderLayoutA(body);
  } else {
    renderStack(body, state.layout);
  }
  app.appendChild(body);
  renderStorageFooter(app);

  // Selections update panels in place: restore the scroll position exactly,
  // never animate or jump the page.
  const stack = app.querySelector('.stack-pane');
  if (stack) stack.scrollTop = previousScroll;
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    state.providers = message.providers;
    state.workspacePath = message.workspacePath;
    state.conversationsByProvider = message.conversationsByProvider;
    applyDetail(message.selected, true);
    render();
  } else if (message.type === 'conversationDetail') {
    applyDetail(message.detail, false);
    render();
  }
});

render();
post({ type: 'ready' });
