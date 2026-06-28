/**
 * Sequencer Module
 * Loads and renders the outreach sequencer definition.
 *
 * Step text is rendered with `textContent` rather than `innerHTML` because
 * the user is able to author and edit message content within the sequencer.
 */

import type { Sequencer } from '../types.js';

/**
 * Load the saved sequencer (if any) and render it.
 */
export async function loadSequencer(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SEQUENCER' });
    if (response.success) {
      const sequencer = response.data as Sequencer;
      window.popupState.sequencer = sequencer;
      renderSequencer(sequencer);
    }
  } catch (error) {
    console.error('[Popup] Error loading sequencer:', error);
  }
}

/**
 * Render the sequencer into the dashboard panel.
 */
export function renderSequencer(sequencer: Sequencer): void {
  const nameInput = document.getElementById('sequencerName') as HTMLInputElement | null;
  if (nameInput) nameInput.value = sequencer.name;

  const container = document.getElementById('sequencerSteps');
  if (!container) return;

  container.replaceChildren();

  sequencer.steps.forEach((step, index) => {
    const row = document.createElement('div');
    row.className = 'sequencer-step';
    row.dataset.id = step.id;

    const number = document.createElement('span');
    number.className = 'step-number';
    number.textContent = String(index + 1);
    row.appendChild(number);

    const content = document.createElement('div');
    content.className = 'step-content';

    const type = document.createElement('div');
    type.className = 'step-type';
    type.textContent = step.type;
    content.appendChild(type);

    const detail = document.createElement('div');
    detail.className = 'step-detail';
    detail.textContent = step.content ?? step.prompt ?? `Wait ${step.duration ?? 0} days`;
    content.appendChild(detail);

    row.appendChild(content);
    container.appendChild(row);
  });
}
