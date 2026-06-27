/**
 * LinkedIn AI GTM - Content Script
 * Handles scraping and interaction with LinkedIn pages
 */

// Prevent multiple injections
if ((window as unknown as { linkedInAIGTMInitialized: boolean }).linkedInAIGTMInitialized) {
  throw new Error('Content script already initialized');
}
(window as unknown as { linkedInAIGTMInitialized: boolean }).linkedInAIGTMInitialized = true;

console.log('[Content] LinkedIn AI GTM loaded');

// Types for content script
interface ContentMessage {
  type: string;
  limit?: number;
  conversationId?: string;
}

interface ContentResponse {
  success: boolean;
  conversations?: ContentConversation[];
  error?: string;
}

interface ContentConversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  avatar: string | null;
  lastMessageAt: string;
  unread: boolean;
}

interface PageInfo {
  url: string;
  path: string;
  pageType: string;
  loggedIn: boolean;
}

// Listen for messages from background/popup
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender: chrome.runtime.MessageSender) => {
      console.log('[Content] Received message:', message.type);

      switch (message.type) {
        case 'SCRAPE_MESSAGES':
          return handleScrapeMessages(message.limit);

        case 'GET_PAGE_INFO':
          return getPageInfo();

        case 'HIGHLIGHT_CONVERSATION':
          highlightConversation(message.conversationId || '');
          return { success: true };

        default:
          console.warn('[Content] Unknown message type:', message.type);
          return { success: false };
      }
    }
  );
} else {
  console.log('[Content] Chrome runtime not available');
}

/**
 * Scrape messages from LinkedIn messages page
 */
function handleScrapeMessages(limit = 10): ContentResponse {
  const conversations: ContentConversation[] = [];

  try {
    // Wait for page to load
    const container = waitForElement('.msg-conversations-container__conversations-list', 5000);
    if (!container) {
      return { success: false, conversations: [], error: 'Messages container not found' };
    }

    // Find conversation elements
    const conversationElements = document.querySelectorAll(
      '.msg-conversations-container__conversation-item'
    );

    for (let i = 0; i < Math.min(conversationElements.length, limit); i++) {
      const element = conversationElements[i];
      const conversation = parseConversation(element);
      if (conversation) {
        conversations.push(conversation);
      }
    }

    console.log('[Content] Scraped', conversations.length, 'conversations');
    return { success: true, conversations };

  } catch (error) {
    console.error('[Content] Error scraping messages:', error);
    return { success: false, conversations: [], error: (error as Error).message };
  }
}

/**
 * Parse a conversation element
 */
function parseConversation(element: Element): ContentConversation | null {
  try {
    const nameEl = element.querySelector('.msg-conversation-listitem__name');
    const previewEl = element.querySelector('.msg-conversation-listitem__message-body');
    const timeEl = element.querySelector('.msg-conversation-listitem__time-offset');
    const avatarEl = element.querySelector('.msg-conversation-listitem__avatar');

    return {
      id: (element as HTMLElement).dataset.conversationId || generateId(),
      name: nameEl?.textContent?.trim() || 'Unknown',
      preview: previewEl?.textContent?.trim() || '',
      time: timeEl?.textContent?.trim() || '',
      avatar: avatarEl?.getAttribute('src') || null,
      lastMessageAt: new Date().toISOString(),
      unread: element.classList.contains('msg-conversation-listitem--unread')
    };
  } catch (error) {
    console.error('[Content] Error parsing conversation:', error);
    return null;
  }
}

/**
 * Get current page information
 */
function getPageInfo(): PageInfo {
  const path = window.location.pathname;
  let pageType = 'unknown';

  if (path.includes('/messaging/')) {
    pageType = 'messages';
  } else if (path.includes('/in/')) {
    pageType = 'profile';
  } else if (path.includes('/feed/')) {
    pageType = 'feed';
  }

  return {
    url: window.location.href,
    path,
    pageType,
    loggedIn: !!document.querySelector('.global-nav')
  };
}

/**
 * Highlight a conversation for visibility
 */
function highlightConversation(conversationId: string): void {
  const element = document.querySelector(
    `[data-conversation-id="${conversationId}"]`
  ) as HTMLElement | null;
  
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('linkedin-ai-gtm-highlight');
  }
}

/**
 * Wait for element to exist
 */
function waitForElement(selector: string, timeout = 5000): Element | null {
  const element = document.querySelector(selector);
  if (element) {
    return element;
  }

  return new Promise<Element | null>((resolve) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  }) as unknown as Element | null;
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}