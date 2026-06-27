/**
 * Sequencer Handler
 * Handles sequencer-related operations
 */

import type { ExtensionMessage, ExtensionResponse, Sequencer } from '../types.js';
import { getDefaultSequencer } from '../utils/sequencer.js';

/**
 * Handle sequencer operations
 */
export async function handleSequencer(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  try {
    switch (message.type) {
      case 'GET_SEQUENCER':
        return await getSequencer();
      case 'SAVE_SEQUENCER':
        return await saveSequencer(message);
      case 'EXECUTE_SEQUENCE':
        return await executeSequence(message);
      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('[Sequencer] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get sequencer definition
 */
async function getSequencer(): Promise<ExtensionResponse<Sequencer>> {
  const result = await chrome.storage.local.get(['sequencer']);
  return { 
    success: true, 
    data: result.sequencer || getDefaultSequencer() 
  };
}

/**
 * Save sequencer definition
 */
async function saveSequencer(
  message: ExtensionMessage
): Promise<ExtensionResponse> {
  if (!message.sequencer) {
    return { success: false, error: 'No sequencer provided' };
  }
  
  const sequencer = {
    ...message.sequencer,
    updatedAt: new Date().toISOString()
  };
  
  await chrome.storage.local.set({ sequencer });
  return { success: true };
}

/**
 * Execute sequencer for a conversation
 */
async function executeSequence(
  _message: ExtensionMessage
): Promise<ExtensionResponse> {
  // Phase 2: Connect to service backend
  return { 
    success: true, 
    message: 'Sequencer execution requires service backend (Phase 2)' 
  };
}