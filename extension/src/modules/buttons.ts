/**
 * Buttons Module
 * Wires up the click handlers used by the full-page UI.
 *
 * Element IDs referenced here must match those in `fullpage.html`.
 */

import type { Conversation, ExtensionMessage, ExtensionResponse } from '../types.js';
import { loadDashboard } from './dashboard.js';
import { renderSequencer } from './sequencer.js';
import { renderContacts } from './messages.js';

const DEFAULT_SCRAPE_LIMIT = 20;
const SCRAPE_LIMIT_MIN = 1;
const SCRAPE_LIMIT_MAX = 100;

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
 *
 * Reads the requested count from `#scrapeCount` if available, otherwise
 * falls back to the default.
 */
async function scrapeConversations(): Promise<void> {
  const btn = document.getElementById('btnScrape') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Scrape Conversations';
  btn.textContent = 'Scraping...';
  setStatus('Scraping...', 'active');

  try {
    const limit = readScrapeLimit();
    const response = (await chrome.runtime.sendMessage({
      type: 'SCRAPE_CONVERSATIONS',
      limit,
    } as ExtensionMessage)) as ExtensionResponse;

    if (response.success) {
      window.popupState.conversations = (response.data as Conversation[]) ?? [];
      renderContacts();
      await loadDashboard();
      setStatus(`Scraped ${window.popupState.conversations.length} conversations`, 'active');
      updateConversationCount();
    } else {
      console.error('[Buttons] Scrape failed:', response.error);
      setStatus(`Scrape failed: ${response.error ?? 'unknown'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error scraping:', error);
    setStatus('Scrape failed. Are you on LinkedIn?', 'error');
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
    setStatus('No sequencer loaded', 'error');
    return;
  }

  sequencer.name = nameInput.value;
  setStatus('Saving sequencer...', 'active');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SAVE_SEQUENCER',
      sequencer,
    } as ExtensionMessage)) as ExtensionResponse;

    if (response.success) {
      setStatus('Sequencer saved', 'active');
    } else {
      setStatus(`Save failed: ${response.error ?? 'unknown'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error saving sequencer:', error);
    setStatus('Failed to save sequencer', 'error');
  }
}

/**
 * Append a new default message step to the in-memory sequencer and re-render.
 */
function addSequencerStep(): void {
  const sequencer = window.popupState.sequencer;
  if (!sequencer) {
    setStatus('No sequencer loaded', 'error');
    return;
  }

  sequencer.steps.push({
    id: `step_${Date.now()}`,
    type: 'message',
    content: 'New message step...',
    next: null,
  });
  renderSequencer(sequencer);
  setStatus(`Step ${sequencer.steps.length} added`, 'active');
}

/**
 * Trigger sequence execution.
 *
 * NOTE: This is a stub until Phase 2 (service backend) is implemented. We
 * surface the placeholder message in the header instead of a modal alert.
 */
async function executeSequence(): Promise<void> {
  const btn = document.getElementById('btnExecute') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Execute';
  btn.textContent = 'Executing...';

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'EXECUTE_SEQUENCE',
      sequencer: window.popupState.sequencer,
    } as ExtensionMessage)) as ExtensionResponse;
    setStatus(response.message ?? 'Sequence executed', response.success ? 'active' : 'error');
  } catch (error) {
    console.error('[Buttons] Error executing sequence:', error);
    setStatus('Execution failed', 'error');
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

/**
 * Update the header status indicator if `window.setExtensionStatus` is
 * available (it is, once `fullpage.ts` has finished initialising).
 */
function setStatus(text: string, kind: 'active' | 'error' | 'idle' = 'active'): void {
  if (typeof window.setExtensionStatus === 'function') {
    window.setExtensionStatus(text, kind);
    return;
  }
  console.log(`[Buttons][${kind}] ${text}`);
}
