/**
 * Sequencer Module
 * Handles sequencer operations
 */

import type { Sequencer, ExtensionMessage } from '../types.js';

/**
 * Load sequencer data
 */
export async function loadSequencer(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SEQUENCER' } as ExtensionMessage);
    if (response.success) {
      (window as unknown as { popupState: { sequencer: Sequencer } }).popupState.sequencer = 
        response.data as Sequencer;
      renderSequencer(response.data as Sequencer);
    }
  } catch (error) {
    console.error('[Popup] Error loading sequencer:', error);
  }
}

/**
 * Render sequencer
 */
export function renderSequencer(sequencer: Sequencer): void {
  const nameInput = document.getElementById('sequencerName') as HTMLInputElement | null;
  if (nameInput) nameInput.value = sequencer.name;

  const container = document.getElementById('sequencerSteps');
  if (container) {
    container.innerHTML = sequencer.steps.map((step, index) => `
      <div class="sequencer-step" data-id="${step.id}">
        <span class="step-number">${index + 1}</span>
        <div class="step-content">
          <div class="step-type">${step.type}</div>
          <div class="step-detail">${step.content || step.prompt || `Wait ${step.duration} days`}</div>
        </div>
      </div>
    `).join('');
  }
}