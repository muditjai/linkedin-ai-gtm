/**
 * LinkedIn AI GTM - Full-Page App Entry Point
 *
 * This is the controller loaded by `fullpage.html` (the page that opens when
 * the user clicks the toolbar icon, per AGENTS.md's "open as a full page"
 * requirement). It wires up tab navigation, button handlers, and the
 * initial data load (dashboard, sequencer, conversations).
 */

import { setupTabs } from './modules/tabs.js';
import { setupButtons } from './modules/buttons.js';
import { loadDashboard } from './modules/dashboard.js';
import { loadSequencer } from './modules/sequencer.js';
import { loadConversations, renderContacts } from './modules/messages.js';

const SCRAPE_LIMIT_MIN = 1;
const SCRAPE_LIMIT_MAX = 100;
const SCRAPE_LIMIT_DEFAULT = 20;

/**
 * Bootstrap the full-page UI. Safe to call once `DOMContentLoaded` fires.
 */
async function init(): Promise<void> {
  console.log('[FullPage] Initializing...');

  window.popupState = {
    conversations: [],
    sequencer: null,
    dashboard: null,
    activeConversation: null,
  };

  setupTabs();
  setupButtons();

  await Promise.all([loadDashboard(), loadSequencer(), loadConversations()]);
  updateConversationCount();
  setStatus('Ready', 'active');

  // Whenever the contacts list is rebuilt, keep the sidebar counter in sync.
  renderContacts();
  console.log('[FullPage] Initialized');
}

/**
 * Update the conversation count badge in the messages sidebar header.
 */
function updateConversationCount(): void {
  const badge = document.getElementById('convCount');
  if (badge) {
    badge.textContent = String(window.popupState.conversations.length);
  }
}

/**
 * Update the global status indicator in the header.
 *
 * Exposed on `window` so other modules can surface scrape / save results
 * without each of them having to find the DOM nodes themselves.
 */
function setStatus(text: string, kind: 'active' | 'error' | 'idle' = 'active'): void {
  const indicator = document.getElementById('statusIndicator');
  const label = document.getElementById('statusText');
  if (label) label.textContent = text;
  if (indicator) {
    indicator.classList.remove('active', 'error', 'idle');
    indicator.classList.add(kind);
  }
}

declare global {
  interface Window {
    setExtensionStatus: typeof setStatus;
  }
}
window.setExtensionStatus = setStatus;

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[FullPage] Init failed:', err);
    setStatus('Init failed', 'error');
  });
});

/**
 * Re-export the configured scrape limits so the buttons module can read
 * them from a single source of truth.
 */
export const SCRAPE_LIMITS = {
  min: SCRAPE_LIMIT_MIN,
  max: SCRAPE_LIMIT_MAX,
  default: SCRAPE_LIMIT_DEFAULT,
} as const;
