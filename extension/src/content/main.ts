/**
 * LinkedIn AI GTM - Content Script
 *
 * Runs inside LinkedIn messaging pages. Three responsibilities:
 *
 *   1. SCRAPE_CONVERSATIONS  - read the conversation list from the inbox
 *      sidebar (one row per LinkedIn conversation).
 *   2. SCRAPE_THREAD         - read every message in the currently-open
 *      thread (linkedin.com/messaging/thread/...).
 *   3. SCRAPE_ALL            - the combined call: auto-scroll the inbox
 *      to load the full list of conversations AND, if a thread is open,
 *      scrape its messages - returning everything in one response.
 *
 * IMPORTANT: This file MUST NOT use ES module syntax (`import` / `export`).
 * Chrome loads content scripts as regular scripts, not modules - a stray
 * `export {}` token causes SyntaxError and silently kills the script.
 *
 * `Conversation`, `ExtensionMessage`, `ExtensionResponse`, and
 * `ConversationMessage` are therefore declared locally as plain interfaces
 * rather than imported from `../types.js`.
 */

interface Conversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  avatar: string | null;
  lastMessageAt: string;
  unread: boolean;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  senderName: string;
  senderAvatar: string | null;
  content: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  dateHeading: string | null;
  edited: boolean;
  reactions: string[];
  needsReply: boolean;
  outcome?: 'positive' | 'negative';
  needsFollowUp: boolean;
  outcome_positive?: boolean;
}

interface ExtensionMessage {
  type: string;
  limit?: number;
  threadLimit?: number;
  [key: string]: unknown;
}

interface ExtensionResponse {
  success: boolean;
  conversations?: Conversation[];
  threadId?: string;
  messages?: ConversationMessage[];
  scrollIterations?: number;
  error?: string;
  count?: number;
  message?: string;
  [key: string]: unknown;
}

interface ScrapeConversationsResponse extends ExtensionResponse {
  conversations?: Conversation[];
  scrollIterations?: number;
}

interface ScrapeThreadResponse extends ExtensionResponse {
  threadId?: string;
  messages?: ConversationMessage[];
}

interface ScrapeAllResponse extends ExtensionResponse {
  conversations?: Conversation[];
  threadId?: string;
  messages?: ConversationMessage[];
  scrollIterations?: number;
  /** Per-thread messages keyed by the LinkedIn URN. */
  threads?: Record<string, ConversationMessage[]>;
  /** How many conversation threads the scraper actually opened + scraped. */
  threadsScraped?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LOADED_FLAG = '__linkedinAiGtmContentLoaded';
const LOADED_AT = '__linkedinAiGtmContentLoadedAt';

const SCROLL_MAX_ITERATIONS = 50;
const SCROLL_STABLE_THRESHOLD = 3;
const SCROLL_WAIT_MS = 500;

/* ---------------------------------------------------------------------------
 * Top-level error guards
 * ------------------------------------------------------------------------- */
window.onerror = (msg, _src, _line, _col, err) => {
  console.error('[Content] window.onerror:', msg, err);
};

try {
  boot();
} catch (err) {
  console.error('[Content] FATAL during boot:', err);
}

function boot(): void {
  console.log('[Content] Booting on', window.location.href);

  (window as unknown as Record<string, unknown>)[LOADED_FLAG] = true;
  (window as unknown as Record<string, unknown>)[LOADED_AT] = Date.now();
  console.log('[Content] Listener registration starting');

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    console.log('[Content] Received:', message.type);

    let responded = false;
    const safeSend = (payload: ExtensionResponse): void => {
      if (responded) return;
      responded = true;
      sendResponse(payload);
    };

    if (message.type === 'SCRAPE_CONVERSATIONS') {
      const limit = clampLimit(message.limit);
      Promise.resolve(scrapeConversations(limit))
        .then(safeSend)
        .catch((err: unknown) => {
          console.error('[Content] Scrape threw:', err);
          safeSend({ success: false, error: (err as Error).message });
        });
      return true;
    }

    if (message.type === 'SCRAPE_THREAD') {
      Promise.resolve(scrapeThreadMessages())
        .then(safeSend)
        .catch((err: unknown) => {
          console.error('[Content] Thread scrape threw:', err);
          safeSend({ success: false, error: (err as Error).message });
        });
      return true;
    }

    if (message.type === 'SCRAPE_ALL') {
      // The handler forwards BOTH `limit` and `threadLimit`, but they
      // mean the same thing for the user: "first N of everything".
      // We use whichever is present (preferring `threadLimit` if both
      // arrive, since that is what the UI's "Max threads" input sends).
      const incoming = (message as Record<string, unknown>).threadLimit;
      const cap = typeof incoming === 'number' && !Number.isNaN(incoming)
        ? incoming
        : clampLimit(message.limit);
      Promise.resolve(scrapeAll(cap))
        .then(safeSend)
        .catch((err: unknown) => {
          console.error('[Content] Scrape-all threw:', err);
          safeSend({ success: false, error: (err as Error).message });
        });
      return true;
    }

    if (message.type === 'SCRAPE_THREAD_BY_INDEX') {
      const index = Number((message as Record<string, unknown>).index);
      Promise.resolve(scrapeThreadByIndex(index))
        .then(safeSend)
        .catch((err: unknown) => {
          console.error('[Content] Thread-by-index scrape threw:', err);
          safeSend({ success: false, error: (err as Error).message });
        });
      return true;
    }

    safeSend({ success: false, error: 'Unknown message type' });
    return false;
  });

  console.log('[Content] Listener registered OK');
}

function clampLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, raw));
}

function readThreadLimit(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 5;
  if (raw < 0) return 0;
  return Math.min(20, Math.floor(raw));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isLinkedInMessagesPage(): boolean {
  return /linkedin\.com\/messaging/i.test(window.location.href);
}

function isLinkedInThreadPage(): boolean {
  return /linkedin\.com\/messaging\/thread\//i.test(window.location.href);
}

/**
 * Extract the LinkedIn thread URN from the current URL, falling back to a
 * synthetic id derived from the pathname.
 */
function getThreadId(): string {
  const m = window.location.pathname.match(/\/messaging\/thread\/([^/?#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return `local_${Date.now()}`;
}

/* ---------------------------------------------------------------------------
 * Inbox (conversation list) scraping
 * ------------------------------------------------------------------------- */

function scrapeConversations(limit: number): ScrapeConversationsResponse {
  if (!isLinkedInMessagesPage()) {
    return { success: false, error: 'Not on a LinkedIn messaging page.' };
  }

  try {
    const items = pickConversationItems();
    if (items.length === 0) {
      return {
        success: false,
        error:
          'No conversations found in the sidebar. Click the messaging icon so the list is visible.',
      };
    }

    const conversations: Conversation[] = [];
    items.forEach((item, index) => {
      if (index >= limit) return;
      const conv = extractConversation(item, index);
      if (conv) conversations.push(conv);
    });

    console.log('[Content] Scraped', conversations.length, 'conversations');
    return { success: true, conversations, scrollIterations: 0 };
  } catch (error) {
    console.error('[Content] Scrape error:', error);
    return { success: false, error: (error as Error).message };
  }
}

function pickConversationItems(): NodeListOf<Element> {
  // LinkedIn renders the conversation list as a <ul.msg-conversations-
  // container__conversations-list>. Each row is a <li.msg-conversations-
  // container__convo-item>. While the user scrolls (or auto-scrolls), the
  // list also contains placeholder <li> elements with the
  // `msg-conversation-card--occluded` class - they exist purely to keep
  // scroll height stable while the next batch of items loads. We must skip
  // those, otherwise we end up scraping empty rows with placeholder
  // dimensions and `name = "Unknown"`.
  const OCCLUDED = ':not(.msg-conversation-card--occluded)';

  // Preferred path: the specific conversations list <ul>.
  const ul = document.querySelector(
    'ul.msg-conversations-container__conversations-list',
  );
  if (ul) {
    const real = ul.querySelectorAll<HTMLElement>(
      `li.msg-conversations-container__convo-item${OCCLUDED}`,
    );
    if (real.length > 0) return real;
  }

  // Fallbacks for older LinkedIn DOMs.
  const selectors = [
    `.msg-conversations-container__convo-item${OCCLUDED}`,
    `li[class*="conversation-listitem"]${OCCLUDED}`,
    `li[data-conversation-id]${OCCLUDED}`,
    `div.msg-conversation-listitem${OCCLUDED}`,
    `a.msg-conversation-listitem${OCCLUDED}`,
    `.msg-overlay-list-bubble__convo-item${OCCLUDED}`,
  ];

  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    if (found.length > 0) return found;
  }

  const sidebar = document.querySelector(
    '.msg-conversations-container, [class*="msg-conversations"]',
  );
  if (sidebar) {
    const items = sidebar.querySelectorAll('li, [role="listitem"]');
    if (items.length > 0) return items as NodeListOf<Element>;
  }

  return document.querySelectorAll('li');
}

function extractConversation(item: Element, index: number): Conversation | null {
  const nameEl = item.querySelector(
    '.msg-conversation-listitem__participant-names, h3, [class*="participant"], [class*="title"]',
  );
  let name = nameEl?.textContent?.trim() ?? '';
  if (!name) {
    const span = item.querySelector('span');
    name = span?.textContent?.trim() ?? 'Unknown';
  }

  const avatarEl = item.querySelector('img');
  const previewEl = item.querySelector(
    '.msg-conversation-card__message-snippet, p, [class*="snippet"], [class*="preview"]',
  );
  const timeEl = item.querySelector('time, [class*="time"], [class*="timestamp"]');

  return {
    id: `conv_${index}_${Date.now()}`,
    name: name || 'Unknown',
    avatar: avatarEl?.getAttribute('src') ?? null,
    preview: previewEl?.textContent?.trim() ?? '',
    time: timeEl?.textContent?.trim() ?? '',
    lastMessageAt: new Date().toISOString(),
    unread: item.classList.contains(
      'msg-conversations-container__convo-item--unread',
    ),
  };
}

/* ---------------------------------------------------------------------------
 * Auto-scroll: walk down the inbox sidebar to load every conversation
 * ------------------------------------------------------------------------- */

/**
 * Find the scrollable ancestor that contains the conversation list. We walk
 * up the DOM from a known list item until we hit an element whose computed
 * `overflow-y` is `auto` or `scroll` AND whose content actually overflows.
 *
 * Falls back to a few known selectors if the heuristic fails.
 */
function findScrollContainer(item: Element): HTMLElement | null {
  let el: HTMLElement | null = item.parentElement;
  let depth = 0;
  while (el && depth < 10) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const scrollableY = overflowY === 'auto' || overflowY === 'scroll';
    if (scrollableY && el.scrollHeight > el.clientHeight + 4) {
      return el;
    }
    el = el.parentElement;
    depth += 1;
  }

  const fallbacks = [
    '.msg-conversations-container',
    '.msg-conversation-list',
    '[class*="msg-conversations-container"]',
    '[class*="conversation-list"]',
  ];
  for (const sel of fallbacks) {
    const found = document.querySelector<HTMLElement>(sel);
    if (found) return found;
  }
  return null;
}

/**
 * Iteratively scroll the inbox list to its bottom so LinkedIn virtualises
 * in more rows, then return the fully-populated NodeList.
 *
 * - Caps at `SCROLL_MAX_ITERATIONS` so we never spin forever.
 * - Stops early once the count has been stable for `SCROLL_STABLE_THRESHOLD`
 *   iterations in a row (i.e. we hit the end of the list).
 */
async function scrollAndCollectConversationItems(): Promise<{
  items: Element[];
  iterations: number;
}> {
  const initial = Array.from(pickConversationItems());
  if (initial.length === 0) return { items: initial, iterations: 0 };

  const container = findScrollContainer(initial[0]);
  if (!container) {
    console.warn(
      '[Content] Could not find scrollable ancestor; using initial items only',
    );
    return { items: initial, iterations: 0 };
  }

  let lastCount = initial.length;
  let stableCount = 0;
  let iterations = 0;

  for (let i = 0; i < SCROLL_MAX_ITERATIONS; i += 1) {
    iterations = i + 1;
    container.scrollTop = container.scrollHeight;
    await sleep(SCROLL_WAIT_MS);

    const current = pickConversationItems();
    if (current.length <= lastCount) {
      stableCount += 1;
      if (stableCount >= SCROLL_STABLE_THRESHOLD) {
        console.log(
          '[Content] Scroll stable at',
          current.length,
          'items after',
          iterations,
          'iterations',
        );
        break;
      }
    } else {
      console.log(
        '[Content] Scroll iteration',
        iterations,
        ':',
        lastCount,
        '->',
        current.length,
        'items',
      );
      stableCount = 0;
      lastCount = current.length;
    }
  }

  return { items: Array.from(pickConversationItems()), iterations };
}

/* ---------------------------------------------------------------------------
 * Thread scraping - every message in the currently-open LinkedIn thread
 * ------------------------------------------------------------------------- */

function scrapeThreadMessages(): ScrapeThreadResponse {
  if (!isLinkedInMessagesPage()) {
    return { success: false, error: 'Not on a LinkedIn messaging page.' };
  }

  const threadId = getThreadId();
  const list = pickMessageList();
  if (!list) {
    return {
      success: false,
      threadId,
      error:
        'No thread message list found. Make sure a thread is open (linkedin.com/messaging/thread/...).',
    };
  }

  const messageNodes = pickMessageEventNodes(list);
  if (messageNodes.length === 0) {
    return {
      success: false,
      threadId,
      error: 'No messages found in this thread.',
    };
  }

  const messages: ConversationMessage[] = [];
  let currentDay: string | null = null;
  let isLast = false;

  messageNodes.forEach((node, index) => {
    // LinkedIn emits a "Friday" / "Saturday" heading as its own list item
    // *before* the first message of that day. When we see one, capture it so
    // the next message(s) inherit it.
    const dayHeadingEl = node.querySelector(
      '.msg-s-message-list__time-heading',
    );
    if (dayHeadingEl) {
      currentDay = dayHeadingEl.textContent?.trim() ?? null;
      // Day headings are their own <li>; don't treat them as messages.
      return;
    }

    const message = extractThreadMessage(node, threadId, currentDay);
    if (message) {
      isLast = index === messageNodes.length - 1;
      message.needsReply =
        isLast && message.direction === 'inbound';
      messages.push(message);
    }
  });

  console.log('[Content] Scraped', messages.length, 'thread messages');
  return {
    success: true,
    threadId,
    messages,
    count: messages.length,
  };
}

function pickMessageList(): HTMLElement | null {
  const selectors = [
    '.msg-s-message-list.full-width.scrollable',
    'ul.msg-s-message-list-content',
    '[id^="message-list-"]',
    '.msg-s-message-list',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el as HTMLElement;
  }
  return null;
}

/**
 * Find the scrollable ancestor of the message list so we can load older
 * history by scrolling it to the top. LinkedIn's thread view only renders
 * the visible portion of the message stream and lazy-loads the rest as
 * the user scrolls toward the top. Without this, "scrape thread" returns
 * only the messages currently in the viewport.
 */
function findMessageListScrollContainer(
  list: HTMLElement,
): HTMLElement | null {
  let el: HTMLElement | null = list;
  let depth = 0;
  while (el && depth < 6) {
    const style = window.getComputedStyle(el);
    const scrollable =
      style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (scrollable && el.scrollHeight > el.clientHeight + 4) {
      return el;
    }
    el = el.parentElement;
    depth += 1;
  }
  return null;
}

/**
 * Scroll the message list container to the top repeatedly so LinkedIn
 * virtualises the older messages into the DOM. Returns the iteration
 * count and the final message-node count.
 */
async function scrollMessageListForFullThread(
  list: HTMLElement,
): Promise<{ iterations: number; finalCount: number }> {
  const container = findMessageListScrollContainer(list);
  if (!container) {
    return { iterations: 0, finalCount: pickMessageEventNodes(list).length };
  }

  let lastCount = pickMessageEventNodes(list).length;
  let stableCount = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 30;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    iterations = i + 1;
    container.scrollTop = 0;
    await sleep(450);
    const current = pickMessageEventNodes(list).length;
    console.log(
      '[Content] Thread scroll iter',
      iterations,
      ': messages =',
      current,
    );
    if (current <= lastCount) {
      stableCount += 1;
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
      lastCount = current;
    }
  }
  return { iterations, finalCount: pickMessageEventNodes(list).length };
}

function pickMessageEventNodes(list: HTMLElement): HTMLElement[] {
  return Array.from(
    list.querySelectorAll<HTMLElement>('li.msg-s-message-list__event'),
  );
}

function extractThreadMessage(
  node: HTMLElement,
  conversationId: string,
  dateHeading: string | null,
): ConversationMessage | null {
  const item = node.querySelector('.msg-s-event-listitem');
  if (!item) return null;

  const id =
    item.getAttribute('data-event-urn') ??
    `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Direction: LinkedIn adds the `--other` modifier to inbound messages.
  // Fall back to the a11y heading text if that class is ever removed.
  let direction: 'inbound' | 'outbound' = item.classList.contains(
    'msg-s-event-listitem--other',
  )
    ? 'inbound'
    : 'outbound';
  if (!item.classList.contains('msg-s-event-listitem--other')) {
    const a11y = node.querySelector(
      '.msg-s-event-listitem--group-a11y-heading',
    )?.textContent?.toLowerCase() ?? '';
    if (a11y.includes('mudit jain sent')) direction = 'outbound';
    else if (a11y.includes('ryan ward sent')) direction = 'inbound';
  }

  // Sender + avatar
  const senderName =
    item.querySelector('.msg-s-message-group__name')?.textContent?.trim() ??
    (direction === 'outbound' ? 'Mudit Jain' : 'Unknown');
  const avatar =
    node.querySelector<HTMLImageElement>('img.msg-s-event-listitem__profile-picture')
      ?.getAttribute('src') ?? null;

  // Timestamp
  const timestamp =
    node.querySelector<HTMLElement>('.msg-s-message-group__timestamp')?.textContent?.trim() ??
    '';

  // Body - LinkedIn puts the visible text in <p.msg-s-event-listitem__body>
  // (with `<br>` for line breaks). We collapse to plain text + \n.
  const bodyEl = item.querySelector<HTMLElement>('.msg-s-event-listitem__body');
  const content = bodyEl ? normaliseBodyText(bodyEl) : '';

  // Edited indicator
  const edited = !!item.querySelector('.msg-s-event-listitem__body-edited, [class*="edited"]');

  // Reactions
  const reactions: string[] = [];
  item.querySelectorAll<HTMLElement>('.msg-reactions-reaction-summary-presenter__pill-emoji').forEach(
    (el) => {
      const text = el.textContent?.trim();
      if (text) reactions.push(text);
    },
  );

  return {
    id,
    conversationId,
    senderName,
    senderAvatar: avatar,
    content,
    direction,
    timestamp,
    dateHeading,
    edited,
    reactions,
    needsReply: false,
    needsFollowUp: false,
  };
}

/**
 * Convert a message body element to plain text. `<br>` becomes `\n`,
 * block-level children become their own line, and consecutive whitespace is
 * collapsed so output stays readable when displayed in the UI.
 */
function normaliseBodyText(el: HTMLElement): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    if (tag === 'SPAN' && node.classList.contains('white-space-pre')) {
      // LinkedIn inserts these between adjacent inline blocks to force a
      // space at line break points - keep them as a literal space.
      out += ' ';
      return;
    }
    if (tag === 'A' || tag === 'STRONG' || tag === 'EM') {
      out += node.textContent ?? '';
      return;
    }
    // Default: recurse so nested structures still get their text.
    out += normaliseBodyText(node);
  });
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------------------------------------------------------------
 * Combined scrape (SCRAPE_ALL): inbox list + thread messages in one shot
 * ------------------------------------------------------------------------- */

const THREAD_NAV_DELAY_MS = 2000;
const THREAD_NAV_TIMEOUT_MS = 8000;

/**
 * Combined scrape: auto-scroll the inbox AND click through up to `cap`
 * conversations to scrape their full threads. A single `cap` is used for
 * BOTH the inbox row count and the per-thread click-through so the
 * user-facing input "Max threads: N" maps to "first N of everything".
 *
 * Returns:
 *   - `conversations`:  capped inbox rows (size <= `cap`)
 *   - `threads`:        per-thread messages keyed by LinkedIn URN
 *   - `threadsScraped`: number of threads successfully scraped
 *   - `scrollIterations`: how many inbox scroll passes were needed
 */
async function scrapeAll(cap: number = 0): Promise<ScrapeAllResponse> {
  if (!isLinkedInMessagesPage()) {
    return { success: false, error: 'Not on a LinkedIn messaging page.' };
  }

  // Normalize the cap so a missing / bogus value clamps to 0.
  const safeCap = Math.min(Math.max(0, Math.floor(cap) || 0), MAX_LIMIT);

  // 1) Auto-scroll + extract inbox conversations.
  let conversationItems: Element[];
  let scrollIterations = 0;
  try {
    const scrolled = await scrollAndCollectConversationItems();
    conversationItems = scrolled.items;
    scrollIterations = scrolled.iterations;
  } catch (err) {
    console.error('[Content] Auto-scroll failed, falling back to initial items:', err);
    conversationItems = Array.from(pickConversationItems());
  }

  // The inbox cap MUST be applied to the response - otherwise we leak the
  // full sidebar back to the UI when the user asked for "5" (the original
  // bug: 61 inbox rows when the user asked for 5 threads).
  const inboxCap = safeCap;
  const conversations: Conversation[] = [];
  if (conversationItems.length > 0) {
    conversationItems.forEach((item, index) => {
      if (index >= inboxCap) return;
      const conv = extractConversation(item, index);
      if (conv) conversations.push(conv);
    });
  }

  console.log(
    '[Content] Scrape-all:',
    conversations.length,
    'conversations after',
    scrollIterations,
    'scroll iterations (cap=',
    safeCap,
    ', sidebar had',
    conversationItems.length,
    ')',
  );

  // 2) Click through up to `safeCap` conversations to scrape their full
  //    thread history. We use LinkedIn's natural UI (clicking the
  //    conversation item) instead of direct URL navigation so the SPA's
  //    router handles the transition the same way a user would. This
  //    keeps the inbox visible throughout.
  //
  //    IMPORTANT: we re-query the conversation items on every iteration
  //    because the SPA can replace sidebar DOM nodes between clicks
  //    (marking items read, adding active state, etc.) and our captured
  //    references would otherwise be stale.
  const threads: Record<string, ConversationMessage[]> = {};
  const totalThreadMessages = await scrapeThreadsByClicking(
    safeCap,
    threads,
  );

  const threadsScraped = Object.keys(threads).length;
  console.log(
    '[Content] Scrape-all done:',
    conversations.length,
    'inbox conversations,',
    threadsScraped,
    'threads,',
    totalThreadMessages,
    'total messages',
  );

  return {
    success: true,
    conversations,
    threads,
    threadsScraped,
    threadId: isLinkedInThreadPage() ? getThreadId() : undefined,
    messages: undefined,
    scrollIterations,
    count:
      conversations.length +
      totalThreadMessages,
  };
}

/**
 * Wait for the message-list container to render after a thread page
 * navigation. Polls `pickMessageList()` until it returns a non-null
 * element OR the timeout expires. Returns the element (or `null`).
 *
 * The LinkedIn SPA sometimes takes > 1.5 s after the URL changes to
 * actually mount the message list - the previous fixed sleep caused
 * "only got the last message" bugs when the SPA was slow.
 */
async function waitForMessageList(
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const list = pickMessageList();
    if (list && pickMessageEventNodes(list).length > 0) {
      return list;
    }
    await sleep(150);
  }
  return pickMessageList();
}

/**
 * Click through up to `cap` conversations in the inbox sidebar and
 * scrape their full message threads. Populates the `threads` map keyed
 * by LinkedIn URN. Returns the total message count across all scraped
 * threads.
 */
async function scrapeThreadsByClicking(
  cap: number,
  threads: Record<string, ConversationMessage[]>,
): Promise<number> {
  if (cap <= 0) {
    // cap === 0 means "don't auto-click"; pick up the currently-open
    // thread only (if the user was already viewing one).
    if (isLinkedInThreadPage()) {
      const thread = scrapeThreadMessages();
      if (thread.success && thread.messages && thread.messages.length > 0) {
        threads[thread.threadId ?? getThreadId()] = thread.messages;
        return thread.messages.length;
      }
    }
    return 0;
  }

  let totalMessages = 0;
  for (let i = 0; i < cap; i += 1) {
    // ALWAYS re-query the conversation items; sidebar DOM is unstable
    // across SPA navigations.
    const liveItems = Array.from(pickConversationItems());
    if (i >= liveItems.length) {
      console.warn(
        '[Content] Conversation index',
        i,
        'out of range (sidebar has',
        liveItems.length,
        'items); stopping thread loop',
      );
      break;
    }
    const item = liveItems[i];
    const link = pickConversationLink(item);
    if (!link) {
      console.warn(
        '[Content] No clickable link for conversation',
        i,
        '- skipping',
      );
      continue;
    }

    logProgress(`Scraping thread ${i + 1}/${cap}...`);
    triggerClick(link);
    const navigated = await waitForUrl(
      /messaging\/thread\//i,
      THREAD_NAV_TIMEOUT_MS,
    );
    if (!navigated) {
      console.warn(
        '[Content] Thread',
        i + 1,
        'did not navigate, continuing to next',
      );
      continue;
    }

    // Wait for the message list to actually render, then scroll it to
    // load older history. This is the fix for "only got the last message":
    // a fixed 1.5 s sleep wasn't enough for slow SPA renders.
    const list = await waitForMessageList(THREAD_NAV_TIMEOUT_MS);
    if (!list) {
      console.warn(
        '[Content] Thread',
        i + 1,
        'navigated but message list never appeared; skipping',
      );
      continue;
    }

    await scrollMessageListForFullThread(list);

    // Re-collect the (now-complete) message list - it may have grown
    // during scrolling.
    const messageNodes = pickMessageEventNodes(list);
    const messagesFromNodeList: ConversationMessage[] = [];
    let currentDay: string | null = null;
    messageNodes.forEach((node, idx) => {
      const dayHeadingEl = node.querySelector(
        '.msg-s-message-list__time-heading',
      );
      if (dayHeadingEl) {
        currentDay = dayHeadingEl.textContent?.trim() ?? null;
        return;
      }
      const message = extractThreadMessage(node, getThreadId(), currentDay);
      if (message) {
        message.needsReply =
          idx === messageNodes.length - 1 && message.direction === 'inbound';
        messagesFromNodeList.push(message);
      }
    });

    if (messagesFromNodeList.length > 0) {
      const urn = getThreadId();
      threads[urn] = messagesFromNodeList;
      totalMessages += messagesFromNodeList.length;
      console.log(
        '[Content] Thread',
        i + 1,
        'scraped:',
        messagesFromNodeList.length,
        'messages (urn',
        urn,
        ')',
      );
    } else {
      console.warn(
        '[Content] Thread',
        i + 1,
        'scrape produced 0 messages, continuing to next',
      );
    }

    // Don't sleep after the LAST thread - we're done.
    if (i < cap - 1) {
      await sleep(THREAD_NAV_DELAY_MS);
    }
  }

  // Best-effort: navigate back to the inbox so the user sees the full
  // list again. If this fails (e.g. they navigated manually), the
  // thread scrape is still saved.
  if (isLinkedInThreadPage()) {
    try {
      const liveItems = Array.from(pickConversationItems());
      const firstLink = liveItems.length > 0 ? pickConversationLink(liveItems[0]) : null;
      if (firstLink) {
        triggerClick(firstLink);
        await waitForUrl(/\/messaging\/?$/i, 3000);
      } else {
        // Fall back to a direct URL change.
        window.history.pushState({}, '', '/messaging/');
      }
    } catch (err) {
      console.warn('[Content] Could not return to inbox:', err);
    }
  }

  return totalMessages;
}

/**
 * Find the clickable element inside a conversation list item. LinkedIn uses
 * either a focusable div with `tabindex="0"` or a profile-link wrapper -
 * we need the *row-level* clickable, not the profile link.
 */
function pickConversationLink(item: Element): HTMLElement | null {
  // Prefer the explicit conversation-link div.
  const link = item.querySelector<HTMLElement>(
    '.msg-conversation-listitem__link, .msg-conversations-container__convo-item-link',
  );
  if (link) return link;
  // Fall back to the first tabindex=0 descendant that isn't a checkbox.
  const candidates = Array.from(
    item.querySelectorAll<HTMLElement>('[tabindex="0"]'),
  );
  for (const el of candidates) {
    if (el.tagName === 'INPUT') continue;
    return el;
  }
  return null;
}

/**
 * Poll `window.location.pathname` until it matches `pattern` or the
 * timeout expires.
 */
async function waitForUrl(pattern: RegExp, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pattern.test(window.location.pathname)) return true;
    await sleep(100);
  }
  return false;
}

function logProgress(message: string): void {
  console.log('[Content]', message);
}

/**
 * Click the Nth conversation in the inbox sidebar, wait for the SPA to
 * navigate to its thread, then scrape the thread messages. Returns the
 * thread URN + messages on success, or an error.
 */
async function scrapeThreadByIndex(
  index: number,
): Promise<ScrapeConversationsResponse> {
  if (!isLinkedInMessagesPage()) {
    return { success: false, error: 'Not on a LinkedIn messaging page.' };
  }
  if (index < 0) {
    return { success: false, error: 'Invalid conversation index.' };
  }

  const items = Array.from(pickConversationItems());
  if (index >= items.length) {
    return {
      success: false,
      error: `Conversation index ${index} out of range (have ${items.length}).`,
    };
  }

  const link = pickConversationLink(items[index]);
  if (!link) {
    return { success: false, error: 'Could not find clickable link for that conversation.' };
  }

  logProgress(`Opening conversation ${index + 1} for thread scrape…`);
  triggerClick(link);
  const navigated = await waitForUrl(/messaging\/thread\//i, THREAD_NAV_TIMEOUT_MS);
  if (!navigated) {
    return {
      success: false,
      error: 'Click did not navigate to a thread URL. Try clicking manually first.',
    };
  }
  // LinkedIn virtualises the message list - give it a beat to render.
  await sleep(1500);

  const thread = scrapeThreadMessages();
  if (!thread.success) {
    return { success: false, error: thread.error ?? 'Thread scrape failed.' };
  }
  return {
    success: true,
    threadId: thread.threadId,
    messages: thread.messages,
    count: thread.messages?.length,
  } as ScrapeConversationsResponse;
}

/**
 * Trigger a click that works with both native HTMLElement.click() and
 * Ember's event-delegation model. LinkedIn's <div tabindex="0"> rows don't
 * have an `href`, so we have to dispatch a real mouse-style click event.
 */
function triggerClick(el: HTMLElement): void {
  el.click();
  // Belt-and-braces: if the framework ignored the synthetic click, fire
  // a bubbling MouseEvent too.
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
}

console.log('[Content] LinkedIn AI GTM loaded on', window.location.href);
