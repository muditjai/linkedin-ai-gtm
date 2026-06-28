/**
 * LinkedIn AI GTM - Content Script
 *
 * Runs inside LinkedIn messaging pages and is responsible for scraping the
 * conversation list out of LinkedIn's DOM. The script keeps its own
 * conversation type in sync with `src/types.ts` by re-exporting the shared
 * `Conversation` type and reusing it for the scrape response payload.
 *
 * Once loaded, we set `window.__linkedinAiGtmContentLoaded = true` so the
 * background script (and the user) can verify the injection succeeded.
 */

import type { Conversation } from '../types.js';
import type { ExtensionMessage, ExtensionResponse } from '../types.js';

interface ScrapeConversationsResponse extends ExtensionResponse {
  conversations?: Conversation[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LOADED_FLAG = '__linkedinAiGtmContentLoaded';

declare global {
  interface Window {
    [LOADED_FLAG]?: boolean;
  }
}

window[LOADED_FLAG] = true;

/**
 * Returns true when the current page is somewhere under the LinkedIn
 * messaging surface (the conversation list, a thread view, etc.).
 */
function isLinkedInMessagesPage(): boolean {
  return /linkedin\.com\/messaging/i.test(window.location.href);
}

/**
 * Listener for messages from the background service worker. The only
 * supported action right now is scraping the conversation list.
 */
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
    return true; // Async response — keep the channel open.
  }

  safeSend({ success: false, error: 'Unknown message type' });
  return false;
});

function clampLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, raw));
}

/**
 * Pulls up to `limit` conversations out of the LinkedIn DOM.
 *
 * LinkedIn's class names change frequently; we try a small set of selectors
 * and gracefully fall back to a generic structure when the canonical one is
 * not present. Works on both the inbox landing page and the per-thread page
 * (the conversation list sidebar is rendered in both).
 */
function scrapeConversations(limit: number): ScrapeConversationsResponse {
  if (!isLinkedInMessagesPage()) {
    return {
      success: false,
      error: 'Not on a LinkedIn messaging page.',
    };
  }

  try {
    console.log('[Content] Scraping conversations, limit:', limit);

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
    // Newer LinkedIn DOM (2024+): anchor items in the messaging sidebar.
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

  // Last-ditch: any list item in the messaging sidebar.
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
