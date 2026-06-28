/**
 * Buttons Module
 *
 * Wires up the click handlers used by the full-page UI. Status messages
 * are pushed to the activity log at the bottom of the page via
 * `window.logExtensionStatus` (set up by `fullpage.ts`).
 */

import type { Conversation, ExtensionMessage, ExtensionResponse } from '../types.js';
import { loadDashboard } from './dashboard.js';
import { renderSequencer } from './sequencer.js';
import { renderContacts } from './messages.js';

const DEFAULT_SCRAPE_LIMIT = 20;
const SCRAPE_LIMIT_MIN = 1;
const SCRAPE_LIMIT_MAX = 100;

interface ScrapeResponse extends ExtensionResponse {
  data?: Conversation[];
  count?: number;
}

/**
 * Attach click handlers to the action buttons.
 */
export function setupButtons(): void {
  console.log('[Buttons] Setting up button listeners');

  onClick('btnScrape', () => {
    void scrapeConversations();
  });
  onClick('btnSaveSequencer', () => {
    void saveSequencer();
  });
  onClick('btnExecute', () => {
    void executeSequence();
  });
  onClick('btnAddStep', () => {
    addSequencerStep();
  });

  console.log('[Buttons] Button listeners set up');
}

/**
 * Helper that safely attaches a click handler if the element exists.
 */
function onClick(id: string, handler: () => void): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    console.log('[Buttons]', id, 'clicked');
    handler();
  });
}

/**
 * Scrape conversations from the active LinkedIn messaging tab.
 */
async function scrapeConversations(): Promise<void> {
  const btn = document.getElementById('btnScrape') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Scrape Conversations';
  const limit = readScrapeLimit();
  btn.textContent = `Scraping ${limit}…`;
  logStatus(`Scrape requested (limit=${limit})…`, 'info');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SCRAPE_CONVERSATIONS',
      limit,
    } as ExtensionMessage)) as ScrapeResponse;

    if (response.success && response.data) {
      const conversations = response.data;
      window.popupState.conversations = conversations;
      renderContacts();
      updateConversationCount();
      await loadDashboard();
      recordScrape();
      logStatus(
        `Scraped ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}.`,
        'success',
      );
    } else {
      logStatus(`Scrape failed: ${response.error ?? 'unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error scraping:', error);
    logStatus(
      `Scrape failed: ${(error as Error).message}. Reload the LinkedIn tab and try again.`,
      'error',
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Save the current sequencer (after reading the user's name from the input).
 */
async function saveSequencer(): Promise<void> {
  const nameInput = document.getElementById('sequencerName') as HTMLInputElement | null;
  if (!nameInput) return;

  const sequencer = window.popupState.sequencer;
  if (!sequencer) {
    logStatus('No sequencer loaded to save.', 'error');
    return;
  }

  sequencer.name = nameInput.value;
  logStatus(`Saving sequencer "${sequencer.name}"…`, 'info');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SAVE_SEQUENCER',
      sequencer,
    } as ExtensionMessage)) as ExtensionResponse;

    if (response.success) {
      logStatus(`Sequencer "${sequencer.name}" saved.`, 'success');
    } else {
      logStatus(`Save failed: ${response.error ?? 'unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error saving sequencer:', error);
    logStatus(`Save failed: ${(error as Error).message}`, 'error');
  }
}

/**
 * Append a new default message step to the in-memory sequencer and re-render.
 */
function addSequencerStep(): void {
  const sequencer = window.popupState.sequencer;
  if (!sequencer) {
    logStatus('No sequencer loaded.', 'error');
    return;
  }

  sequencer.steps.push({
    id: `step_${Date.now()}`,
    type: 'message',
    content: 'New message step…',
    next: null,
  });
  renderSequencer(sequencer);
  logStatus(`Step ${sequencer.steps.length} added.`, 'info');
}

/**
 * Trigger sequence execution.
 *
 * NOTE: This is a stub until Phase 2 (service backend) is implemented.
 */
async function executeSequence(): Promise<void> {
  const btn = document.getElementById('btnExecute') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Execute';
  btn.textContent = 'Executing…';
  logStatus('Executing sequence…', 'info');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'EXECUTE_SEQUENCE',
      sequencer: window.popupState.sequencer,
    } as ExtensionMessage)) as ExtensionResponse;

    if (response.success) {
      logStatus(response.message ?? 'Sequence executed.', 'success');
    } else {
      logStatus(`Execution failed: ${response.error ?? 'unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error executing sequence:', error);
    logStatus(`Execution failed: ${(error as Error).message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Read the user's requested scrape limit from `#scrapeCount`, clamped to
 * a sane range.
 */
function readScrapeLimit(): number {
  const input = document.getElementById('scrapeCount') as HTMLInputElement | null;
  if (!input) return DEFAULT_SCRAPE_LIMIT;
  const raw = parseInt(input.value, 10);
  if (Number.isNaN(raw)) return DEFAULT_SCRAPE_LIMIT;
  return Math.min(SCRAPE_LIMIT_MAX, Math.max(SCRAPE_LIMIT_MIN, raw));
}

/**
 * Update the sidebar conversation counter.
 */
function updateConversationCount(): void {
  const badge = document.getElementById('convCount');
  if (badge) {
    badge.textContent = String(window.popupState.conversations.length);
  }
}

/* -------------------------------------------------------------------------- *
 * Activity log helpers
 * -------------------------------------------------------------------------- */

type LogKind = 'info' | 'success' | 'error' | 'warn';

/**
 * Push a message into the bottom-of-page activity log. Falls back to the
 * console if `fullpage.ts` hasn't initialised yet.
 */
function logStatus(message: string, kind: LogKind = 'info'): void {
  const win = window as Window & {
    logExtensionStatus?: (m: string, k: LogKind) => void;
    recordScrapeCount?: () => void;
  };
  if (typeof win.logExtensionStatus === 'function') {
    win.logExtensionStatus(message, kind);
    return;
  }
  console.log(`[Buttons][${kind}] ${message}`);
}

function recordScrape(): void {
  const win = window as Window & { recordScrapeCount?: () => void };
  if (typeof win.recordScrapeCount === 'function') {
    win.recordScrapeCount();
  }
}
