import * as fs from 'fs';
import * as readline from 'readline';
import {
  addUsage,
  ConversationSummary,
  EMPTY_USAGE,
  PromptRequest,
  ToolCallInfo,
  UsageTokens
} from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';

/**
 * VS Code's chatSessions/*.jsonl is an append log of patch operations onto
 * one growing document, not a single JSON snapshot:
 *   kind 0 -> `v` is the full initial document.
 *   kind 1 -> {k: path, v: value} sets `document` at `path` to `value`.
 *   kind 2 -> {k: path, v: elements[]} pushes `elements` onto the array
 *             already at `path` (observed only for `["requests"]`).
 * Confirmed by direct inspection of real local files (see plan.md); there is
 * no public spec for this format, so this stays a minimal, defensive
 * generic patcher rather than a hand-picked field list.
 */
type JsonPath = (string | number)[];

interface Kind0Op {
  kind: 0;
  v: Record<string, unknown>;
}
interface Kind1Op {
  kind: 1;
  k: JsonPath;
  v: unknown;
}
interface Kind2Op {
  kind: 2;
  k: JsonPath;
  v: unknown[];
}
type SessionOp = Kind0Op | Kind1Op | Kind2Op | { kind: number; k?: JsonPath; v?: unknown };

function getAtPath(root: Record<string, unknown>, path: JsonPath): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function setAtPath(root: Record<string, unknown>, path: JsonPath, value: unknown): void {
  if (path.length === 0) return;
  let cur: Record<string | number, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const next = cur[seg];
    if (next === null || next === undefined || typeof next !== 'object') {
      cur[seg] = typeof path[i + 1] === 'number' ? [] : {};
    }
    cur = cur[seg] as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

interface RawResponsePart {
  kind?: string;
  text?: string;
  value?: string;
}

interface RawToolCall {
  id: string;
  name: string;
  arguments?: string;
}

interface RawToolCallRound {
  response?: string;
  toolCalls?: RawToolCall[];
  timestamp?: number;
  thinking?: { tokens?: number };
}

interface RawToolCallResultContent {
  content?: { value?: string }[];
}

interface RawCopilotRequest {
  requestId: string;
  timestamp: number;
  modelId?: string;
  message?: { text?: string };
  result?: {
    timings?: { firstProgress?: number; totalElapsed?: number };
    errorDetails?: { message?: string };
    details?: string;
    metadata?: {
      resolvedModel?: string;
      promptTokens?: number;
      outputTokens?: number;
      toolCallRounds?: RawToolCallRound[];
      toolCallResults?: Record<string, RawToolCallResultContent>;
    };
  };
  response?: RawResponsePart[];
  promptTokens?: number;
  completionTokens?: number;
  copilotCredits?: number;
  elapsedMs?: number;
  editedFileEvents?: { uri?: { path?: string }; path?: string }[];
}

interface RawCopilotDocument {
  sessionId?: string;
  customTitle?: string;
  creationDate?: number;
  requests: RawCopilotRequest[];
  inputState?: { selectedModel?: { metadata?: { maxInputTokens?: number; maxOutputTokens?: number } } };
}

function contextWindowFromDocument(doc: RawCopilotDocument): number | undefined {
  return doc.inputState?.selectedModel?.metadata?.maxInputTokens;
}

async function reconstructDocument(filePath: string): Promise<RawCopilotDocument> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  let doc: Record<string, unknown> = { requests: [] };
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let op: SessionOp;
    try {
      op = JSON.parse(trimmed) as SessionOp;
    } catch {
      continue;
    }
    if (op.kind === 0) {
      doc = (op as Kind0Op).v ?? doc;
      if (!Array.isArray(doc.requests)) doc.requests = [];
      continue;
    }
    if (op.kind === 1 && op.k) {
      setAtPath(doc, op.k, op.v);
      continue;
    }
    if (op.kind === 2 && op.k && Array.isArray(op.v)) {
      const arr = getAtPath(doc, op.k);
      if (Array.isArray(arr)) arr.push(...op.v);
      continue;
    }
  }
  return doc as unknown as RawCopilotDocument;
}

function previewText(text: string, maxLen = 80): string | undefined {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}...` : normalized;
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

function toolInputPreview(argumentsJson: string | undefined, maxLen = 70): string | undefined {
  if (!argumentsJson) return undefined;
  let parsed: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(argumentsJson) as unknown;
    parsed = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
  if (!parsed) return undefined;
  for (const key of ['path', 'filePath', 'command', 'query', 'pattern', 'url']) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().replace(/\s+/g, ' ');
      return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}...` : normalized;
    }
  }
  return undefined;
}

function toolResultText(result: RawToolCallResultContent | undefined): string | undefined {
  const parts = result?.content?.map((c) => c.value).filter((v): v is string => !!v);
  return parts && parts.length > 0 ? parts.join('\n') : undefined;
}

function isToolError(text: string | undefined): boolean {
  return !!text && /^ERROR\b/i.test(text.trim());
}

function editedFilePaths(events: RawCopilotRequest['editedFileEvents']): string[] | undefined {
  if (!events || events.length === 0) return undefined;
  const paths = events.map((e) => e.uri?.path ?? e.path).filter((p): p is string => !!p);
  return paths.length > 0 ? paths : undefined;
}

function toolsForRequest(raw: RawCopilotRequest): { tools: ToolCallInfo[]; toolCallCount: number } {
  const rounds = raw.result?.metadata?.toolCallRounds ?? [];
  const results = raw.result?.metadata?.toolCallResults ?? {};
  const tools: ToolCallInfo[] = [];
  for (const round of rounds) {
    for (const call of round.toolCalls ?? []) {
      const resultText = toolResultText(results[call.id]);
      tools.push({
        id: call.id,
        name: call.name,
        startedAt: round.timestamp ? new Date(round.timestamp).toISOString() : undefined,
        inputChars: charSize(call.arguments),
        inputPreview: toolInputPreview(call.arguments),
        outputChars: resultText !== undefined ? charSize(resultText) : undefined,
        isError: isToolError(resultText)
      });
    }
  }
  return { tools, toolCallCount: tools.length };
}

function toPromptRequest(raw: RawCopilotRequest, index: number, pricing: PricingService, contextWindow: number | undefined): PromptRequest {
  const model = raw.result?.metadata?.resolvedModel ?? raw.modelId;
  const usage: UsageTokens = {
    ...EMPTY_USAGE,
    inputTokens: raw.promptTokens ?? raw.result?.metadata?.promptTokens ?? 0,
    outputTokens: raw.completionTokens ?? raw.result?.metadata?.outputTokens ?? 0
  };

  const startedAt = new Date(raw.timestamp).toISOString();
  const durationMs = raw.result?.timings?.totalElapsed ?? raw.elapsedMs;
  const endedAt = durationMs !== undefined ? new Date(raw.timestamp + durationMs).toISOString() : undefined;

  const { tools, toolCallCount } = toolsForRequest(raw);
  const rounds = raw.result?.metadata?.toolCallRounds ?? [];
  const reasoningOutputTokens = rounds.reduce((sum, r) => sum + (r.thinking?.tokens ?? 0), 0);

  const thinkingParts = (raw.response ?? []).filter((p) => p.kind === 'thinking');
  const textParts = (raw.response ?? []).filter((p) => p.kind === undefined);
  const thinkingChars = thinkingParts.reduce((sum, p) => sum + (p.text?.length ?? 0), 0);
  const textChars = textParts.reduce((sum, p) => sum + (p.value?.length ?? p.text?.length ?? 0), 0);

  return {
    id: raw.requestId,
    index,
    startedAt,
    endedAt,
    model,
    usage,
    cost: pricing.estimateCopilotCost(model, usage),
    toolCallCount,
    durationMs,
    llmCallCount: rounds.length > 0 ? rounds.length : undefined,
    stopReason: raw.result?.errorDetails?.message,
    modelsUsed: model ? [model] : undefined,
    thinkingBlocks: thinkingParts.length > 0 ? thinkingParts.length : undefined,
    thinkingChars: thinkingChars > 0 ? thinkingChars : undefined,
    textChars: textChars > 0 ? textChars : undefined,
    promptChars: raw.message?.text ? raw.message.text.length : undefined,
    promptText: raw.message?.text,
    tools: tools.length > 0 ? tools : undefined,
    reasoningOutputTokens: reasoningOutputTokens > 0 ? reasoningOutputTokens : undefined,
    timeToFirstTokenMs: raw.result?.timings?.firstProgress,
    modelContextWindow: contextWindow,
    premiumCredits: raw.copilotCredits,
    editedFiles: editedFilePaths(raw.editedFileEvents)
  };
}

export interface CopilotMeta {
  title?: string;
  firstAt?: string;
  lastAt?: string;
  requestCount: number;
  totalUsage: UsageTokens;
  totalCostUsd: number;
}

export async function scanCopilotSessionMeta(filePath: string, pricing: PricingService): Promise<CopilotMeta> {
  const doc = await reconstructDocument(filePath);
  const requests = doc.requests ?? [];
  const contextWindow = contextWindowFromDocument(doc);

  let totalUsage: UsageTokens = { ...EMPTY_USAGE };
  let totalCostUsd = 0;
  let firstAt: string | undefined;
  let lastAt: string | undefined;
  let title = doc.customTitle;

  requests.forEach((raw, index) => {
    const request = toPromptRequest(raw, index, pricing, contextWindow);
    totalUsage = addUsage(totalUsage, request.usage);
    totalCostUsd += request.cost.usd ?? 0;
    firstAt ??= request.startedAt;
    lastAt = request.startedAt;
    if (!title && request.promptText) title = previewText(request.promptText);
  });

  return { title, firstAt, lastAt, requestCount: requests.length, totalUsage, totalCostUsd };
}

export async function parseCopilotSession(
  filePath: string,
  sessionId: string,
  workspacePath: string,
  pricing: PricingService
): Promise<ConversationSummary> {
  const doc = await reconstructDocument(filePath);
  const rawRequests = doc.requests ?? [];
  const contextWindow = contextWindowFromDocument(doc);

  const requests = rawRequests.map((raw, index) => toPromptRequest(raw, index, pricing, contextWindow));
  const totalUsage = requests.reduce((acc, r) => addUsage(acc, r.usage), { ...EMPTY_USAGE });
  const totalCostUsd = requests.reduce((sum, r) => sum + (r.cost.usd ?? 0), 0);

  let title = doc.customTitle;
  if (!title) {
    const firstPrompt = requests.find((r) => r.promptText)?.promptText;
    if (firstPrompt) title = previewText(firstPrompt);
  }

  const updatedAt = requests.length > 0 ? requests[requests.length - 1].startedAt : new Date(doc.creationDate ?? Date.now()).toISOString();

  return {
    id: sessionId,
    provider: 'copilot',
    title,
    workspacePath,
    updatedAt,
    requests,
    totalUsage,
    totalCost: { usd: totalCostUsd, source: 'estimated' }
  };
}
