/**
 * Sequencer Utilities
 *
 * Provides the default sequencer template and helpers for substituting
 * placeholders (such as `{{name}}`) in message steps.
 */

import type { Sequencer, SequencerStep } from '../types.js';

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const DEFAULT_TEMPLATE_VARIABLES: Record<string, string> = {
  name: 'there',
  firstName: 'there',
  company: 'your company',
  role: 'your role',
};

/**
 * Get the default sequencer template used when the user has not yet saved
 * their own.
 */
export function getDefaultSequencer(): Sequencer {
  const now = new Date().toISOString();
  return {
    id: 'default',
    name: 'Default Outreach Sequence',
    steps: [
      {
        id: 'step1',
        type: 'delay',
        duration: 2,
        next: 'step2',
      },
      {
        id: 'step2',
        type: 'message',
        content: 'Hi {{name}}, hope you\'re doing well! I wanted to reach out about...',
        next: 'step3',
      },
      {
        id: 'step3',
        type: 'delay',
        duration: 3,
        next: 'step4',
      },
      {
        id: 'step4',
        type: 'ai_message',
        prompt: 'Generate a friendly follow-up referencing {{company}}.',
        next: null,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a new sequencer step with sensible defaults for its type.
 */
export function createSequencerStep(
  type: SequencerStep['type'],
  config: Partial<SequencerStep> = {},
): SequencerStep {
  const id = `step_${Date.now()}`;
  const defaults: Partial<SequencerStep> = {
    delay: { duration: 1 },
    message: { content: 'New message...' },
    ai_message: { prompt: 'Write a follow-up message.' },
  }[type];

  return {
    id,
    type,
    ...defaults,
    ...config,
    next: null,
  };
}

/**
 * Replace `{{var}}` placeholders in a template string with values supplied
 * in `variables`. Unknown placeholders fall back to the defaults defined
 * above (or remain unchanged if no default exists for that key).
 *
 * The substitution is intentionally simple — it does not support conditional
 * logic or expressions. Keep templates readable; do not put code in them.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string> = {},
): string {
  return template.replace(PLACEHOLDER_REGEX, (_match, key: string) => {
    if (key in variables) return variables[key] ?? '';
    if (key in DEFAULT_TEMPLATE_VARIABLES) return DEFAULT_TEMPLATE_VARIABLES[key] ?? '';
    return `{{${key}}}`;
  });
}

/**
 * Render the body of a sequencer step, applying template substitution. For
 * steps that have no body (delays), returns an empty string.
 */
export function renderStep(
  step: SequencerStep,
  variables: Record<string, string> = {},
): string {
  if (step.type === 'message') return renderTemplate(step.content ?? '', variables);
  if (step.type === 'ai_message') return renderTemplate(step.prompt ?? '', variables);
  return '';
}
