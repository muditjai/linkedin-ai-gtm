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
  console.log('[Buttons] Setting up button listeners');
  
  const scrapeBtn = document.getElementById('btnScrape');
  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', () => {
      console.log('[Buttons] Scrape button clicked');
      scrapeConversations();
    });
  }

  const saveBtn = document.getElementById('btnSaveSequencer');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      console.log('[Buttons] Save button clicked');
      saveSequencer();
    });
  }

  const executeBtn = document.getElementById('btnExecute');
  if (executeBtn) {
    executeBtn.addEventListener('click', () => {
      console.log('[Buttons] Execute button clicked');
      executeSequence();
    });
  }

  const addStepBtn = document.getElementById('btnAddStep');
  if (addStepBtn) {
    addStepBtn.addEventListener('click', () => {
      console.log('[Buttons] Add step button clicked');
      addSequencerStep();
    });
  }

  const openFullApp = document.getElementById('openFullApp');
  if (openFullApp) {
    openFullApp.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Buttons] Open full app clicked');
      openFullAppPage();
    });
  }

  console.log('[Buttons] Button listeners set up');
}

/**
 * Scrape conversations from LinkedIn
 */
async function scrapeConversations(): Promise<void> {
  const btn = document.getElementById('btnScrape') as HTMLButtonElement | null;
  if (!btn) {
    console.error('[Buttons] Scrape button not found');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Scraping...';
  console.log('[Buttons] Starting scrape...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SCRAPE_CONVERSATIONS',
      limit: 20
    } as ExtensionMessage);

    console.log('[Buttons] Scrape response:', response);

    if (response.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convs: any = (response as any).conversations || [];
      window.popupState.conversations = convs;
      renderContacts();
      await loadDashboard();
      alert('Scraped ' + window.popupState.conversations.length + ' conversations!');
    } else {
      alert('Error: ' + (response as { error: string }).error);
    }
  } catch (error) {
    console.error('[Buttons] Error scraping:', error);
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
  if (!nameInput) {
    console.error('[Buttons] Sequencer name input not found');
    return;
  }

  if (!window.popupState.sequencer) {
    console.error('[Buttons] No sequencer loaded');
    alert('No sequencer loaded');
    return;
  }

  window.popupState.sequencer.name = nameInput.value;
  console.log('[Buttons] Saving sequencer:', window.popupState.sequencer.name);

  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SEQUENCER',
      sequencer: window.popupState.sequencer
    } as ExtensionMessage);
    alert('Sequencer saved!');
  } catch (error) {
    console.error('[Buttons] Error saving sequencer:', error);
    alert('Failed to save sequencer');
  }
}

/**
 * Add new sequencer step
 */
function addSequencerStep(): void {
  console.log('[Buttons] Adding new step');
  
  if (!window.popupState.sequencer) {
    console.error('[Buttons] No sequencer loaded');
    return;
  }
  
  const newStep = {
    id: `step_${Date.now()}`,
    type: 'message' as const,
    content: 'New message step...',
    next: null
  };
  window.popupState.sequencer.steps.push(newStep);
  renderSequencer(window.popupState.sequencer);
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
    const response = await chrome.runtime.sendMessage({
      type: 'EXECUTE_SEQUENCE',
      sequencer: window.popupState.sequencer
    } as ExtensionMessage);
    alert((response as { message: string }).message || 'Sequence executed!');
  } catch (error) {
    console.error('[Buttons] Error executing sequence:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Execute Sequence';
  }
}

/**
 * Open full app page
 */
async function openFullAppPage(): Promise<void> {
  console.log('[Buttons] Opening full app page');
  try {
    await chrome.runtime.sendMessage({
      type: 'OPEN_FULL_APP'
    } as ExtensionMessage);
  } catch (error) {
    console.error('[Buttons] Error opening full app:', error);
  }
}