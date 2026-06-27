/**
 * LinkedIn AI GTM - Background Service Worker
 * Main entry point
 */

import { handleConversations } from './handlers/conversations.js';
import { handleSequencer } from './handlers/sequencer.js';
import { handleDashboard } from './handlers/dashboard.js';
import { handleAnalysis } from './handlers/analysis.js';
import type { ExtensionMessage } from './types.js';

// Handle icon click - open full app
chrome.action.onClicked.addListener(() => {
  console.log('[Background] Icon clicked, opening full app');
  chrome.tabs.create({ url: 'fullpage.html' });
});

// Message handler
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender: chrome.runtime.MessageSender, sendResponse) => {
    console.log('[Background] Received:', message.type);
    
    switch (message.type) {
      case 'GET_CONVERSATIONS':
      case 'SCRAPE_CONVERSATIONS':
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
        console.warn('[Background] Unknown:', message.type);
    }
  }
);

console.log('[Background] LinkedIn AI GTM loaded');
