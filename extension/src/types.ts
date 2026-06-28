/**
 * Type Definitions for LinkedIn AI GTM Extension
 */

// Message Types
export type MessageType =
  | 'GET_CONVERSATIONS'
  | 'SCRAPE_CONVERSATIONS'
  | 'SCRAPE_THREAD'
  | 'SCRAPE_THREAD_BY_INDEX'
  | 'SCRAPE_ALL'
  | 'TEST_CONNECTION'
  | 'GET_SEQUENCER'
  | 'SAVE_SEQUENCER'
  | 'EXECUTE_SEQUENCE'
  | 'GET_DASHBOARD'
  | 'ANALYZE_MESSAGE'
  | 'OPEN_FULL_APP'
  | 'SCRAPE_MESSAGES'
  | 'GET_PAGE_INFO'
  | 'HIGHLIGHT_CONVERSATION';

export interface ExtensionMessage {
  type: MessageType;
  /**
   * General-purpose cap for inbox-only scrapes (`SCRAPE_CONVERSATIONS`)
   * and thread-message scrapes (`SCRAPE_THREAD`).
   */
  limit?: number;
  /**
   * Cap on how many inbox conversations to keep / click through.
   *
   * Note: the same value caps BOTH the inbox row count and the number of
   * conversations the scraper opens to scrape. The user-facing input is
   * labelled "Max conversations" - "thread" in the UI now refers to the
   * per-conversation message history (right-hand pane), not the
   * inbox-side click count.
   */
  conversationLimit?: number;
  /** Index of a conversation in the inbox list (for `SCRAPE_THREAD_BY_INDEX`). */
  index?: number;
  sequencer?: Sequencer;
  conversationId?: string;
}

export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  message?: string;
  /** Per-thread messages keyed by the LinkedIn URN. Populated by SCRAPE_ALL. */
  threads?: Record<string, ConversationMessage[]>;
  /** How many conversation threads the scraper opened while collecting. */
  threadsScraped?: number;
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
  /** Stable message id (LinkedIn message URN when available, otherwise a synthetic one). */
  id: string;
  /** Conversation/thread this message belongs to. */
  conversationId: string;
  /** Display name of the person who sent the message. */
  senderName: string;
  /** Avatar image URL or `null` if not available. */
  senderAvatar: string | null;
  /** Plain-text body of the message. `<br>` boundaries are converted to `\n`. */
  content: string;
  /** Whether the message was received (other person) or sent (the current user). */
  direction: 'inbound' | 'outbound';
  /** Time of day as displayed in the thread (e.g. "1:46 PM"). */
  timestamp: string;
  /** Day-boundary heading that precedes the message (e.g. "Friday") or `null`. */
  dateHeading: string | null;
  /** True if LinkedIn shows the "(Edited)" tag next to this message. */
  edited: boolean;
  /** Emoji reactions on the message (e.g. ["👍"]). */
  reactions: string[];
  /** True when the message is the most recent in the thread and has no reply yet. */
  needsReply: boolean;
  outcome?: 'positive' | 'negative';
  needsFollowUp: boolean;
  /** Set by the side panel / backend integration when this message was
   *  scraped for the first time (i.e. the backend hadn't seen it before).
   *  The UI uses it to render a NEW pill. */
  isNew?: boolean;
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
  /** Messages scraped from the currently-open LinkedIn thread, if any. */
  threadMessages: ConversationMessage[];
  /** LinkedIn URN of the thread that `threadMessages` came from. */
  activeThreadId: string | null;
  /**
   * Per-thread message cache, keyed by LinkedIn URN. Populated by SCRAPE_ALL
   * and incrementally as the user opens different conversations in the
   * Messages tab. Lets us re-render a thread without re-scraping it.
   */
  threads: Record<string, ConversationMessage[]>;
  sequencer: Sequencer | null;
  dashboard: Dashboard | null;
  activeConversation: Conversation | null;
}

/* ---------------------------------------------------------------------------
 * Activity log
 *
 * `fullpage.ts` wires up a DOM-backed activity log and exposes the writer
 * and counter on `window` for other modules to call. The functions are
 * optional because the page-side modules may be evaluated before
 * `fullpage.ts` has run (or during the brief moment before `DOMContentLoaded`).
 * ------------------------------------------------------------------------- */
export type LogKind = 'info' | 'success' | 'error' | 'warn';
export type StatusLogger = (message: string, kind?: LogKind) => void;
export type ScrapeCounter = () => void;

// Declare global
declare global {
  interface Window {
    popupState: PopupState;
    logExtensionStatus?: StatusLogger;
    recordScrapeCount?: ScrapeCounter;
  }
}
