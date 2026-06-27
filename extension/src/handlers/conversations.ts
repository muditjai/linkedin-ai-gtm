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
  const result = await chrome.storage.local.get(['conversations']);
  return { success: true, data: result.conversations || [] };
}

/**
 * Scrape conversations from LinkedIn messages page
 */
async function scrapeConversations(
  message: ExtensionMessage
): Promise<ExtensionResponse<number>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url?.includes('linkedin.com')) {
    return { success: false, error: 'Not on LinkedIn page' };
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'SCRAPE_MESSAGES',
    limit: message.limit || 10
  } as ExtensionMessage);

  await chrome.storage.local.set({ conversations: response.conversations });

  return { success: true, count: response.conversations?.length || 0 };
}