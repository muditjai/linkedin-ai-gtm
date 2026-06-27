/**
 * Buttons Module
 * Handles button click events
 */

import type { ExtensionMessage, Sequencer } from '../types.js';
import { loadDashboard } from './dashboard.js';
import { loadSequencer, renderSequencer } from './sequencer.js';
import { loadConversations, renderContacts } from './messages.js';

/**
 * Setup button event listeners
 */
export function setupButtons(): void {
  document.getElementById('btnScrape')?.addEventListener('click', scrapeConversations);
  document.getElementById('btnSaveSequencer')?.addEventListener('click', saveSequencer);
  document.getElementById('btnExecute')?.addEventListener('click', executeSequence);
  document.getElementById('btnAddStep')?.addEventListener('click', addSequencerStep);
}

/**
 * Scrape conversations from LinkedIn
 */
async function scrapeConversations(): Promise<void> {
  const btn = document.getElementById('btnScrape') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = 'Scraping...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SCRAPE_CONVERSATIONS',
      limit: 20
    } as ExtensionMessage);

    if (response.success) {
      (window as unknown as { popupState: { conversations: unknown[] } }).popupState.conversations = 
        (response as unknown as { conversations: unknown[] }).conversations || [];
      renderContacts();
      await loadDashboard();
    } else {
      alert('Error: ' + (response as { error: string }).error);
    }
  } catch (error) {
    console.error('[Popup] Error scraping:', error);
    alert('Failed to scrape. Make sure you are on LinkedIn.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scrape Conversations';
  }
}

/**
 * Save sequencer
 */
async function saveSequencer(): Promise<void> {
  const nameInput = document.getElementById('sequencerName') as HTMLInputElement | null;
  if (!nameInput) return;

  const state = (window as unknown as { popupState: { sequencer: { name: string } } }).popupState;
  state.sequencer.name = nameInput.value;

  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SEQUENCER',
      sequencer: state.sequencer
    } as ExtensionMessage);
    alert('Sequencer saved!');
  } catch (error) {
    console.error('[Popup] Error saving sequencer:', error);
    alert('Failed to save sequencer');
  }
}

/**
 * Add new sequencer step
 */
function addSequencerStep(): void {
  const state = window.popupState;
  if (!state.sequencer) return;
  
  const newStep = {
    id: `step_${Date.now()}`,
    type: 'message' as const,
    content: 'New message step...',
    next: null
  };
  state.sequencer.steps.push(newStep);
  renderSequencer(state.sequencer);
}

/**
 * Execute sequence
 */
async function executeSequence(): Promise<void> {
  const btn = document.getElementById('btnExecute') as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = 'Executing...';

  try {
    const state = window.popupState;
    const response = await chrome.runtime.sendMessage({
      type: 'EXECUTE_SEQUENCE',
      sequencer: state.sequencer
    } as ExtensionMessage);
    alert((response as { message: string }).message || 'Sequence executed!');
  } catch (error) {
    console.error('[Popup] Error executing sequence:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Execute Sequence';
  }
}