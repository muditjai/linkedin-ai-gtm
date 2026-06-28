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

  switch (message.type) {
    case 'GET_CONVERSATIONS':
    case 'SCRAPE_CONVERSATIONS':
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

console.log('[Background] LinkedIn AI GTM loaded');
