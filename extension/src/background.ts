/**
 * LinkedIn AI GTM - Background Service Worker
 *
 * The extension is configured (per AGENTS.md) to open as a full page rather
 * than a popup. Clicking the toolbar icon launches `fullpage.html` in a new
 * tab via `chrome.tabs.create`.
 */

import { handleConversations } from './handlers/conversations.js';
import { handleSequencer } from './handlers/sequencer.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleAnalysis } from './handlers/analysis.js';
import type { ScrapeProgressMessage } from './types.js';

// Open the full app in a new tab when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  console.log('[Background] Icon clicked, opening full app in a new tab');
  const url = chrome.runtime.getURL('fullpage.html');
  chrome.tabs.create({ url });
});

// Centralised message router. Each handler returns a Promise that resolves
// with an `ExtensionResponse` to be sent back to the caller.
const onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
  message,
  sender,
  sendResponse,
) => {
  console.log('[Background] Received:', message.type);

  // SCRAPE_PROGRESS is a one-way stream event from the content script
  // describing how far the SCRAPE_ALL loop has gotten. The full-page UI
  // listens on `chrome.runtime.onMessage` and renders a progress bar;
  // we forward the message to every listening extension page. There is
  // NO sendResponse for these (the listener is fire-and-forget).
  if (message.type === 'SCRAPE_PROGRESS') {
    forwardProgressToExtensionPages(message as ScrapeProgressMessage);
    return false;
  }

  switch (message.type) {
    case 'GET_CONVERSATIONS':
    case 'SCRAPE_CONVERSATIONS':
    case 'SCRAPE_THREAD':
    case 'SCRAPE_THREAD_BY_INDEX':
    case 'SCRAPE_ALL':
    case 'TEST_CONNECTION':
      handleConversations(message, sender).then(sendResponse);
      return true;
    case 'GET_SEQUENCER':
    case 'SAVE_SEQUENCER':
    case 'EXECUTE_SEQUENCE':
      handleSequencer(message, sender).then(sendResponse);
      return true;
    case 'GET_DASHBOARD':
      handleDashboard(message, sender).then(sendResponse);
      return true;
    case 'ANALYZE_MESSAGE':
      handleAnalysis(message, sender).then(sendResponse);
      return true;
    default:
      console.warn('[Background] Unknown message type:', message.type);
      return undefined;
  }
};

chrome.runtime.onMessage.addListener(onMessage);

/**
 * Broadcast a SCRAPE_PROGRESS update to every listening extension page.
 *
 * Content scripts cannot message extension pages directly, so the
 * background service worker is the relay. We use `chrome.runtime.sendMessage`
 * with no `target` - in MV3 that delivers to all extension pages with
 * a matching `onMessage` listener.
 *
 * Failures are swallowed: progress events are advisory and we don't
 * want a single closed tab to spam the console.
 */
function forwardProgressToExtensionPages(
  payload: ScrapeProgressMessage,
): void {
  try {
    chrome.runtime.sendMessage(payload, () => {
      // Suppress "no receivers" / tab-closed errors - these are advisory
      // events and we don't want the activity log to flood.
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.warn('[Background] Failed to forward SCRAPE_PROGRESS:', err);
  }
}

console.log('[Background] LinkedIn AI GTM loaded');
