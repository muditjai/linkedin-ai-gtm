/**
 * Messages Module
 *
 * Renders the Messages-tab contact list (left pane) and the active
 * conversation thread (centre pane). Both panes source data from the
 * service backend (`/api/threads`, `/api/messages`) instead of the
 * LinkedIn scraper so the UI reflects whatever is persisted in MongoDB.
 *
 * - Contact list = `GET /api/threads?limit=N` (the most recently
 *   scraped threads).
 * - Conversation pane = `GET /api/messages?threadUrn=...` for the
 *   selected thread.
 *
 * The NEW pill on a message survives a re-fetch by:
 *   1. The backend tracks `createdAt` (Mongoose timestamps) per message.
 *   2. The buttons module writes the URNs reported by the backend as
 *      "new since last scrape" into `popupState.pendingNewUrns[urn]`
 *      after every Scrape All.
 *   3. When we render a thread, we OR-mark `isNew` from BOTH the
 *      pending list AND a freshness window (5 minutes) on `firstSeenAt`.
 *      After consuming the pending list once, we drop it so a re-view
 *      of the same thread doesn't re-badge the same messages.
 *
 * The conversation name and preview text come straight from the backend
 * (which derives them from the most recent message). They are inserted
 * via safe DOM APIs (`textContent`, `createElement`) rather than
 * `innerHTML` to avoid any chance of HTML/JS injection.
 */

import type {
  Conversation,
  ConversationMessage,
} from '../types.js';
import { THREAD_SELECTED_EVENT } from '../types.js';
import {
  getThreads,
  getMessages as apiGetMessages,
  threadToConversation,
} from './api.js';

/**
 * How long after the backend's `createdAt` a message counts as "fresh"
 * for the NEW pill. Anything older than this on a fresh fetch is NOT
 * marked new (the pending list still wins).
 */
const NEW_PILL_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Show or hide the small "loading thread..." indicator in the contacts
 * sidebar header. Used while a contact-list click is fetching the thread.
 */
function setLoadingThread(loading: boolean): void {
  const el = document.getElementById('loadingThread');
  if (!el) return;
  el.classList.toggle('hidden', !loading);
}

/**
 * Load the contact list from the service backend and render it.
 *
 * Falls back gracefully: if the backend is unreachable we leave the
 * previously-cached list in place rather than wiping it, so the UI
 * never shows an empty state when the only issue is the network.
 */
export async function loadConversations(): Promise<void> {
  try {
    const threads = await getThreads(50);
    if (!threads || threads.length === 0) {
      // No data on the backend yet - keep the existing (possibly stale)
      // list rather than clearing it.
      renderContacts();
      return;
    }
    window.popupState.conversations = threads.map(threadToConversation);
    renderContacts();
  } catch (error) {
    console.error('[Popup] Error loading conversations:', error);
  }
}

/**
 * Render the contacts list. Clears and re-creates nodes safely.
 */
export function renderContacts(): void {
  const container = document.getElementById('contactsList');
  if (!container) return;

  // Reset children without using innerHTML so we don't accidentally
  // re-interpret any prior content as HTML.
  container.replaceChildren();

  const state = window.popupState;
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const p1 = document.createElement('p');
    p1.textContent = 'No conversations';
    empty.appendChild(p1);

    const p2 = document.createElement('p');
    p2.className = 'hint';
    p2.textContent = 'Scrape from Dashboard to populate the backend';
    empty.appendChild(p2);

    container.appendChild(empty);
    return;
  }

  state.conversations.forEach((conv, index) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.dataset.index = String(index);
    if (conv.urn) item.dataset.urn = conv.urn;

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar';
    avatar.textContent = getInitials(conv.name);
    item.appendChild(avatar);

    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = conv.name;
    item.appendChild(name);

    // The unread badge doubles as our "needs reply" indicator: if the
    // backend reports `lastMessageIsInbound` we owe a reply.
    if (conv.unread) {
      const badge = document.createElement('span');
      badge.className =
        'ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700';
      badge.textContent = 'Reply';
      badge.title = 'Inbound - a reply is owed';
      item.appendChild(badge);
    }

    item.addEventListener('click', () => selectConversation(index));
    container.appendChild(item);
  });
}

/**
 * Render the bubble list for messages fetched from the backend.
 *
 * Each message can be flagged with `isNew` either because:
 *   - the just-completed Scrape All reported it as `newSinceLastScrape`
 *     (consumed from `popupState.pendingNewUrns[urn]` once per render),
 *   - or because `firstSeenAt` is within the freshness window.
 */
function renderThreadMessages(
  view: HTMLElement,
  messages: ConversationMessage[],
  threadId: string | null,
  conv: Conversation,
): void {
  console.log(
    '[Messages] renderThreadMessages called for',
    conv.name,
    'with',
    messages.length,
    'messages, threadId=',
    threadId,
  );
  view.replaceChildren();

  const header = document.createElement('div');
  header.className = 'conversation-header';

  const headerAvatar = document.createElement('div');
  headerAvatar.className = 'contact-avatar';
  headerAvatar.textContent = getInitials(conv.name);
  header.appendChild(headerAvatar);

  const info = document.createElement('div');
  info.className = 'contact-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'contact-name';
  nameEl.textContent = conv.name;
  info.appendChild(nameEl);

  if (threadId) {
    const threadEl = document.createElement('div');
    threadEl.className = 'conversation-time';
    threadEl.textContent = `Thread ${threadId.slice(0, 16)}…`;
    info.appendChild(threadEl);
  }

  header.appendChild(info);
  view.appendChild(header);

  // Build the list inside a DocumentFragment so the browser only
  // triggers one reflow when we mount it.
  const list = document.createElement('div');
  list.className = 'flex flex-col gap-3';
  const fragment = document.createDocumentFragment();

  let lastDay: string | null = null;
  for (let idx = 0; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg.dateHeading && msg.dateHeading !== lastDay) {
      const divider = document.createElement('div');
      divider.className =
        'my-2 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-gray-400';
      divider.textContent = msg.dateHeading;
      fragment.appendChild(divider);
      lastDay = msg.dateHeading;
    }
    fragment.appendChild(
      renderMessageBubble(msg, idx === messages.length - 1),
    );
  }
  list.appendChild(fragment);

  view.appendChild(list);
  // Defer the scroll-to-bottom by a frame so the layout has settled
  // and we don't trigger a forced reflow at the same time as the
  // appendChild above.
  requestAnimationFrame(() => {
    view.scrollTop = view.scrollHeight;
  });
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
  if (msg.isNew) {
    // Marked by either the Scrape All -> backend -> pendingNewUrns
    // pipeline, or by the firstSeenAt freshness window. The Messages
    // tab marks it here so the pill survives a backend re-fetch.
    const pill = document.createElement('span');
    pill.className =
      'ml-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700';
    pill.textContent = 'New';
    pill.title =
      'New since the last scrape (the service backend had not seen this message before)';
    meta.appendChild(pill);
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

/**
 * Select a conversation: paint the cached preview, fetch the messages
 * from the backend (`GET /api/messages?threadUrn=...`), then render.
 *
 * Also dispatches `linkedin-ai:thread-selected` on `window` so the AI
 * side panel can sync its selection without importing this module.
 */
export function selectConversation(index: number): void {
  const state = window.popupState;
  const conv = state.conversations[index];
  if (!conv) return;

  state.activeConversation = conv;
  const urn = conv.urn ?? conv.id;

  document.querySelectorAll('.contact-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  const view = document.getElementById('conversationView');
  if (!view) return;

  // 1) Paint the cached preview right away so the UI never goes blank.
  view.replaceChildren();
  const header = document.createElement('div');
  header.className = 'conversation-header';

  const headerAvatar = document.createElement('div');
  headerAvatar.className = 'contact-avatar';
  headerAvatar.textContent = getInitials(conv.name);
  header.appendChild(headerAvatar);

  const info = document.createElement('div');
  info.className = 'contact-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'contact-name';
  nameEl.textContent = conv.name;
  info.appendChild(nameEl);

  const timeEl = document.createElement('div');
  timeEl.className = 'conversation-time';
  timeEl.textContent = conv.time;
  info.appendChild(timeEl);

  header.appendChild(info);
  view.appendChild(header);

  const messages = document.createElement('div');
  messages.className = 'conversation-messages';

  const preview = document.createElement('div');
  preview.className = 'message-preview';
  preview.textContent = conv.preview || 'Loading messages from backend…';
  messages.appendChild(preview);
  view.appendChild(messages);

  // Notify the side panel of the selection. Dispatched early so the
  // panel can start its context fetch in parallel with ours.
  emitThreadSelected(urn, conv);

  // 2) Fetch the persisted messages from the backend.
  setLoadingThread(true);
  void (async () => {
    try {
      const fetched = await apiGetMessages(urn);
      const withNew = applyNewPillFlags(urn, fetched);
      // Mark the most recent inbound message as needsReply so the
      // bubble gets the amber ring on render.
      const lastInboundIdx = findLastInboundIndex(withNew);
      if (lastInboundIdx >= 0) {
        withNew[lastInboundIdx] = {
          ...withNew[lastInboundIdx],
          needsReply: lastInboundIdx === withNew.length - 1,
        };
      }

      console.log(
        '[Messages] Backend fetch for',
        conv.name,
        'returned',
        withNew.length,
        'messages (',
        withNew.filter((m) => m.isNew).length,
        'new).',
      );

      state.threadMessages = withNew;
      state.activeThreadId = urn;
      state.threads[urn] = withNew;
      renderThreadMessages(view, withNew, urn, conv);

      // Update the thread badge in the header to show the message count.
      const badge = document.getElementById('threadBadge');
      if (badge) {
        badge.textContent = String(withNew.length);
        badge.classList.toggle('hidden', withNew.length === 0);
      }
      const title = document.getElementById('threadTitle');
      if (title) title.textContent = conv.name;
    } catch (err) {
      console.error('[Messages] Backend thread fetch error:', err);
      const errEl = view.querySelector('.conversation-messages');
      if (errEl) {
        errEl.replaceChildren();
        const p = document.createElement('p');
        p.className = 'text-xs text-rose-600';
        p.textContent =
          'Could not load messages from the backend. Make sure the service is running and try again.';
        errEl.appendChild(p);
      }
    } finally {
      setLoadingThread(false);
    }
  })();
}

/**
 * Decide which messages should display a NEW pill on this render.
 *
 * Two signals contribute:
 *   1. `pendingNewUrns[urn]` - the URNs the backend reported as
 *      `newSinceLastScrape` in the most recent Scrape All. We consume
 *      this list once (delete the entry) so re-opening the same
 *      thread doesn't re-badge the same messages.
 *   2. A freshness window on `firstSeenAt` (5 minutes) so any message
 *      that was added very recently by another code path still gets
 *      the pill. This is mostly defensive - the pending list normally
 *      covers everything.
 */
function applyNewPillFlags(
  urn: string,
  messages: ConversationMessage[],
): ConversationMessage[] {
  const pending = window.popupState.pendingNewUrns ?? {};
  const pendingSet = new Set(pending[urn] ?? []);
  if (pendingSet.size > 0) {
    // Consume once - the next view won't re-badge these messages.
    delete pending[urn];
  }
  const now = Date.now();
  return messages.map((m) => {
    let isNew = pendingSet.has(m.id);
    if (!isNew && m.firstSeenAt) {
      const ts = Date.parse(m.firstSeenAt);
      if (Number.isFinite(ts) && now - ts < NEW_PILL_FRESHNESS_MS) {
        isNew = true;
      }
    }
    return { ...m, isNew };
  });
}

function findLastInboundIndex(messages: ConversationMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].direction === 'inbound') return i;
  }
  return -1;
}

/**
 * Fire the cross-component selection event so the side panel can sync.
 * Kept as a single helper so we don't accidentally fan out two events
 * from different code paths.
 */
function emitThreadSelected(
  urn: string,
  conversation: Conversation,
): void {
  try {
    const detail = { urn, conversation };
    window.dispatchEvent(
      new CustomEvent(THREAD_SELECTED_EVENT, { detail }),
    );
  } catch (err) {
    console.warn('[Messages] Failed to dispatch thread-selected:', err);
  }
}

/**
 * Extract up to two uppercase initials from a contact's name.
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}