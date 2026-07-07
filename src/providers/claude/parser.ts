import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  addUsage,
  CacheMissInfo,
  ConversationSummary,
  EMPTY_USAGE,
  LlmCallInfo,
  PromptRequest,
  ToolCallInfo,
  UsageTokens
} from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';
import { buildToolCallDetail, unavailableDetail } from '../callDetail';
import { ToolCallDetail } from '../../domain/types';

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  /** tool_use */
  id?: string;
  name?: string;
  input?: unknown;
  /** tool_result */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface RawUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  service_tier?: string;
  speed?: string;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

interface RawToolUseResult {
  durationMs?: number;
  agentId?: string;
  status?: string;
  resolvedModel?: string;
}

interface RawRecord {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  aiTitle?: string;
  toolUseResult?: RawToolUseResult | string;
  message?: {
    /**
     * API message id. One API response is written as several JSONL lines (one
     * per content block) all sharing this id and repeating the same usage —
     * usage/diagnostics must be counted once per id, content blocks per line.
     */
    id?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: RawUsage;
    stop_reason?: string;
    diagnostics?: {
      cache_miss_reason?: {
        type?: string;
        cache_missed_input_tokens?: number;
      };
    };
  };
}

function isRealUserPrompt(record: RawRecord): boolean {
  if (record.type !== 'user' || record.isMeta) return false;
  const content = record.message?.content;
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.some((block) => block?.type === 'text' && !!block.text?.trim());
  }
  return false;
}

function usageFromRecord(record: RawRecord): UsageTokens {
  const usage = record.message?.usage;
  if (!usage) return EMPTY_USAGE;
  const cache5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const cache1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? cache5m + cache1h,
    cacheCreation5mTokens: cache5m,
    cacheCreation1hTokens: cache1h,
    outputTokens: usage.output_tokens ?? 0
  };
}

function rawPromptText(record: RawRecord): string | undefined {
  const content = record.message?.content;
  const text =
    typeof content === 'string' ? content : Array.isArray(content) ? content.find((b) => b?.type === 'text')?.text : undefined;
  const trimmed = text?.trim();
  return trimmed || undefined;
}

/** Short prompt snippet, for the conversation title fallback only. */
function extractTitlePreview(record: RawRecord, maxLen = 80): string | undefined {
  const text = rawPromptText(record);
  return text ? text.slice(0, maxLen) : undefined;
}

/**
 * Full user prompt text (not a payload the model produced, so OP-002's "no
 * full tool payloads" limit does not apply). Capped generously so a huge
 * pasted blob cannot bloat webview state; the UI truncates further for the
 * collapsed view and expands to this full text on demand.
 */
function extractPromptText(record: RawRecord, maxLen = 50_000): string | undefined {
  const text = rawPromptText(record);
  if (!text) return undefined;
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function promptChars(record: RawRecord): number {
  const content = record.message?.content;
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, b) => sum + (b?.type === 'text' ? b.text?.length ?? 0 : 0), 0);
}

function charSize(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/** Short human hint of what a tool call targets, from its best-known input field. */
function toolInputPreview(input: unknown, maxLen = 70): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ['description', 'command', 'file_path', 'pattern', 'query', 'prompt', 'skill', 'url', 'path']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim().replace(/\s+/g, ' ');
      return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
    }
  }
  return undefined;
}

/**
 * Sums a subagent transcript (`<sessionId>/subagents/agent-<id>.jsonl`) so an
 * Agent tool call can carry its delegated token/cost totals exactly.
 */
async function scanSubagentTotals(
  subagentFile: string,
  pricing: PricingService
): Promise<{ tokens: number; costUsd: number; model?: string } | undefined> {
  try {
    await fs.promises.access(subagentFile, fs.constants.R_OK);
  } catch {
    return undefined;
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(subagentFile, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let usage: UsageTokens = { ...EMPTY_USAGE };
  let costUsd = 0;
  let model: string | undefined;
  let lastMessageId: string | undefined;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: RawRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (record.type !== 'assistant') continue;
    model = record.message?.model ?? model;
    const messageId = record.message?.id;
    if (!messageId || messageId !== lastMessageId) {
      const u = usageFromRecord(record);
      usage = addUsage(usage, u);
        costUsd += pricing.estimateClaudeCost(record.message?.model, u).usd ?? 0;
    }
    lastMessageId = messageId;
  }
  const tokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens + usage.outputTokens;
  return { tokens, costUsd, model };
}

export interface ClaudeSessionMeta {
  title?: string;
  firstAt?: string;
  lastAt?: string;
  requestCount: number;
  totalUsage: UsageTokens;
  totalCostUsd: number;
}

/**
 * Single streaming pass over a session for the conversation list: title,
 * first/last timestamps, request count, and running usage/cost totals.
 * Groups records into requests with the same rules as parseClaudeSession but
 * keeps no per-request array, so listing many sessions stays one read each.
 * Prefers the last `ai-title` record (Claude Code can retitle a conversation
 * as it progresses); falls back to a preview of the first real user prompt.
 */
export async function scanClaudeSessionMeta(filePath: string, pricing: PricingService): Promise<ClaudeSessionMeta> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let title: string | undefined;
  let firstPromptPreview: string | undefined;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  let requestCount = 0;
  let totalUsage: UsageTokens = { ...EMPTY_USAGE };
  let totalCostUsd = 0;
  let currentModel: string | undefined;
  let currentUsage: UsageTokens | null = null;
  let lastMessageId: string | undefined;

  const closeRequest = () => {
    if (!currentUsage) return;
    totalUsage = addUsage(totalUsage, currentUsage);
    totalCostUsd += pricing.estimateClaudeCost(currentModel, currentUsage).usd ?? 0;
    currentUsage = null;
    currentModel = undefined;
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: RawRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (record.timestamp) {
      firstAt ??= record.timestamp;
      lastAt = record.timestamp;
    }

    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      title = record.aiTitle;
      continue;
    }

    if (isRealUserPrompt(record)) {
      closeRequest();
      requestCount += 1;
      currentUsage = { ...EMPTY_USAGE };
      if (!firstPromptPreview) firstPromptPreview = extractTitlePreview(record);
      continue;
    }

    if (record.type === 'assistant' && currentUsage) {
      currentModel = record.message?.model ?? currentModel;
      const messageId = record.message?.id;
      if (!messageId || messageId !== lastMessageId) {
        currentUsage = addUsage(currentUsage, usageFromRecord(record));
      }
      lastMessageId = messageId;
    }
  }
  closeRequest();

  return { title: title ?? firstPromptPreview, firstAt, lastAt, requestCount, totalUsage, totalCostUsd };
}

/**
 * Groups a Claude Code session JSONL file into prompt-iteration requests.
 * A new request starts at each real user prompt (a `user` record carrying
 * actual text, not a bare tool_result continuation or a meta record); every
 * `assistant` record until the next such prompt belongs to it.
 */
export async function parseClaudeSession(
  filePath: string,
  sessionId: string,
  workspacePath: string,
  pricing: PricingService
): Promise<ConversationSummary> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  const requests: PromptRequest[] = [];
  let current: PromptRequest | null = null;
  let title: string | undefined;
  let lastTimestamp = '';
  let lastMessageId: string | undefined;
  /** tool_use id → its ToolCallInfo, for matching results across records. */
  let openTools = new Map<string, ToolCallInfo>();
  /** The in-flight LLM call, so later records sharing its message.id extend its span. */
  let currentLlmCall: LlmCallInfo | undefined;

  const pushCurrent = () => {
    if (current) {
      current.cost = pricing.estimateClaudeCost(current.model, current.usage);
      if (current.endedAt) {
        const ms = Date.parse(current.endedAt) - Date.parse(current.startedAt);
        if (Number.isFinite(ms) && ms >= 0) current.durationMs = ms;
      }
      requests.push(current);
    }
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: RawRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // tolerate partially written or corrupt lines
    }

    if (record.timestamp) lastTimestamp = record.timestamp;

    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      title = record.aiTitle;
      continue;
    }

    if (isRealUserPrompt(record)) {
      pushCurrent();
      openTools = new Map();
      currentLlmCall = undefined;
      current = {
        id: record.uuid ?? `req-${requests.length}`,
        index: requests.length,
        startedAt: record.timestamp ?? lastTimestamp,
        usage: { ...EMPTY_USAGE },
        cost: { usd: 0, source: 'estimated' },
        toolCallCount: 0,
        llmCallCount: 0,
        thinkingBlocks: 0,
        thinkingChars: 0,
        textChars: 0,
        promptChars: promptChars(record),
        promptText: extractPromptText(record),
        modelsUsed: [],
        tools: []
      };
      continue;
    }

    if (!current) continue;

    if (record.type === 'assistant') {
      current.endedAt = record.timestamp;
      current.model = record.message?.model ?? current.model;
      if (record.message?.stop_reason) current.stopReason = record.message.stop_reason;

      // One API response (one LLM call) spans several lines sharing message.id,
      // each repeating the same usage/diagnostics: count those once per id.
      const messageId = record.message?.id;
      const isNewLlmCall = !messageId || messageId !== lastMessageId;
      lastMessageId = messageId;
      if (isNewLlmCall) {
        const callUsage = usageFromRecord(record);
        current.usage = addUsage(current.usage, callUsage);
        current.llmCallCount = (current.llmCallCount ?? 0) + 1;

        currentLlmCall = {
          index: (current.llmCalls ??= []).length,
          startedAt: record.timestamp,
          endedAt: record.timestamp,
          model: record.message?.model,
          contextTokens: callUsage.inputTokens + callUsage.cacheReadTokens + callUsage.cacheCreationTokens,
          inputTokens: callUsage.inputTokens,
          cacheReadTokens: callUsage.cacheReadTokens,
          cacheCreationTokens: callUsage.cacheCreationTokens,
          outputTokens: callUsage.outputTokens,
          stopReason: record.message?.stop_reason,
          costUsd: pricing.estimateClaudeCost(record.message?.model, callUsage).usd
        };
        current.llmCalls.push(currentLlmCall);

        const usage = record.message?.usage;
        if (usage?.service_tier) current.serviceTier = usage.service_tier;
        if (usage?.speed) current.speed = usage.speed;
        const search = usage?.server_tool_use?.web_search_requests ?? 0;
        const fetch = usage?.server_tool_use?.web_fetch_requests ?? 0;
        if (search > 0) current.webSearchRequests = (current.webSearchRequests ?? 0) + search;
        if (fetch > 0) current.webFetchRequests = (current.webFetchRequests ?? 0) + fetch;

        const model = record.message?.model;
        if (model && current.modelsUsed && !current.modelsUsed.includes(model)) current.modelsUsed.push(model);

        const miss = record.message?.diagnostics?.cache_miss_reason;
        if (miss?.type) {
          (current.cacheMisses ??= []).push({ reason: miss.type, missedTokens: miss.cache_missed_input_tokens });
        }
      } else if (currentLlmCall) {
        // Later lines of the same API response: extend the streaming span and
        // pick up the stop_reason, which often lands only on the final line.
        if (record.timestamp) currentLlmCall.endedAt = record.timestamp;
        if (record.message?.stop_reason) currentLlmCall.stopReason = record.message.stop_reason;
      }

      const content = record.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_use') {
            current.toolCallCount += 1;
            const info: ToolCallInfo = {
              id: block.id ?? `tool-${current.tools?.length ?? 0}`,
              name: block.name ?? 'unknown',
              startedAt: record.timestamp,
              inputChars: charSize(block.input),
              inputPreview: toolInputPreview(block.input)
            };
            current.tools?.push(info);
            if (info.id) openTools.set(info.id, info);
          } else if (block?.type === 'thinking') {
            current.thinkingBlocks = (current.thinkingBlocks ?? 0) + 1;
            current.thinkingChars = (current.thinkingChars ?? 0) + (block.thinking?.length ?? 0);
          } else if (block?.type === 'text') {
            current.textChars = (current.textChars ?? 0) + (block.text?.length ?? 0);
          }
        }
      }
      continue;
    }

    if (record.type === 'user') {
      // tool_result continuations: match results back to their tool_use.
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      const sidecar = typeof record.toolUseResult === 'object' && record.toolUseResult !== null ? record.toolUseResult : undefined;
      for (const block of content) {
        if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
        const info = openTools.get(block.tool_use_id);
        if (!info) continue;
        openTools.delete(block.tool_use_id);
        info.outputChars = charSize(block.content);
        if (block.is_error) info.isError = true;
        if (sidecar?.durationMs !== undefined) {
          info.durationMs = sidecar.durationMs;
          info.durationSource = 'reported';
        } else if (record.timestamp && info.startedAt) {
          const ms = Date.parse(record.timestamp) - Date.parse(info.startedAt);
          if (Number.isFinite(ms) && ms >= 0) {
            info.durationMs = ms;
            info.durationSource = 'derived';
          }
        }
        if (sidecar?.agentId) info.agentId = sidecar.agentId;
        if (sidecar?.resolvedModel) info.subagentModel = sidecar.resolvedModel;
      }
    }
  }
  pushCurrent();

  // Attach exact subagent totals to Agent tool calls from their transcripts.
  const subagentsDir = path.join(path.dirname(filePath), sessionId, 'subagents');
  for (const request of requests) {
    for (const tool of request.tools ?? []) {
      if (!tool.agentId) continue;
      const totals = await scanSubagentTotals(path.join(subagentsDir, `agent-${tool.agentId}.jsonl`), pricing);
      if (totals) {
        tool.subagentTokens = totals.tokens;
        tool.subagentCostUsd = totals.costUsd;
        tool.subagentModel = totals.model ?? tool.subagentModel;
      }
    }
  }

  const totalUsage = requests.reduce((acc, r) => addUsage(acc, r.usage), { ...EMPTY_USAGE });
  const totalCostUsd = requests.reduce((sum, r) => sum + (r.cost.usd ?? 0), 0);

  return {
    id: sessionId,
    provider: 'claude',
    title,
    workspacePath,
    updatedAt: lastTimestamp,
    requests,
    totalUsage,
    totalCost: { usd: totalCostUsd, source: 'estimated' }
  };
}

/** Joins a tool_result's content (string or text-block array) into plain text. */
function toolResultContentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((block) => (block && typeof block === 'object' && typeof (block as ContentBlock).text === 'string' ? (block as ContentBlock).text : ''))
    .filter((t): t is string => !!t);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * On-demand Call detail extraction (plans/2026-07/07/call-details, OP-101):
 * re-reads the session file, locates one tool call by its tool_use id, and
 * returns only the bounded excerpt — the full payload never leaves the host.
 */
export async function extractClaudeToolCallDetail(filePath: string, toolCallId: string): Promise<ToolCallDetail> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let input: unknown;
  let inputFound = false;
  let resultText: string | undefined;
  let resultFound = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(toolCallId)) continue;
    let record: RawRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    if (record.type === 'assistant' && !inputFound) {
      const block = content.find((b) => b?.type === 'tool_use' && b.id === toolCallId);
      if (block) {
        input = block.input;
        inputFound = true;
      }
    } else if (record.type === 'user' && !resultFound) {
      const block = content.find((b) => b?.type === 'tool_result' && b.tool_use_id === toolCallId);
      if (block) {
        resultText = toolResultContentText(block.content);
        resultFound = true;
      }
    }
    if (inputFound && resultFound) break;
  }

  if (!inputFound) return unavailableDetail(toolCallId, 'tool call not found in the session log');
  return buildToolCallDetail(toolCallId, input, resultText);
}
