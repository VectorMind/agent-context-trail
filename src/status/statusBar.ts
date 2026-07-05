import * as vscode from 'vscode';
import { ConversationSummary, PromptRequest } from '../domain/types';

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

  private formatCost(usd: number): string {
    return `$${usd.toFixed(2)}`;
  }

  private render(): void {
    if (!this.summary || this.summary.requests.length === 0) {
      this.item.text = '$(comment-discussion) No agent activity';
      this.item.tooltip = 'Agent Context Trail: no Claude Code conversation found for this workspace yet.';
      this.item.show();
      return;
    }

    const last = this.summary.requests[this.summary.requests.length - 1];
    this.item.text = `$(comment-discussion) ${this.formatCost(last.cost.usd)} | ${this.formatCost(
      this.summary.totalCost.usd
    )}`;
    this.item.tooltip = this.buildTooltip(last);
    this.item.show();
  }

  private buildTooltip(last: PromptRequest): vscode.MarkdownString {
    const s = this.summary!;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${s.title ?? 'Untitled conversation'}**\n\n`);
    md.appendMarkdown(
      `_${s.requests.length} prompt iteration${s.requests.length === 1 ? '' : 's'} · Claude Code_\n\n`
    );
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(`Last call: **${this.formatCost(last.cost.usd)}**  \n`);
    md.appendMarkdown(`Conversation total: **${this.formatCost(s.totalCost.usd)}**\n\n`);
    md.appendMarkdown(`_Cost is ${s.totalCost.source}; token detail is in the panel._\n\n`);
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(`[Open panel](command:agentContextTrail.openPanel)`);
    return md;
  }
}
