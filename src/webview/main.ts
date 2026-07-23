import {
  categoryColorMap,
  COST_COLOR,
  CostMapSelection,
  CostMapVariant,
  formatDurationMs,
  formatTokens,
  formatTokensCompact,
  gapBeforeMs,
  llmCallSpanMs,
  renderChart,
  renderCostMapChart,
  renderOverviewChart,
  renderPromptTimeline,
  shortModelName,
  timelineEvents,
  TimelineSelection,
  OVERVIEW_CHART_MAX_ROWS,
  TOKEN_SERIES,
  tokenTotal
} from './chart';
import { CostMapExclusions, CostMapPoint, deriveCostMapPoints, emptyExclusions } from '../domain/costMap';
import { ConversationDetailPayload, CostMapPeriodPayload, HostToWebviewMessage, WebviewToHostMessage } from '../panel/protocol';
import {
  ConversationListItem,
  CurrentStatusSnapshot,
  LlmCallInfo,
  PayloadExcerpt,
  PromptRequest,
  ProviderId,
  ToolCallDetail,
  ToolCallInfo
} from '../domain/types';
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
type SortKey = 'title' | 'firstAt' | 'lastAt' | 'durationMs' | 'requestCount' | 'totalTokens' | 'totalCostUsd';
type SortDir = 'asc' | 'desc';
type SectionId = 'chart' | 'table' | 'limits' | 'context' | 'thread' | 'request' | 'toolTimeline' | 'tools' | 'callDetail' | 'costMap';
type TableTimeFilter = 'all' | 'day' | 'week' | 'month';
/** Prompt cost map scope toggle (plans/2026-07/19/prompt-cost-map OP-001). */
type CostMapScope = 'conversation' | 'period';
/** Tools table (Layout D request card): '#' is call order, not a sortable metric. */
type ToolSortKey = 'order' | 'name' | 'target' | 'in' | 'out' | 'time';

const LAYOUTS: { id: LayoutId; label: string; hint: string }[] = [
  { id: 'D', label: 'D · Enriched', hint: 'Stacked panels plus timeline lanes, cache breaks, and a deep prompt card' }
];

const SECTIONS: { id: SectionId; title: string; icon: string; hint: string }[] = [
  { id: 'limits', title: 'Provider Limits (Last seen)', icon: '≡', hint: 'Last recorded provider plan and rate-limit usage' },
  { id: 'chart', title: 'Tokens per conversation', icon: '▦', hint: 'Token totals per conversation' },
  { id: 'table', title: 'Conversations', icon: '☰', hint: 'Sortable, filterable conversations table' },
  { id: 'context', title: 'Current Context Status', icon: '≣', hint: 'Selected conversation context occupancy' },
  { id: 'costMap', title: 'Prompt cost map', icon: '⊛', hint: 'Cost bubbles per prompt: context growth or LLM calls vs context work' },
  { id: 'thread', title: 'Conversation', icon: '∿', hint: 'Selected conversation, prompt by prompt' },
  { id: 'toolTimeline', title: 'Prompt timeline', icon: '▥', hint: 'LLM and tool calls of the selected prompt, in sequence' },
  { id: 'request', title: 'Prompt detail', icon: '◎', hint: 'Selected prompt breakdown' },
  { id: 'tools', title: 'Tools', icon: '⚙', hint: 'Every tool call of the selected prompt — click a row for its call detail below' },
  { id: 'callDetail', title: 'Call detail', icon: '⌖', hint: 'Bounded detail for the selected LLM or tool call' }
];

const TABLE_PAGE_SIZE = 100;
const TABLE_TIME_FILTERS: { key: TableTimeFilter; label: string; days?: number }[] = [
  { key: 'all', label: 'All time' },
  { key: 'day', label: 'Last day', days: 1 },
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: 'Last month', days: 30 }
];

interface PersistedState {
  layout?: LayoutId;
  sectionsCollapsed?: Partial<Record<SectionId, boolean>>;
  costMapScope?: CostMapScope;
  costMapPeriod?: TableTimeFilter;
  costMapVariant?: CostMapVariant;
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
  tableTimeFilter: TableTimeFilter;
  tablePage: number;
  /** Layouts B and C: panels collapsed to their heading bar. */
  sectionsCollapsed: Partial<Record<SectionId, boolean>>;
  /** Layout D: tools table sort, shared across whichever request is selected. */
  toolsSortKey: ToolSortKey;
  toolsSortDir: SortDir;
  /** Layout D: whether the current request's full prompt is expanded. Lives in
   * state (not a local DOM closure) so it survives the full re-render any
   * other in-card control (e.g. sorting the tools table) triggers. */
  promptExpanded: boolean;
  /** Call selected in the Prompt timeline / Tools table, driving Call detail. */
  selectedCall?: TimelineSelection;
  /** Prompt cost map: scope toggle, period filter, and optional model filter (DD-009/DD-020). */
  costMapScope: CostMapScope;
  costMapPeriod: TableTimeFilter;
  costMapModelFilter?: string;
  /** Prompt cost map chart projection (plans/2026-07/23/cost-map-calls-variant). */
  costMapVariant: CostMapVariant;
  /** Period-mode point activation on another conversation: prompt to select once its detail arrives. */
  pendingPromptSelect?: { conversationId: string; promptIndex: number };
  /** Storage Footer lines supplied host-side (Copilot OTel status + storage guarantee). */
  storageFooter?: string[];
}

/**
 * On-demand tool-call excerpts (plans/2026-07/07/call-details OP-101), keyed
 * `${provider}/${conversationId}/${toolCallId}`. 'loading' while the host
 * fetch is in flight. Kept outside `state`: it is a cache, not view state.
 */
const toolDetailCache = new Map<string, ToolCallDetail | 'loading'>();

function toolDetailKey(provider: ProviderId, conversationId: string, toolCallId: string): string {
  return `${provider}/${conversationId}/${toolCallId}`;
}

/**
 * Selected-period projections for the Prompt cost map, keyed
 * `${provider}/${days ?? 'all'}`; 'loading' while the host query is in
 * flight. A cache, not view state. On every init the entries are marked
 * stale instead of dropped: the stale points keep rendering (so the page
 * height — and with it the scroll position — never jumps on the periodic
 * refresh) while a fresh query runs in the background.
 */
const costMapPeriodCache = new Map<string, CostMapPeriodPayload | 'loading'>();
const costMapPeriodStale = new Set<string>();

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
  tableTimeFilter: 'all',
  tablePage: 0,
  sectionsCollapsed: persisted?.sectionsCollapsed ?? {},
  toolsSortKey: 'order',
  toolsSortDir: 'asc',
  promptExpanded: false,
  costMapScope: persisted?.costMapScope === 'period' ? 'period' : 'conversation',
  costMapPeriod:
    persisted?.costMapPeriod && TABLE_TIME_FILTERS.some((f) => f.key === persisted.costMapPeriod)
      ? persisted.costMapPeriod
      : 'all',
  costMapVariant: persisted?.costMapVariant === 'calls' ? 'calls' : 'context'
};

function persistState(): void {
  vscodeApi.setState({
    layout: state.layout,
    sectionsCollapsed: state.sectionsCollapsed,
    costMapScope: state.costMapScope,
    costMapPeriod: state.costMapPeriod,
    costMapVariant: state.costMapVariant
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

function conversationDurationMs(item: ConversationListItem): number | undefined {
  if (!item.firstAt) return undefined;
  const startMs = Date.parse(item.firstAt);
  const endMs = Date.parse(item.lastAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
  return Math.max(endMs - startMs, 0);
}

function formatConversationDuration(item: ConversationListItem): string {
  const durationMs = conversationDurationMs(item);
  return durationMs === undefined ? 'â€”' : formatDurationMs(durationMs);
}

function limitsSummaryText(status: CurrentStatusSnapshot | undefined): string {
  if (!status?.rateLimits) return 'unavailable';
  const parts: string[] = [];
  if (isRateLimitSnapshotStale(status.rateLimits)) parts.push('stale');
  if (status.rateLimits.planType) parts.push(status.rateLimits.planType);
  if (status.rateLimits.primary?.usedPercent !== undefined) {
    parts.push(`${status.rateLimits.primary.usedPercent.toFixed(0)}% used`);
  }
  if (!isRateLimitSnapshotStale(status.rateLimits) && status.rateLimits.observedAt) {
    parts.push(`seen ${formatRelative(status.rateLimits.observedAt)}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'unavailable';
}

function isRateLimitSnapshotStale(rateLimits: NonNullable<CurrentStatusSnapshot['rateLimits']>): boolean {
  return [rateLimits.primary, rateLimits.secondary].some((window) =>
    isRateLimitWindowSnapshotStale(window, rateLimits.observedAt)
  );
}

function isRateLimitWindowSnapshotStale(
  window: { resetsAt?: string } | undefined,
  observedAt: string | undefined
): boolean {
  if (!window?.resetsAt) return false;
  const resetMs = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetMs) || resetMs > Date.now()) return false;
  if (!observedAt) return true;
  const observedMs = Date.parse(observedAt);
  return !Number.isFinite(observedMs) || observedMs < resetMs;
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
  const visible = SECTIONS.filter((section) => {
    if (section.id === 'limits') return hasProviderLimits(state.selectedProvider, status);
    if (section.id === 'context') return hasContextStatus(state.selectedProvider, status);
    return true;
  }).map((section) =>
    section.id === 'context'
      ? {
          ...section,
          title: 'Last Context Status',
          hint: 'Last recorded selected-conversation context occupancy'
        }
      : section
  );
  const contextIndex = visible.findIndex((section) => section.id === 'context');
  const limitsIndex = visible.findIndex((section) => section.id === 'limits');
  if (contextIndex > limitsIndex && limitsIndex !== -1) {
    const [contextSection] = visible.splice(contextIndex, 1);
    visible.splice(limitsIndex + 1, 0, contextSection);
  }
  return visible;
}

// ---- sorting / filtering ----------------------------------------------------

const DEFAULT_DESC: ReadonlySet<SortKey> = new Set(['firstAt', 'lastAt', 'durationMs', 'requestCount', 'totalTokens', 'totalCostUsd']);

const SORT_LABELS: Record<SortKey, string> = {
  title: 'title',
  firstAt: 'first message',
  lastAt: 'last message',
  durationMs: 'session duration',
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
  if (sortKey === 'durationMs') {
    const av = conversationDurationMs(a);
    const bv = conversationDurationMs(b);
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return sign * (av - bv);
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

function matchesTableTimeFilter(item: ConversationListItem): boolean {
  if (state.tableTimeFilter === 'all') return true;
  const lastAtMs = Date.parse(item.lastAt);
  if (!Number.isFinite(lastAtMs)) return false;
  const days = TABLE_TIME_FILTERS.find((filter) => filter.key === state.tableTimeFilter)?.days;
  if (!days) return true;
  return lastAtMs >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function filteredItems(): ConversationListItem[] {
  const items = [...(state.conversationsByProvider[state.selectedProvider] ?? [])];
  items.sort(compareItems);
  const titleNeedle = state.filter.trim().toLowerCase();
  return items.filter((item) => (!titleNeedle || item.title.toLowerCase().includes(titleNeedle)) && matchesTableTimeFilter(item));
}

function tablePageCount(items: ConversationListItem[]): number {
  return Math.max(1, Math.ceil(items.length / TABLE_PAGE_SIZE));
}

function clampTablePage(items: ConversationListItem[]): void {
  state.tablePage = Math.max(0, Math.min(state.tablePage, tablePageCount(items) - 1));
}

function paginatedItems(items: ConversationListItem[]): ConversationListItem[] {
  clampTablePage(items);
  const start = state.tablePage * TABLE_PAGE_SIZE;
  return items.slice(start, start + TABLE_PAGE_SIZE);
}

function tablePageLabel(items: ConversationListItem[]): string {
  if (items.length === 0) return 'No conversations';
  clampTablePage(items);
  const start = state.tablePage * TABLE_PAGE_SIZE + 1;
  const end = Math.min(items.length, (state.tablePage + 1) * TABLE_PAGE_SIZE);
  const total = (state.conversationsByProvider[state.selectedProvider] ?? []).length;
  const suffix = items.length === total ? '' : ` filtered from ${total}`;
  return `Showing ${start}-${end} of ${items.length}${suffix}`;
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
  state.sectionsCollapsed.tools = false;
  state.promptExpanded = false;
  state.selectedCall = undefined;
  persistState();
  render();
}

/** Current selected request, when the loaded detail has one. */
function selectedRequest(): PromptRequest | undefined {
  const detail = state.detail;
  return detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
}

/**
 * Selects one call (timeline column, Tools-table row, or stepper) and drives
 * the Call detail section; tool calls trigger the on-demand excerpt fetch.
 */
function selectCall(selection: TimelineSelection): void {
  state.selectedCall = selection;
  state.sectionsCollapsed.callDetail = false;
  persistState();

  const detail = state.detail;
  const request = selectedRequest();
  if (detail && request && selection.kind === 'tool') {
    const tool = request.tools?.[selection.index];
    if (tool) {
      const key = toolDetailKey(detail.provider, detail.id, tool.id);
      if (!toolDetailCache.has(key)) {
        toolDetailCache.set(key, 'loading');
        post({ type: 'getToolCallDetail', provider: detail.provider, conversationId: detail.id, toolCallId: tool.id });
      }
    }
  }
  render();
}

function selectProvider(provider: ProviderId): void {
  state.selectedProvider = provider;
  state.tablePage = 0;
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
  const items = filteredItems();
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
    empty.textContent = 'Select a conversation to inspect last seen provider limits.';
    container.appendChild(empty);
    return;
  }

  const status = detail.currentStatus;
  if (!status?.rateLimits) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No provider-limit snapshot was recorded for ${PROVIDER_LABELS[detail.provider]}.`;
    container.appendChild(empty);
    return;
  }

  const block = document.createElement('div');
  block.className = 'status-block';
  const body = document.createElement('div');
  body.className = 'status-card';
  if (
    status.rateLimits.planType ||
    status.rateLimits.limitId ||
    status.rateLimits.rateLimitReachedType ||
    status.rateLimits.observedAt
  ) {
    const summary = document.createElement('div');
    summary.className = 'status-card-summary';
    const bits: string[] = [];
    if (status.rateLimits.planType) bits.push(`plan ${status.rateLimits.planType}`);
    if (status.rateLimits.limitId) bits.push(status.rateLimits.limitId);
    if (status.rateLimits.rateLimitReachedType) bits.push(`reached ${status.rateLimits.rateLimitReachedType}`);
    if (status.rateLimits.observedAt) bits.push(`last seen ${formatExact(status.rateLimits.observedAt)}`);
    if (isRateLimitSnapshotStale(status.rateLimits)) bits.push('stale after reset');
    summary.textContent = bits.join(' | ');
    body.appendChild(summary);
  }

  for (const window of [status.rateLimits.primary, status.rateLimits.secondary]) {
    if (!window) continue;
    const bits: string[] = [];
    const windowDuration = formatWindowDuration(window.windowMinutes);
    if (windowDuration) bits.push(windowDuration);
    if (window.resetsAt) bits.push(`resets ${formatExact(window.resetsAt)}`);
    if (isRateLimitWindowSnapshotStale(window, status.rateLimits.observedAt)) bits.push('stale after reset');
    body.appendChild(
      compactStatusMeter({
        usedText: window.usedPercent !== undefined ? `${formatPercentValue(window.usedPercent)} used` : 'used unavailable',
        remainingText:
          window.usedPercent !== undefined ? `${formatPercentValue(Math.max(0, 100 - window.usedPercent))} remaining` : undefined,
        fillPercent: window.usedPercent,
        tone: limitTone(window.usedPercent),
        meta: bits.join(' | ')
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
    empty.textContent = 'Select a conversation to inspect last context status.';
    container.appendChild(empty);
    return;
  }

  const status = detail.currentStatus;
  if (!status?.context) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No last context status was recorded for ${PROVIDER_LABELS[detail.provider]}.`;
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

  // ---- shares of the conversation ----
  const shares = document.createElement('div');
  shares.className = 'shares';
  const costShare = maybeShareRow('Share of conversation cost', request.cost.usd, detail.totalCost.usd);
  if (costShare) shares.appendChild(costShare);
  shares.appendChild(shareRow('Share of conversation tokens', tokenTotal(request.usage), tokenTotal(detail.totalUsage)));
  card.appendChild(shares);

  container.appendChild(card);
}

// ---- Tools section: the selected prompt's per-call table -----------------------------
// Sortable on heading click; a row selects the call and drives the Call
// detail section directly below.

function renderToolsSection(body: HTMLElement): void {
  const request = selectedRequest();
  if (!request) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Click a bar in the conversation chart to inspect a prompt.';
    body.appendChild(empty);
    return;
  }
  if (!request.tools?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tool calls in this prompt.';
    body.appendChild(empty);
    return;
  }

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
    // '#' is the call's position in the actual sequence, so order-1 is the
    // tools[] index — the same key the Prompt timeline columns select on.
    if (state.selectedCall?.kind === 'tool' && state.selectedCall.index === order - 1) tr.classList.add('active');
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `Inspect tool call ${order}: ${tool.name}`);
    tr.addEventListener('click', () => selectCall({ kind: 'tool', index: order - 1 }));
    tr.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectCall({ kind: 'tool', index: order - 1 });
      }
    });
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
  body.appendChild(scroll);
}

// ---- Call detail section (plans/2026-07/07/call-details) ---------------------------
// One section, card adapts to the selected call kind (OP-204). Cards keep a
// fixed anatomy — header + steppers, fields, snapshot zones of constant
// height, metrics footer — regardless of payload size (OP-102): the webview
// only ever receives bounded excerpts, never full payloads.

/** Input keys rendered as directory + file name + extension badge (OP-103). */
const FILE_FIELD_KEYS = new Set(['file_path', 'filePath', 'path', 'notebook_path', 'absolute_path']);
/** Input keys rendered as a monospace value (commands, patterns, globs). */
const CODE_FIELD_KEYS = new Set(['command', 'pattern', 'glob', 'old_string', 'new_string', 'query', 'q', 'url']);

function fieldRow(key: string, valueEl: HTMLElement): HTMLElement[] {
  const keyEl = document.createElement('div');
  keyEl.className = 'call-field-key';
  keyEl.textContent = key;
  return [keyEl, valueEl];
}

function textFieldValue(value: string, mono: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'call-field-value' + (mono ? ' mono' : '');
  el.textContent = value;
  el.title = value;
  return el;
}

/** Directory (muted) + file name (strong) + extension badge. */
function fileFieldValue(path: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'call-field-value mono';
  el.title = path;
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  if (dir) {
    const dirEl = document.createElement('span');
    dirEl.className = 'call-file-dir';
    dirEl.textContent = dir;
    el.appendChild(dirEl);
  }
  const baseEl = document.createElement('span');
  baseEl.className = 'call-file-name';
  baseEl.textContent = base;
  el.appendChild(baseEl);
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = base.slice(dot + 1).toLowerCase();
    el.appendChild(badge);
  }
  return el;
}

function renderCallFields(container: HTMLElement, detail: ToolCallDetail): void {
  const grid = document.createElement('div');
  grid.className = 'call-fields';
  for (const field of detail.fields) {
    const valueEl = FILE_FIELD_KEYS.has(field.key)
      ? fileFieldValue(field.value)
      : textFieldValue(field.value, CODE_FIELD_KEYS.has(field.key));
    grid.append(...fieldRow(field.key, valueEl));
  }
  if (detail.fields.length > 0) container.appendChild(grid);
}

/**
 * Fixed-height monospace snapshot zone: head lines, a skipped-chars
 * separator, tail lines (OP-102: 8 + 4). The zone keeps its height whether
 * the payload is 3 lines, absent, or 200k chars — consistency over density.
 */
function snapshotBlock(caption: string, excerpt: PayloadExcerpt | undefined, emptyNote: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'snapshot-wrap';

  const head = document.createElement('div');
  head.className = 'snapshot-caption';
  if (excerpt) {
    const shownAll = !excerpt.tailLines && excerpt.skippedChars === 0;
    head.textContent =
      `${caption} · ${formatTokensCompact(excerpt.totalChars)} chars · ${excerpt.totalLines} line${excerpt.totalLines === 1 ? '' : 's'}` +
      (shownAll ? '' : ' · excerpt') +
      (excerpt.reconstructed ? ' · reconstructed from the log’s display tree' : '');
  } else {
    head.textContent = caption;
  }
  wrap.appendChild(head);

  const zone = document.createElement('div');
  zone.className = 'snapshot';
  if (!excerpt) {
    const note = document.createElement('div');
    note.className = 'snapshot-empty';
    note.textContent = emptyNote;
    zone.appendChild(note);
  } else {
    for (const line of excerpt.headLines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'snapshot-line';
      lineEl.textContent = line || ' ';
      zone.appendChild(lineEl);
    }
    if (excerpt.tailLines) {
      const sep = document.createElement('div');
      sep.className = 'snapshot-sep';
      sep.textContent = `⋯ ${formatTokensCompact(excerpt.skippedChars)} chars skipped ⋯`;
      zone.appendChild(sep);
      for (const line of excerpt.tailLines) {
        const lineEl = document.createElement('div');
        lineEl.className = 'snapshot-line';
        lineEl.textContent = line || ' ';
        zone.appendChild(lineEl);
      }
    }
  }
  wrap.appendChild(zone);
  return wrap;
}

/** Header row shared by both card kinds: title, badges, prev/next steppers walking the event sequence. */
function callCardHeader(card: HTMLElement, request: PromptRequest, titleText: string, badges: HTMLElement[]): void {
  const events = timelineEvents(request);
  const sel = state.selectedCall;
  const pos = sel
    ? events.findIndex(
        (e) =>
          (e.kind === 'tool' && sel.kind === 'tool' && e.toolIndex === sel.index) ||
          (e.kind === 'llm' && sel.kind === 'llm' && e.llmIndex === sel.index)
      )
    : -1;

  const header = document.createElement('div');
  header.className = 'detail-header';
  const title = document.createElement('h3');
  title.textContent = titleText;
  for (const badge of badges) title.appendChild(badge);
  header.appendChild(title);

  const steppers = document.createElement('div');
  steppers.className = 'call-steppers';
  const posLabel = document.createElement('span');
  posLabel.className = 'call-pos';
  posLabel.textContent = pos >= 0 ? `${pos + 1} of ${events.length}` : '';
  const mkStep = (label: string, target: number, hint: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'call-step';
    button.textContent = label;
    button.title = hint;
    button.disabled = target < 0 || target >= events.length;
    if (!button.disabled) {
      button.addEventListener('click', () => {
        const event = events[target];
        selectCall(event.kind === 'tool' ? { kind: 'tool', index: event.toolIndex } : { kind: 'llm', index: event.llmIndex });
      });
    }
    return button;
  };
  steppers.append(mkStep('‹', pos - 1, 'Previous call in the sequence'), posLabel, mkStep('›', pos + 1, 'Next call in the sequence'));
  header.appendChild(steppers);
  card.appendChild(header);
}

function badgeEl(text: string, warn = false): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'badge' + (warn ? ' badge-warn' : '');
  badge.textContent = text;
  return badge;
}

function renderToolCallCard(container: HTMLElement, request: PromptRequest, tool: ToolCallInfo, toolIndex: number): void {
  const detailPayload = state.detail;
  const card = document.createElement('div');
  card.className = 'detail-card enriched call-card';

  const toolCount = request.tools?.length ?? 0;
  const badges: HTMLElement[] = [];
  if (tool.isError) badges.push(badgeEl('error', true));
  callCardHeader(card, request, `#${toolIndex + 1} of ${toolCount} · ${tool.name}`, badges);

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  meta.textContent = [
    tool.startedAt ? formatExact(tool.startedAt) : undefined,
    tool.durationMs !== undefined ? `${tool.durationSource === 'derived' ? '≈' : ''}${formatDurationMs(tool.durationMs)}` : 'time unavailable'
  ]
    .filter(Boolean)
    .join(' · ');
  card.appendChild(meta);

  // ---- host-fetched bounded detail: fields + snapshots ----
  const key = detailPayload ? toolDetailKey(detailPayload.provider, detailPayload.id, tool.id) : undefined;
  const fetched = key ? toolDetailCache.get(key) : undefined;
  if (fetched === 'loading' || fetched === undefined) {
    const loading = document.createElement('div');
    loading.className = 'diag-row';
    loading.textContent = 'Loading call payload from the session log…';
    card.appendChild(loading);
    card.appendChild(snapshotBlock('INPUT', undefined, 'loading…'));
    card.appendChild(snapshotBlock('RESULT', undefined, 'loading…'));
  } else if (fetched.unavailable) {
    const warn = document.createElement('div');
    warn.className = 'diag-row warn';
    warn.textContent = `▲ ${fetched.unavailable}`;
    card.appendChild(warn);
    card.appendChild(snapshotBlock('INPUT', undefined, 'unavailable'));
    card.appendChild(snapshotBlock('RESULT', undefined, 'unavailable'));
  } else {
    renderCallFields(card, fetched);
    card.appendChild(
      snapshotBlock(
        fetched.inputPayloadKey ? `INPUT · ${fetched.inputPayloadKey}` : 'INPUT',
        fetched.inputExcerpt,
        fetched.fields.length > 0 ? 'no long text payload — the full input is the fields above' : 'no input payload recorded'
      )
    );
    card.appendChild(
      snapshotBlock(
        'RESULT',
        fetched.resultExcerpt,
        tool.outputChars === undefined ? 'no result recorded in this log' : 'result content not stored in this log'
      )
    );
  }

  // ---- metrics footer (always available from the eager parse) ----
  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.appendChild(chip('in', formatChars(tool.inputChars)));
  if (tool.outputChars !== undefined) chips.appendChild(chip('out', formatChars(tool.outputChars)));
  if (tool.durationMs !== undefined) {
    chips.appendChild(
      chip('time', `${tool.durationSource === 'derived' ? '≈' : ''}${formatDurationMs(tool.durationMs)}`,
        tool.durationSource === 'derived' ? 'Derived from tool_use → tool_result timestamps' : 'Provider-reported duration')
    );
  }
  if (tool.agentId) {
    chips.appendChild(chip('subagent', tool.agentId.slice(0, 10) + '…'));
    if (tool.subagentModel) chips.appendChild(chip('subagent model', shortModelName(tool.subagentModel)));
    if (tool.subagentTokens !== undefined) chips.appendChild(chip('subagent tokens', formatTokensCompact(tool.subagentTokens)));
    if (tool.subagentCostUsd !== undefined) chips.appendChild(chip('subagent cost', formatUsd(tool.subagentCostUsd)));
  }
  card.appendChild(chips);

  container.appendChild(card);
}

function renderLlmCallCard(container: HTMLElement, request: PromptRequest, call: LlmCallInfo, llmIndex: number): void {
  const card = document.createElement('div');
  card.className = 'detail-card enriched call-card';

  const llmCount = request.llmCalls?.length ?? 0;
  const badges: HTMLElement[] = [];
  if (call.model) badges.push(badgeEl(shortModelName(call.model)));
  callCardHeader(card, request, `LLM call L${llmIndex + 1} of ${llmCount}`, badges);

  const span = llmCallSpanMs(call);
  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  meta.textContent = [
    call.startedAt ? formatExact(call.startedAt) : undefined,
    span !== undefined ? `≈${formatDurationMs(span)} streaming` : undefined,
    call.stopReason ? `ended: ${call.stopReason.replace(/_/g, ' ')}` : undefined
  ]
    .filter(Boolean)
    .join(' · ');
  card.appendChild(meta);

  if (call.contextTokens !== undefined) {
    // context composition: cache read / cache write / fresh remainder — the
    // same provably-summing split the timeline's CONTEXT lane stacks.
    const cacheRead = Math.min(call.cacheReadTokens ?? 0, call.contextTokens);
    const cacheWrite = Math.min(call.cacheCreationTokens ?? 0, Math.max(0, call.contextTokens - cacheRead));
    const fresh = Math.max(0, call.contextTokens - cacheRead - cacheWrite);
    card.appendChild(subHeading('Context submitted with this call'));
    const breakdown = document.createElement('div');
    breakdown.className = 'breakdown';
    const max = Math.max(1, cacheRead, cacheWrite, fresh);
    breakdown.append(...breakdownRow('Cache read', cacheRead, max, TOKEN_SERIES[0].color));
    breakdown.append(...breakdownRow('Cache write', cacheWrite, max, TOKEN_SERIES[1].color));
    breakdown.append(...breakdownRow('Fresh', fresh, max, TOKEN_SERIES[2].color));
    const note = document.createElement('div');
    note.className = 'breakdown-note';
    note.textContent =
      `Total ${formatTokens(call.contextTokens)} tokens` +
      (call.modelContextWindow
        ? ` · ${((call.contextTokens / call.modelContextWindow) * 100).toFixed(1)}% of the ${formatTokensCompact(call.modelContextWindow)} window`
        : '');
    breakdown.appendChild(note);
    card.appendChild(breakdown);
  } else {
    const row = document.createElement('div');
    row.className = 'diag-row';
    row.textContent = 'Per-call token usage is not recorded in this provider’s log.';
    card.appendChild(row);
  }

  const chips = document.createElement('div');
  chips.className = 'chips';
  if (call.outputTokens !== undefined) chips.appendChild(chip('output', `${formatTokensCompact(call.outputTokens)} tok`));
  if (call.reasoningOutputTokens !== undefined && call.reasoningOutputTokens > 0) {
    chips.appendChild(chip('reasoning', `${formatTokensCompact(call.reasoningOutputTokens)} tok`, 'Included in output tokens (a breakdown, not an addition)'));
  }
  if (call.thinkingTokens !== undefined && call.thinkingTokens > 0) {
    chips.appendChild(chip('thinking', `${formatTokensCompact(call.thinkingTokens)} tok`));
  }
  if (call.costUsd !== undefined) chips.appendChild(chip('cost', formatUsd(call.costUsd), 'Estimated from the rate table — no provider reports per-call cost'));
  if (call.modelContextWindow !== undefined) chips.appendChild(chip('context window', formatTokensCompact(call.modelContextWindow)));
  card.appendChild(chips);

  container.appendChild(card);
}

function renderCallDetailSection(body: HTMLElement): void {
  const request = selectedRequest();
  if (!request) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Click a bar in the conversation chart to inspect a prompt.';
    body.appendChild(empty);
    return;
  }
  const sel = state.selectedCall;
  if (!sel) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Click a column in the Prompt timeline — or a row in the Tools table — to inspect a call.';
    body.appendChild(empty);
    return;
  }
  if (sel.kind === 'tool') {
    const tool = request.tools?.[sel.index];
    if (tool) renderToolCallCard(body, request, tool, sel.index);
    return;
  }
  const call = request.llmCalls?.[sel.index];
  if (call) renderLlmCallCard(body, request, call, sel.index);
}

// ---- Prompt cost map section (plans/2026-07/19/prompt-cost-map) ---------------------

const COST_MAP_SCOPES: { key: CostMapScope; label: string; hint: string }[] = [
  { key: 'conversation', label: 'Selected conversation', hint: 'Every prompt in the selected conversation' },
  {
    key: 'period',
    label: 'Selected period',
    hint: 'Every prompt of this workspace and provider inside the period filter'
  }
];

/** Chart projection toggle: same points, same cost-as-area, different axes. */
const COST_MAP_VARIANTS: { key: CostMapVariant; label: string; hint: string }[] = [
  {
    key: 'context',
    label: 'Context growth',
    hint: 'Start context (x) vs end context (y); bubble area = cost, color = LLM calls'
  },
  {
    key: 'calls',
    label: 'Calls vs work',
    hint: 'LLM calls (x) vs context work (y); bubble area = cost, color = cache-write share'
  }
];

function costMapPeriodDays(): number | undefined {
  return TABLE_TIME_FILTERS.find((filter) => filter.key === state.costMapPeriod)?.days;
}

function costMapPeriodLabel(): string {
  return TABLE_TIME_FILTERS.find((filter) => filter.key === state.costMapPeriod)?.label ?? 'All time';
}

function ensureCostMapPeriodData(): CostMapPeriodPayload | 'loading' {
  const key = `${state.selectedProvider}/${costMapPeriodDays() ?? 'all'}`;
  const cached = costMapPeriodCache.get(key);
  if (cached === 'loading') return cached;
  if (cached && !costMapPeriodStale.has(key)) return cached;
  // Stale-while-revalidate: keep serving the stale points while the fresh
  // query runs, so the section never shrinks to a loading placeholder.
  costMapPeriodStale.delete(key);
  if (!cached) costMapPeriodCache.set(key, 'loading');
  post({ type: 'getCostMapPeriod', provider: state.selectedProvider, days: costMapPeriodDays() });
  return cached ?? 'loading';
}

interface CostMapScopeData {
  points: CostMapPoint[];
  totalPrompts: number;
  excludedPrompts: number;
  reasons: CostMapExclusions;
  loading: boolean;
  /** Set in period scope only; prefixes the collapsed summary. */
  periodLabel?: string;
}

/** The cost-map input for the active scope; undefined when nothing is selected yet. */
function costMapData(): CostMapScopeData | undefined {
  if (state.costMapScope === 'conversation') {
    const detail = state.detail;
    if (!detail) return undefined;
    const derived = deriveCostMapPoints(detail.requests, { id: detail.id, title: detail.title });
    return { ...derived, loading: false };
  }
  const label = costMapPeriodLabel();
  const data = ensureCostMapPeriodData();
  if (data === 'loading') {
    return { points: [], totalPrompts: 0, excludedPrompts: 0, reasons: emptyExclusions(), loading: true, periodLabel: label };
  }
  return {
    points: data.points,
    totalPrompts: data.totalPrompts,
    excludedPrompts: data.excludedPrompts,
    reasons: data.reasons,
    loading: false,
    periodLabel: label
  };
}

function costMapSummary(): string {
  const data = costMapData();
  if (!data) return 'none selected';
  const prefix = data.periodLabel ? `${data.periodLabel} · ` : '';
  if (data.loading) return `${prefix}loading…`;
  const parts = [`${data.totalPrompts} prompt${data.totalPrompts === 1 ? '' : 's'}`, `${data.points.length} charted`];
  if (data.excludedPrompts > 0) parts.push(`${data.excludedPrompts} not charted`);
  if (data.points.length > 0) {
    parts.push(`${formatUsd(data.points.reduce((sum, p) => sum + p.costUsd, 0))} total`);
  }
  return prefix + parts.join(' · ');
}

function setCostMapScope(scope: CostMapScope): void {
  state.costMapScope = scope;
  state.costMapModelFilter = undefined;
  persistState();
  render();
}

function setCostMapPeriod(key: TableTimeFilter): void {
  state.costMapPeriod = key;
  state.costMapModelFilter = undefined;
  persistState();
  render();
}

function setCostMapVariant(variant: CostMapVariant): void {
  state.costMapVariant = variant;
  persistState();
  render();
}

/**
 * Point activation (OP-006/DD-020): reuse the existing selection path. A
 * point of the loaded conversation selects that prompt directly; a
 * period-mode point of another conversation loads that conversation first
 * and selects the prompt when its detail arrives. The page never scrolls —
 * render() restores scroll position.
 */
function selectCostMapPoint(point: CostMapPoint): void {
  const detail = state.detail;
  if (point.conversationId && point.conversationId !== detail?.id) {
    state.pendingPromptSelect = { conversationId: point.conversationId, promptIndex: point.promptIndex };
    state.loadingId = point.conversationId;
    state.sectionsCollapsed.thread = false;
    state.sectionsCollapsed.request = false;
    persistState();
    post({ type: 'selectConversation', provider: state.selectedProvider, id: point.conversationId });
    render();
    return;
  }
  selectRequest(point.promptIndex);
}

function costMapExclusionBits(reasons: CostMapExclusions): string[] {
  const bits: string[] = [];
  if (reasons.noLlmCalls > 0) bits.push(`no LLM calls ×${reasons.noLlmCalls}`);
  if (reasons.missingFirstContext > 0) bits.push(`missing first-call context ×${reasons.missingFirstContext}`);
  if (reasons.missingLastContext > 0) bits.push(`missing last-call context ×${reasons.missingLastContext}`);
  if (reasons.costUnavailable > 0) bits.push(`cost unavailable ×${reasons.costUnavailable}`);
  return bits;
}

function renderCostMapSection(body: HTMLElement): void {
  // scope toggle + period filter (period pills only in period mode, DD-020)
  const toolbar = document.createElement('div');
  toolbar.className = 'overview-toolbar';
  const scopePills = document.createElement('div');
  scopePills.className = 'filter-pills';
  for (const scope of COST_MAP_SCOPES) {
    const button = document.createElement('button');
    button.className = 'filter-pill' + (state.costMapScope === scope.key ? ' active' : '');
    button.textContent = scope.label;
    button.title = scope.hint;
    button.addEventListener('click', () => setCostMapScope(scope.key));
    scopePills.appendChild(button);
  }
  toolbar.appendChild(scopePills);
  if (state.costMapScope === 'period') {
    const periodPills = document.createElement('div');
    periodPills.className = 'filter-pills';
    for (const filter of TABLE_TIME_FILTERS) {
      const button = document.createElement('button');
      button.className = 'filter-pill' + (state.costMapPeriod === filter.key ? ' active' : '');
      button.textContent = filter.label;
      button.title = `Prompts whose start time falls in: ${filter.label.toLowerCase()}`;
      button.addEventListener('click', () => setCostMapPeriod(filter.key));
      periodPills.appendChild(button);
    }
    toolbar.appendChild(periodPills);
  }
  const variantPills = document.createElement('div');
  variantPills.className = 'filter-pills';
  for (const variant of COST_MAP_VARIANTS) {
    const button = document.createElement('button');
    button.className = 'filter-pill' + (state.costMapVariant === variant.key ? ' active' : '');
    button.textContent = variant.label;
    button.title = variant.hint;
    button.addEventListener('click', () => setCostMapVariant(variant.key));
    variantPills.appendChild(button);
  }
  toolbar.appendChild(variantPills);
  body.appendChild(toolbar);

  const data = costMapData();
  if (!data) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a conversation to map its prompts.';
    body.appendChild(empty);
    return;
  }
  if (data.loading) {
    const loading = document.createElement('div');
    loading.className = 'empty';
    loading.textContent = 'Scanning workspace conversations for this period…';
    body.appendChild(loading);
    return;
  }
  if (data.totalPrompts === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      state.costMapScope === 'period'
        ? `No ${PROVIDER_LABELS[state.selectedProvider]} prompts in this workspace for ${costMapPeriodLabel().toLowerCase()}.`
        : 'No prompts in this conversation yet.';
    body.appendChild(empty);
    return;
  }

  // honest coverage line (DD-010): counts + reasons, never zero-fabrication
  const status = document.createElement('div');
  status.className = 'costmap-status';
  const reasonBits = costMapExclusionBits(data.reasons);
  status.textContent =
    `${data.points.length} of ${data.totalPrompts} prompt${data.totalPrompts === 1 ? '' : 's'} charted` +
    (reasonBits.length > 0 ? ` — not charted: ${reasonBits.join(', ')}` : '');
  body.appendChild(status);

  if (data.points.length === 0) {
    // explicit unavailable state (DD-011), e.g. Copilot's missing per-call context
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      `No prompt here exposes the data this map needs — ${PROVIDER_LABELS[state.selectedProvider]} ` +
      'is missing per-LLM-call context or usable cost for every prompt in scope (reasons above). ' +
      'Nothing is plotted rather than showing made-up zeros.';
    body.appendChild(empty);
    return;
  }

  // compact model filter when several priced models are visible (DD-009)
  const modelKeys: string[] = [];
  for (const point of data.points) {
    const key = point.model ?? 'unknown';
    if (!modelKeys.includes(key)) modelKeys.push(key);
  }
  const activeModelFilter =
    state.costMapModelFilter && modelKeys.includes(state.costMapModelFilter) ? state.costMapModelFilter : undefined;
  if (modelKeys.length > 1) {
    const modelPills = document.createElement('div');
    modelPills.className = 'filter-pills costmap-models';
    const allButton = document.createElement('button');
    allButton.className = 'filter-pill' + (activeModelFilter === undefined ? ' active' : '');
    allButton.textContent = 'All models';
    allButton.addEventListener('click', () => {
      state.costMapModelFilter = undefined;
      render();
    });
    modelPills.appendChild(allButton);
    for (const key of modelKeys) {
      const button = document.createElement('button');
      button.className = 'filter-pill' + (activeModelFilter === key ? ' active' : '');
      button.textContent = key === 'unknown' ? 'unknown model' : shortModelName(key);
      button.title = key === 'unknown' ? 'Prompts with no recorded model' : key;
      button.addEventListener('click', () => {
        state.costMapModelFilter = key;
        render();
      });
      modelPills.appendChild(button);
    }
    body.appendChild(modelPills);
  }
  const points =
    activeModelFilter === undefined ? data.points : data.points.filter((p) => (p.model ?? 'unknown') === activeModelFilter);

  if (points.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No charted prompt matches the model filter.';
    body.appendChild(empty);
    return;
  }

  const selected: CostMapSelection | undefined =
    state.detail && state.selectedRequestIndex !== undefined
      ? { conversationId: state.detail.id, promptIndex: state.selectedRequestIndex }
      : undefined;
  const chartHost = document.createElement('div');
  chartHost.className = 'chart-host';
  body.appendChild(chartHost);
  renderCostMapChart(chartHost, {
    points,
    selected,
    onSelect: selectCostMapPoint,
    showConversation: state.costMapScope === 'period',
    variant: state.costMapVariant
  });

  // explanatory framing, not causal (DD-017)
  const hint = document.createElement('div');
  hint.className = 'chart-hint';
  hint.textContent =
    state.costMapVariant === 'context'
      ? 'Prompts on the same diagonal grew their context by the same amount; up-right on a diagonal means the same growth from a larger start. ' +
        'An explanatory comparison, not a causal model — model rates, cache pricing, and output tokens also shape cost.'
      : 'Prompts on the same ray averaged the same context per LLM call; above the pack means fatter calls. Bubbles bigger than their height ' +
        'suggests an expensive token mix (cache writes, model rates) — an explanatory comparison, not a causal model.';
  body.appendChild(hint);
}

// ---- conversations table ------------------------------------------------------------

const TABLE_COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Conversation' },
  { key: 'requestCount', label: 'Prompts', numeric: true },
  { key: 'firstAt', label: 'First message' },
  { key: 'lastAt', label: 'Last message' },
  { key: 'durationMs', label: 'Session duration' },
  { key: 'totalTokens', label: 'Tokens', numeric: true },
  { key: 'totalCostUsd', label: 'Cost', numeric: true }
];

function renderTable(container: HTMLElement, items: ConversationListItem[]): void {
  container.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.filter.trim() || state.tableTimeFilter !== 'all' ? 'No conversation matches the filter.' : emptyMessage();
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
      { text: formatConversationDuration(item), tooltip: item.firstAt ? `${formatExact(item.firstAt)} -> ${formatExact(item.lastAt)}` : undefined },
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
  tablePageLabel?: HTMLElement;
  tablePrevButton?: HTMLButtonElement;
  tableNextButton?: HTMLButtonElement;
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
    const request = selectedRequest();
    if (!request) return 'none selected';
    const llmCount = request.llmCalls?.length ?? 0;
    const toolCount = request.tools?.length ?? 0;
    if (llmCount === 0 && toolCount === 0) return 'no calls recorded';
    const parts: string[] = [];
    if (llmCount > 0) parts.push(`${llmCount} LLM call${llmCount === 1 ? '' : 's'}`);
    parts.push(`${toolCount} tool call${toolCount === 1 ? '' : 's'}`);
    const hasTime = (request.tools ?? []).some((t) => t.durationMs !== undefined);
    return parts.join(' · ') + (hasTime || toolCount === 0 ? '' : ' · time unavailable');
  }
  if (id === 'costMap') {
    return costMapSummary();
  }
  if (id === 'tools') {
    const request = selectedRequest();
    if (!request) return 'none selected';
    const toolCount = request.tools?.length ?? 0;
    if (toolCount === 0) return 'no tool calls';
    const errors = (request.tools ?? []).filter((t) => t.isError).length;
    return `${toolCount} call${toolCount === 1 ? '' : 's'}` + (errors > 0 ? ` · ${errors} error${errors === 1 ? '' : 's'}` : '');
  }
  if (id === 'callDetail') {
    const request = selectedRequest();
    const sel = state.selectedCall;
    if (!request || !sel) return 'none selected';
    if (sel.kind === 'tool') {
      const tool = request.tools?.[sel.index];
      return tool ? `#${sel.index + 1} · ${tool.name}` : 'none selected';
    }
    const call = request.llmCalls?.[sel.index];
    return call ? `L${sel.index + 1} · ${call.model ? shortModelName(call.model) : 'LLM call'}` : 'none selected';
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
    const quickFilters = document.createElement('div');
    quickFilters.className = 'filter-pills';
    for (const quickFilter of TABLE_TIME_FILTERS) {
      const button = document.createElement('button');
      button.className = 'filter-pill' + (state.tableTimeFilter === quickFilter.key ? ' active' : '');
      button.textContent = quickFilter.label;
      button.title = `Filter conversations by last message: ${quickFilter.label.toLowerCase()}`;
      button.addEventListener('click', () => {
        state.tableTimeFilter = quickFilter.key;
        state.tablePage = 0;
        render();
      });
      quickFilters.appendChild(button);
    }
    const count = document.createElement('span');
    count.className = 'overview-count';
    count.textContent = sectionSummary('table', items);
    toolbar.append(filter, quickFilters);
    toolbar.appendChild(count);
    body.appendChild(toolbar);

    const pager = document.createElement('div');
    pager.className = 'overview-pager';
    const pageLabel = document.createElement('span');
    pageLabel.className = 'overview-page-label';
    pageLabel.textContent = tablePageLabel(items);
    const pagerButtons = document.createElement('div');
    pagerButtons.className = 'pager-buttons';
    const prev = document.createElement('button');
    prev.className = 'pager-button';
    prev.textContent = 'Prev';
    prev.disabled = state.tablePage === 0;
    prev.addEventListener('click', () => {
      if (state.tablePage === 0) return;
      state.tablePage -= 1;
      render();
    });
    const next = document.createElement('button');
    next.className = 'pager-button';
    next.textContent = 'Next';
    next.disabled = state.tablePage >= tablePageCount(items) - 1;
    next.addEventListener('click', () => {
      if (state.tablePage >= tablePageCount(items) - 1) return;
      state.tablePage += 1;
      render();
    });
    pagerButtons.append(prev, next);
    pager.append(pageLabel, pagerButtons);
    body.appendChild(pager);

    const results = document.createElement('div');
    body.appendChild(results);
    renderTable(results, paginatedItems(items));

    stackRefs.tableResults = results;
    stackRefs.tableCount = count;
    stackRefs.tablePageLabel = pageLabel;
    stackRefs.tablePrevButton = prev;
    stackRefs.tableNextButton = next;
    filter.addEventListener('input', () => {
      state.filter = filter.value;
      state.tablePage = 0;
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
    const request = selectedRequest();
    if (!request) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Click a bar in the conversation chart to inspect a prompt.';
      body.appendChild(empty);
      return;
    }
    renderPromptTimeline(body, request, state.selectedCall, selectCall);
    return;
  }

  if (id === 'tools') {
    renderToolsSection(body);
    return;
  }

  if (id === 'callDetail') {
    renderCallDetailSection(body);
    return;
  }

  if (id === 'costMap') {
    renderCostMapSection(body);
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
  const items = filteredItems();
  if (stackRefs.chartBody) {
    stackRefs.chartBody.innerHTML = '';
    renderSectionBody('chart', stackRefs.chartBody, items);
  }
  if (stackRefs.tableResults) renderTable(stackRefs.tableResults, paginatedItems(items));
  if (stackRefs.tableCount) stackRefs.tableCount.textContent = sectionSummary('table', items);
  if (stackRefs.tablePageLabel) stackRefs.tablePageLabel.textContent = tablePageLabel(items);
  if (stackRefs.tablePrevButton) stackRefs.tablePrevButton.disabled = state.tablePage === 0;
  if (stackRefs.tableNextButton) stackRefs.tableNextButton.disabled = state.tablePage >= tablePageCount(items) - 1;
  for (const id of ['chart', 'table'] as SectionId[]) {
    const summary = stackRefs.summaries[id];
    if (summary) summary.textContent = sectionSummary(id, items);
  }
}

function preserveSelectedCall(
  request: PromptRequest | undefined,
  selection: TimelineSelection | undefined
): TimelineSelection | undefined {
  if (!request || !selection) return undefined;
  if (selection.kind === 'tool') {
    return request.tools?.[selection.index] ? selection : undefined;
  }
  return request.llmCalls?.[selection.index] ? selection : undefined;
}

function toggleSection(id: SectionId): void {
  state.sectionsCollapsed[id] = !state.sectionsCollapsed[id];
  persistState();
  render();
}

/**
 * Side-bar navigation: scroll the stack to a section. A collapsed target is
 * expanded first (a jump to a bare heading bar would show nothing) — but the
 * side bar never collapses anything; that stays on the section heading.
 */
function jumpToSection(id: SectionId): void {
  if (state.sectionsCollapsed[id]) {
    state.sectionsCollapsed[id] = false;
    persistState();
    render();
  }
  const target = document.querySelector<HTMLElement>(`section[data-section="${id}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSideBar(container: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'side-bar';
  for (const section of visibleSections()) {
    // The icon mirrors the section's heading-bar state — lit when the panel
    // is expanded, dimmed when collapsed — but clicking always navigates.
    const collapsed = !!state.sectionsCollapsed[section.id];
    const button = document.createElement('button');
    button.className = 'side-icon' + (collapsed ? '' : ' active');
    button.textContent = section.icon;
    button.title = `Jump to ${section.title}${collapsed ? ' (collapsed — will expand)' : ''}`;
    button.setAttribute('aria-label', `Jump to section: ${section.title}${collapsed ? ' (collapsed — will expand)' : ''}`);
    button.addEventListener('click', () => jumpToSection(section.id));
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

  const items = filteredItems();

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
  const previousSelectedCall = sameConversation ? state.selectedCall : undefined;
  const previousPromptExpanded = sameConversation ? state.promptExpanded : false;
  state.detail = detail;
  state.selectedRequestIndex =
    detail && detail.requests.length > 0
      ? previousRequestIndex !== undefined
        ? Math.min(previousRequestIndex, detail.requests.length - 1)
        : detail.requests.length - 1
      : undefined;
  const selectedRequest =
    detail && state.selectedRequestIndex !== undefined ? detail.requests[state.selectedRequestIndex] : undefined;
  state.loadingId = undefined;
  state.promptExpanded = previousPromptExpanded;
  state.selectedCall =
    sameConversation && state.selectedRequestIndex === previousRequestIndex
      ? preserveSelectedCall(selectedRequest, previousSelectedCall)
      : undefined;
  if (detail) state.selectedProvider = detail.provider;
}

// ---- storage footer -----------------------------------------------------------------

/**
 * Copilot-only troubleshooting line at the bottom of the page: the live
 * "Copilot detail: …" OTel activation state and local usage-history size. It
 * shows on the Copilot tab alone — the other providers persist nothing, so the
 * line would be noise there. The retention/privacy explanation it used to carry
 * now lives in the README.
 */
function renderStorageFooter(container: HTMLElement): void {
  if (state.selectedProvider !== 'copilot') return;
  const lines = state.storageFooter;
  if (!lines?.length) return;
  const footer = document.createElement('div');
  footer.className = 'storage-footer';
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    footer.appendChild(row);
  }
  container.appendChild(footer);
}

// ---- root render ------------------------------------------------------------------

/**
 * Every inner scrollable container class the page uses. Scroll positions must
 * survive any full re-render — selection updates and the periodic data
 * refresh alike (surfaces-and-privacy.md "Panel interaction rules"). This is
 * deliberately a generic enumeration of container classes, not a per-section
 * allowlist: an allowlist silently drops every scroller added later (the
 * Prompt cost map's chart lost its horizontal position on refresh this way),
 * so any new scrollable surface must only reuse one of these classes to
 * inherit the guarantee.
 */
const SCROLL_CONTAINER_SELECTOR = '.stack-pane, .chart-scroll, .table-scroll, .tools-scroll';

/**
 * All scroll containers in DOM order, each with a stable key: owning section
 * (or 'root' outside any) + class + occurrence index. Keys match across a
 * re-render as long as the same containers exist, without assuming one
 * scroller per section.
 */
function scrollContainers(app: HTMLElement): { key: string; el: HTMLElement }[] {
  const counters = new Map<string, number>();
  return Array.from(app.querySelectorAll<HTMLElement>(SCROLL_CONTAINER_SELECTOR)).map((el) => {
    const section = el.closest<HTMLElement>('[data-section]')?.dataset.section ?? 'root';
    const base = `${section}/${el.className}`;
    const n = counters.get(base) ?? 0;
    counters.set(base, n + 1);
    return { key: `${base}#${n}`, el };
  });
}

function render(): void {
  const app = root();
  const previousScrolls = new Map<string, { top: number; left: number }>();
  for (const { key, el } of scrollContainers(app)) {
    previousScrolls.set(key, { top: el.scrollTop, left: el.scrollLeft });
  }

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

  // Re-renders update panels in place: restore every scroll position exactly
  // (vertical and horizontal), never animate or jump the page.
  for (const { key, el } of scrollContainers(app)) {
    const saved = previousScrolls.get(key);
    if (!saved) continue;
    el.scrollTop = saved.top;
    el.scrollLeft = saved.left;
  }
}

/** Period-mode activation: jump to the pending prompt once its conversation's detail is in. */
function applyPendingPromptSelect(detail: ConversationDetailPayload): void {
  const pending = state.pendingPromptSelect;
  if (!pending || detail.id !== pending.conversationId) return;
  state.pendingPromptSelect = undefined;
  if (detail.requests.length === 0) return;
  state.selectedRequestIndex = Math.min(pending.promptIndex, detail.requests.length - 1);
  state.selectedCall = undefined;
  state.promptExpanded = false;
  state.sectionsCollapsed.request = false;
  state.sectionsCollapsed.toolTimeline = false;
  state.sectionsCollapsed.tools = false;
  persistState();
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    state.providers = message.providers;
    state.workspacePath = message.workspacePath;
    state.conversationsByProvider = message.conversationsByProvider;
    state.storageFooter = message.storageFooter;
    for (const [key, value] of costMapPeriodCache) {
      if (value !== 'loading') costMapPeriodStale.add(key);
    }
    applyDetail(message.selected, true);
    if (message.selected) applyPendingPromptSelect(message.selected);
    render();
  } else if (message.type === 'conversationDetail') {
    applyDetail(message.detail, true);
    applyPendingPromptSelect(message.detail);
    render();
  } else if (message.type === 'costMapPeriod') {
    const key = `${message.payload.provider}/${message.payload.days ?? 'all'}`;
    costMapPeriodCache.set(key, message.payload);
    costMapPeriodStale.delete(key);
    render();
  } else if (message.type === 'toolCallDetail') {
    const provider = state.detail?.provider ?? state.selectedProvider;
    toolDetailCache.set(toolDetailKey(provider, message.conversationId, message.detail.toolCallId), message.detail);
    render();
  }
});

render();
post({ type: 'ready' });
