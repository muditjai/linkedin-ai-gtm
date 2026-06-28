/**
 * DigitalOcean Inference wrapper - the optional fast-path for message
 * generation per AGENTS.md "Message generation model: Use an LLM from
 * the DigitalOcean model list, e.g. `gpt-oss-20b`".
 *
 * If `DO_INFERENCE_TOKEN` is unset we throw so the caller can fall back
 * to Gemini. The OpenAI SDK is OpenAI-API compatible which is exactly
 * what DO Inference exposes.
 */

import OpenAI from 'openai';
import { env, hasDoInference } from '../config/env.js';
import type { DraftResult, GeminiMessageInput } from './gemini.js';

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  if (!hasDoInference()) {
    throw new Error(
      'DO_INFERENCE_TOKEN is empty - cannot use DigitalOcean Inference. ' +
        'Set DO_INFERENCE_TOKEN in .env.local, or fall back to Gemini.',
    );
  }
  cachedClient = new OpenAI({
    apiKey: env.DO_INFERENCE_TOKEN,
    baseURL: env.DO_INFERENCE_BASE_URL,
  });
  return cachedClient;
}

export async function draftReplyWithDo(
  messages: GeminiMessageInput[],
  profile?: string,
  priorFeedback: { score: number; comment: string; draft: string }[] = [],
): Promise<DraftResult> {
  const client = getClient();
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  if (!lastInbound) return { draft: '', sentiment: '', tips: [] };

  const systemPrompt = [
    'You are an AI assistant drafting a LinkedIn reply for the human user.',
    'Reply in the first person, concise, warm, no fluff.',
    'Return JSON with keys { draft: string, sentiment: "positive"|"neutral"|"negative", tips: string[] }.',
    profile ? `Recipient profile:\n${profile}\n` : '',
  ].join('\n');

  const feedbackDigest = priorFeedback
    .slice(-5)
    .map(
      (r) =>
        `- prior draft (user rated ${r.score}/5): "${r.draft.slice(0, 200)}" — user said: ${r.comment || '(no comment)'}`,
    )
    .join('\n');

  const userPrompt = [
    feedbackDigest ? `Prior feedback:\n${feedbackDigest}\n` : '',
    'Latest inbound message to reply to:',
    `${lastInbound.senderName}${lastInbound.timestamp ? ` @ ${lastInbound.timestamp}` : ''}:\n${lastInbound.content}`,
  ].join('\n');

  const completion = await client.chat.completions.create({
    model: env.DO_INFERENCE_MODEL,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? '{}';
  let parsed: { draft?: string; sentiment?: string; tips?: string[] } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // If the model returned non-JSON, treat the whole text as the draft.
    parsed = { draft: text };
  }
  return {
    draft: parsed.draft ?? '',
    sentiment: (parsed.sentiment as DraftResult['sentiment']) ?? '',
    tips: Array.isArray(parsed.tips) ? parsed.tips : [],
  };
}
