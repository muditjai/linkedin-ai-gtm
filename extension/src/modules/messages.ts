/**
 * Messages Module
 * Renders the contacts list and the active conversation thread.
 *
 * The conversation name and preview text originate from scraping LinkedIn's
 * DOM. They are inserted using safe DOM APIs (`textContent`, `createElement`)
 * rather than `innerHTML` to avoid any chance of HTML/JS injection from
 * unexpectedly-formatted profile data.
 */

import type { Conversation } from '../types.js';

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
 * Select and display a conversation in the right-hand thread pane.
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
