import * as vscode from 'vscode';
import {
  getClaudeSessionFilePath,
  listClaudeConversations
} from '../providers/claude/discover';
import { extractClaudeToolCallDetail, parseClaudeSession } from '../providers/claude/parser';
import { getCodexSessionFilePath, listCodexConversations } from '../providers/codex/discover';
import { extractCodexToolCallDetail, parseCodexSession } from '../providers/codex/parser';
import { getCopilotSessionFilePath, listCopilotConversations } from '../providers/copilot/discover';
import { extractCopilotToolCallDetail, parseCopilotSession } from '../providers/copilot/parser';
import { unavailableDetail } from '../providers/callDetail';
import { PricingService } from '../pricing/pricingService';
import { ConversationListItem, ProviderId, ToolCallDetail } from '../domain/types';
import { ConversationDetailPayload, HostToWebviewMessage, WebviewToHostMessage } from './protocol';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'copilot'];

export class PanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private workspacePath: string | undefined;
  private selectedConversation: { provider: ProviderId; id: string } | undefined;

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
      this.selectedConversation = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.handleMessage(message));
  }

  async refresh(workspacePath: string | undefined): Promise<void> {
    this.workspacePath = workspacePath;
    if (!this.panel || !this.ready) return;
    await this.sendInit();
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
      this.selectedConversation = { provider: message.provider, id: message.id };
      const detail = await this.loadDetail(message.provider, message.id);
      if (detail) this.post({ type: 'conversationDetail', detail });
      return;
    }
    if (message.type === 'getToolCallDetail') {
      const detail = await this.loadToolCallDetail(message.provider, message.conversationId, message.toolCallId);
      this.post({ type: 'toolCallDetail', conversationId: message.conversationId, detail });
    }
  }

  /** Bounded excerpt for one tool call, re-read from the provider log on demand. */
  private async loadToolCallDetail(provider: ProviderId, conversationId: string, toolCallId: string): Promise<ToolCallDetail> {
    try {
      if (provider === 'claude') {
        const filePath = this.workspacePath ? getClaudeSessionFilePath(this.workspacePath, conversationId) : undefined;
        if (!filePath) return unavailableDetail(toolCallId, 'session file not found');
        return await extractClaudeToolCallDetail(filePath, toolCallId);
      }
      if (provider === 'codex') {
        const filePath = getCodexSessionFilePath(conversationId);
        if (!filePath) return unavailableDetail(toolCallId, 'session file not found');
        return await extractCodexToolCallDetail(filePath, toolCallId);
      }
      const filePath = getCopilotSessionFilePath(conversationId);
      if (!filePath) return unavailableDetail(toolCallId, 'session file not found');
      return await extractCopilotToolCallDetail(filePath, toolCallId);
    } catch {
      return unavailableDetail(toolCallId, 'could not read the session log');
    }
  }

  private async sendInit(): Promise<void> {
    const workspacePath = this.workspacePath;
    const [claudeItems, codexItems, copilotItems]: [ConversationListItem[], ConversationListItem[], ConversationListItem[]] = workspacePath
      ? await Promise.all([
          listClaudeConversations(workspacePath, this.pricing),
          listCodexConversations(workspacePath, this.pricing),
          listCopilotConversations(workspacePath, this.pricing)
        ])
      : [[], [], []];
    const conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>> = {
      claude: claudeItems,
      codex: codexItems,
      copilot: copilotItems
    };
    const selectedRef = this.findSelectedConversation(conversationsByProvider);
    const selected = selectedRef ? await this.loadDetail(selectedRef.provider, selectedRef.item.id) : undefined;
    this.selectedConversation = selected ? { provider: selected.provider, id: selected.id } : undefined;

    this.post({
      type: 'init',
      providers: PROVIDERS,
      workspacePath,
      conversationsByProvider,
      selected
    });
  }

  private async loadDetail(provider: ProviderId, id: string): Promise<ConversationDetailPayload | undefined> {
    if (provider === 'claude') {
      if (!this.workspacePath) return undefined;
      const filePath = getClaudeSessionFilePath(this.workspacePath, id);
      if (!filePath) return undefined;

      const summary = await parseClaudeSession(filePath, id, this.workspacePath, this.pricing);
      return {
        provider: 'claude',
        id,
        title: summary.title,
        workspacePath: summary.workspacePath,
        updatedAt: summary.updatedAt,
        requests: summary.requests,
        totalUsage: summary.totalUsage,
        totalCost: summary.totalCost,
        currentStatus: summary.currentStatus
      };
    }

    if (provider === 'codex') {
      const filePath = getCodexSessionFilePath(id);
      if (!filePath) return undefined;

      const summary = await parseCodexSession(filePath, id, undefined, this.pricing);
      return {
        provider: 'codex',
        id,
        title: summary.title,
        workspacePath: summary.workspacePath,
        updatedAt: summary.updatedAt,
        requests: summary.requests,
        totalUsage: summary.totalUsage,
        totalCost: summary.totalCost,
        currentStatus: summary.currentStatus
      };
    }

    if (provider === 'copilot') {
      if (!this.workspacePath) return undefined;
      const filePath = getCopilotSessionFilePath(id);
      if (!filePath) return undefined;

      const summary = await parseCopilotSession(filePath, id, this.workspacePath, this.pricing);
      return {
        provider: 'copilot',
        id,
        title: summary.title,
        workspacePath: summary.workspacePath,
        updatedAt: summary.updatedAt,
        requests: summary.requests,
        totalUsage: summary.totalUsage,
        totalCost: summary.totalCost,
        currentStatus: summary.currentStatus
      };
    }

    return undefined;
  }

  private findSelectedConversation(
    conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>
  ): { provider: ProviderId; item: ConversationListItem } | undefined {
    const selected = this.selectedConversation;
    if (selected) {
      const items = conversationsByProvider[selected.provider] ?? [];
      const match = items.find((item) => item.id === selected.id);
      if (match) return { provider: selected.provider, item: match };
    }
    return this.findLatestConversation(conversationsByProvider);
  }

  private findLatestConversation(
    conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>
  ): { provider: ProviderId; item: ConversationListItem } | undefined {
    let latest: { provider: ProviderId; item: ConversationListItem } | undefined;
    for (const provider of PROVIDERS) {
      for (const item of conversationsByProvider[provider] ?? []) {
        if (!latest || item.lastAt.localeCompare(latest.item.lastAt) > 0) {
          latest = { provider, item };
        }
      }
    }
    return latest;
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
  #app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .layout-body { flex: 1; display: flex; overflow: hidden; }
  .split { display: flex; flex: 1; min-width: 0; overflow: hidden; }

  .design-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    flex-shrink: 0;
  }
  .design-label {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin-right: 4px;
  }
  .design-tab {
    padding: 3px 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 11px;
  }
  .design-tab:hover { background: var(--vscode-toolbar-hoverBackground); }
  .design-tab.active {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-color: transparent;
    font-weight: 600;
  }
  .design-hint { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); }

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

  .sort-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .sort-caption { font-size: 10px; color: var(--vscode-descriptionForeground); margin-right: 2px; }
  .sort-button {
    padding: 2px 7px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 11px;
  }
  .sort-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .sort-button.active { color: var(--vscode-foreground); font-weight: 600; }

  .conversation-list { overflow-y: auto; flex: 1; }
  .conversation-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
  }
  .conversation-item .item-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conversation-item .item-meta {
    margin-top: 1px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conversation-item:hover { background: var(--vscode-list-hoverBackground); }
  .conversation-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .conversation-item.active .item-meta { color: inherit; opacity: 0.8; }
  .empty { padding: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }

  .thread-pane { flex: 1; min-width: 0; overflow-y: auto; padding: 12px 16px; }

  .side-bar {
    width: 44px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 10px;
    border-right: 1px solid var(--vscode-panel-border);
    background: var(--vscode-activityBar-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  }
  .side-icon {
    width: 34px;
    height: 34px;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--vscode-activityBar-inactiveForeground, var(--vscode-descriptionForeground));
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    opacity: 0.55;
  }
  .side-icon:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-activityBar-foreground, var(--vscode-foreground));
    opacity: 1;
  }
  .side-icon.active {
    color: var(--vscode-activityBar-foreground, var(--vscode-foreground));
    border-left-color: var(--vscode-activityBar-activeBorder, var(--vscode-focusBorder));
    background: color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent);
    opacity: 1;
  }

  .stack-pane {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 8px 10px 14px;
  }
  .stack-pane .tabs { margin: -8px -10px 8px; }

  .workspace-scope {
    margin: 0 0 8px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent),
        color-mix(in srgb, var(--vscode-badge-background) 18%, transparent)
      );
  }
  .workspace-scope-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .workspace-scope-path {
    margin-top: 4px;
    font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
    font-size: 12px;
    color: var(--vscode-foreground);
    word-break: break-all;
  }
  .workspace-scope-note {
    margin-top: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  /* Each panel is a clearly bounded block: contrasted heading bar on top,
     bordered body below; collapsed = heading bar only. */
  .section {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 10px;
    background: var(--vscode-editor-background);
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background, var(--vscode-toolbar-hoverBackground)));
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    border: none;
    border-bottom: 1px solid var(--vscode-panel-border);
    text-align: left;
    font-family: inherit;
    cursor: pointer;
  }
  .section-head:hover { filter: brightness(1.12); }
  .section.collapsed .section-head { border-bottom: none; }
  .section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .section-icon { font-size: 12px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }
  .section-summary {
    margin-left: auto;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .chevron { font-size: 10px; color: var(--vscode-descriptionForeground); width: 10px; flex-shrink: 0; }
  .section-body { padding: 8px 12px 14px; }

  .overview-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 0 8px;
  }
  .filter-input {
    flex: 0 1 260px;
    padding: 3px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: 12px;
  }
  .filter-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .overview-count { font-size: 11px; color: var(--vscode-descriptionForeground); }

  .table-scroll { overflow-x: auto; }
  .conv-table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .conv-table th {
    background: var(--vscode-editor-background);
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 0;
    white-space: nowrap;
  }
  .conv-table th.numeric { text-align: right; }
  .th-button {
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    text-align: inherit;
    white-space: nowrap;
  }
  .th-button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
  .th-button.active { color: var(--vscode-foreground); }
  .conv-table td {
    padding: 5px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 45%, transparent);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .conv-table td.numeric { text-align: right; }
  .conv-table td.cell-title {
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conv-table tbody tr { cursor: pointer; }
  .conv-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  .conv-table tbody tr:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .conv-table tbody tr.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
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
  .overview-selected {
    fill: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 32%, transparent);
    stroke: var(--vscode-list-activeSelectionBackground);
    stroke-width: 1;
  }

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

  /* ---- enriched request card (Layout D) ---- */
  .detail-card.enriched { max-width: 640px; }
  .legend-glyph { font-size: 9px; line-height: 1; }
  .chart-warn-marker { font-size: 9px; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 4px; }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 9px;
    border: 1px solid var(--vscode-panel-border);
    background: color-mix(in srgb, var(--vscode-badge-background) 30%, transparent);
  }
  .chip-label { color: var(--vscode-descriptionForeground); font-size: 10px; }
  .chip-value { font-weight: 600; font-variant-numeric: tabular-nums; }

  .detail-subheading {
    margin: 14px 0 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .prompt-preview-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .prompt-preview {
    font-size: 11px;
    padding: 6px 8px;
    border-left: 2px solid var(--vscode-panel-border);
    color: var(--vscode-foreground);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .prompt-preview[role='button'] { cursor: pointer; border-radius: 0 3px 3px 0; }
  .prompt-preview[role='button']:hover { background: var(--vscode-toolbar-hoverBackground); }
  .prompt-preview[role='button']:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .prompt-preview.expanded { border-left-color: var(--vscode-textLink-foreground); }
  .prompt-toggle {
    align-self: flex-start;
    padding: 0;
    font-size: 10px;
    color: var(--vscode-textLink-foreground);
    background: none;
    border: none;
    cursor: pointer;
  }
  .prompt-toggle:hover { text-decoration: underline; }
  .prompt-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); }

  .breakdown-note {
    grid-column: 2 / 4;
    margin-top: -4px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }

  .diag { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
  .diag-row { color: var(--vscode-descriptionForeground); }
  .diag-row.warn { color: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange)); }
  .diag-row.ok { color: var(--vscode-charts-green); }

  .composition { font-size: 11px; color: var(--vscode-foreground); }
  .status-block + .status-block { margin-top: 12px; }
  .status-card {
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
    border-radius: 6px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 72%, transparent);
  }
  .status-card-summary {
    margin-bottom: 8px;
    font-size: 11px;
    color: var(--vscode-foreground);
    font-weight: 600;
  }
  .status-meter + .status-meter { margin-top: 10px; }
  .status-meter-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-size: 11px;
  }
  .status-meter-label { color: var(--vscode-descriptionForeground); }
  .status-meter-value {
    color: var(--vscode-foreground);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .status-meter-side { white-space: nowrap; }
  .status-meter-track {
    margin-top: 5px;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--vscode-panel-border) 45%, transparent);
  }
  .status-meter-track.ok .status-meter-fill {
    background: linear-gradient(90deg, #3fa86b, #7fd88f);
  }
  .status-meter-track.warn .status-meter-fill {
    background: linear-gradient(90deg, #d7a129, #f3c76a);
  }
  .status-meter-track.danger .status-meter-fill {
    background: linear-gradient(90deg, #c95757, #ff8f8f);
  }
  .status-meter-track.neutral .status-meter-fill {
    background: linear-gradient(90deg, var(--vscode-progressBar-background), color-mix(in srgb, var(--vscode-focusBorder) 62%, white));
  }
  .status-meter-fill {
    height: 100%;
    min-width: 0;
    border-radius: inherit;
  }
  .status-meter-meta {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .status-meter-footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-top: 4px;
  }
  .status-meter-remaining {
    font-size: 10px;
    color: var(--vscode-foreground);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .status-meter-remaining.top { text-align: right; }
  .status-meter-remaining.solo {
    display: block;
    margin-top: 4px;
    text-align: right;
  }
  .status-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin-top: 10px;
  }
  .status-fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 9px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 45%, transparent);
  }
  .status-fact-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status-fact-value {
    font-size: 12px;
    color: var(--vscode-foreground);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tools-scroll { max-height: 300px; overflow-y: auto; }
  .tools-table { font-size: 11px; }
  .tools-table td.muted { color: var(--vscode-descriptionForeground); }
  .tools-table td.cell-target {
    max-width: 230px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-descriptionForeground);
  }
  .tools-table td.tool-error { color: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange)); }
  .subagent-row td {
    padding-top: 0;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Call detail card (plans/2026-07/07/call-details) ---- */
  .call-card { max-width: 640px; }
  .call-steppers { display: flex; align-items: center; gap: 6px; }
  .call-pos { font-size: 10px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .call-step {
    width: 22px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }
  .call-step:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
  .call-step:disabled { opacity: 0.35; cursor: default; }
  .badge-warn {
    background: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange));
    color: var(--vscode-editor-background);
  }
  .call-fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 6px 0 4px;
    font-size: 11px;
    align-items: baseline;
  }
  .call-field-key { color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .call-field-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .call-field-value.mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .call-file-dir { color: var(--vscode-descriptionForeground); }
  .call-file-name { font-weight: 600; }
  .snapshot-wrap { margin-top: 10px; }
  .snapshot-caption {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
  }
  /* Fixed zone height regardless of payload: 8 head + separator + 4 tail lines. */
  .snapshot {
    height: calc(13 * 1.5 * 11px + 12px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 72%, transparent);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.5;
  }
  .snapshot-line { white-space: pre; }
  .snapshot-sep {
    color: var(--vscode-descriptionForeground);
    text-align: center;
    font-style: italic;
    white-space: pre;
  }
  .snapshot-empty { color: var(--vscode-descriptionForeground); font-style: italic; font-family: var(--vscode-font-family, sans-serif); }

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

  .storage-footer {
    flex-shrink: 0;
    padding: 4px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
