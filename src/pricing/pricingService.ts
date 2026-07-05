import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CostAmount, UsageTokens } from '../domain/types';

interface ModelRate {
  baseInput: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

interface CodexModelRate {
  baseInput: number;
  cacheRead: number;
  output: number;
}

interface PricingFile {
  schemaVersion: number;
  claude: {
    source: string;
    retrieved: string;
    models: Record<string, ModelRate>;
    fallback: ModelRate;
  };
  codex: {
    source: string;
    retrieved: string;
    models: Record<string, CodexModelRate>;
    fallback: CodexModelRate;
  };
}

const DATE_SUFFIX = /-\d{8}$/;

export class PricingService {
  private data: PricingFile | undefined;
  private readonly filePath: string;

  constructor(extensionPath: string) {
    this.filePath = path.join(extensionPath, 'config', 'tokens-cost.yaml');
  }

  private load(): PricingFile {
    if (!this.data) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = yaml.load(raw) as PricingFile;
    }
    return this.data;
  }

  private resolveClaudeModel(model: string | undefined): ModelRate {
    const { models, fallback } = this.load().claude;
    if (!model) return fallback;
    if (models[model]) return models[model];
    const withoutDateSuffix = model.replace(DATE_SUFFIX, '');
    if (models[withoutDateSuffix]) return models[withoutDateSuffix];
    return fallback;
  }

  private resolveCodexModel(model: string | undefined): CodexModelRate {
    const { models, fallback } = this.load().codex;
    if (!model) return fallback;
    return models[model] ?? fallback;
  }

  /**
   * Estimated cost only. Claude Code session logs do not report cost
   * directly, so every result from this method is labeled "estimated".
   */
  estimateClaudeCost(model: string | undefined, usage: UsageTokens): CostAmount {
    const rate = this.resolveClaudeModel(model);
    const perToken = (rateUsdPerMTok: number) => rateUsdPerMTok / 1_000_000;

    // Prefer the 5m/1h cache-write breakdown when the log provides it;
    // otherwise assume the (shorter, cheaper) 5-minute cache TTL, which is
    // the Claude Code default.
    const hasBreakdown = usage.cacheCreation5mTokens + usage.cacheCreation1hTokens > 0;
    const cacheWriteCost = hasBreakdown
      ? usage.cacheCreation5mTokens * perToken(rate.cacheWrite5m) +
        usage.cacheCreation1hTokens * perToken(rate.cacheWrite1h)
      : usage.cacheCreationTokens * perToken(rate.cacheWrite5m);

    const usd =
      usage.inputTokens * perToken(rate.baseInput) +
      cacheWriteCost +
      usage.cacheReadTokens * perToken(rate.cacheRead) +
      usage.outputTokens * perToken(rate.output);

    return { usd, source: 'estimated' };
  }

  /**
   * Estimated cost only. Codex is normally billed through a subscription /
   * rate-limit plan, not metered per token, so this is a bring-your-own-token
   * equivalent: what the same usage would cost at OpenAI's standard listed
   * API rate. Reasoning tokens are already counted inside outputTokens by the
   * Codex log (a breakdown, not an addition), so they are not billed twice.
   */
  estimateCodexCost(model: string | undefined, usage: UsageTokens): CostAmount {
    const rate = this.resolveCodexModel(model);
    const perToken = (rateUsdPerMTok: number) => rateUsdPerMTok / 1_000_000;

    const usd =
      usage.inputTokens * perToken(rate.baseInput) +
      usage.cacheReadTokens * perToken(rate.cacheRead) +
      usage.outputTokens * perToken(rate.output);

    return { usd, source: 'estimated' };
  }
}
