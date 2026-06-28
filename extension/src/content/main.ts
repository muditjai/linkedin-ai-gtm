/**
 * LinkedIn AI GTM - Content Script
 *
 * Runs inside LinkedIn messaging pages and is responsible for scraping the
 * conversation list out of LinkedIn's DOM. Wraps everything in a top-level
 * try/catch with explicit logging so we can see exactly where injection
 * fails, and sets `window.__linkedinAiGtmContentLoaded` once the listener
 * is registered so the background script can confirm the load.
 */

import type { Conversation, ExtensionMessage, ExtensionResponse } from '../types.js';

interface ScrapeConversationsResponse extends ExtensionResponse {
  conversations?: Conversation[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LOADED_FLAG = '__linkedinAiGtmContentLoaded';
const LOADED_AT = '__linkedinAiGtmContentLoadedAt';

declare global {
  interface Window {
    [LOADED_FLAG]?: boolean;
    [LOADED_AT]?: number;
  }
}

/* ---------------------------------------------------------------------------
 * Top-level error guards
 *
 * Anything that throws during script initialisation lands here. We use both
 * a try/catch around the body and a `window.onerror` handler so we never
 * silently die on LinkedIn's SPA.
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

  if (!isLinkedInMessagesPage()) {
    console.warn('[Content] Not a LinkedIn messaging page, will still register listener');
  }

  window[LOADED_FLAG] = true;
  window[LOADED_AT] = Date.now();
  console.log('[Content] Listener registration starting');

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    console.log('[Content] Received:', message.type);

    let responded = false;
    const safeSend = (payload: ScrapeConversationsResponse): void => {
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

    safeSend({ success: false, error: 'Unknown message type' });
    return false;
  });

  console.log('[Content] Listener registered OK');
}

function clampLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, raw));
}

/**
 * Returns true when the current page is somewhere under the LinkedIn
 * messaging surface (the conversation list, a thread view, etc.).
 */
function isLinkedInMessagesPage(): boolean {
  return /linkedin\.com\/messaging/i.test(window.location.href);
}

/**
 * Pulls up to `limit` conversations out of the LinkedIn DOM.
 */
function scrapeConversations(limit: number): ScrapeConversationsResponse {
  if (!isLinkedInMessagesPage()) {
    return {
      success: false,
      error: 'Not on a LinkedIn messaging page.',
    };
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

/**
 * Try several selectors until we find the conversation list items.
 */
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
    if (found.length > 0) {
      console.log('[Content] Using selector:', selector, '->', found.length, 'items');
      return found;
    }
  }

  const sidebar = document.querySelector('.msg-conversations-container, [class*="msg-conversations"]');
  if (sidebar) {
    const items = sidebar.querySelectorAll('li, [role="listitem"]');
    if (items.length > 0) return items as NodeListOf<Element>;
  }

  return document.querySelectorAll('li');
}

/**
 * Extract a single conversation record from a list item element.
 */
function extractConversation(item: Element, index: number): Conversation | null {
  const nameEl = item.querySelector(
    '.msg-conversation-listitem__participant-names, ' +
      'h3, ' +
      '[class*="participant"], ' +
      '[class*="title"]',
  );
  let name = nameEl?.textContent?.trim() ?? '';
  if (!name) {
    const span = item.querySelector('span');
    name = span?.textContent?.trim() ?? 'Unknown';
  }

  const avatarEl = item.querySelector('img');
  const previewEl = item.querySelector(
    '.msg-conversation-card__message-snippet, ' +
      'p, ' +
      '[class*="snippet"], ' +
      '[class*="preview"]',
  );
  const timeEl = item.querySelector('time, [class*="time"], [class*="timestamp"]');

  return {
    id: `conv_${index}_${Date.now()}`,
    name: name || 'Unknown',
    avatar: avatarEl?.getAttribute('src') ?? null,
    preview: previewEl?.textContent?.trim() ?? '',
    time: timeEl?.textContent?.trim() ?? '',
    lastMessageAt: new Date().toISOString(),
    unread: item.classList.contains('msg-conversations-container__convo-item--unread'),
  };
}

console.log('[Content] LinkedIn AI GTM loaded on', window.location.href);
