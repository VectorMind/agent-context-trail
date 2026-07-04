import * as fs from 'fs';
import * as readline from 'readline';
import { addUsage, ConversationSummary, EMPTY_USAGE, PromptRequest, UsageTokens } from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';

interface ContentBlock {
  type?: string;
  text?: string;
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
}

interface RawRecord {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  aiTitle?: string;
  message?: {
    model?: string;
    content?: string | ContentBlock[];
    usage?: RawUsage;
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

function countToolCalls(record: RawRecord): number {
  const content = record.message?.content;
  if (!Array.isArray(content)) return 0;
  return content.filter((block) => block?.type === 'tool_use').length;
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

  const pushCurrent = () => {
    if (current) {
      current.cost = pricing.estimateClaudeCost(current.model, current.usage);
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
      current = {
        id: record.uuid ?? `req-${requests.length}`,
        index: requests.length,
        startedAt: record.timestamp ?? lastTimestamp,
        usage: { ...EMPTY_USAGE },
        cost: { usd: 0, source: 'estimated' },
        toolCallCount: 0
      };
      continue;
    }

    if (record.type === 'assistant' && current) {
      current.endedAt = record.timestamp;
      current.model = record.message?.model ?? current.model;
      current.usage = addUsage(current.usage, usageFromRecord(record));
      current.toolCallCount += countToolCalls(record);
    }
  }
  pushCurrent();

  const totalUsage = requests.reduce((acc, r) => addUsage(acc, r.usage), { ...EMPTY_USAGE });
  const totalCostUsd = requests.reduce((sum, r) => sum + r.cost.usd, 0);

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
