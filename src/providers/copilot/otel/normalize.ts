import { NormalizedCall, OTEL_SCHEMA_VERSION } from './types';

/**
 * Allowlist normalizer (plan_v2 Phase 3). Turns one parsed OTLP/JSON trace
 * export into normalized per-LLM-call records, reading ONLY allowlisted
 * usage/correlation attributes. Content, repo, git, and any unknown attribute
 * are never read, so they can never reach disk — the allowlist is enforced by
 * construction, not by a later filter.
 *
 * Shapes match real captured Copilot exports (see fixtures/real-trace-redacted
 * .json and the packet's test.md). Everything is defensive: unknown value
 * encodings, missing fields, and non-`chat` spans are tolerated.
 */

// --- Minimal OTLP/JSON structural types (only what we read). ---
interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
}
interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}
interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpKeyValue[];
  status?: { code?: number };
}
interface OtlpScopeSpans {
  scope?: { name?: string; version?: string };
  spans?: OtlpSpan[];
}
interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
}
export interface OtlpTraceExport {
  resourceSpans?: OtlpResourceSpans[];
}

function toNumber(v: OtlpAnyValue | undefined): number | undefined {
  if (!v) return undefined;
  if (typeof v.intValue === 'number') return v.intValue;
  if (typeof v.intValue === 'string' && v.intValue.trim() !== '') {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  return undefined;
}
function toStringVal(v: OtlpAnyValue | undefined): string | undefined {
  return typeof v?.stringValue === 'string' ? v.stringValue : undefined;
}
function firstStringOfArray(v: OtlpAnyValue | undefined): string | undefined {
  const first = v?.arrayValue?.values?.[0];
  return toStringVal(first);
}

function attrMap(attributes: OtlpKeyValue[] | undefined): Map<string, OtlpAnyValue> {
  const m = new Map<string, OtlpAnyValue>();
  for (const a of attributes ?? []) if (a && typeof a.key === 'string' && a.value) m.set(a.key, a.value);
  return m;
}

/** Big-int-safe nanosecond → millisecond conversion (ns exceeds 2^53). */
function nanosToMs(ns: string | number | undefined): number | undefined {
  if (ns === undefined || ns === null) return undefined;
  try {
    const ms = BigInt(typeof ns === 'number' ? Math.trunc(ns) : ns) / 1_000_000n;
    const n = Number(ms);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize one OTLP trace export into persisted call records. Only `chat`
 * spans become records; `execute_tool`/`embeddings`/`invoke_agent` spans are
 * ignored (tools already come from chatSessions).
 */
export function normalizeTraceExport(body: unknown): NormalizedCall[] {
  const doc = body as OtlpTraceExport | undefined;
  const out: NormalizedCall[] = [];
  if (!doc || !Array.isArray(doc.resourceSpans)) return out;

  for (const rs of doc.resourceSpans) {
    const resourceAttrs = attrMap(rs.resource?.attributes);
    const resourceVersion = toStringVal(resourceAttrs.get('service.version'));

    for (const ss of rs.scopeSpans ?? []) {
      const sourceVersion = resourceVersion ?? ss.scope?.version;
      for (const span of ss.spans ?? []) {
        const a = attrMap(span.attributes);
        if (toStringVal(a.get('gen_ai.operation.name')) !== 'chat') continue;
        if (!span.spanId || !span.traceId) continue;

        const startMs = nanosToMs(span.startTimeUnixNano);
        const endMs = nanosToMs(span.endTimeUnixNano);

        out.push({
          timestamp: startMs !== undefined ? new Date(startMs).toISOString() : new Date(0).toISOString(),
          conversationId: toStringVal(a.get('gen_ai.conversation.id')),
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          requestId:
            toStringVal(a.get('copilot_chat.server_request_id')) ?? toStringVal(a.get('gen_ai.response.id')),
          operation: 'chat',
          requestedModel: toStringVal(a.get('gen_ai.request.model')),
          resolvedModel: toStringVal(a.get('gen_ai.response.model')),
          inputTokens: toNumber(a.get('gen_ai.usage.input_tokens')),
          outputTokens: toNumber(a.get('gen_ai.usage.output_tokens')),
          cacheReadTokens: toNumber(a.get('gen_ai.usage.cache_read.input_tokens')),
          // cacheCreationTokens intentionally omitted — never emitted by Copilot.
          reasoningOutputTokens:
            toNumber(a.get('gen_ai.usage.reasoning.output_tokens')) ??
            toNumber(a.get('gen_ai.usage.reasoning_tokens')),
          maxOutputTokens: toNumber(a.get('gen_ai.request.max_tokens')),
          contextWindowTokens: toNumber(a.get('copilot_chat.request.max_prompt_tokens')),
          durationMs: startMs !== undefined && endMs !== undefined ? Math.max(endMs - startMs, 0) : undefined,
          timeToFirstTokenMs: toNumber(a.get('copilot_chat.time_to_first_token')),
          finishReason: firstStringOfArray(a.get('gen_ai.response.finish_reasons')),
          isError: span.status?.code === 2 ? true : undefined,
          premiumUsageNanoAiu: toNumber(a.get('copilot_chat.copilot_usage_nano_aiu')),
          sourceVersion,
          schemaVersion: OTEL_SCHEMA_VERSION
        });
      }
    }
  }
  return out;
}
