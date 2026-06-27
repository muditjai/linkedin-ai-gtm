/**
 * Dashboard Module
 * Handles dashboard data
 */

import type { Dashboard, ExtensionMessage } from '../types.js';

/**
 * Load dashboard data
 */
export async function loadDashboard(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_DASHBOARD' } as ExtensionMessage);
    if (response.success) {
      window.popupState.dashboard = response.data as Dashboard;
      renderDashboard(response.data as Dashboard);
    }
  } catch (error) {
    console.error('[Popup] Error loading dashboard:', error);
  }
}

/**
 * Render dashboard data
 */
export function renderDashboard(data: Dashboard): void {
  const setText = (id: string, value: number | string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  setText('statConversations', data.totalConversations);
  setText('statToReply', data.messagesToReply);
  setText('statSent', data.sentMessages);
  setText('statReceived', data.receivedMessages);
  setText('statPositive', data.positiveOutcomes);
  setText('statNegative', data.negativeOutcomes);

  const timeEl = document.getElementById('lastScrapeTime');
  if (timeEl) {
    timeEl.textContent = data.lastScrapeTime 
      ? new Date(data.lastScrapeTime).toLocaleString() 
      : 'Never';
  }
}