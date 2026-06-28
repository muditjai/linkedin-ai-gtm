/**
 * Conversations Handler
 *
 * Forwards scrape requests to the LinkedIn tab's content script. If the
 * content script isn't responding we:
 *   1. Probe the tab for the `__linkedinAiGtmContentLoaded` flag.
 *   2. Inject `content/main.js` via `chrome.scripting.executeScript`.
 *   3. Probe again to confirm the listener actually registered.
 *   4. Send the scrape message.
 *
 * Each step is logged so the user can see exactly which one failed.
 */

import type {
  Conversation,
  ConversationMessage,
  ExtensionMessage,
  ExtensionResponse,
} from '../types.js';

const FIRST_RETRY_DELAY_MS = 400;
const SECOND_RETRY_DELAY_MS = 800;
const MAX_SEND_ATTEMPTS = 3;

interface ScrapePayload {
  conversations?: Conversation[];
  error?: string;
}

interface ContentScriptState {
  loaded: boolean;
  loadedAt: number | null;
  url: string;
  hasChromeRuntime: boolean;
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
    case 'SCRAPE_THREAD':
      return await scrapeThread(message);
    case 'SCRAPE_ALL':
      return await scrapeAll(message);
    case 'TEST_CONNECTION':
      return await testConnection();
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function getConversations(): Promise<ExtensionResponse<Conversation[]>> {
  const result = await chrome.storage.local.get(['conversations']);
  return { success: true, data: (result.conversations as Conversation[]) || [] };
}

/**
 * Pull every message from the LinkedIn thread that the user is currently
 * looking at and persist them to `chrome.storage.local` so the UI can show
 * them later.
 */
async function scrapeThread(
  message: ExtensionMessage,
): Promise<ExtensionResponse<ConversationMessage[]>> {
  const limit = message.limit ?? 200;
  console.log('[Conversations] Scraping up to', limit, 'thread messages');

  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/messaging*' });
  if (tabs.length === 0) {
    return {
      success: false,
      error:
        'No LinkedIn messaging tab is open. Navigate to linkedin.com/messaging/thread/... first.',
    };
  }

  const linkedInTab = tabs[0];
  if (!linkedInTab.id) {
    return { success: false, error: 'LinkedIn tab is not accessible.' };
  }

  // Same probe → inject → reprobe pipeline as the inbox scraper, so we
  // recover gracefully when the content script hasn't loaded yet.
  let state = await probeContentScript(linkedInTab.id);
  if (!state.loaded) {
    const injected = await injectContentScript(linkedInTab.id);
    if (!injected.ok) {
      return {
        success: false,
        error: `Content script injection failed: ${injected.reason}.`,
      };
    }
    await sleep(FIRST_RETRY_DELAY_MS);
    state = await probeContentScript(linkedInTab.id);
    if (!state.loaded) {
      return {
        success: false,
        error:
          'Injected content/main.js but the script did not register a listener.',
      };
    }
  }

  let response = await trySendScrapeThread(linkedInTab.id, limit);
  if (!response) {
    await sleep(SECOND_RETRY_DELAY_MS);
    response = await trySendScrapeThread(linkedInTab.id, limit);
  }

  if (response?.messages) {
    const messages = response.messages as ConversationMessage[];
    await chrome.storage.local.set({
      messages,
      threadId: response.threadId ?? null,
      threadLastScrapedAt: new Date().toISOString(),
    });
    return {
      success: true,
      data: messages,
      count: messages.length,
      message: response.threadId ?? undefined,
    };
  }

  if (response?.error) {
    return { success: false, error: response.error };
  }

  return {
    success: false,
    error: 'Content script did not respond to SCRAPE_THREAD.',
  };
}

async function trySendScrapeThread(
  tabId: number,
  limit: number,
): Promise<{ messages?: ConversationMessage[]; threadId?: string; error?: string } | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'SCRAPE_THREAD',
      limit,
    });
    if (response) return response as { messages?: ConversationMessage[]; threadId?: string; error?: string };
    return null;
  } catch (err) {
    console.warn('[Conversations] SCRAPE_THREAD sendMessage failed:', err);
    return null;
  }
}

/**
 * Diagnostic used by the "Test Connection" button in the UI.
 */
async function testConnection(): Promise<ExtensionResponse<ContentScriptState>> {
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/messaging*' });
  if (tabs.length === 0) {
    return {
      success: false,
      error: 'No LinkedIn messaging tab is open.',
      data: { loaded: false, loadedAt: null, url: '', hasChromeRuntime: false },
    };
  }
  const tabId = tabs[0].id;
  if (!tabId) {
    return {
      success: false,
      error: 'LinkedIn tab has no id.',
      data: { loaded: false, loadedAt: null, url: '', hasChromeRuntime: false },
    };
  }

  let state = await probeContentScript(tabId);
  if (!state.loaded) {
    const injectResult = await injectContentScript(tabId);
    if (!injectResult.ok) {
      return {
        success: false,
        error: `Content script injection failed: ${injectResult.reason}`,
        data: state,
      };
    }
    await sleep(FIRST_RETRY_DELAY_MS);
    state = await probeContentScript(tabId);
  }

  return {
    success: state.loaded,
    data: state,
    error: state.loaded
      ? undefined
      : 'Content script is still not loaded after injection. Check the LinkedIn tab DevTools console for errors.',
  };
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

  // 1) Probe first — if the manifest content script already loaded, we
  //    can skip the manual injection step.
  let state = await probeContentScript(linkedInTab.id);
  console.log('[Conversations] Probe state:', state);

  // 2) If not loaded, try to inject.
  if (!state.loaded) {
    const injected = await injectContentScript(linkedInTab.id);
    if (!injected.ok) {
      return {
        success: false,
        error: `Content script injection failed: ${injected.reason}. Reload the LinkedIn tab and try again.`,
      };
    }
    await sleep(FIRST_RETRY_DELAY_MS);
    state = await probeContentScript(linkedInTab.id);
    console.log('[Conversations] Post-injection state:', state);
    if (!state.loaded) {
      return {
        success: false,
        error:
          'Injected content/main.js but the script did not register a listener. Open the LinkedIn tab DevTools console to see the error.',
      };
    }
  }

  // 3) Listener is in place — try to send the scrape message.
  let response = await trySendScrape(linkedInTab.id, limit);

  // 4) One last-ditch retry with a longer delay in case the SPA is slow.
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
      'Content script did not respond to the scrape message. Check the LinkedIn tab DevTools console.',
  };
}

/**
 * Probe the LinkedIn tab for the content-script loaded flag. Uses a
 * function injection so we get the result back regardless of message
 * channel state.
 */
async function probeContentScript(tabId: number): Promise<ContentScriptState> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const w = window as unknown as {
          __linkedinAiGtmContentLoaded?: boolean;
          __linkedinAiGtmContentLoadedAt?: number;
        };
        return {
          loaded: w.__linkedinAiGtmContentLoaded === true,
          loadedAt: w.__linkedinAiGtmContentLoadedAt ?? null,
          url: window.location.href,
          hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime?.onMessage,
        };
      },
      world: 'ISOLATED',
    });
    if (Array.isArray(results) && results.length > 0) {
      const r = results[0]?.result as ContentScriptState | undefined;
      if (r) return r;
    }
    return { loaded: false, loadedAt: null, url: '', hasChromeRuntime: false };
  } catch (err) {
    console.warn('[Conversations] probeContentScript threw:', err);
    return { loaded: false, loadedAt: null, url: '', hasChromeRuntime: false };
  }
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

interface ScrapeAllPayload {
  conversations?: Conversation[];
  threadId?: string;
  messages?: ConversationMessage[];
  scrollIterations?: number;
  error?: string;
}

/**
 * Combined scrape: auto-scroll the inbox for every conversation AND, if a
 * thread is open, capture its messages too - all in one round-trip.
 */
async function scrapeAll(
  message: ExtensionMessage,
): Promise<ExtensionResponse<{
  conversations: Conversation[];
  threadId: string | null;
  messages: ConversationMessage[];
  scrollIterations: number;
}>> {
  const limit = message.limit ?? 200;
  console.log('[Conversations] Scrape-all (limit=', limit, ')');

  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/messaging*' });
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

  // Probe → inject → reprobe, same as the other scrapers.
  let state = await probeContentScript(linkedInTab.id);
  if (!state.loaded) {
    const injected = await injectContentScript(linkedInTab.id);
    if (!injected.ok) {
      return {
        success: false,
        error: `Content script injection failed: ${injected.reason}.`,
      };
    }
    await sleep(FIRST_RETRY_DELAY_MS);
    state = await probeContentScript(linkedInTab.id);
    if (!state.loaded) {
      return {
        success: false,
        error:
          'Injected content/main.js but the script did not register a listener.',
      };
    }
  }

  let response = await trySendScrapeAll(linkedInTab.id, limit);
  if (!response) {
    await sleep(SECOND_RETRY_DELAY_MS);
    response = await trySendScrapeAll(linkedInTab.id, limit);
  }

  if (!response) {
    return {
      success: false,
      error: 'Content script did not respond to SCRAPE_ALL.',
    };
  }

  const conversations = (response.conversations as Conversation[]) ?? [];
  const messages = (response.messages as ConversationMessage[]) ?? [];
  const threadId = (response.threadId as string | null) ?? null;
  const scrollIterations = (response.scrollIterations as number | undefined) ?? 0;

  await chrome.storage.local.set({
    conversations,
    messages,
    threadId,
    lastScrapeAllAt: new Date().toISOString(),
  });

  return {
    success: true,
    data: { conversations, threadId, messages, scrollIterations },
    count: conversations.length + messages.length,
  };
}

async function trySendScrapeAll(
  tabId: number,
  limit: number,
): Promise<ScrapeAllPayload | null> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'SCRAPE_ALL',
        limit,
      });
      if (response) return response as ScrapeAllPayload;
      console.warn(`[Conversations] SCRAPE_ALL returned empty (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[Conversations] SCRAPE_ALL failed (attempt ${attempt}):`, err);
    }
    if (attempt < MAX_SEND_ATTEMPTS) {
      await sleep(150 * attempt);
    }
  }
  return null;
}

/**
 * Manually inject the registered content script.
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
    console.log('[Conversations] executeScript results:', results);
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
