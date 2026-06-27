/**
 * Messages Module
 * Handles conversation list and view
 */

import type { Conversation, ExtensionMessage } from '../types.js';

/**
 * Load conversations
 */
export async function loadConversations(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' } as ExtensionMessage);
    if (response.success) {
      (window as unknown as { popupState: { conversations: Conversation[] } }).popupState.conversations = 
        (response.data as Conversation[]) || [];
      renderContacts();
    }
  } catch (error) {
    console.error('[Popup] Error loading conversations:', error);
  }
}

/**
 * Render contacts list
 */
export function renderContacts(): void {
  const container = document.getElementById('contactsList');
  if (!container) return;

  const state = window.popupState;
  if (!state.conversations.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No conversations</p>
        <p class="hint">Scrape from Dashboard</p>
      </div>`;
    return;
  }

  container.innerHTML = (state.conversations as Conversation[]).map((conv, index) => `
    <div class="contact-item" data-index="${index}">
      <div class="contact-avatar">${getInitials(conv.name)}</div>
      <div class="contact-name">${conv.name}</div>
    </div>
  `).join('');

  container.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0');
      selectConversation(index);
    });
  });
}

/**
 * Select conversation
 */
export function selectConversation(index: number): void {
  const state = window.popupState;
  state.activeConversation = (state.conversations as Conversation[])[index];

  document.querySelectorAll('.contact-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  const conv = state.activeConversation as Conversation;
  const view = document.getElementById('conversationView');
  if (view) {
    view.innerHTML = `
      <div class="conversation-header">
        <div class="contact-avatar">${getInitials(conv.name)}</div>
        <div class="contact-info">
          <div class="contact-name">${conv.name}</div>
          <div class="conversation-time">${conv.time}</div>
        </div>
      </div>
      <div class="conversation-messages">
        <div class="message-preview">${conv.preview || 'No messages yet'}</div>
      </div>
    `;
  }
}

/**
 * Get initials from name
 */
function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}