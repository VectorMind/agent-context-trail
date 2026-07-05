import * as vscode from 'vscode';
import { ConversationSummary } from './domain/types';
import { findLatestClaudeSession } from './providers/claude/discover';
import { parseClaudeSession } from './providers/claude/parser';
import { PricingService } from './pricing/pricingService';
import { CostUnit, StatusBarController } from './status/statusBar';
import { PanelController } from './panel/panelController';

const REFRESH_INTERVAL_MS = 15_000;

let outputChannel: vscode.OutputChannel;
let statusBar: StatusBarController;
let panelController: PanelController;
let pricing: PricingService;
let currentSummary: ConversationSummary | undefined;

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function refresh(): Promise<void> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    currentSummary = undefined;
    statusBar.update(undefined);
    return;
  }

  try {
    const session = findLatestClaudeSession(workspacePath);
    if (!session) {
      currentSummary = undefined;
      statusBar.update(undefined);
      return;
    }
    currentSummary = await parseClaudeSession(session.filePath, session.sessionId, workspacePath, pricing);
    statusBar.update(currentSummary);
  } catch (err) {
    outputChannel.appendLine(`[refresh] failed: ${(err as Error).stack ?? String(err)}`);
  }
}

function formatCostDetail(usd: number): string {
  return `$${usd.toFixed(4)} (${pricing.usdToCredit(usd).toFixed(2)} AIC)`;
}

function showSummary(): void {
  outputChannel.clear();

  if (!currentSummary || currentSummary.requests.length === 0) {
    outputChannel.appendLine('No Claude Code conversation found for this workspace yet.');
    outputChannel.show(true);
    return;
  }

  const s = currentSummary;
  outputChannel.appendLine(`Conversation: ${s.title ?? '(untitled)'}`);
  outputChannel.appendLine(`Workspace: ${s.workspacePath}`);
  outputChannel.appendLine(`Requests: ${s.requests.length}`);
  outputChannel.appendLine('');

  for (const r of s.requests) {
    outputChannel.appendLine(
      `#${r.index + 1}  model=${r.model ?? 'unknown'}  in=${r.usage.inputTokens}` +
        `  cacheRead=${r.usage.cacheReadTokens}  cacheWrite=${r.usage.cacheCreationTokens}` +
        `  out=${r.usage.outputTokens}  tools=${r.toolCallCount}  cost=${formatCostDetail(r.cost.usd)}`
    );
  }

  outputChannel.appendLine('');
  outputChannel.appendLine(
    `TOTAL  in=${s.totalUsage.inputTokens}  cacheRead=${s.totalUsage.cacheReadTokens}` +
      `  cacheWrite=${s.totalUsage.cacheCreationTokens}  out=${s.totalUsage.outputTokens}` +
      `  cost=${formatCostDetail(s.totalCost.usd)}`
  );
  outputChannel.show(true);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Agent Context Trail');
  pricing = new PricingService(context.extensionPath);
  statusBar = new StatusBarController(pricing);
  panelController = new PanelController(context, pricing);

  context.subscriptions.push(outputChannel, statusBar, panelController);

  context.subscriptions.push(
    vscode.commands.registerCommand('agentContextTrail.refresh', () => refresh()),
    vscode.commands.registerCommand('agentContextTrail.showSummary', () => showSummary()),
    vscode.commands.registerCommand('agentContextTrail.openPanel', () => panelController.reveal(getWorkspacePath())),
    vscode.commands.registerCommand('agentContextTrail.setCostUnit', async (unit: CostUnit) => {
      await vscode.workspace
        .getConfiguration('agentContextTrail')
        .update('costUnit', unit, vscode.ConfigurationTarget.Global);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentContextTrail.costUnit')) {
        statusBar.update(currentSummary);
      }
    })
  );

  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  void refresh();
}

export function deactivate(): void {
  // Disposables registered via context.subscriptions handle cleanup.
}
