/**
 * Conversations Handler
 *
 * Forwards scrape requests to the LinkedIn tab's content script. If the
 * content script isn't responding (typical when the tab was open before
 * the extension was installed/updated) we attempt to programmatically
 * inject it via `chrome.scripting.executeScript` and retry, with the
 * injected file path mirrored from the manifest registration.
 */

import type { Conversation, ExtensionMessage, ExtensionResponse } from '../types.js';

const FIRST_RETRY_DELAY_MS = 400;
const SECOND_RETRY_DELAY_MS = 800;
const MAX_SEND_ATTEMPTS = 3;

interface ScrapePayload {
  conversations?: Conversation[];
  error?: string;
}

export async function handleConversations(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
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

  // Try the registered content script first. If it doesn't answer, fall
  // back to a manual injection (which loads `content/main.js` into the
  // same isolated world the manifest registers it in) and try again.
  let response = await trySendScrape(linkedInTab.id, limit);

  if (!response) {
    console.log('[Conversations] No response, attempting manual content script injection');
    const injected = await injectContentScript(linkedInTab.id);
    if (!injected.ok) {
      return {
        success: false,
        error: `Content script injection failed: ${injected.reason}. Reload the LinkedIn tab and try again.`,
      };
    }
    await sleep(FIRST_RETRY_DELAY_MS);
    response = await trySendScrape(linkedInTab.id, limit);
  }

  // One more retry with a longer delay in case the script is still
  // initialising.
  if (!response) {
    console.log('[Conversations] Still no response, retrying with longer delay');
    await sleep(SECOND_RETRY_DELAY_MS);
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
): Promise<ScrapePayload | null> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'SCRAPE_CONVERSATIONS',
        limit,
      });
      if (response) return response as ScrapePayload;
      console.warn(`[Conversations] sendMessage returned empty (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[Conversations] sendMessage failed (attempt ${attempt}):`, err);
    }
    if (attempt < MAX_SEND_ATTEMPTS) {
      await sleep(150 * attempt);
    }
  }
  return null;
}

/**
 * Manually inject the registered content script. Returns a tagged result
 * so the caller can surface a precise error message instead of the
 * generic "did not respond" fallback.
 */
async function injectContentScript(
  tabId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/main.js'],
      world: 'ISOLATED',
    });
    if (!Array.isArray(results) || results.length === 0) {
      return { ok: false, reason: 'executeScript returned no results' };
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[Conversations] executeScript threw:', reason);
    return { ok: false, reason };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
