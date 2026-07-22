import { LlmCallInfo, PromptRequest, UsageTokens, EMPTY_USAGE } from '../../../domain/types';
import { PricingService } from '../../../pricing/pricingService';
import { NormalizedCall } from './types';

/**
 * Read-time correlation + enrichment (plan_v2 Phase 6). Joins normalized OTel
 * calls to the Copilot chatSessions request model by proven stable IDs:
 *
 *   conversation : gen_ai.conversation.id == chatSessions filename (sessionId)
 *   request/turn : exact server/response ID match, then an unambiguous UUID
 *                  version-nibble compatibility match
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

function callCorrelationIds(call: NormalizedCall): string[] {
  return [...new Set([call.serverRequestId, call.responseId, call.requestId].filter((id): id is string => !!id))];
}

/**
 * Mask only the UUID version nibble (the first nibble of the third group).
 * Some Copilot backends emit otherwise identical IDs with different UUID
 * versions; broader normalization would make correlation speculative.
 */
export function uuidWithoutVersionNibble(value: string): string | undefined {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    return undefined;
  }
  return `${normalized.slice(0, 14)}*${normalized.slice(15)}`;
}

/** Group normalized calls by their turn-level request id. */
export function groupCallsByRequestId(calls: NormalizedCall[]): Map<string, NormalizedCall[]> {
  const byId = new Map<string, NormalizedCall[]>();
  for (const call of calls) {
    const groupId = call.serverRequestId ?? call.requestId ?? call.responseId;
    if (!groupId) continue;
    const bucket = byId.get(groupId);
    if (bucket) bucket.push(call);
    else byId.set(groupId, [call]);
  }
  for (const bucket of byId.values()) {
    bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return byId;
}

function matchingCalls(responseId: string, grouped: Map<string, NormalizedCall[]>): NormalizedCall[] | undefined {
  const groups = [...grouped.values()];
  const exact = groups.filter((calls) => calls.some((call) => callCorrelationIds(call).includes(responseId)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  const maskedResponseId = uuidWithoutVersionNibble(responseId);
  if (!maskedResponseId) return undefined;
  const compatible = groups.filter((calls) =>
    calls.some((call) =>
      callCorrelationIds(call).some((id) => uuidWithoutVersionNibble(id) === maskedResponseId)
    )
  );
  // The calls are already conversation-scoped. Still, accept this compatibility
  // fallback only when exactly one turn-level group can own the session ID.
  return compatible.length === 1 ? compatible[0] : undefined;
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
    const matched = responseId ? matchingCalls(responseId, byRequestId) : undefined;
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
