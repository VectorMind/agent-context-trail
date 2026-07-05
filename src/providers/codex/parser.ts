import * as fs from 'fs';
import * as readline from 'readline';
import {
  addUsage,
  ConversationSummary,
  CurrentStatusSnapshot,
  EMPTY_USAGE,
  PromptRequest,
  RateLimitStatus,
  ToolCallInfo,
  UsageTokens
} from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface CodexRateLimits {
  limit_id?: string;
  plan_type?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  rate_limit_reached_type?: string;
}

interface CodexMeta {
  title?: string;
  firstAt?: string;
  lastAt?: string;
  requestCount: number;
  totalUsage: UsageTokens;
  totalCostUsd: number;
  workspacePath?: string;
}

interface PendingTurn {
  turnId: string;
  request: PromptRequest;
  openTools: Map<string, ToolCallInfo>;
  latestUsage?: UsageTokens;
  latestReasoningOutputTokens?: number;
  latestModelContextWindow?: number;
  latestRateLimits?: RateLimitStatus;
}

interface RawRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function unixSecondsToIso(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return new Date(value * 1000).toISOString();
}

function usageFromTokenUsage(tokens: CodexTokenUsage | undefined): UsageTokens {
  return {
    inputTokens: tokens?.input_tokens ?? 0,
    cacheReadTokens: tokens?.cached_input_tokens ?? 0,
    cacheCreationTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    outputTokens: tokens?.output_tokens ?? 0
  };
}

function rateLimitsFromPayload(raw: CodexRateLimits | undefined): RateLimitStatus | undefined {
  if (!raw) return undefined;
  return {
    limitId: raw.limit_id,
    planType: raw.plan_type,
    primary: raw.primary
      ? {
          usedPercent: raw.primary.used_percent,
          windowMinutes: raw.primary.window_minutes,
          resetsAt: unixSecondsToIso(raw.primary.resets_at)
        }
      : undefined,
    secondary: raw.secondary
      ? {
          usedPercent: raw.secondary.used_percent,
          windowMinutes: raw.secondary.window_minutes,
          resetsAt: unixSecondsToIso(raw.secondary.resets_at)
        }
      : undefined,
    rateLimitReachedType: raw.rate_limit_reached_type
  };
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

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function toolInputPreview(input: Record<string, unknown> | undefined, maxLen = 70): string | undefined {
  if (!input) return undefined;
  for (const key of ['command', 'path', 'file_path', 'pattern', 'q', 'query', 'prompt', 'url']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().replace(/\s+/g, ' ');
      return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}...` : normalized;
    }
  }
  return undefined;
}

function isToolError(output: string | undefined): boolean {
  if (!output) return false;
  return /\bExit code:\s*[1-9]\d*\b/.test(output) || /\bisError"\s*:\s*true\b/.test(output);
}

function collectTextBlocks(value: unknown, kind: 'input_text' | 'output_text'): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const record = entry as Record<string, unknown>;
      return record.type === kind && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function previewText(text: string, maxLen = 80): string | undefined {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}...` : normalized;
}

function turnIdFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  const direct = payload.turn_id;
  if (typeof direct === 'string') return direct;
  const passThrough = payload.internal_chat_message_metadata_passthrough;
  if (passThrough && typeof passThrough === 'object') {
    const turnId = (passThrough as Record<string, unknown>).turn_id;
    if (typeof turnId === 'string') return turnId;
  }
  return undefined;
}

function updateContextStatus(
  currentStatus: CurrentStatusSnapshot | undefined,
  request: PromptRequest,
  workspacePath: string | undefined
): CurrentStatusSnapshot | undefined {
  const usedTokens = request.usage.inputTokens;
  const window = request.modelContextWindow;
  const fillPercent = window && window > 0 ? (usedTokens / window) * 100 : undefined;
  const availableTokens = window && window > usedTokens ? window - usedTokens : undefined;
  const next: CurrentStatusSnapshot = { ...currentStatus };
  next.context = {
    workspacePath,
    model: request.model,
    modelContextWindow: window,
    contextUsedTokens: usedTokens > 0 ? usedTokens : undefined,
    contextAvailableTokens: availableTokens,
    contextFillPercent: fillPercent
  };
  return next;
}

function startTurn(turnId: string, startedAt: string, index: number): PendingTurn {
  return {
    turnId,
    openTools: new Map(),
    request: {
      id: turnId,
      index,
      startedAt,
      usage: { ...EMPTY_USAGE },
      cost: { source: 'unavailable' },
      toolCallCount: 0,
      modelsUsed: [],
      tools: []
    }
  };
}

function applyLatestTokenSnapshot(turn: PendingTurn): void {
  if (turn.latestUsage) turn.request.usage = turn.latestUsage;
  if (turn.latestReasoningOutputTokens !== undefined) {
    turn.request.reasoningOutputTokens = turn.latestReasoningOutputTokens;
  }
  if (turn.latestModelContextWindow !== undefined) {
    turn.request.modelContextWindow = turn.latestModelContextWindow;
  }
}

export async function scanCodexSessionMeta(
  filePath: string,
  titleFromIndex: string | undefined,
  pricing: PricingService
): Promise<CodexMeta> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let title = titleFromIndex;
  let firstPromptPreview: string | undefined;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  let workspacePath: string | undefined;
  let totalUsage: UsageTokens = { ...EMPTY_USAGE };
  let totalCostUsd = 0;
  let requestCount = 0;
  let current: PendingTurn | null = null;

  const finalize = () => {
    if (!current) return;
    applyLatestTokenSnapshot(current);
    totalUsage = addUsage(totalUsage, current.request.usage);
    totalCostUsd += pricing.estimateCodexCost(current.request.model, current.request.usage).usd ?? 0;
    requestCount += 1;
    current = null;
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: RawRecord;
    try {
      record = JSON.parse(trimmed) as RawRecord;
    } catch {
      continue;
    }

    firstAt ??= record.timestamp;
    if (record.timestamp) lastAt = record.timestamp;
    const payload = record.payload;

    if (record.type === 'session_meta') {
      const cwd = payload?.cwd;
      if (typeof cwd === 'string') workspacePath = cwd;
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'task_started') {
      const turnId = turnIdFromPayload(payload);
      if (!turnId) continue;
      finalize();
      const startedAt = unixSecondsToIso(typeof payload.started_at === 'number' ? payload.started_at : undefined) ?? record.timestamp ?? '';
      current = startTurn(turnId, startedAt, requestCount);
      current.latestModelContextWindow =
        typeof payload.model_context_window === 'number' ? payload.model_context_window : undefined;
      continue;
    }

    if (record.type === 'turn_context') {
      const turnId = turnIdFromPayload(payload);
      if (!turnId) continue;
      if (!current || current.turnId !== turnId) {
        finalize();
        current = startTurn(turnId, record.timestamp ?? '', requestCount);
      }
      if (typeof payload?.model === 'string') {
        current.request.model = payload.model;
        if (!current.request.modelsUsed?.includes(payload.model)) current.request.modelsUsed?.push(payload.model);
      }
      if (typeof payload?.model_context_window === 'number') {
        current.latestModelContextWindow = payload.model_context_window;
      }
      const cwd = payload?.cwd;
      if (typeof cwd === 'string') workspacePath = cwd;
      continue;
    }

    if (record.type === 'response_item' && payload?.type === 'message') {
      const role = payload.role;
      if (role === 'user') {
        const prompt = collectTextBlocks(payload.content, 'input_text');
        if (!title && !firstPromptPreview) firstPromptPreview = previewText(prompt);
      }
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'token_count' && current) {
      const info = payload.info as Record<string, unknown> | undefined;
      const lastTokenUsage = (info?.last_token_usage ?? {}) as CodexTokenUsage;
      current.latestUsage = usageFromTokenUsage(lastTokenUsage);
      current.latestReasoningOutputTokens = lastTokenUsage.reasoning_output_tokens;
      if (typeof info?.model_context_window === 'number') current.latestModelContextWindow = info.model_context_window;
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'task_complete') {
      finalize();
    }
  }

  finalize();

  return {
    title: title ?? firstPromptPreview,
    firstAt,
    lastAt,
    requestCount,
    totalUsage,
    totalCostUsd,
    workspacePath
  };
}

export async function parseCodexSession(
  filePath: string,
  sessionId: string,
  titleFromIndex: string | undefined,
  pricing: PricingService
): Promise<ConversationSummary> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  const requests: PromptRequest[] = [];
  let title = titleFromIndex;
  let workspacePath = '';
  let updatedAt = '';
  let current: PendingTurn | null = null;
  let currentStatus: CurrentStatusSnapshot | undefined;

  const finalize = (completedAt?: string, durationMs?: number, timeToFirstTokenMs?: number) => {
    if (!current) return;
    if (completedAt) current.request.endedAt = completedAt;
    if (durationMs !== undefined) current.request.durationMs = durationMs;
    if (timeToFirstTokenMs !== undefined) current.request.timeToFirstTokenMs = timeToFirstTokenMs;
    if (current.request.endedAt && current.request.durationMs === undefined) {
      const derived = Date.parse(current.request.endedAt) - Date.parse(current.request.startedAt);
      if (Number.isFinite(derived) && derived >= 0) current.request.durationMs = derived;
    }
    applyLatestTokenSnapshot(current);
    current.request.cost = pricing.estimateCodexCost(current.request.model, current.request.usage);
    requests.push(current.request);
    currentStatus = updateContextStatus(currentStatus, current.request, workspacePath || undefined);
    if (current.latestRateLimits) {
      currentStatus = { ...currentStatus, rateLimits: current.latestRateLimits };
    }
    current = null;
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: RawRecord;
    try {
      record = JSON.parse(trimmed) as RawRecord;
    } catch {
      continue;
    }

    if (record.timestamp) updatedAt = record.timestamp;
    const payload = record.payload;

    if (record.type === 'session_meta') {
      const cwd = payload?.cwd;
      if (typeof cwd === 'string') workspacePath = cwd;
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'task_started') {
      const turnId = turnIdFromPayload(payload);
      if (!turnId) continue;
      finalize();
      const startedAt = unixSecondsToIso(typeof payload.started_at === 'number' ? payload.started_at : undefined) ?? record.timestamp ?? '';
      current = startTurn(turnId, startedAt, requests.length);
      if (typeof payload.model_context_window === 'number') {
        current.latestModelContextWindow = payload.model_context_window;
      }
      continue;
    }

    if (record.type === 'turn_context') {
      const turnId = turnIdFromPayload(payload);
      if (!turnId) continue;
      if (!current || current.turnId !== turnId) {
        finalize();
        current = startTurn(turnId, record.timestamp ?? '', requests.length);
      }
      if (typeof payload?.model === 'string') {
        current.request.model = payload.model;
        if (!current.request.modelsUsed?.includes(payload.model)) current.request.modelsUsed?.push(payload.model);
      }
      if (typeof payload?.model_context_window === 'number') {
        current.latestModelContextWindow = payload.model_context_window;
      }
      const cwd = payload?.cwd;
      if (typeof cwd === 'string') workspacePath = cwd;
      continue;
    }

    if (!current) continue;

    if (record.type === 'response_item' && payload?.type === 'message') {
      const role = payload.role;
      if (role === 'user') {
        const promptText = collectTextBlocks(payload.content, 'input_text');
        if (promptText) {
          current.request.promptText = promptText;
          current.request.promptChars = promptText.length;
          title ??= previewText(promptText);
        }
      } else if (role === 'assistant') {
        const text = collectTextBlocks(payload.content, 'output_text');
        if (text) current.request.textChars = (current.request.textChars ?? 0) + text.length;
      }
      continue;
    }

    if (record.type === 'response_item' && payload?.type === 'function_call') {
      current.request.toolCallCount += 1;
      const argsString = typeof payload.arguments === 'string' ? payload.arguments : undefined;
      const argsObject = parseJsonObject(argsString);
      const callId = typeof payload.call_id === 'string' ? payload.call_id : `tool-${current.request.toolCallCount}`;
      const tool: ToolCallInfo = {
        id: callId,
        name: typeof payload.name === 'string' ? payload.name : 'unknown',
        startedAt: record.timestamp,
        inputChars: charSize(argsObject ?? argsString),
        inputPreview: toolInputPreview(argsObject)
      };
      current.request.tools?.push(tool);
      current.openTools.set(callId, tool);
      continue;
    }

    if (record.type === 'response_item' && payload?.type === 'function_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      if (!callId) continue;
      const tool = current.openTools.get(callId);
      if (!tool) continue;
      current.openTools.delete(callId);
      const output = typeof payload.output === 'string' ? payload.output : undefined;
      tool.outputChars = charSize(output);
      if (isToolError(output)) tool.isError = true;
      if (record.timestamp && tool.startedAt) {
        const duration = Date.parse(record.timestamp) - Date.parse(tool.startedAt);
        if (Number.isFinite(duration) && duration >= 0) {
          tool.durationMs = duration;
          tool.durationSource = 'derived';
        }
      }
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'token_count') {
      const info = payload.info as Record<string, unknown> | undefined;
      const lastTokenUsage = (info?.last_token_usage ?? {}) as CodexTokenUsage;
      current.latestUsage = usageFromTokenUsage(lastTokenUsage);
      current.latestReasoningOutputTokens = lastTokenUsage.reasoning_output_tokens;
      if (typeof info?.model_context_window === 'number') current.latestModelContextWindow = info.model_context_window;
      current.latestRateLimits = rateLimitsFromPayload(payload.rate_limits as CodexRateLimits | undefined);
      continue;
    }

    if (record.type === 'event_msg' && payload?.type === 'task_complete') {
      const completedAt =
        unixSecondsToIso(typeof payload.completed_at === 'number' ? payload.completed_at : undefined) ?? record.timestamp;
      const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined;
      const timeToFirstTokenMs =
        typeof payload.time_to_first_token_ms === 'number' ? payload.time_to_first_token_ms : undefined;
      finalize(completedAt, durationMs, timeToFirstTokenMs);
    }
  }

  finalize();

  const totalUsage = requests.reduce((acc, request) => addUsage(acc, request.usage), { ...EMPTY_USAGE });
  const totalCostUsd = requests.reduce((sum, r) => sum + (r.cost.usd ?? 0), 0);

  return {
    id: sessionId,
    provider: 'codex',
    title,
    workspacePath,
    updatedAt,
    requests,
    totalUsage,
    totalCost: { usd: totalCostUsd, source: 'estimated' },
    currentStatus
  };
}
