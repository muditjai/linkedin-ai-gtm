/**
 * LinkedIn AI GTM - Content Script
 * Handles scraping LinkedIn pages
 */

interface Conversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  avatar: string | null;
  lastMessageAt: string;
  unread: boolean;
}

interface ScrapeResponse {
  success: boolean;
  conversations?: Conversation[];
  error?: string;
}

// Check if on LinkedIn messages page
function isLinkedInMessagesPage(): boolean {
  return window.location.href.includes('linkedin.com/messaging');
}

// Handle messages from background or popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Content] Received:', message.type);
  
  switch (message.type) {
    case 'SCRAPE_CONVERSATIONS':
      const result = scrapeConversations(message.limit || 20);
      console.log('[Content] Scrape result:', result);
      sendResponse(result);
      break;
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
});


function scrapeConversations(limit = 20): ScrapeResponse {
  try {
    console.log('[Content] Scraping conversations, limit:', limit);
    
    // Find conversation list items - try multiple selectors
    let items = document.querySelectorAll('.msg-conversations-container__convo-item');
    if (items.length === 0) {
      items = document.querySelectorAll('li[class*="conversation-listitem"]');
    }
    if (items.length === 0) {
      items = document.querySelectorAll('li[data-conversation-id]');
    }
    
    console.log('[Content] Found', items.length, 'items');
    
    if (items.length === 0) {
      return { success: false, error: 'No conversations found. Make sure you are on LinkedIn messages page.' };
    }
    
    const conversations: Conversation[] = [];
    
    items.forEach((item, index) => {
      if (index >= limit) return;
      
      // Get name
      const nameEl = item.querySelector('.msg-conversation-listitem__participant-names, h3, [class*="participant"]');
      let name = nameEl?.textContent?.trim() || 'Unknown';
      if (name === 'Unknown') {
        const span = item.querySelector('span');
        name = span?.textContent?.trim() || 'Unknown';
      }
      
      // Get avatar
      const avatarEl = item.querySelector('img');
      const avatar = avatarEl?.src || null;
      
      // Get preview
      const previewEl = item.querySelector('.msg-conversation-card__message-snippet, p, [class*="snippet"]');
      const preview = previewEl?.textContent?.trim() || '';
      
      // Get time
      const timeEl = item.querySelector('time, [class*="time"]');
      const time = timeEl?.textContent?.trim() || '';
      
      // Check unread
      const unread = item.classList.contains('msg-conversations-container__convo-item--unread');
      
      conversations.push({
        id: 'conv_' + index + '_' + Date.now(),
        name,
        avatar,
        preview,
        time,
        lastMessageAt: new Date().toISOString(),
        unread
      });
    });
    
    console.log('[Content] Scraped', conversations.length, 'conversations');
    return { success: true, conversations };
    
  } catch (error) {
    console.error('[Content] Scrape error:', error);
    return { success: false, error: (error as Error).message };
  }
}

console.log('[Content] LinkedIn AI GTM loaded on', window.location.href);
