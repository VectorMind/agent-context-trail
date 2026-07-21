import * as vscode from 'vscode';
import { ConversationListItem, ConversationSummary, ProviderId } from './domain/types';
import { findLatestClaudeSession } from './providers/claude/discover';
import { parseClaudeSession } from './providers/claude/parser';
import { getCodexSessionFilePath, getLatestCodexRateLimits, listCodexConversations } from './providers/codex/discover';
import { parseCodexSession } from './providers/codex/parser';
import { getCopilotSessionFilePath, listCopilotConversations } from './providers/copilot/discover';
import { parseCopilotSession } from './providers/copilot/parser';
import { PricingService } from './pricing/pricingService';
import { CopilotOtelService } from './providers/copilot/otel/service';
import { formatUsd } from './shared/format';
import { StatusBarController } from './status/statusBar';
import { PanelController } from './panel/panelController';

const REFRESH_INTERVAL_MS = 15_000;

let outputChannel: vscode.OutputChannel;
let statusBar: StatusBarController;
let panelController: PanelController;
let pricing: PricingService;
let otelService: CopilotOtelService;
let currentSummary: ConversationSummary | undefined;

function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function refresh(): Promise<void> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    currentSummary = undefined;
    statusBar.update(undefined);
    await panelController.refresh(undefined);
    return;
  }

  try {
    currentSummary = await loadLatestSummary(workspacePath);
    if (!currentSummary) {
      currentSummary = undefined;
      statusBar.update(undefined);
      await panelController.refresh(workspacePath);
      return;
    }
    statusBar.update(currentSummary);
    await panelController.refresh(workspacePath);
  } catch (err) {
    outputChannel.appendLine(`[refresh] failed: ${(err as Error).stack ?? String(err)}`);
  }
}

async function loadLatestSummary(workspacePath: string): Promise<ConversationSummary | undefined> {
  const claudeSession = findLatestClaudeSession(workspacePath);
  const [codexItems, copilotItems] = await Promise.all([
    listCodexConversations(workspacePath, pricing),
    listCopilotConversations(workspacePath, pricing)
  ]);

  const candidates: Array<{ provider: ProviderId; lastAt: string; load: () => Promise<ConversationSummary | undefined> }> = [];
  if (claudeSession) {
    candidates.push({
      provider: 'claude',
      lastAt: new Date(claudeSession.mtimeMs).toISOString(),
      load: () => parseClaudeSession(claudeSession.filePath, claudeSession.sessionId, workspacePath, pricing)
    });
  }
  if (codexItems[0]) {
    candidates.push({
      provider: 'codex',
      lastAt: codexItems[0].lastAt,
      load: () => listAndLoadCodexSummary(workspacePath, codexItems)
    });
  }
  if (copilotItems[0]) {
    candidates.push({
      provider: 'copilot',
      lastAt: copilotItems[0].lastAt,
      load: () => listAndLoadCopilotSummary(workspacePath, copilotItems)
    });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return candidates[0].load();
}

async function listAndLoadCodexSummary(workspacePath: string, items: ConversationListItem[]): Promise<ConversationSummary | undefined> {
  const latest = items[0];
  if (!latest) return undefined;
  const filePath = getCodexSessionFilePath(latest.id);
  if (!filePath) return undefined;
  const summary = await parseCodexSession(filePath, latest.id, undefined, pricing);
  const latestRateLimits = await getLatestCodexRateLimits(workspacePath, pricing);
  return {
    ...summary,
    currentStatus:
      summary.currentStatus || latestRateLimits
        ? {
            ...summary.currentStatus,
            rateLimits: latestRateLimits ?? summary.currentStatus?.rateLimits
          }
        : undefined
  };
}

async function listAndLoadCopilotSummary(
  workspacePath: string,
  items: ConversationListItem[]
): Promise<ConversationSummary | undefined> {
  const latest = items[0];
  if (!latest) return undefined;
  const filePath = getCopilotSessionFilePath(latest.id);
  if (!filePath) return undefined;
  return parseCopilotSession(filePath, latest.id, workspacePath, pricing, otelService.storageDir);
}

function showSummary(): void {
  outputChannel.clear();

  if (!currentSummary || currentSummary.requests.length === 0) {
    outputChannel.appendLine('No agent conversation found for this workspace yet.');
    outputChannel.show(true);
    return;
  }

  const s = currentSummary;
  outputChannel.appendLine(`Conversation: ${s.title ?? '(untitled)'} (${s.provider})`);
  outputChannel.appendLine(`Workspace: ${s.workspacePath}`);
  outputChannel.appendLine(`Prompts: ${s.requests.length}`);
  outputChannel.appendLine('');

  for (const r of s.requests) {
    outputChannel.appendLine(
      `#${r.index + 1}  model=${r.model ?? 'unknown'}  in=${r.usage.inputTokens}` +
        `  cacheRead=${r.usage.cacheReadTokens}  cacheWrite=${r.usage.cacheCreationTokens}` +
        `  out=${r.usage.outputTokens}  tools=${r.toolCallCount}  cost=${formatUsd(r.cost.usd)}`
    );
  }

  outputChannel.appendLine('');
  outputChannel.appendLine(
    `TOTAL  in=${s.totalUsage.inputTokens}  cacheRead=${s.totalUsage.cacheReadTokens}` +
      `  cacheWrite=${s.totalUsage.cacheCreationTokens}  out=${s.totalUsage.outputTokens}` +
      `  cost=${formatUsd(s.totalCost.usd)}`
  );
  outputChannel.show(true);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Agent Context Trail');
  pricing = new PricingService(context.extensionPath);
  statusBar = new StatusBarController();
  otelService = new CopilotOtelService(
    context.globalStorageUri.fsPath,
    (message) => outputChannel.appendLine(message),
    () => void refresh()
  );
  panelController = new PanelController(context, pricing, otelService);

  context.subscriptions.push(outputChannel, statusBar, panelController, {
    dispose: () => void otelService.stop()
  });

  // Start the loopback OTel receiver when the user has opted in and pointed
  // Copilot at a loopback endpoint; otherwise it stays dormant (no listener).
  void otelService.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('agentContextTrail.refresh', () => refresh()),
    vscode.commands.registerCommand('agentContextTrail.showSummary', () => showSummary()),
    vscode.commands.registerCommand('agentContextTrail.openPanel', () => panelController.reveal(getWorkspacePath()))
  );

  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  void refresh();
}

export function deactivate(): void {
  // Disposables registered via context.subscriptions handle cleanup.
}
