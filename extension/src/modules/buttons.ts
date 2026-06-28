/**
 * Buttons Module
 *
 * Wires up the click handlers used by the full-page UI. Status messages
 * are pushed to the activity log at the bottom of the page via
 * `window.logExtensionStatus` (set up by `fullpage.ts`).
 */

import type {
  Conversation,
  ConversationMessage,
  ExtensionMessage,
  ExtensionResponse,
  LogKind,
} from '../types.js';
import { loadDashboard } from './dashboard.js';
import { renderSequencer } from './sequencer.js';
import { renderContacts } from './messages.js';

const DEFAULT_CONVERSATION_LIMIT = 5;
const CONVERSATION_LIMIT_MIN = 0;
const CONVERSATION_LIMIT_MAX = 20;

interface ScrapeAllData {
  conversations: Conversation[];
  threadId: string | null;
  messages: ConversationMessage[];
  scrollIterations: number;
  threads: Record<string, ConversationMessage[]>;
  threadsScraped: number;
}

/**
 * Attach click handlers to the action buttons.
 */
export function setupButtons(): void {
  console.log('[Buttons] Setting up button listeners');

  onClick('btnScrapeAll', () => {
    void scrapeAll();
  });
  onClick('btnClearMessages', () => {
    clearAllMessageState();
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
 * Combined "Scrape All" action: scrolls the inbox, scrapes the
 * conversation list, optionally opens up to N conversation threads (via
 * LinkedIn's own UI - clicking each conversation) and returns everything
 * in one round-trip.
 */
async function scrapeAll(): Promise<void> {
  const btn = document.getElementById('btnScrapeAll') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent ?? 'Scrape All';
  btn.textContent = 'Scraping…';
  const conversationLimit = readConversationLimit();
  logStatus(
    `Scrape All requested (max ${conversationLimit} conversation${conversationLimit === 1 ? '' : 's'})…`,
    'info',
  );

  try {
    // The "Max conversations" input in the dashboard controls BOTH:
    //   1. how many inbox rows we keep (cap = conversationLimit)
    //   2. how many conversations we click through to scrape their
    //      full message thread (right-hand pane).
    // Sending the value as `conversationLimit` is the canonical name.
    const response = (await chrome.runtime.sendMessage({
      type: 'SCRAPE_ALL',
      conversationLimit,
    } as ExtensionMessage)) as ExtensionResponse<ScrapeAllData> & {
      threads?: Record<string, ConversationMessage[]>;
      threadsScraped?: number;
    };

    if (response.success) {
      const data = response.data;
      const conversations = data?.conversations ?? [];
      const threads = response.threads ?? {};
      const threadsScraped = response.threadsScraped ?? 0;
      const scrollIterations = data?.scrollIterations ?? 0;
      const totalThreadMessages = Object.values(threads).reduce(
        (sum, msgs) => sum + msgs.length,
        0,
      );

      // Inbox list.
      if (conversations.length > 0) {
        window.popupState.conversations = conversations;
        renderContacts();
        updateConversationCount();
        const convCountEl = document.getElementById('conversationCount');
        if (convCountEl) {
          convCountEl.textContent = String(conversations.length);
        }
      }

      // Threads collected by the click-through.
      if (Object.keys(threads).length > 0) {
        renderThreadsIntoState(threads);
        // Render whichever thread is currently active (i.e. matches the
        // open thread page). Fall back to the first one we scraped.
        const activeUrn = data?.threadId ?? Object.keys(threads)[0];
        const activeMessages = activeUrn ? threads[activeUrn] : undefined;
        if (activeMessages) {
          renderThread(activeMessages, activeUrn ?? null);
          updateThreadCount(activeMessages.length);
        }
      }

      const itersEl = document.getElementById('scrollIterations');
      if (itersEl) itersEl.textContent = String(scrollIterations);

      const threadsEl = document.getElementById('threadsScraped');
      if (threadsEl) threadsEl.textContent = String(threadsScraped);

      recordScrape();
      await loadDashboard();
      logStatus(
        `Scrape All complete: ${conversations.length} inbox conversation` +
          `${conversations.length === 1 ? '' : 's'} + ` +
          `${threadsScraped} thread${threadsScraped === 1 ? '' : 's'} ` +
          `(${totalThreadMessages} message${totalThreadMessages === 1 ? '' : 's'}).`,
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
 * Trigger sequence execution. Phase 2 stub.
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

/* -------------------------------------------------------------------------- *
 * Rendering helpers
 * -------------------------------------------------------------------------- */

/**
 * Push the per-conversation thread messages collected by SCRAPE_ALL into
 * `popupState` and pick one to display in the right-hand pane.
 */
function renderThreadsIntoState(
  threads: Record<string, ConversationMessage[]>,
): number {
  const urns = Object.keys(threads);
  if (urns.length === 0) return 0;
  const firstUrn = urns[0];
  const messages = threads[firstUrn] ?? [];
  window.popupState.threadMessages = messages;
  window.popupState.activeThreadId = firstUrn;
  return Object.values(threads).reduce((sum, msgs) => sum + msgs.length, 0);
}

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

function updateConversationCount(): void {
  const badge = document.getElementById('convCount');
  if (badge) {
    badge.textContent = String(window.popupState.conversations.length);
  }
}

/**
 * Read the user's "Max conversations" value from `#conversationLimit`,
 * clamped to [0, 20]. 0 disables thread scraping entirely.
 *
 * The cap drives BOTH the inbox row count AND the number of conversations
 * the scraper clicks through to read their full message history.
 */
function readConversationLimit(): number {
  const input = document.getElementById('conversationLimit') as HTMLInputElement | null;
  if (!input) return DEFAULT_CONVERSATION_LIMIT;
  const raw = parseInt(input.value, 10);
  if (Number.isNaN(raw)) return DEFAULT_CONVERSATION_LIMIT;
  return Math.min(CONVERSATION_LIMIT_MAX, Math.max(CONVERSATION_LIMIT_MIN, raw));
}

/* -------------------------------------------------------------------------- *
 * Activity log helpers
 *
 * `logExtensionStatus` and `recordScrapeCount` are declared on `Window` in
 * `src/types.ts`. They are optional because `modules/buttons.ts` may be
 * evaluated before `fullpage.ts` has finished wiring them up.
 * ------------------------------------------------------------------------- */

function logStatus(message: string, kind: LogKind = 'info'): void {
  if (window.logExtensionStatus) {
    window.logExtensionStatus(message, kind);
    return;
  }
  console.log(`[Buttons][${kind}] ${message}`);
}

/**
 * Wipe all message-related UI state: the inbox list, the active thread,
 * the per-conversation thread cache, the status-card counters, and
 * restore the empty state in the right-hand thread pane.
 *
 * The activity log and the page-level "Scrapes" / "Errors" counters are
 * intentionally NOT reset here - those are session-level audit info.
 */
function clearAllMessageState(): void {
  // popupState
  window.popupState.conversations = [];
  window.popupState.threadMessages = [];
  window.popupState.activeThreadId = null;
  window.popupState.activeConversation = null;

  // Re-render the contact list with the empty state.
  renderContacts();
  updateConversationCount();
  const convCountEl = document.getElementById('conversationCount');
  if (convCountEl) convCountEl.textContent = '0';

  // Restore the right-hand thread pane to the empty state.
  const view = document.getElementById('conversationView');
  if (view) {
    view.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'Cleared. Run Scrape All to repopulate.';
    empty.appendChild(p);
    view.appendChild(empty);
  }

  const title = document.getElementById('threadTitle');
  if (title) title.textContent = 'Select a conversation';
  const badge = document.getElementById('threadBadge');
  if (badge) {
    badge.classList.add('hidden');
    badge.textContent = '0';
  }

  // Reset dashboard-card counters.
  for (const id of [
    'threadMessageCount',
    'scrollIterations',
    'threadsScraped',
  ]) {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  }
  const lastScrapeEl = document.getElementById('lastScrapeTime');
  if (lastScrapeEl) lastScrapeEl.textContent = 'Never';
  const tabUrlEl = document.getElementById('linkedinTabUrl');
  if (tabUrlEl) tabUrlEl.textContent = '—';

  // Also wipe the persisted scrape on the extension side so a re-scrape
  // starts clean. (The inbox scroll position resets when the user
  // navigates away, but persistence could otherwise carry stale rows
  // across sessions.)
  try {
    void chrome.storage.local.remove([
      'conversations',
      'messages',
      'threadId',
      'threadLastScrapedAt',
      'lastScrapeAllAt',
    ]);
  } catch (err) {
    console.warn('[Buttons] Could not clear stored scrape:', err);
  }

  logStatus('Cleared all message state. Click Scrape All to repopulate.', 'info');
}

function recordScrape(): void {
  window.recordScrapeCount?.();
}
