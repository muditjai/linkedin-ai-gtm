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
  | 'HIGHLIGHT_CONVERSATION'
  /** Emitted from the content script while a SCRAPE_ALL is running. The
   *  background forwards it to the full-page UI which renders a progress
   *  bar so the user can see how many threads have completed. */
  | 'SCRAPE_PROGRESS';

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
  /** LinkedIn URN of the underlying thread, when sourced from the backend. */
  urn?: string;
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
  /** ISO timestamp from the backend for when this message was first
   *  persisted (the Mongoose `createdAt`). Lets the client mark a
   *  message as new on subsequent fetches. */
  firstSeenAt?: string;
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
  /**
   * Per-thread "new since last scrape" marker URNs. Populated by the
   * backend's upsert response and consumed when the user opens a thread
   * so the NEW pill survives a re-fetch from MongoDB.
   */
  pendingNewUrns: Record<string, string[]>;
  sequencer: Sequencer | null;
  dashboard: Dashboard | null;
  activeConversation: Conversation | null;
}

/* ---------------------------------------------------------------------------
 * Scrape progress
 *
 * Emitted from the content script while a SCRAPE_ALL is running so the
 * full-page UI can render a live progress bar. The background forwards
 * every message it receives with `type === 'SCRAPE_PROGRESS'` to all
 * listening extension pages via `chrome.runtime.sendMessage`.
 * ------------------------------------------------------------------------- */
export type ScrapeProgressPhase =
  /** Emitted once at the start of a SCRAPE_ALL, before any thread is opened. */
  | 'started'
  /** Emitted after each conversation in the inbox has been opened + scraped. */
  | 'thread_done'
  /** Emitted after each conversation in the inbox has been opened + failed. */
  | 'thread_failed'
  /** Emitted once after the SCRAPE_ALL response is fully assembled. */
  | 'finished';

export interface ScrapeProgressMessage {
  type: 'SCRAPE_PROGRESS';
  /** Current phase of the scrape lifecycle. */
  phase: ScrapeProgressPhase;
  /** 1-based index of the thread currently in flight (or just completed). */
  current: number;
  /** Total number of threads the scraper intends to open. */
  total: number;
  /** Number of threads that have been successfully scraped so far. */
  completed: number;
  /** Number of threads that have failed so far. */
  failed: number;
  /** Display name of the thread currently being scraped, when known. */
  currentName?: string;
  /** LinkedIn URN of the thread currently being scraped, when known. */
  currentUrn?: string;
  /** Optional human-readable status (e.g. "Scraping thread 2/5..."). */
  message?: string;
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
/** Show the scrape progress bar with the expected thread total. */
export type ScrapeProgressStarter = (total: number) => void;
/** Force-hide the scrape progress bar (the bar also auto-hides after a
 *  short delay when the `finished` phase event arrives). */
export type ScrapeProgressEnder = () => void;

/* ---------------------------------------------------------------------------
 * Context sources (per-thread, returned by GET /api/threads/:urn/context)
 *
 * Mirrors the backend's `ContextSource` union in `backend/src/routes/threads.ts`.
 * Per AGENTS.md Phase 3 the side panel surfaces these so the AI has richer
 * grounding when drafting replies. Most kinds are stubs today - the
 * `available` flag tells the UI which ones have real data.
 * ------------------------------------------------------------------------- */

export interface LinkedInProfileSource {
  kind: 'linkedin_profile';
  available: boolean;
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  about: string[];
  experience: Array<{ title: string; company: string; duration: string }>;
}

export interface CompanySource {
  kind: 'company';
  available: boolean;
  name: string;
  industry: string;
  size: string;
  website: string;
  description: string;
}

export interface EmailSource {
  kind: 'email';
  available: boolean;
  history: Array<{
    subject: string;
    from: string;
    sentAt: string;
    snippet: string;
  }>;
}

export interface CommonConnectionSource {
  kind: 'common_connections';
  available: boolean;
  people: Array<{
    name: string;
    headline: string;
    profileUrl: string;
  }>;
}

export interface SocialPostSource {
  kind: 'social_posts';
  available: boolean;
  posts: Array<{
    platform: 'linkedin' | 'twitter' | 'facebook' | 'other';
    author: string;
    postedAt: string;
    snippet: string;
    url: string;
  }>;
}

export interface InterestSource {
  kind: 'interests';
  available: boolean;
  tags: string[];
  prioritised: boolean;
}

export interface FeedbackSource {
  kind: 'feedback';
  available: boolean;
  recent: Array<{
    score: number;
    comment: string;
    createdAt: string;
  }>;
}

export type ContextSource =
  | LinkedInProfileSource
  | CompanySource
  | EmailSource
  | CommonConnectionSource
  | SocialPostSource
  | InterestSource
  | FeedbackSource;

export interface ContextSourcesResponse {
  success: boolean;
  urn: string;
  conversationName: string;
  sources: ContextSource[];
  /** Unix-ms timestamp the payload was assembled. */
  assembledAt: number;
}

/* ---------------------------------------------------------------------------
 * Cross-component events
 *
 * The Messages tab (centre pane) and the AI side panel (right pane) need
 * to stay in sync without importing each other. We dispatch a custom DOM
 * event on `window` whenever the user picks a conversation; the side
 * panel listens and updates `selectedUrn`.
 * ------------------------------------------------------------------------- */

export interface ThreadSelectedDetail {
  urn: string;
  /** Convenience - the rendered conversation row, if the emitter had one. */
  conversation?: Conversation;
}

export const THREAD_SELECTED_EVENT = 'linkedin-ai:thread-selected';

/** Type-safe accessor for the custom event detail. */
export function readThreadSelectedDetail(
  event: Event,
): ThreadSelectedDetail | null {
  const ce = event as CustomEvent<ThreadSelectedDetail>;
  const detail = ce.detail;
  if (!detail || typeof detail !== 'object' || typeof detail.urn !== 'string') {
    return null;
  }
  return detail;
}

// Declare global
declare global {
  interface Window {
    popupState: PopupState;
    logExtensionStatus?: StatusLogger;
    recordScrapeCount?: ScrapeCounter;
    startScrapeProgress?: ScrapeProgressStarter;
    endScrapeProgress?: ScrapeProgressEnder;
  }
}