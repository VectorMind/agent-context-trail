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
      selected
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
  .chart-wrapper { position: relative; }
  .chart-scroll { overflow-x: auto; }

  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    margin-bottom: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 3px; }
  .legend-line { width: 14px; height: 2px; border-radius: 1px; }

  .chart-caption { font-size: 9px; letter-spacing: 0.08em; }
  .chart-tick { font-size: 10px; }
  .chart-tick.selected { font-weight: 600; }
  .chart-value-label { font-size: 10px; }

  .bar-group { cursor: pointer; }
  .bar-group:hover .seg { filter: brightness(1.18); }
  .bar-group:focus { outline: none; }
  .bar-group:focus .hit { stroke: var(--vscode-focusBorder); stroke-width: 1.5; }

  .chart-tooltip {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    min-width: 170px;
    padding: 8px 10px;
    font-size: 11px;
    border-radius: 4px;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .tooltip-header { font-weight: 600; margin-bottom: 6px; }
  .tooltip-model { font-weight: 400; color: var(--vscode-descriptionForeground); margin-left: 6px; font-size: 10px; }
  .tooltip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  .tooltip-key { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .tooltip-key.line { height: 2px; border-radius: 1px; }
  .tooltip-label { color: var(--vscode-descriptionForeground); }
  .tooltip-value { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }

  .chart-hint { margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }

  .detail-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 12px 14px;
    max-width: 520px;
  }
  .detail-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .detail-header h3 { margin: 0; font-size: 13px; }
  .detail-cost { font-size: 15px; font-weight: 600; }
  .badge {
    margin-left: 6px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 400;
    border-radius: 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    vertical-align: middle;
  }
  .detail-meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin: 4px 0 12px; }

  .breakdown {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 7px 10px;
    align-items: center;
    font-size: 11px;
  }
  .breakdown-label { color: var(--vscode-descriptionForeground); }
  .breakdown-track { height: 12px; border-radius: 0 4px 4px 0; }
  .breakdown-bar { height: 100%; border-radius: 0 4px 4px 0; }
  .breakdown-value { text-align: right; font-variant-numeric: tabular-nums; min-width: 58px; }
  .breakdown-value.zero { color: var(--vscode-descriptionForeground); }

  .shares { margin-top: 14px; display: flex; flex-direction: column; gap: 9px; }
  .share-row { font-size: 11px; }
  .share-head { display: flex; justify-content: space-between; margin-bottom: 3px; color: var(--vscode-descriptionForeground); }
  .share-pct { color: var(--vscode-foreground); font-weight: 600; font-variant-numeric: tabular-nums; }
  .share-track {
    height: 5px;
    border-radius: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--vscode-progressBar-background) 22%, transparent);
  }
  .share-fill { height: 100%; background: var(--vscode-progressBar-background); border-radius: 3px; }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
