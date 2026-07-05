import {
  ConversationListItem,
  CostAmount,
  CurrentStatusSnapshot,
  ProviderId,
  PromptRequest,
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
      conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>;
      selected?: ConversationDetailPayload;
    }
  | { type: 'conversationDetail'; detail: ConversationDetailPayload };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'selectConversation'; provider: ProviderId; id: string };
