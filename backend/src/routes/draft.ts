/**
 * `/api/draft` - AI reply drafting endpoint.
 *
 * Body:
 *   {
 *     threadUrn:        string,
 *     profile?:         string,
 *     lastMessageUrn?:  string,  // messageUrn of the last inbound we're replying to
 *     messages:        Array<{ messageUrn, direction, senderName, content, ... }>
 *   }
 *
 * Response:
 *   { success, draft: { draft, sentiment, tips }, model }
 *
 * The route tries DO Inference first (if `DO_INFERENCE_TOKEN` is set) for
 * speed; on any failure it falls back to Gemini. The `model` field in
 * the response tells the caller which path produced the draft so it can
 * be stored alongside feedback for fine-tuning telemetry.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Feedback } from '../models/Feedback.js';
import { Thread } from '../models/Thread.js';
import { env, hasDoInference } from '../config/env.js';
import { draftReply, type GeminiMessageInput } from '../services/gemini.js';
import { draftReplyWithDo } from '../services/doInference.js';

const router = Router();

const MessageInput = z.object({
  messageUrn: z.string().min(1),
  direction: z.enum(['inbound', 'outbound']),
  senderName: z.string().default(''),
  content: z.string().default(''),
  timestamp: z.string().default(''),
  dateHeading: z.string().nullable().optional(),
  edited: z.boolean().optional().default(false),
  reactions: z.array(z.string()).optional().default([]),
  sentAt: z.string().datetime().nullable().optional(),
});

const DraftBodySchema = z.object({
  threadUrn: z.string().min(1),
  profile: z.string().optional().default(''),
  lastMessageUrn: z.string().optional().default(''),
  messages: z.array(MessageInput).min(1),
});

/** POST /api/draft  - generate a draft reply for the latest inbound message. */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = DraftBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.errors,
      });
      return;
    }
    const { threadUrn, profile, lastMessageUrn, messages } = parsed.data;
    const castMessages: GeminiMessageInput[] = messages.map((m) => ({
      messageUrn: m.messageUrn,
      direction: m.direction,
      senderName: m.senderName,
      content: m.content,
      timestamp: m.timestamp,
      dateHeading: m.dateHeading ?? null,
    }));

    // Pull prior feedback for the same thread so the prompt learns the
    // user's taste. Cap at last 5.
    const priorFeedback = await Feedback.find({ threadUrn })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const feedback = priorFeedback.map((f) => ({
      score: (f as { score?: number }).score ?? 0,
      comment: (f as { comment?: string }).comment ?? '',
      draft: (f as { draft?: string }).draft ?? '',
    }));

    let usedModel = env.GEMINI_MODEL;
    let draft: { draft: string; sentiment: string; tips: string[] };
    try {
      if (hasDoInference()) {
        usedModel = env.DO_INFERENCE_MODEL;
        draft = await draftReplyWithDo(castMessages, profile, feedback);
        // If DO came back empty (rare), fall through to Gemini.
        if (!draft.draft) throw new Error('empty draft from DO');
      } else {
        throw new Error('DO inference not configured');
      }
    } catch {
      usedModel = env.GEMINI_MODEL;
      draft = await draftReply(castMessages, profile, feedback);
    }

    // Best-effort: store the draft in a Feedback doc with score=0 (i.e.
    // "unrated") so the user can rate it later. We use findOneAndUpdate
    // with upsert on (threadUrn, lastMessageUrn) to avoid duplicate drafts.
    if (lastMessageUrn) {
      try {
        await Feedback.findOneAndUpdate(
          { threadUrn, messageUrn: lastMessageUrn },
          {
            $set: {
              threadUrn,
              messageUrn: lastMessageUrn,
              draft: draft.draft,
              sentiment: draft.sentiment,
              model: usedModel,
            },
            $setOnInsert: { score: 0, comment: '' },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[backend] failed to persist draft for feedback', e);
      }
    }

    // Update the Thread aggregate too so the side panel can show the
    // most-recent draft without re-running Gemini.
    try {
      await Thread.findOneAndUpdate(
        { urn: threadUrn },
        {
          $set: {
            lastScrapedAt: new Date(),
          },
        },
      );
    } catch {
      // ignore
    }

    res.json({ success: true, draft, model: usedModel });
  } catch (err) {
    next(err);
  }
});

export default router;
export { router as draftRouter };
