/**
 * Backend API client.
 *
 * Tiny fetch wrapper for the service backend. Per AGENTS.md the backend
 * URL is configurable; we read it from `chrome.storage.local` so the
 * user can point the extension at a different environment (dev, staging,
 * prod) without rebuilding.
 *
 * The default URL points at the production backend running on DigitalOcean
 * Kubernetes (public LoadBalancer in sfo2). To point at a local dev
 * backend instead, set:
 *   chrome.storage.local.set({ BACKEND_URL: 'http://localhost:3000' })
 *
 * Every method returns `null` on network/5xx failure so the caller can
 * degrade gracefully (the extension must keep working when the backend
 * is offline).
 */

import type {
  Conversation,
  ConversationMessage,
  ContextSourcesResponse,
} from '../types.js';

const STORAGE_KEY = 'BACKEND_URL';
// Default -> DO k8s LoadBalancer in sfo2 (env=production, db=linkedin-ai
// on Atlas cluster0). Override per-environment via chrome.storage.local
// (see the docblock above).
const DEFAULT_BACKEND_URL = 'http://138.197.236.196';

let cachedBase: string | null = null;

export async function getBackendUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (typeof stored === 'string' && stored.trim().length > 0) {
      cachedBase = stored.replace(/\/+$/, '');
      return cachedBase;
    }
  } catch {
    // ignore - fall back to default
  }
  cachedBase = DEFAULT_BACKEND_URL;
  return cachedBase;
}

/** Tiny typed wrapper around fetch with timeout + JSON. */
async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<T | null> {
  const base = await getBackendUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        '[api] non-OK response from',
        path,
        '-',
        res.status,
        res.statusText,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[api] request to', path, 'failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Types that mirror the backend's response shapes ---

export interface UpsertSummary {
  threadUrn: string;
  inserted: string[];
  updated: string[];
  unchanged: string[];
  newSinceLastScrape: string[];
  totalMessages: number;
}

export interface UpsertResponse {
  success: boolean;
  summary: UpsertSummary;
  counts: {
    inserted: number;
    matched: number;
    modified: number;
    newSinceLastScrapeCount: number;
  };
}

export interface BackendThread {
  urn: string;
  conversationName: string;
  conversationUrl: string;
  lastInboundPreview: string;
  lastMessageTime: string;
  lastMessageIsInbound: boolean;
  inboundCount: number;
  outboundCount: number;
  lastScrapedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThreadsListResponse {
  success: boolean;
  count: number;
  threads: BackendThread[];
}

/**
 * Raw Mongoose doc shape returned by GET /api/messages. We expose this
 * (rather than `ConversationMessage[]`) so the normaliser can pick up
 * the `createdAt` / `updatedAt` fields that don't exist on the
 * extension-side type.
 */
export interface MessagesListResponse {
  success: boolean;
  threadUrn: string;
  count: number;
  messages: Array<Record<string, unknown>>;
}

export interface DraftResponse {
  success: boolean;
  draft: {
    draft: string;
    sentiment: string;
    tips: string[];
  };
  model: string;
}

// --- Domain methods (typed) ---

/**
 * Bulk-upsert one thread's messages. Returns the response (with the
 * `newSinceLastScrape` list) or `null` on failure.
 */
export async function upsertMessages(
  threadUrn: string,
  conversationName: string,
  conversationUrl: string,
  messages: ConversationMessage[],
): Promise<UpsertResponse | null> {
  return request<UpsertResponse>('POST', '/api/messages', {
    threadUrn,
    conversationName,
    conversationUrl,
    messages,
  });
}

/** GET /api/threads?limit=15 - top 15 most-recently-updated threads. */
export async function getTopThreads(limit = 15): Promise<BackendThread[]> {
  const res = await request<ThreadsListResponse>(
    'GET',
    `/api/threads?limit=${limit}`,
  );
  return res?.threads ?? [];
}

/**
 * GET /api/threads?limit=N - canonical alias used by the Messages tab.
 * Same response shape as `getTopThreads` but semantically named for the
 * inbox-list use case.
 */
export async function getThreads(limit = 50): Promise<BackendThread[]> {
  return getTopThreads(limit);
}

/**
 * GET /api/messages?threadUrn=... - persisted messages for one thread.
 *
 * The backend's lean docs include the Mongoose `createdAt`/`updatedAt`
 * timestamps. We surface them as `firstSeenAt` so the caller can decide
 * whether to render the NEW pill on subsequent fetches.
 */
export async function getMessages(
  threadUrn: string,
): Promise<ConversationMessage[]> {
  const res = await request<MessagesListResponse>(
    'GET',
    `/api/messages?threadUrn=${encodeURIComponent(threadUrn)}`,
  );
  const raw = res?.messages ?? [];
  return raw.map((m) => normaliseBackendMessage(m));
}

/**
 * Convert a raw Mongoose `messages` doc into the `ConversationMessage`
 * shape the UI expects. The backend uses `messageUrn` as its natural
 * key but the extension types use `id`, so we copy across and attach
 * `firstSeenAt` for the new-pill logic.
 */
function normaliseBackendMessage(raw: Record<string, unknown>): ConversationMessage {
  const messageUrn = typeof raw.messageUrn === 'string' ? raw.messageUrn : '';
  const createdAt = raw.createdAt;
  let firstSeenAt: string | undefined;
  if (createdAt instanceof Date) {
    firstSeenAt = createdAt.toISOString();
  } else if (typeof createdAt === 'string' && createdAt.length > 0) {
    firstSeenAt = createdAt;
  }
  return {
    id: messageUrn,
    conversationId:
      typeof raw.threadUrn === 'string' ? raw.threadUrn : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName : '',
    senderAvatar: null,
    content: typeof raw.content === 'string' ? raw.content : '',
    direction:
      raw.direction === 'inbound' || raw.direction === 'outbound'
        ? raw.direction
        : 'inbound',
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : '',
    dateHeading:
      typeof raw.dateHeading === 'string' ? raw.dateHeading : null,
    edited: raw.edited === true,
    reactions: Array.isArray(raw.reactions)
      ? raw.reactions.filter((r): r is string => typeof r === 'string')
      : [],
    needsReply: false,
    needsFollowUp: false,
    firstSeenAt,
  };
}

/**
 * GET /api/threads/:urn/context - per-thread context sources for the
 * side panel. Returns `null` on network / 5xx failure so the caller can
 * render an empty-state gracefully.
 */
export async function getContextSources(
  threadUrn: string,
): Promise<ContextSourcesResponse | null> {
  return request<ContextSourcesResponse>(
    'GET',
    `/api/threads/${encodeURIComponent(threadUrn)}/context`,
  );
}

/** POST /api/draft - generate a draft reply via Gemini / DO Inference. */
export async function createDraft(
  threadUrn: string,
  lastMessageUrn: string,
  messages: ConversationMessage[],
  profile = '',
): Promise<DraftResponse | null> {
  return request<DraftResponse>('POST', '/api/draft', {
    threadUrn,
    lastMessageUrn,
    profile,
    messages,
  });
}

/** POST /api/feedback - save user feedback for a draft. */
export async function saveFeedback(payload: {
  threadUrn: string;
  messageUrn: string;
  draft: string;
  sentiment: string;
  score: number;
  comment: string;
  model: string;
}): Promise<boolean> {
  const res = await request<{ success: boolean }>('POST', '/api/feedback', payload);
  return res?.success === true;
}

/** GET /api/agent/status - the agent backend stub. */
export async function getAgentStatus(): Promise<{ deployed: boolean }> {
  const res = await request<{ status: string }>('GET', '/api/agent/status');
  return { deployed: res?.status === 'agent-backend-deployed' };
}

/** One-shot health check used by the UI's "backend" status indicator. */
export async function pingBackend(): Promise<boolean> {
  const res = await request<{ success: boolean }>('GET', '/health');
  return res?.success === true;
}

/**
 * Project a backend `BackendThread` row into the legacy `Conversation`
 * shape used by the messages sidebar. We use the URN as the conversation
 * `id` (the previous shape used a synthetic id) so a click handler can
 * look up the thread by URN without an index-based mapping.
 */
export function threadToConversation(thread: BackendThread): Conversation {
  return {
    id: thread.urn,
    urn: thread.urn,
    name: thread.conversationName,
    preview: thread.lastInboundPreview || thread.lastMessageTime || '',
    time: thread.lastMessageTime || '',
    avatar: null,
    lastMessageAt: thread.lastScrapedAt ?? thread.createdAt ?? '',
    unread: thread.lastMessageIsInbound === true,
  };
}