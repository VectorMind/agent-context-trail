import {
  ConversationListItem,
  CostAmount,
  CurrentStatusSnapshot,
  ProviderId,
  PromptRequest,
  ToolCallDetail,
  UsageTokens
} from '../domain/types';

export interface ConversationDetailPayload {
  provider: ProviderId;
  id: string;
  title?: string;
  workspacePath: string;
  updatedAt: string;
  requests: PromptRequest[];
  totalUsage: UsageTokens;
  totalCost: CostAmount;
  currentStatus?: CurrentStatusSnapshot;
}

export type HostToWebviewMessage =
  | {
      type: 'init';
      providers: ProviderId[];
      workspacePath?: string;
      conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>;
      selected?: ConversationDetailPayload;
    }
  | { type: 'conversationDetail'; detail: ConversationDetailPayload }
  // On-demand Call detail (plans/2026-07/07/call-details OP-101): the host
  // re-reads the log on request and ships only the bounded excerpt.
  | { type: 'toolCallDetail'; conversationId: string; detail: ToolCallDetail };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'selectConversation'; provider: ProviderId; id: string }
  | { type: 'getToolCallDetail'; provider: ProviderId; conversationId: string; toolCallId: string };
