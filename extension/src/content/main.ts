/**
 * LinkedIn AI GTM - Content Script
 *
 * Runs inside LinkedIn messaging pages. Two responsibilities:
 *
 *   1. SCRAPE_CONVERSATIONS - read the conversation list from the inbox
 *      sidebar (one row per LinkedIn conversation).
 *
 *   2. SCRAPE_THREAD - read every message in the currently-open thread
 *      (the page the user is looking at, e.g.
 *      linkedin.com/messaging/thread/2-...).
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
  [key: string]: unknown;
}

interface ExtensionResponse {
  success: boolean;
  conversations?: Conversation[];
  threadId?: string;
  messages?: ConversationMessage[];
  error?: string;
  count?: number;
  message?: string;
  [key: string]: unknown;
}

interface ScrapeConversationsResponse extends ExtensionResponse {
  conversations?: Conversation[];
}

interface ScrapeThreadResponse extends ExtensionResponse {
  threadId?: string;
  messages?: ConversationMessage[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LOADED_FLAG = '__linkedinAiGtmContentLoaded';
const LOADED_AT = '__linkedinAiGtmContentLoadedAt';

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

    safeSend({ success: false, error: 'Unknown message type' });
    return false;
  });

  console.log('[Content] Listener registered OK');
}

function clampLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, raw));
}

function isLinkedInMessagesPage(): boolean {
  return /linkedin\.com\/messaging/i.test(window.location.href);
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
    return { success: true, conversations };
  } catch (error) {
    console.error('[Content] Scrape error:', error);
    return { success: false, error: (error as Error).message };
  }
}

function pickConversationItems(): NodeListOf<Element> {
  const selectors = [
    '.msg-conversations-container__convo-item',
    'li[class*="conversation-listitem"]',
    'li[data-conversation-id]',
    'div.msg-conversation-listitem',
    'a.msg-conversation-listitem',
    '.msg-overlay-list-bubble__convo-item',
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

console.log('[Content] LinkedIn AI GTM loaded on', window.location.href);
