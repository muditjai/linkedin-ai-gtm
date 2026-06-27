/**
 * LinkedIn AI GTM - Background Service Worker
 * Main entry point - handles message routing
 */

import { handleConversations } from './handlers/conversations.js';
import { handleSequencer } from './handlers/sequencer.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleAnalysis } from './handlers/analysis.js';
import type { ExtensionMessage } from './types.js';

// Message handler for popup and content script communication
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender: chrome.runtime.MessageSender) => {
    console.log('[Background] Received message:', message.type);

    // Handle each message type
    switch (message.type) {
      case 'GET_CONVERSATIONS':
      case 'SCRAPE_CONVERSATIONS':
        handleConversations(message, sender);
        break;

      case 'GET_SEQUENCER':
      case 'SAVE_SEQUENCER':
      case 'EXECUTE_SEQUENCE':
        handleSequencer(message, sender);
        break;

      case 'GET_DASHBOARD':
        handleDashboard(message, sender);
        break;

      case 'ANALYZE_MESSAGE':
        handleAnalysis(message, sender);
        break;

      case 'OPEN_FULL_APP':
        // Open the full app in a new tab
        chrome.tabs.create({ url: 'fullpage.html' });
        break;

      default:
        console.warn('[Background] Unknown message type:', message.type);
    }
  }
);

// Initialize extension
console.log('[Background] LinkedIn AI GTM extension loaded');

// Handle tab updates to refresh status
chrome.tabs.onUpdated.addListener(
  (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('linkedin.com')) {
      console.log('[Background] LinkedIn page detected:', tab.url);
    }
  }
);