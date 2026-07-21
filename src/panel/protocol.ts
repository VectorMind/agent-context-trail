import {
  ConversationListItem,
  CostAmount,
  CurrentStatusSnapshot,
  ProviderId,
  PromptRequest,
  ToolCallDetail,
  UsageTokens
} from '../domain/types';
import { CostMapExclusions, CostMapPoint } from '../domain/costMap';

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

/**
 * Selected-period projection for the Prompt cost map (the narrow
 * product-scope.md exception): chart points only, across the current
 * workspace and one provider — never full prompt or call payloads.
 */
export interface CostMapPeriodPayload {
  provider: ProviderId;
  /** Rolling window in days; undefined = All time. */
  days?: number;
  points: CostMapPoint[];
  totalPrompts: number;
  excludedPrompts: number;
  reasons: CostMapExclusions;
  conversationCount: number;
}

export type HostToWebviewMessage =
  | {
      type: 'init';
      providers: ProviderId[];
      workspacePath?: string;
      conversationsByProvider: Partial<Record<ProviderId, ConversationListItem[]>>;
      selected?: ConversationDetailPayload;
      /** Storage Footer lines (Copilot OTel status + storage guarantee/retention). */
      storageFooter?: string[];
    }
  | { type: 'conversationDetail'; detail: ConversationDetailPayload }
  // On-demand Call detail (plans/2026-07/07/call-details OP-101): the host
  // re-reads the log on request and ships only the bounded excerpt.
  | { type: 'toolCallDetail'; conversationId: string; detail: ToolCallDetail }
  | { type: 'costMapPeriod'; payload: CostMapPeriodPayload };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'selectConversation'; provider: ProviderId; id: string }
  | { type: 'getToolCallDetail'; provider: ProviderId; conversationId: string; toolCallId: string }
  | { type: 'getCostMapPeriod'; provider: ProviderId; days?: number };
