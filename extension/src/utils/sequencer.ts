/**
 * Sequencer Utilities
 * Default sequencer template and helpers
 */

import type { Sequencer, SequencerStep } from '../types.js';

/**
 * Get default sequencer template
 */
export function getDefaultSequencer(): Sequencer {
  return {
    id: 'default',
    name: 'Default Outreach Sequence',
    steps: [
      {
        id: 'step1',
        type: 'delay',
        duration: 2,
        next: 'step2'
      },
      {
        id: 'step2',
        type: 'message',
        content: 'Hi {{name}}, hope you\'re doing well! I wanted to reach out about...',
        next: 'step3'
      },
      {
        id: 'step3',
        type: 'delay',
        duration: 3,
        next: 'step4'
      },
      {
        id: 'step4',
        type: 'ai_message',
        prompt: 'Generate a follow-up message',
        next: null
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Create a new sequencer step
 */
export function createSequencerStep(
  type: SequencerStep['type'],
  config: Partial<SequencerStep> = {}
): SequencerStep {
  const id = `step_${Date.now()}`;
  return {
    id,
    type,
    ...config,
    next: null
  };
}