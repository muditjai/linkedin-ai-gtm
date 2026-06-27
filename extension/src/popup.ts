/**
 * LinkedIn AI GTM - Popup Controller
 * Main entry point
 */

import { setupTabs } from './modules/tabs.js';
import { setupButtons } from './modules/buttons.js';
import { loadDashboard } from './modules/dashboard.js';
import { loadSequencer } from './modules/sequencer.js';
import { loadConversations } from './modules/messages.js';
import './types/shared.js';

/**
 * Initialize popup
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] Initializing...');
  
  // Initialize state
  window.popupState = {
    conversations: [],
    sequencer: null,
    dashboard: null,
    activeConversation: null
  };

  // Setup UI
  setupTabs();
  setupButtons();

  // Load data
  await loadDashboard();
  await loadSequencer();
  await loadConversations();
});