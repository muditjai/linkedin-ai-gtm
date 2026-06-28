/**
 * Conversations Handler
 *
 * Forwards scrape requests to the LinkedIn tab's content script. If the
 * content script isn't responding (e.g. the user opened the tab before
 * the extension was installed/updated) we attempt to programmatically
 * inject it via `chrome.scripting.executeScript` and retry once.
 */

import type { Conversation, ExtensionMessage, ExtensionResponse } from '../types.js';

const RETRY_DELAY_MS = 250;

export async function handleConversations(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  console.log('[Conversations] Handling:', message.type);

  switch (message.type) {
    case 'GET_CONVERSATIONS':
      return await getConversations();
    case 'SCRAPE_CONVERSATIONS':
      return await scrapeConversations(message);
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function getConversations(): Promise<ExtensionResponse<Conversation[]>> {
  const result = await chrome.storage.local.get(['conversations']);
  return { success: true, data: (result.conversations as Conversation[]) || [] };
}

async function scrapeConversations(
  message: ExtensionMessage,
): Promise<ExtensionResponse<Conversation[]>> {
  const limit = message.limit ?? 20;
  console.log('[Conversations] Scraping up to', limit, 'conversations');

  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/messaging*' });
  console.log('[Conversations] Found', tabs.length, 'LinkedIn messaging tab(s)');

  if (tabs.length === 0) {
    return {
      success: false,
      error:
        'No LinkedIn messaging tab is open. Navigate to linkedin.com/messaging first.',
    };
  }

  const linkedInTab = tabs[0];
  if (!linkedInTab.id) {
    return { success: false, error: 'LinkedIn tab is not accessible.' };
  }

  // The content script is registered in the manifest, but Chrome won't
  // inject it into tabs that were already open when the extension loaded
  // (or when the manifest was last updated). Try once, fall back to a
  // manual injection, then retry once more.
  let response = await trySendScrape(linkedInTab.id, limit);
  if (!response) {
    console.log('[Conversations] No response, attempting manual content script injection');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: linkedInTab.id },
        files: ['content/main.js'],
      });
    } catch (err) {
      console.error('[Conversations] Manual injection failed:', err);
    }
    await sleep(RETRY_DELAY_MS);
    response = await trySendScrape(linkedInTab.id, limit);
  }

  if (response?.conversations) {
    const conversations = response.conversations as Conversation[];
    await chrome.storage.local.set({ conversations });
    return {
      success: true,
      data: conversations,
      count: conversations.length,
    };
  }

  if (response?.error) {
    return { success: false, error: response.error };
  }

  return {
    success: false,
    error:
      'Content script did not respond. Reload the LinkedIn tab and try again.',
  };
}

/**
 * Send the scrape message to the content script and return its payload,
 * or `null` if the message channel failed (no listener / tab crashed).
 */
async function trySendScrape(
  tabId: number,
  limit: number,
): Promise<{ conversations?: Conversation[]; error?: string } | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'SCRAPE_CONVERSATIONS',
      limit,
    });
    return response ?? null;
  } catch (err) {
    console.warn('[Conversations] sendMessage failed:', err);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
