/**
 * Copilot OTel enrichment — normalized record shape (plan_v2 Storage Format).
 *
 * This is the ONLY thing the extension persists from OTel: one line per LLM
 * call, allowlisted usage/correlation fields only. The raw OTLP request and
 * every content/repo/git attribute are discarded before a record is written
 * (proven necessary — captureContent:false does not strip content; see the
 * packet's test.md). Absent numeric fields stay `undefined`, never 0; a field
 * that the provider emitted as a real 0 (e.g. cache_read on a fresh call) is
 * kept as 0.
 */

/** Current write schema. The reader explicitly allowlists compatible versions. */
export const OTEL_SCHEMA_VERSION = 2;
export const SUPPORTED_OTEL_SCHEMA_VERSIONS = new Set([1, OTEL_SCHEMA_VERSION]);

export interface NormalizedCall {
  /** ISO 8601, from the span start time. */
  timestamp: string;
  /**
   * gen_ai.conversation.id — equals the chatSessions/<id>.jsonl filename
   * (proven, OP-001). Absent on auxiliary helper spans (title/intent calls),
   * which therefore never correlate to a user conversation.
   */
  conversationId?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  /**
   * Legacy primary ID retained for schema-v1 history compatibility. Schema v1
   * preferred copilot_chat.server_request_id over gen_ai.response.id.
   */
  requestId?: string;
  /** copilot_chat.server_request_id; normally shared by all rounds of a turn. */
  serverRequestId?: string;
  /** gen_ai.response.id; may differ from the provider-specific request ID. */
  responseId?: string;
  /** gen_ai.operation.name (always "chat" for persisted records). */
  operation: string;
  requestedModel?: string;
  resolvedModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** Never emitted by Copilot (cache-write gap confirmed); always undefined. */
  cacheCreationTokens?: number;
  reasoningOutputTokens?: number;
  /** gen_ai.request.max_tokens — the call's max output budget. */
  maxOutputTokens?: number;
  /** copilot_chat.request.max_prompt_tokens — effective context window for the call. */
  contextWindowTokens?: number;
  durationMs?: number;
  /** copilot_chat.time_to_first_token, milliseconds. */
  timeToFirstTokenMs?: number;
  finishReason?: string;
  /** true when the span status code is ERROR (2). */
  isError?: boolean;
  /** copilot_chat.copilot_usage_nano_aiu — premium usage in nano-AIU. */
  premiumUsageNanoAiu?: number;
  /** Copilot Chat version (resource service.version / scope version). */
  sourceVersion?: string;
  schemaVersion: number;
}
