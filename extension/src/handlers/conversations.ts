/**
 * Conversations Handler
 */

import type { ExtensionMessage, ExtensionResponse, Conversation } from '../types.js';

export async function handleConversations(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  console.log('[Conversations] Handling:', message.type);
  
  switch (message.type) {
    case 'GET_CONVERSATIONS':
      return await getConversations();
    case 'SCRAPE_CONVERSATIONS':
      return await scrapeConversations(message);
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function getConversations(): Promise<ExtensionResponse<Conversation[]>> {
  const result = await chrome.storage.local.get(['conversations']);
  return { success: true, data: result.conversations || [] };
}

async function scrapeConversations(message: ExtensionMessage): Promise<ExtensionResponse<number>> {
  const limit = message.limit || 20;
  console.log('[Conversations] Scraping', limit, 'conversations');
  
  // Find the LinkedIn tab
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  console.log('[Conversations] Found', tabs.length, 'LinkedIn tabs');
  
  if (tabs.length === 0) {
    return { success: false, error: 'No LinkedIn tab found. Please open LinkedIn first.' };
  }
  
  // Use the first LinkedIn tab
  const linkedInTab = tabs[0];
  
  if (!linkedInTab.id) {
    return { success: false, error: 'LinkedIn tab not accessible' };
  }
  
  try {
    // Send message to content script on LinkedIn tab
    const response = await chrome.tabs.sendMessage(linkedInTab.id, {
      type: 'SCRAPE_CONVERSATIONS',
      limit: limit
    });
    
    console.log('[Conversations] Got response:', response);
    
    if (response && response.conversations) {
      // Store in local storage
      await chrome.storage.local.set({ conversations: response.conversations });
      return { success: true, count: response.conversations.length };
    }
    
    return { success: false, error: response?.error || 'No conversations found' };
  } catch (error) {
    console.error('[Conversations] Error:', error);
    return { success: false, error: 'Failed to scrape. Make sure LinkedIn messages page is loaded.' };
  }
}
