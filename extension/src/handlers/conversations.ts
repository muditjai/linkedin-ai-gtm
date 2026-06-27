/**
 * Conversations Handler
 * Handles conversation-related operations
 */

import type { ExtensionMessage, ExtensionResponse, Conversation } from '../types.js';

/**
 * Handle conversation operations
 */
export async function handleConversations(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  console.log('[Conversations] Handling message:', message.type);
  
  try {
    switch (message.type) {
      case 'GET_CONVERSATIONS':
        return await getConversations();
      case 'SCRAPE_CONVERSATIONS':
        return await scrapeConversations(message);
      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('[Conversations] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get stored conversations
 */
async function getConversations(): Promise<ExtensionResponse<Conversation[]>> {
  console.log('[Conversations] Getting conversations from storage');
  const result = await chrome.storage.local.get(['conversations']);
  const data = result.conversations || [];
  console.log('[Conversations] Got conversations:', data.length);
  return { success: true, data };
}

/**
 * Scrape conversations from LinkedIn messages page
 */
async function scrapeConversations(
  message: ExtensionMessage
): Promise<ExtensionResponse<number>> {
  console.log('[Conversations] Starting scrape');
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[Conversations] Current tab:', tab.url);

  if (!tab.url || !tab.url.includes('linkedin.com')) {
    console.log('[Conversations] Not on LinkedIn page');
    return { success: false, error: 'Not on LinkedIn page. Please open LinkedIn first.' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SCRAPE_MESSAGES',
      limit: message.limit || 10
    } as ExtensionMessage);

    console.log('[Conversations] Scrape response:', response);

    if (response && response.conversations) {
      await chrome.storage.local.set({ conversations: response.conversations });
      return { success: true, count: response.conversations.length };
    }
    
    return { success: false, error: 'No conversations found' };
  } catch (error) {
    console.error('[Conversations] Scrape error:', error);
    return { success: false, error: 'Failed to scrape: ' + (error as Error).message };
  }
}