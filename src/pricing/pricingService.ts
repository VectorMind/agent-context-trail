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

interface PricingFile {
  schemaVersion: number;
  credit: { usdPerCredit: number };
  claude: {
    source: string;
    retrieved: string;
    models: Record<string, ModelRate>;
    fallback: ModelRate;
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

  get usdPerCredit(): number {
    return this.load().credit.usdPerCredit;
  }

  usdToCredit(usd: number): number {
    return usd / this.usdPerCredit;
  }

  private resolveClaudeModel(model: string | undefined): ModelRate {
    const { models, fallback } = this.load().claude;
    if (!model) return fallback;
    if (models[model]) return models[model];
    const withoutDateSuffix = model.replace(DATE_SUFFIX, '');
    if (models[withoutDateSuffix]) return models[withoutDateSuffix];
    return fallback;
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
}
