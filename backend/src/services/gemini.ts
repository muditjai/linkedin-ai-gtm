/**
 * Gemini 3.1 Pro wrapper - per AGENTS.md "AI Self-Reflection" + "Message
 * generation model" can be Gemini OR a DO-hosted model. Gemini is the
 * default; the DO Inference service is the optional fast-path for
 * message generation (see `./doInference.ts`).
 *
 * Two operations:
 *  - `reflect(messages, profile?)` -> short paragraph + sentiment + tips
 *  - `draftReply(messages, profile?, priorFeedback?)` -> { draft, sentiment, tips }
 *
 * Output is forced to JSON via a `responseSchema`, so the caller can
 * rely on shape without having to regex-parse free text.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { env } from '../config/env.js';

const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Per AGENTS.md: prefer Pro for reflection/drafting. The model name is
// configurable via GEMINI_MODEL so the user can A/B without rebuilding.
const model = client.getGenerativeModel({
  model: env.GEMINI_MODEL,
  generationConfig: {
    temperature: 0.4,
    topP: 0.95,
    maxOutputTokens: 1024,
  },
});

/** Shape of a single LinkedIn message we pass in. */
export interface GeminiMessageInput {
  messageUrn: string;
  direction: 'inbound' | 'outbound';
  senderName: string;
  content: string;
  timestamp?: string;
  dateHeading?: string | null;
}

export interface DraftResult {
  draft: string;
  sentiment: 'positive' | 'neutral' | 'negative' | '';
  tips: string[];
}

export interface ReflectResult {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  tips: string[];
}

const RESPONSE_SCHEMA: unknown = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    sentiment: {
      type: SchemaType.STRING,
      enum: ['positive', 'neutral', 'negative'],
    },
    tips: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    draft: { type: SchemaType.STRING },
  },
  required: ['summary', 'sentiment', 'tips'],
};

function transcript(messages: GeminiMessageInput[]): string {
  return messages
    .map((m) => {
      const head = `${m.direction === 'inbound' ? 'IN' : 'OUT'} | ${m.senderName}${
        m.timestamp ? ` @ ${m.timestamp}` : ''
      }`;
      return `${head}\n${m.content}`;
    })
    .join('\n\n');
}

function feedbackDigest(
  rows: { score: number; comment: string; draft: string }[],
): string {
  if (rows.length === 0) return 'No prior feedback.';
  return rows
    .slice(-5) // last 5
    .map(
      (r, i) =>
        `Example ${i + 1} (user rated ${r.score}/5): "${r.draft.slice(0, 200)}" — user said: ${r.comment || '(no comment)'}`,
    )
    .join('\n');
}

export async function reflect(
  messages: GeminiMessageInput[],
  profile?: string,
): Promise<ReflectResult> {
  const prompt = [
    'You are an AI assistant reviewing a LinkedIn conversation.',
    'Write a 1-2 sentence summary of the current state, classify the overall',
    'sentiment as one of [positive, neutral, negative], and give 1-3 concrete',
    'tips the human could use to respond next. Output JSON only.',
    profile ? `Recipient profile:\n${profile}\n` : '',
    'Conversation transcript (oldest first):',
    transcript(messages),
  ].join('\n');

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA as never,
    },
  });

  const raw = safeJson(result.response.text());
  return {
    summary: str(raw?.summary),
    sentiment:
      (raw?.sentiment as ReflectResult['sentiment']) ?? 'neutral',
    tips: Array.isArray(raw?.tips) ? raw.tips.map(str) : [],
  };
}

export async function draftReply(
  messages: GeminiMessageInput[],
  profile?: string,
  priorFeedback: { score: number; comment: string; draft: string }[] = [],
): Promise<DraftResult> {
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  if (!lastInbound) {
    return { draft: '', sentiment: '', tips: [] };
  }

  const prompt = [
    'You are an AI assistant drafting a LinkedIn reply for the human user.',
    'Write a short, friendly, professional reply in the first person.',
    'Match the human user\'s typical tone (concise, warm, no fluff).',
    'Output JSON only - "draft" is the reply text, "sentiment" is the',
    'inferred sentiment of the inbound message, and "tips" are 1-3 short',
    'follow-up actions the human can take after sending.',
    profile ? `Recipient profile:\n${profile}\n` : '',
    'Prior feedback examples (so you learn the user\'s taste):',
    feedbackDigest(priorFeedback),
    'Latest inbound message to reply to:',
    `${lastInbound.senderName}${lastInbound.timestamp ? ` @ ${lastInbound.timestamp}` : ''}:\n${lastInbound.content}`,
  ].join('\n');

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA as never,
    },
  });

  const raw = safeJson(result.response.text());
  return {
    draft: str(raw?.draft),
    sentiment:
      (raw?.sentiment as DraftResult['sentiment']) ?? '',
    tips: Array.isArray(raw?.tips) ? raw.tips.map(str) : [],
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
