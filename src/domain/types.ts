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
  usd: number;
  source: CostSource;
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
