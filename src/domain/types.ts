export type ProviderId = 'claude' | 'codex' | 'copilot';

export interface UsageTokens {
  inputTokens: number;
  cacheReadTokens: number;
  /** Total cache-write tokens (cacheCreation5mTokens + cacheCreation1hTokens). */
  cacheCreationTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  outputTokens: number;
}

export type CostSource = 'provider-reported' | 'estimated' | 'unavailable';

export interface CostAmount {
  usd?: number;
  source: CostSource;
}

export interface RateLimitWindowStatus {
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
}

export interface RateLimitStatus {
  limitId?: string;
  planType?: string;
  primary?: RateLimitWindowStatus;
  secondary?: RateLimitWindowStatus;
  rateLimitReachedType?: string;
}

export interface ConversationContextStatus {
  workspacePath?: string;
  model?: string;
  modelContextWindow?: number;
  contextUsedTokens?: number;
  contextAvailableTokens?: number;
  contextFillPercent?: number;
  reservedOutputTokens?: number;
  longContextMode?: string;
}

export interface CurrentStatusSnapshot {
  rateLimits?: RateLimitStatus;
  context?: ConversationContextStatus;
}

/** One tool invocation inside a request, matched tool_use -> tool_result. */
export interface ToolCallInfo {
  id: string;
  name: string;
  startedAt?: string;
  /** Serialized input size, chars. */
  inputChars: number;
  /** Short human hint of the call target (description, command, file, pattern...). */
  inputPreview?: string;
  /** Serialized result size, chars; absent when no result record was found. */
  outputChars?: number;
  /**
   * Tool wall time. Explicit provider value when the log carries one,
   * otherwise derived from the tool_use -> tool_result timestamps (includes
   * scheduling; labeled "~" in the UI).
   */
  durationMs?: number;
  durationSource?: 'reported' | 'derived';
  isError?: boolean;
  /** Agent tool only: subagent transcript id, plus its scanned totals. */
  agentId?: string;
  subagentTokens?: number;
  subagentCostUsd?: number;
  subagentModel?: string;
}

/** One cache break inside a request, from message.diagnostics. */
export interface CacheMissInfo {
  reason: string;
  missedTokens?: number;
}

export interface PromptRequest {
  id: string;
  index: number;
  startedAt: string;
  endedAt?: string;
  model?: string;
  usage: UsageTokens;
  cost: CostAmount;
  toolCallCount: number;
  // ---- enriched metadata (plans/2026-07/05/conversation-meta); all optional,
  // absent means "unavailable in the source log", never zero. ----
  /** Wall time from the user prompt to the last assistant record, ms. */
  durationMs?: number;
  /** Number of API calls (assistant records) grouped into this request. */
  apiCallCount?: number;
  /** stop_reason of the request's final API call. */
  stopReason?: string;
  serviceTier?: string;
  /** e.g. "fast" when fast mode served the request. */
  speed?: string;
  /** Models seen across the request's API calls, in order of first use. */
  modelsUsed?: string[];
  thinkingBlocks?: number;
  thinkingChars?: number;
  /** Visible assistant text size, chars. */
  textChars?: number;
  /** User prompt size, chars, and its full text (capped; own input, not a tool payload). */
  promptChars?: number;
  promptText?: string;
  webSearchRequests?: number;
  webFetchRequests?: number;
  cacheMisses?: CacheMissInfo[];
  tools?: ToolCallInfo[];
  reasoningOutputTokens?: number;
  timeToFirstTokenMs?: number;
  modelContextWindow?: number;
}

export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: string;
  /** Timestamp of the first record in the session, when readable. */
  firstAt?: string;
  /** Timestamp of the last record in the session; falls back to file mtime. */
  lastAt: string;
  requestCount: number;
  totalUsage: UsageTokens;
  /** Sum of all four token kinds in totalUsage. */
  totalTokens: number;
  /** Conversation cost in USD when the provider exposes or supports it. */
  totalCostUsd?: number;
  /** Conversation cwd or a relative path label when the provider exposes one. */
  pathLabel?: string;
}

export interface ConversationSummary {
  id: string;
  provider: ProviderId;
  title?: string;
  workspacePath: string;
  updatedAt: string;
  requests: PromptRequest[];
  totalUsage: UsageTokens;
  totalCost: CostAmount;
  currentStatus?: CurrentStatusSnapshot;
}

export const EMPTY_USAGE: Readonly<UsageTokens> = Object.freeze({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  outputTokens: 0
});

export function addUsage(a: UsageTokens, b: UsageTokens): UsageTokens {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheCreation5mTokens: a.cacheCreation5mTokens + b.cacheCreation5mTokens,
    cacheCreation1hTokens: a.cacheCreation1hTokens + b.cacheCreation1hTokens,
    outputTokens: a.outputTokens + b.outputTokens
  };
}
