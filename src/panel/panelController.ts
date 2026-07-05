import * as vscode from 'vscode';
import {
  getClaudeSessionFilePath,
  listClaudeConversations
} from '../providers/claude/discover';
import { parseClaudeSession } from '../providers/claude/parser';
import { PricingService } from '../pricing/pricingService';
import { ConversationListItem, ProviderId } from '../domain/types';
import { ConversationDetailPayload, HostToWebviewMessage, WebviewToHostMessage } from './protocol';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'copilot'];

export class PanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private workspacePath: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly pricing: PricingService) {}

  dispose(): void {
    this.panel?.dispose();
  }

  async reveal(workspacePath: string | undefined): Promise<void> {
    this.workspacePath = workspacePath;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      if (this.ready) await this.sendInit();
      return;
    }

    this.ready = false;
    this.panel = vscode.window.createWebviewPanel(
      'agentContextTrail.panel',
      'Agent Context Trail',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')]
      }
    );
    this.panel.webview.html = this.buildHtml(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.handleMessage(message));
  }

  private post(message: HostToWebviewMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.sendInit();
      return;
    }
    if (message.type === 'selectConversation') {
      const detail = await this.loadDetail(message.provider, message.id);
      if (detail) this.post({ type: 'conversationDetail', detail });
    }
  }

  private async sendInit(): Promise<void> {
    const workspacePath = this.workspacePath;
    const claudeItems: ConversationListItem[] = workspacePath ? await listClaudeConversations(workspacePath) : [];
    const conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>> = {
      claude: claudeItems,
      codex: [],
      copilot: []
    };

    const selected = claudeItems.length > 0 ? await this.loadDetail('claude', claudeItems[0].id) : undefined;

    this.post({
      type: 'init',
      providers: PROVIDERS,
      conversationsByProvider,
      selected,
      usdPerCredit: this.pricing.usdPerCredit
    });
  }

  private async loadDetail(provider: ProviderId, id: string): Promise<ConversationDetailPayload | undefined> {
    if (provider !== 'claude' || !this.workspacePath) return undefined;
    const filePath = getClaudeSessionFilePath(this.workspacePath, id);
    if (!filePath) return undefined;

    const summary = await parseClaudeSession(filePath, id, this.workspacePath, this.pricing);
    return {
      provider: 'claude',
      id,
      title: summary.title,
      requests: summary.requests,
      totalUsage: summary.totalUsage,
      totalCost: summary.totalCost
    };
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  #app { display: flex; height: 100vh; overflow: hidden; }

  .collapse-toggle {
    border: none;
    border-right: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    width: 18px;
    flex-shrink: 0;
  }
  .collapse-toggle:hover { background: var(--vscode-toolbar-hoverBackground); }

  .list-pane {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--vscode-panel-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .list-pane.collapsed { display: none; }

  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab {
    flex: 1;
    padding: 6px 4px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 11px;
  }
  .tab.active { border-bottom: 2px solid var(--vscode-focusBorder); font-weight: 600; }
  .tab:hover { background: var(--vscode-toolbar-hoverBackground); }

  .conversation-list { overflow-y: auto; flex: 1; }
  .conversation-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .conversation-item:hover { background: var(--vscode-list-hoverBackground); }
  .conversation-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .empty { padding: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }

  .thread-pane { flex: 1; overflow-y: auto; padding: 12px 16px; }
  .thread-header h2 { margin: 0 0 2px; font-size: 15px; }
  .thread-meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px; }

  .chart-host { margin-bottom: 16px; }

  .detail-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 10px 12px;
    max-width: 420px;
  }
  .detail-card h3 { margin: 0 0 8px; font-size: 13px; }
  .detail-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; }
  .detail-label { color: var(--vscode-descriptionForeground); }
  .detail-value { font-family: var(--vscode-editor-font-family, monospace); }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
