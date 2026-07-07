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

/**
 * One LLM call (model completion) inside a request. Per-provider honest
 * (plans/2026-07/07/call-details): Claude carries full per-call usage and an
 * estimated cost; Codex per-call usage from its token_count events; Copilot
 * only round marks (timestamp, thinking tokens). Absent means "not in the
 * source log", never zero.
 */
export interface LlmCallInfo {
  /** 0-based position within the request's LLM call sequence. */
  index: number;
  startedAt?: string;
  /**
   * Claude only: timestamp of the call's last streamed record, so
   * endedAt - startedAt ≈ the streaming span (excludes time to first token).
   */
  endedAt?: string;
  model?: string;
  /** Full context submitted with this call (fresh input + cache read + cache write). */
  contextTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  /** Copilot: per-round thinking tokens when the round reports them. */
  thinkingTokens?: number;
  stopReason?: string;
  /** Always estimated from the rate table; no provider reports per-call cost. */
  costUsd?: number;
  modelContextWindow?: number;
}

/**
 * Bounded head/tail excerpt of a tool payload, trimmed host-side. Full
 * payloads never cross into the webview (plans/2026-07/07/call-details
 * OP-101/OP-102).
 */
export interface PayloadExcerpt {
  headLines: string[];
  /** Present only when lines were skipped between head and tail. */
  tailLines?: string[];
  totalChars: number;
  totalLines: number;
  /** Chars omitted between head and tail (0 when the excerpt is complete). */
  skippedChars: number;
  /** Copilot results: text reassembled from a serialized display-node tree. */
  reconstructed?: boolean;
}

export interface ToolCallDetailField {
  key: string;
  value: string;
}

/** On-demand detail for one tool call, extracted from the provider log. */
export interface ToolCallDetail {
  toolCallId: string;
  /** Top-level input fields except the payload body; values capped host-side. */
  fields: ToolCallDetailField[];
  /** The input's dominant text payload (file content, command, ...), excerpted. */
  inputExcerpt?: PayloadExcerpt;
  /** Which input field the excerpt came from (e.g. "content", "command"). */
  inputPayloadKey?: string;
  resultExcerpt?: PayloadExcerpt;
  /** Reason the log has no locatable data; shown as-is, never fabricated. */
  unavailable?: string;
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
  /** Number of LLM calls (model completions) grouped into this request. */
  llmCallCount?: number;
  /** stop_reason of the request's final LLM call. */
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
  /** Per-LLM-call detail, in call order; provider depth varies (see LlmCallInfo). */
  llmCalls?: LlmCallInfo[];
  reasoningOutputTokens?: number;
  timeToFirstTokenMs?: number;
  modelContextWindow?: number;
  /** Copilot: real fractional premium-request credits consumed (e.g. 1.4), not USD. */
  premiumCredits?: number;
  /** Copilot: file paths touched by this request's edits, when the source data has them. */
  editedFiles?: string[];
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
