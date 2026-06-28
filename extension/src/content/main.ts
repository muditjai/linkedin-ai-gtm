/**
 * LinkedIn AI GTM - Content Script
 *
 * Runs inside LinkedIn messaging pages and is responsible for scraping the
 * conversation list out of LinkedIn's DOM. The script keeps its own
 * conversation type in sync with `src/types.ts` by re-exporting the shared
 * `Conversation` type and reusing it for the scrape response payload.
 */

import type { Conversation } from '../types.js';
import type { ExtensionMessage, ExtensionResponse } from '../types.js';

interface ScrapeConversationsResponse extends ExtensionResponse {
  conversations?: Conversation[];
}

const DEFAULT_LIMIT = 20;

/**
 * Returns true when the current page is the LinkedIn messaging page,
 * which is where the conversation list UI lives.
 */
function isLinkedInMessagesPage(): boolean {
  return window.location.href.includes('linkedin.com/messaging');
}

/**
 * Listener for messages from the background service worker. The only
 * supported action right now is scraping the conversation list.
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  console.log('[Content] Received:', message.type);

  if (message.type === 'SCRAPE_CONVERSATIONS') {
    const result = scrapeConversations(message.limit ?? DEFAULT_LIMIT);
    sendResponse(result satisfies ScrapeConversationsResponse);
  } else {
    sendResponse({ success: false, error: 'Unknown message type' });
  }

  // Return true to indicate we will respond asynchronously.
  return true;
});

/**
 * Pulls up to `limit` conversations out of the LinkedIn DOM.
 *
 * LinkedIn's class names change frequently; we try a small set of selectors
 * and gracefully fall back to a generic structure when the canonical one is
 * not present.
 */
function scrapeConversations(limit: number): ScrapeConversationsResponse {
  if (!isLinkedInMessagesPage()) {
    return {
      success: false,
      error: 'Not on a LinkedIn messaging page. Open linkedin.com/messaging first.',
    };
  }

  try {
    console.log('[Content] Scraping conversations, limit:', limit);

    const items = pickConversationItems();
    if (items.length === 0) {
      return {
        success: false,
        error: 'No conversations found. Make sure your inbox is loaded.',
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
  ];

  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    if (found.length > 0) {
      console.log('[Content] Using selector:', selector, '->', found.length, 'items');
      return found;
    }
  }

  return document.querySelectorAll('li');
}

/**
 * Extract a single conversation record from a list item element.
 */
function extractConversation(item: Element, index: number): Conversation | null {
  const nameEl = item.querySelector(
    '.msg-conversation-listitem__participant-names, h3, [class*="participant"]',
  );
  let name = nameEl?.textContent?.trim() ?? '';
  if (!name) {
    const span = item.querySelector('span');
    name = span?.textContent?.trim() ?? 'Unknown';
  }

  const avatarEl = item.querySelector('img');
  const previewEl = item.querySelector(
    '.msg-conversation-card__message-snippet, p, [class*="snippet"]',
  );
  const timeEl = item.querySelector('time, [class*="time"]');

  return {
    id: `conv_${index}_${Date.now()}`,
    name,
    avatar: avatarEl?.getAttribute('src') ?? null,
    preview: previewEl?.textContent?.trim() ?? '',
    time: timeEl?.textContent?.trim() ?? '',
    lastMessageAt: new Date().toISOString(),
    unread: item.classList.contains('msg-conversations-container__convo-item--unread'),
  };
}

console.log('[Content] LinkedIn AI GTM loaded on', window.location.href);
