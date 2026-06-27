/**
 * Dashboard Handler
 * Handles dashboard data operations
 */

import type { ExtensionMessage, ExtensionResponse, Dashboard, ConversationMessage } from '../types.js';

/**
 * Handle dashboard operations
 */
export async function handleDashboard(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  try {
    return await getDashboardData();
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get dashboard data
 */
async function getDashboardData(): Promise<ExtensionResponse<Dashboard>> {
  const result = await chrome.storage.local.get([
    'conversations',
    'messages',
    'dashboard'
  ]);

  const conversations = (result.conversations || []) as Array<{ id: string }>;
  const messages = (result.messages || []) as ConversationMessage[];

  const dashboard: Dashboard = {
    totalConversations: conversations.length,
    messagesToReply: messages.filter(m => m.needsReply).length,
    sentMessages: messages.filter(m => m.direction === 'outbound').length,
    receivedMessages: messages.filter(m => m.direction === 'inbound').length,
    positiveOutcomes: messages.filter(m => m.outcome === 'positive').length,
    negativeOutcomes: messages.filter(m => m.outcome === 'negative').length,
    pendingFollowUps: messages.filter(m => m.needsFollowUp).length,
    lastScrapeStatus: 'completed',
    lastScrapeTime: new Date().toISOString()
  };

  return { success: true, data: dashboard };
}