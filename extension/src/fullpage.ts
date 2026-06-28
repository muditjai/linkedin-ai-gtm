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
import type { LogKind } from './types.js';

const SCRAPE_LIMIT_MIN = 1;
const SCRAPE_LIMIT_MAX = 100;
const SCRAPE_LIMIT_DEFAULT = 20;
const MAX_LOG_ENTRIES = 200;

interface LogEntry {
  time: number;
  kind: LogKind;
  message: string;
}

const counters = {
  scrapes: 0,
  errors: 0,
};

/**
 * Bootstrap the full-page UI. Safe to call once `DOMContentLoaded` fires.
 */
async function init(): Promise<void> {
  console.log('[FullPage] Initializing...');

  window.popupState = {
    conversations: [],
    threadMessages: [],
    activeThreadId: null,
    threads: {},
    sequencer: null,
    dashboard: null,
    activeConversation: null,
  };

  setupTabs();
  setupButtons();
  wireLogControls();

  logStatus('Full-page UI ready. Open linkedin.com/messaging to scrape.', 'info');
  logStatus('Tip: stay on the messaging tab while scraping.', 'info');

  await Promise.all([loadDashboard(), loadSequencer(), loadConversations()]);
  updateConversationCount();
  renderContacts();

  console.log('[FullPage] Initialized');
}

/**
 * Append a line to the activity log at the bottom of the page. Exposed on
 * `window` so other modules (e.g. `modules/buttons.ts`) can push messages
 * without each having to find the DOM nodes themselves.
 */
function logStatus(message: string, kind: LogKind = 'info'): void {
  const list = document.getElementById('statusLog');
  if (!list) {
    console.log(`[FullPage][${kind}] ${message}`);
    return;
  }

  const entry: LogEntry = { time: Date.now(), kind, message };
  appendLogEntry(list, entry);
  updateCounters(kind);
  list.scrollTop = list.scrollHeight;
}

function appendLogEntry(list: HTMLElement, entry: LogEntry): void {
  const li = document.createElement('li');
  li.className = `log-entry ${entry.kind}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = formatTime(entry.time);
  li.appendChild(time);

  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = entry.message;
  li.appendChild(msg);

  list.appendChild(li);

  // Trim the log so it does not grow unbounded.
  while (list.children.length > MAX_LOG_ENTRIES) {
    list.removeChild(list.firstChild as Node);
  }
}

function updateCounters(kind: LogKind): void {
  if (kind === 'error') {
    counters.errors += 1;
    const el = document.getElementById('counterErrors');
    if (el) el.textContent = String(counters.errors);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * Increment the "Scrapes" counter (called from buttons.ts on success).
 */
export function recordScrape(): void {
  counters.scrapes += 1;
  const el = document.getElementById('counterScrapes');
  if (el) el.textContent = String(counters.scrapes);
}

/**
 * Hook up the "Clear log" button.
 */
function wireLogControls(): void {
  const clear = document.getElementById('btnClearLog');
  const list = document.getElementById('statusLog');
  if (!clear || !list) return;
  clear.addEventListener('click', () => {
    list.replaceChildren();
    logStatus('Log cleared.', 'info');
  });
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

// `logStatus` and `recordScrape` are exposed to other modules via
// `window.logExtensionStatus` / `window.recordScrapeCount`. The
// `Window` interface is augmented in `./types.js`.
window.logExtensionStatus = logStatus;
window.recordScrapeCount = recordScrape;

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[FullPage] Init failed:', err);
    logStatus(`Init failed: ${(err as Error).message}`, 'error');
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
