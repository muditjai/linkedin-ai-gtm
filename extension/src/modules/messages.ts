/**
 * Messages Module
 * Renders the contacts list and the active conversation thread.
 *
 * The conversation name and preview text originate from scraping LinkedIn's
 * DOM. They are inserted using safe DOM APIs (`textContent`, `createElement`)
 * rather than `innerHTML` to avoid any chance of HTML/JS injection from
 * unexpectedly-formatted profile data.
 */

import type { Conversation, ConversationMessage, ExtensionResponse } from '../types.js';

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
 * Load conversations from the background service worker and render them.
 */
export async function loadConversations(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' });
    if (response.success) {
      window.popupState.conversations = (response.data as Conversation[]) || [];
      renderContacts();
    }
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
    p2.textContent = 'Scrape from Dashboard';
    empty.appendChild(p2);

    container.appendChild(empty);
    return;
  }

  state.conversations.forEach((conv, index) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.dataset.index = String(index);

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar';
    avatar.textContent = getInitials(conv.name);
    item.appendChild(avatar);

    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = conv.name;
    item.appendChild(name);

    item.addEventListener('click', () => selectConversation(index));
    container.appendChild(item);
  });
}

/**
 * Render the bubble list for a previously-scraped thread. Mirrors the
 * chat-bubble rendering in `modules/buttons.ts`.
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
  // triggers one reflow when we mount it. Without this, each
  // appendChild below forces a reflow and the render of a 25-message
  // thread is visibly janky.
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
 * Select a conversation: paint the cached preview immediately, then fire
 * SCRAPE_THREAD_BY_INDEX so the content script clicks that conversation in
 * the LinkedIn inbox sidebar, waits for the thread to load, and pushes
 * the full message list back via the response.
 */
export function selectConversation(index: number): void {
  const state = window.popupState;
  const conv = state.conversations[index];
  if (!conv) return;

  state.activeConversation = conv;

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
  preview.textContent = conv.preview || 'No messages yet';
  messages.appendChild(preview);
  view.appendChild(messages);

  // 2) Trigger a thread scrape in the background. The content script
  //    will click the conversation in LinkedIn's own UI, wait for the
  //    thread to render, scrape it, and send the messages back.
  setLoadingThread(true);
  void (async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'SCRAPE_THREAD_BY_INDEX',
        index,
      } as unknown as Record<string, unknown>)) as ExtensionResponse<{
        threadId: string | null;
        messages: ConversationMessage[];
      }>;

      console.log(
        '[Messages] SCRAPE_THREAD_BY_INDEX response for conv',
        index,
        '(',
        conv.name,
        '):',
        {
          success: response.success,
          error: response.error,
          threadId: response.data?.threadId,
          messageCount: response.data?.messages?.length,
          firstMessage: response.data?.messages?.[0],
          lastMessage: response.data?.messages?.[
            (response.data?.messages?.length ?? 1) - 1
          ],
        },
      );

      if (response.success && response.data?.messages) {
        const { threadId, messages: threadMessages } = response.data;
        // Cache so a later re-select is instant.
        if (threadId) {
          state.threads = state.threads ?? {};
          state.threads[threadId] = threadMessages;
        }
        state.threadMessages = threadMessages;
        state.activeThreadId = threadId ?? null;
        renderThreadMessages(view, threadMessages, threadId ?? null, conv);
      } else {
        console.warn(
          '[Messages] Thread-by-index scrape failed:',
          response.error ?? 'no messages in response',
        );
      }
    } catch (err) {
      console.error('[Messages] SCRAPE_THREAD_BY_INDEX error:', err);
    } finally {
      setLoadingThread(false);
    }
  })();
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
