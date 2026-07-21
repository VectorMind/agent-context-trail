import { LlmCallInfo, PromptRequest, UsageTokens, EMPTY_USAGE } from '../../../domain/types';
import { PricingService } from '../../../pricing/pricingService';
import { NormalizedCall } from './types';

/**
 * Read-time correlation + enrichment (plan_v2 Phase 6). Joins normalized OTel
 * calls to the Copilot chatSessions request model by proven stable IDs:
 *
 *   conversation : gen_ai.conversation.id == chatSessions filename (sessionId)
 *   request/turn : copilot_chat.server_request_id == request.result.metadata.responseId
 *   per-call     : each chat span (spanId), ordered by start time = the request's rounds
 *
 * When a request has a confident per-call match, its skeletal `llmCalls` (round
 * marks with no usage) are replaced by real per-call context/usage. Requests
 * with no match keep their existing request-level values — unmatched OTel calls
 * are never force-attached (incorrect correlation is worse than unavailable).
 * Nothing here rewrites stored JSONL; correlation is purely at read time.
 */

/** OpenAI/Copilot report input_tokens as the TOTAL prompt (cache-inclusive); the
 * cached subset is cache_read.input_tokens. So the fresh (uncached) input is the
 * difference, and the full submitted context equals input_tokens itself. This
 * mirrors the Claude convention contextTokens = fresh + cacheRead + cacheWrite. */
function otelCallToLlmCall(call: NormalizedCall, index: number, pricing: PricingService): LlmCallInfo {
  const total = call.inputTokens;
  const cacheRead = call.cacheReadTokens;
  const fresh =
    total !== undefined && cacheRead !== undefined ? Math.max(total - cacheRead, 0) : total;

  const usage: UsageTokens = {
    ...EMPTY_USAGE,
    inputTokens: fresh ?? 0,
    cacheReadTokens: cacheRead ?? 0,
    outputTokens: call.outputTokens ?? 0
  };

  return {
    index,
    startedAt: call.timestamp,
    model: call.resolvedModel ?? call.requestedModel,
    contextTokens: total,
    inputTokens: fresh,
    cacheReadTokens: cacheRead,
    // cacheCreationTokens stays absent — Copilot never emits cache-write.
    outputTokens: call.outputTokens,
    reasoningOutputTokens: call.reasoningOutputTokens,
    stopReason: call.finishReason,
    costUsd: pricing.estimateCopilotCost(call.resolvedModel ?? call.requestedModel, usage).usd,
    modelContextWindow: call.contextWindowTokens
  };
}

/** Group normalized calls by their request id (server_request_id / responseId). */
export function groupCallsByRequestId(calls: NormalizedCall[]): Map<string, NormalizedCall[]> {
  const byId = new Map<string, NormalizedCall[]>();
  for (const call of calls) {
    if (!call.requestId) continue;
    const bucket = byId.get(call.requestId);
    if (bucket) bucket.push(call);
    else byId.set(call.requestId, [call]);
  }
  for (const bucket of byId.values()) {
    bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return byId;
}

/**
 * Enrich requests whose `responseId` matches OTel calls. `responseIdByIndex[i]`
 * is the join key for `requests[i]` (from result.metadata.responseId). Returns
 * new request objects; inputs are not mutated.
 */
export function applyOtelEnrichment(
  requests: PromptRequest[],
  responseIdByIndex: (string | undefined)[],
  otelCalls: NormalizedCall[],
  pricing: PricingService
): PromptRequest[] {
  if (otelCalls.length === 0) return requests;
  const byRequestId = groupCallsByRequestId(otelCalls);

  return requests.map((request, i) => {
    const responseId = responseIdByIndex[i];
    const matched = responseId ? byRequestId.get(responseId) : undefined;
    if (!matched || matched.length === 0) return request;

    const llmCalls = matched.map((call, index) => otelCallToLlmCall(call, index, pricing));
    const lastWindow = matched[matched.length - 1].contextWindowTokens;

    return {
      ...request,
      llmCalls,
      llmCallCount: llmCalls.length,
      modelContextWindow: request.modelContextWindow ?? lastWindow
    };
  });
}
