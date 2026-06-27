/**
 * Type Definitions for LinkedIn AI GTM Extension
 */

// Message Types
export type MessageType =
  | 'GET_CONVERSATIONS'
  | 'SCRAPE_CONVERSATIONS'
  | 'GET_SEQUENCER'
  | 'SAVE_SEQUENCER'
  | 'EXECUTE_SEQUENCE'
  | 'GET_DASHBOARD'
  | 'ANALYZE_MESSAGE'
  | 'OPEN_POPUP'
  | 'SCRAPE_MESSAGES'
  | 'GET_PAGE_INFO'
  | 'HIGHLIGHT_CONVERSATION';

export interface ExtensionMessage {
  type: MessageType;
  limit?: number;
  sequencer?: Sequencer;
  conversationId?: string;
}

export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  message?: string;
}

// Conversation Types
export interface Conversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  avatar: string | null;
  lastMessageAt: string;
  unread: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  content: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  needsReply: boolean;
  outcome?: 'positive' | 'negative';
  needsFollowUp: boolean;
}

// Sequencer Types
export interface Sequencer {
  id: string;
  name: string;
  steps: SequencerStep[];
  createdAt: string;
  updatedAt: string;
}

export interface SequencerStep {
  id: string;
  type: 'delay' | 'message' | 'ai_message';
  duration?: number;
  content?: string;
  prompt?: string;
  next: string | null;
}

// Dashboard Types
export interface Dashboard {
  totalConversations: number;
  messagesToReply: number;
  sentMessages: number;
  receivedMessages: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  pendingFollowUps: number;
  lastScrapeStatus: 'completed' | 'pending' | 'error';
  lastScrapeTime: string;
}

// Analysis Types
export interface MessageAnalysis {
  sentiment: 'positive' | 'negative' | 'neutral';
  quality: 'good' | 'fair' | 'poor';
  suggestions: string[];
}

// Page Info
export interface PageInfo {
  url: string;
  path: string;
  pageType: 'messages' | 'profile' | 'feed' | 'unknown';
  loggedIn: boolean;
}

// Storage Keys
export interface StorageData {
  conversations: Conversation[];
  messages: ConversationMessage[];
  sequencer: Sequencer | null;
  dashboard: Dashboard | null;
}

// Shared popup state
export interface PopupState {
  conversations: Conversation[];
  sequencer: Sequencer | null;
  dashboard: Dashboard | null;
  activeConversation: Conversation | null;
}

// Declare global
declare global {
  interface Window {
    popupState: PopupState;
  }
}