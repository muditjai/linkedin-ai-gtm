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
import { mountSidePanel, refreshThreadList } from './modules/sidePanel.js';
import type { LogKind, ScrapeProgressMessage } from './types.js';

const SCRAPE_LIMIT_MIN = 1;
const SCRAPE_LIMIT_MAX = 100;
const SCRAPE_LIMIT_DEFAULT = 20;
const MAX_LOG_ENTRIES = 200;
/** How long to leave the 100% "Done" bar on screen before fading it out. */
const PROGRESS_FINISHED_VISIBLE_MS = 1500;

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
  wireProgressBar();
  wireScrapeProgressListener();

  logStatus('Full-page UI ready. Open linkedin.com/messaging to scrape.', 'info');
  logStatus('Tip: stay on the messaging tab while scraping.', 'info');

  await Promise.all([loadDashboard(), loadSequencer(), loadConversations()]);
  updateConversationCount();
  renderContacts();

  // Mount the AI side panel. The panel itself calls the backend; if the
  // backend is unreachable it just shows an empty-state message.
  await mountSidePanel();

  console.log('[FullPage] Initialized');
}

/** Re-fetch the side panel from the backend. Called after Scrape All. */
export async function refreshSidePanel(): Promise<void> {
  await refreshThreadList();
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

/* ---------------------------------------------------------------------------
 * Scrape progress bar
 *
 * The scrape button in the dashboard reveals `#scrapeProgress` (a labelled
 * filled bar). The actual fill animation is driven by SCRAPE_PROGRESS
 * events streamed from the content script via the background. The page-side
 * code only needs to:
 *   1. show the bar when a SCRAPE_ALL begins,
 *   2. update it as events arrive,
 *   3. hide it again after a short delay when the scrape finishes.
 *
 * The start/end helpers are exposed on `window` so `modules/buttons.ts`
 * (which initiates the scrape) can wire them up without importing the
 * DOM nodes directly.
 * ------------------------------------------------------------------------- */

/** Timer for the auto-hide after the "finished" event. */
let progressHideTimer: number | null = null;

/**
 * Cache references to the progress-bar DOM nodes. Returns `null` if any
 * node is missing so the rest of the helpers can no-op safely when the
 * markup has been removed or the page is in an unexpected state.
 */
function getProgressEls(): {
  container: HTMLElement;
  bar: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
} | null {
  const container = document.getElementById('scrapeProgress');
  const bar = document.getElementById('scrapeProgressBar');
  const label = document.getElementById('scrapeProgressLabel');
  const count = document.getElementById('scrapeProgressCount');
  if (!container || !bar || !label || !count) return null;
  return { container, bar, label, count };
}

/**
 * Reveal the progress bar in its initial state. Called from
 * `modules/buttons.ts` immediately before sending the SCRAPE_ALL message
 * so the user sees the bar before the first content-script event lands.
 */
function showScrapeProgress(total: number): void {
  const els = getProgressEls();
  if (!els) return;
  if (progressHideTimer !== null) {
    clearTimeout(progressHideTimer);
    progressHideTimer = null;
  }
  els.container.classList.remove('hidden');
  els.bar.classList.remove('bg-emerald-500', 'bg-rose-500');
  els.bar.classList.add('bg-brand-600');
  els.bar.style.width = '0%';
  els.bar.setAttribute('aria-valuenow', '0');
  els.label.textContent =
    total > 0
      ? `Preparing scrape of ${total} conversation${total === 1 ? '' : 's'}…`
      : 'Preparing scrape…';
  els.count.textContent = `0/${total}`;
}

/**
 * Apply a progress update to the bar. The fill % is `completed / total`,
 * capped at 100 so a finished bar fills cleanly even if a stray "done"
 * event arrives after the 100% mark.
 */
function updateScrapeProgress(payload: ScrapeProgressMessage): void {
  const els = getProgressEls();
  if (!els) return;
  const { completed, total, failed, currentName, phase, message } = payload;
  const safeTotal = total > 0 ? total : 1;
  const processed = Math.min(completed + failed, safeTotal);
  const percent = Math.min(100, Math.round((processed / safeTotal) * 100));
  els.bar.style.width = `${percent}%`;
  els.bar.setAttribute('aria-valuenow', String(percent));
  els.count.textContent = `${processed}/${total}`;

  if (phase === 'finished') {
    els.bar.classList.remove('bg-brand-600', 'bg-rose-500');
    els.bar.classList.add(failed > 0 ? 'bg-rose-500' : 'bg-emerald-500');
    els.label.textContent =
      message ??
      (failed > 0
        ? `Done with ${failed} failure${failed === 1 ? '' : 's'}.`
        : 'Done.');
  } else if (phase === 'thread_done') {
    els.label.textContent =
      message ?? `Thread ${completed}/${total} scraped${currentName ? ` \u2014 ${currentName}` : ''}.`;
  } else if (phase === 'thread_failed') {
    els.bar.classList.remove('bg-emerald-500');
    els.bar.classList.add('bg-rose-500');
    els.label.textContent =
      message ??
      `Thread ${completed + failed}/${total} failed${currentName ? ` \u2014 ${currentName}` : ''}.`;
  } else {
    // `started` phase - the button already showed the bar; nothing else
    // to do here.
    if (message) els.label.textContent = message;
  }
}

/**
 * Hide the progress bar. Called automatically on the `finished` phase
 * after a short delay so the user has a moment to see the 100% bar.
 */
function hideScrapeProgress(): void {
  const els = getProgressEls();
  if (!els) return;
  if (progressHideTimer !== null) {
    clearTimeout(progressHideTimer);
  }
  progressHideTimer = window.setTimeout(() => {
    const fresh = getProgressEls();
    if (fresh) fresh.container.classList.add('hidden');
    progressHideTimer = null;
  }, PROGRESS_FINISHED_VISIBLE_MS);
}

/**
 * Wire the chrome.runtime.onMessage listener for SCRAPE_PROGRESS. Returns
 * `true` synchronously when the listener is async, per Chrome's docs.
 */
function wireScrapeProgressListener(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type !== 'SCRAPE_PROGRESS') return;
    updateScrapeProgress(message as ScrapeProgressMessage);
    if ((message as ScrapeProgressMessage).phase === 'finished') {
      hideScrapeProgress();
    }
  });
}

/**
 * Pre-cache DOM refs and expose helpers on `window`. No-op if the markup
 * is missing (keeps unit tests that load this module without a real DOM
 * from throwing).
 */
function wireProgressBar(): void {
  // Reference once so we can fail fast at startup if the markup is gone.
  getProgressEls();

  // Buttons module calls these on click of #btnScrapeAll.
  window.startScrapeProgress = (total: number) => showScrapeProgress(total);
  window.endScrapeProgress = () => hideScrapeProgress();
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
