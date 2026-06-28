/**
 * Buttons Module
 *
 * Wires up the click handlers used by the full-page UI. Status messages
 * are pushed to the activity log at the bottom of the page via
 * `window.logExtensionStatus` (set up by `fullpage.ts`).
 */

import type { Conversation, ExtensionMessage, ExtensionResponse, LogKind } from '../types.js';
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

  onClick('btnScrapeAll', () => {
    void scrapeAll();
  });
  onClick('btnScrape', () => {
    void scrapeConversations();
  });
  onClick('btnScrapeThread', () => {
    void scrapeThread();
  });
  onClick('btnTestConnection', () => {
    void testConnection();
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
 * Combined Scrape All: auto-scroll the inbox AND scrape the current
 * thread (if one is open) in a single round-trip. Updates the inbox list
 * AND the thread pane at once, and surfaces scroll iterations + counts in
 * the activity log so the user can see what happened.
 */
async function scrapeAll(): Promise<void> {
  const btn = document.getElementById('btnScrapeAll') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Scrape All (with scroll)';
  const limit = readScrapeLimit();
  btn.textContent = 'Scraping…';
  logStatus(`Scrape All requested (limit=${limit})…`, 'info');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SCRAPE_ALL',
      limit,
    } as ExtensionMessage)) as ExtensionResponse<{
      conversations: Conversation[];
      threadId: string | null;
      messages: ConversationMessage[];
      scrollIterations: number;
    }>;

    if (response.success && response.data) {
      const { conversations, messages, threadId, scrollIterations } = response.data;

      if (conversations) {
        window.popupState.conversations = conversations;
        renderContacts();
        updateConversationCount();
        const convCountEl = document.getElementById('conversationCount');
        if (convCountEl) convCountEl.textContent = String(conversations.length);
      }

      if (messages && messages.length > 0) {
        window.popupState.threadMessages = messages;
        window.popupState.activeThreadId = threadId ?? null;
        renderThread(messages, threadId ?? null);
        updateThreadCount(messages.length);
      }

      const itersEl = document.getElementById('scrollIterations');
      if (itersEl) itersEl.textContent = String(scrollIterations ?? 0);

      recordScrape();
      await loadDashboard();
      logStatus(
        `Scrape All complete: ${conversations?.length ?? 0} conversations ` +
          `(scrolled ${scrollIterations ?? 0}×) + ${messages?.length ?? 0} thread messages.`,
        'success',
      );
    } else {
      logStatus(`Scrape All failed: ${response.error ?? 'unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Scrape All error:', error);
    logStatus(`Scrape All failed: ${(error as Error).message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Scrape every message in the currently-open LinkedIn thread and push them
 * into `popupState` so the right-hand thread pane can render them.
 */
async function scrapeThread(): Promise<void> {
  const btn = document.getElementById('btnScrapeThread') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Scrape Messages';
  btn.textContent = 'Scraping…';
  logStatus('Scrape thread requested (this tab must be a LinkedIn thread page).', 'info');

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SCRAPE_THREAD',
    } as ExtensionMessage)) as ExtensionResponse<ConversationMessage[]> & {
      threadId?: string;
    };

    if (response.success && response.data) {
      const messages = response.data;
      window.popupState.threadMessages = messages;
      window.popupState.activeThreadId = response.threadId ?? null;
      recordScrape();
      renderThread(messages, response.threadId ?? null);
      updateThreadCount(messages.length);
      logStatus(
        `Scraped ${messages.length} message${messages.length === 1 ? '' : 's'} from thread ${response.threadId ?? '(unknown)'}.`,
        'success',
      );
    } else {
      logStatus(`Thread scrape failed: ${response.error ?? 'unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('[Buttons] Error scraping thread:', error);
    logStatus(`Thread scrape failed: ${(error as Error).message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Diagnostic that probes the LinkedIn tab for the content-script
 * loaded flag and reports the result back into the activity log.
 */
async function testConnection(): Promise<void> {
  logStatus('Testing content-script connection...', 'info');
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
    } as ExtensionMessage)) as ExtensionResponse<{
      loaded: boolean;
      loadedAt: number | null;
      url: string;
      hasChromeRuntime: boolean;
    }>;

    const data = response.data;
    const urlEl = document.getElementById('linkedinTabUrl');
    if (urlEl) urlEl.textContent = data?.url ?? '—';

    if (response.success && data?.loaded) {
      logStatus(
        `Content script loaded on ${data.url ?? 'unknown URL'}. Listener is ready.`,
        'success',
      );
    } else {
      logStatus(
        `Content script NOT loaded: ${response.error ?? 'unknown reason'}.`,
        'error',
      );
    }
  } catch (error) {
    console.error('[Buttons] testConnection error:', error);
    logStatus(`Test failed: ${(error as Error).message}`, 'error');
  }
}

/**
 * Render scraped thread messages into the right-hand conversation pane.
 * Safe to call from any state - empty input collapses to the empty state.
 */
function renderThread(
  messages: ConversationMessage[],
  threadId: string | null,
): void {
  const view = document.getElementById('conversationView');
  const title = document.getElementById('threadTitle');
  const badge = document.getElementById('threadBadge');
  if (!view) return;

  view.replaceChildren();

  if (title) {
    title.textContent = threadId
      ? `Thread ${threadId.slice(0, 16)}…`
      : 'Thread';
  }
  if (badge) {
    badge.textContent = String(messages.length);
    badge.classList.toggle('hidden', messages.length === 0);
  }

  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'No messages scraped yet.';
    empty.appendChild(p);
    view.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-3';

  let lastDay: string | null = null;
  messages.forEach((msg, idx) => {
    if (msg.dateHeading && msg.dateHeading !== lastDay) {
      const divider = document.createElement('div');
      divider.className =
        'my-2 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-gray-400';
      divider.textContent = msg.dateHeading;
      list.appendChild(divider);
      lastDay = msg.dateHeading;
    }
    list.appendChild(renderMessageBubble(msg, idx === messages.length - 1));
  });

  view.appendChild(list);
  view.scrollTop = view.scrollHeight;
}

function renderMessageBubble(
  msg: ConversationMessage,
  isLast: boolean,
): HTMLElement {
  const wrapper = document.createElement('div');
  const isOutbound = msg.direction === 'outbound';
  wrapper.className = [
    'flex flex-col gap-1',
    isOutbound ? 'items-end' : 'items-start',
  ].join(' ');

  const meta = document.createElement('div');
  meta.className = 'flex items-center gap-2 text-xs text-gray-500';
  const sender = document.createElement('span');
  sender.className = 'font-semibold text-gray-700';
  sender.textContent = msg.senderName;
  const time = document.createElement('span');
  time.textContent = msg.timestamp;
  meta.appendChild(sender);
  meta.appendChild(time);
  if (msg.edited) {
    const edited = document.createElement('span');
    edited.className = 'italic';
    edited.textContent = '(edited)';
    meta.appendChild(edited);
  }
  if (msg.reactions.length > 0) {
    const reactions = document.createElement('span');
    reactions.textContent = ` ${msg.reactions.join(' ')}`;
    meta.appendChild(reactions);
  }
  wrapper.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = [
    'max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed',
    isOutbound
      ? 'rounded-br-sm bg-brand-600 text-white'
      : 'rounded-bl-sm bg-gray-100 text-gray-900',
    isLast && msg.needsReply ? 'ring-2 ring-amber-400' : '',
  ].join(' ');
  bubble.textContent = msg.content;
  wrapper.appendChild(bubble);

  return wrapper;
}

function updateThreadCount(count: number): void {
  const el = document.getElementById('threadMessageCount');
  if (el) el.textContent = String(count);
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
 *
 * `logExtensionStatus` and `recordScrapeCount` are declared on `Window` in
 * `src/types.ts`. They are optional because `modules/buttons.ts` may be
 * evaluated before `fullpage.ts` has finished wiring them up (e.g. if
 * something fires during the synchronous boot phase).
 * ------------------------------------------------------------------------- */

/**
 * Push a message into the bottom-of-page activity log. Falls back to the
 * console if `fullpage.ts` hasn't initialised yet.
 */
function logStatus(message: string, kind: LogKind = 'info'): void {
  if (window.logExtensionStatus) {
    window.logExtensionStatus(message, kind);
    return;
  }
  console.log(`[Buttons][${kind}] ${message}`);
}

/** Increment the scrape counter shown in the activity panel header. */
function recordScrape(): void {
  window.recordScrapeCount?.();
}
