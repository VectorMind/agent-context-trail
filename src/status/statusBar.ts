import * as vscode from 'vscode';
import { ConversationSummary, PromptRequest } from '../domain/types';
import { formatUsd } from '../shared/format';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private summary: ConversationSummary | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Agent Context Trail';
    this.item.command = 'agentContextTrail.openPanel';
  }

  dispose(): void {
    this.item.dispose();
  }

  update(summary: ConversationSummary | undefined): void {
    this.summary = summary;
    this.render();
  }

  private render(): void {
    if (!this.summary || this.summary.requests.length === 0) {
      this.item.text = '$(comment-discussion) No agent activity';
      this.item.tooltip = 'Agent Context Trail: no agent conversation found for this workspace yet.';
      this.item.show();
      return;
    }

    const last = this.summary.requests[this.summary.requests.length - 1];
    this.item.text = `$(comment-discussion) ${this.primaryText(last)}`;
    this.item.tooltip = this.buildTooltip(last);
    this.item.show();
  }

  /**
   * Cost is the default headline signal, but it's honestly unavailable for
   * providers (e.g. Codex) that don't report per-token pricing. Rather than
   * show "n/a | n/a" by default, fall back to that provider's own economic
   * signal (rate-limit consumption), then to a plain prompt count.
   */
  private primaryText(last: PromptRequest): string {
    const summary = this.summary!;
    if (last.cost.usd !== undefined || summary.totalCost.usd !== undefined) {
      return `${formatUsd(last.cost.usd)} | ${formatUsd(summary.totalCost.usd)}`;
    }
    const primaryPercent = summary.currentStatus?.rateLimits?.primary?.usedPercent;
    if (primaryPercent !== undefined) {
      return `${primaryPercent.toFixed(0)}% used`;
    }
    return `${summary.requests.length} prompt${summary.requests.length === 1 ? '' : 's'}`;
  }

  private buildTooltip(last: PromptRequest): vscode.MarkdownString {
    const summary = this.summary!;
    const providerLabel = summary.provider === 'claude' ? 'Claude Code' : summary.provider === 'codex' ? 'Codex' : 'Copilot';

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${summary.title ?? 'Untitled conversation'}**\n\n`);
    md.appendMarkdown(
      `_${summary.requests.length} prompt iteration${summary.requests.length === 1 ? '' : 's'} · ${providerLabel}_\n\n`
    );
    md.appendMarkdown('---\n\n');
    if (last.cost.usd !== undefined || summary.totalCost.usd !== undefined) {
      md.appendMarkdown(`Last call: **${formatUsd(last.cost.usd)}**  \n`);
      md.appendMarkdown(`Conversation total: **${formatUsd(summary.totalCost.usd)}**\n\n`);
      md.appendMarkdown(`_Cost is ${summary.totalCost.source}; token detail is in the panel._\n\n`);
    } else {
      md.appendMarkdown(`_${providerLabel} does not report per-token cost; rate-limit consumption is shown instead._\n\n`);
    }
    appendRateLimits(md, summary);
    appendContextStatus(md, summary);
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(`[Open panel](command:agentContextTrail.openPanel)`);
    return md;
  }
}

function appendRateLimits(md: vscode.MarkdownString, summary: ConversationSummary): void {
  const rateLimits = summary.currentStatus?.rateLimits;
  if (!rateLimits?.primary && !rateLimits?.secondary) return;

  const windows: string[] = [];
  if (rateLimits.primary?.usedPercent !== undefined) {
    windows.push(`primary ${rateLimits.primary.usedPercent.toFixed(0)}%`);
  }
  if (rateLimits.secondary?.usedPercent !== undefined) {
    windows.push(`secondary ${rateLimits.secondary.usedPercent.toFixed(0)}%`);
  }
  if (windows.length === 0) return;

  const prefix = rateLimits.planType ? `${rateLimits.planType} plan · ` : '';
  md.appendMarkdown(`${prefix}${windows.join(' · ')}\n\n`);
}

function appendContextStatus(md: vscode.MarkdownString, summary: ConversationSummary): void {
  const context = summary.currentStatus?.context;
  if (!context) return;

  md.appendMarkdown(`Current context: **${formatContextFill(context.contextFillPercent)}**`);
  if (context.modelContextWindow !== undefined) {
    md.appendMarkdown(` · capacity ${formatTokensCompact(context.modelContextWindow)}`);
  }
  if (context.contextUsedTokens !== undefined) {
    md.appendMarkdown(` · used ${formatTokensCompact(context.contextUsedTokens)}`);
  }
  if (context.reservedOutputTokens !== undefined) {
    md.appendMarkdown(` · reserved output ${formatTokensCompact(context.reservedOutputTokens)}`);
  }
  if (context.longContextMode) {
    md.appendMarkdown(` · ${context.longContextMode}`);
  }
  md.appendMarkdown('\n\n');
}

function formatContextFill(fillPercent: number | undefined): string {
  return fillPercent === undefined ? 'unavailable' : `${fillPercent.toFixed(1)}% full`;
}

function formatTokensCompact(value: number): string {
  const trim = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}
