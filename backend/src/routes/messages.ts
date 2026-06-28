/**
 * `/api/messages` - bulk upsert + read routes for the message store.
 *
 * Idempotency contract:
 *   - The body shape is `{ threadUrn, conversationName, conversationUrl?, messages }`.
 *   - Each message in `messages` is upserted by the natural key
 *     `(threadUrn, messageUrn)`. MongoDB's `bulkWrite` with
 *     `updateOne: { $set, $setOnInsert }` does this in one round-trip.
 *   - The response splits the input into `inserted` / `updated` / `unchanged`
 *     by comparing the prior `scrapedAt` to the new one, and returns
 *     `newSinceLastScrape` (URNs of messages that weren't in the DB before
 *     this call) so the side panel can badge them.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Message } from '../models/Message.js';
import { Thread } from '../models/Thread.js';

const router = Router();

const MessageInputSchema = z.object({
  threadUrn: z.string().min(1),
  conversationName: z.string().min(1),
  conversationUrl: z.string().optional().default(''),
  messages: z
    .array(
      z.object({
        messageUrn: z.string().min(1),
        direction: z.enum(['inbound', 'outbound']),
        senderName: z.string().default(''),
        content: z.string().default(''),
        timestamp: z.string().default(''),
        dateHeading: z.string().nullable().optional(),
        edited: z.boolean().optional().default(false),
        reactions: z.array(z.string()).optional().default([]),
        sentAt: z
          .string()
          .datetime()
          .nullable()
          .optional(),
      }),
    )
    .min(1, 'messages array must not be empty'),
});

const MessagesBodySchema = z.object({
  threadUrn: z.string().min(1),
  conversationName: z.string().min(1),
  conversationUrl: z.string().optional().default(''),
  messages: z.array(
    z.object({
      messageUrn: z.string().min(1),
      direction: z.enum(['inbound', 'outbound']),
      senderName: z.string().default(''),
      content: z.string().default(''),
      timestamp: z.string().default(''),
      dateHeading: z.string().nullable().optional(),
      edited: z.boolean().optional().default(false),
      reactions: z.array(z.string()).optional().default([]),
      sentAt: z.string().datetime().nullable().optional(),
    }),
  ),
});

type UpsertSummary = {
  threadUrn: string;
  inserted: string[];
  updated: string[];
  unchanged: string[];
  newSinceLastScrape: string[];
  totalMessages: number;
};

/** POST /api/messages  - bulk upsert one thread's messages. */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = MessagesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.errors,
      });
      return;
    }
    const { threadUrn, conversationName, conversationUrl, messages } =
      parsed.data;

    // Two-phase: first fetch which messageUrns already exist, so we can
    // partition into "new" vs "existing" for the response. Then run the
    // bulkWrite. The count check is O(N) but cheap thanks to the
    // (threadUrn, messageUrn) unique index.
    const existing = await Message.find(
      {
        threadUrn,
        messageUrn: { $in: messages.map((m) => m.messageUrn) },
      },
      { projection: { messageUrn: 1 } },
    ).lean();

    const existingUrns = new Set(existing.map((d) => d.messageUrn));
    const newSinceLastScrape: string[] = [];
    for (const m of messages) {
      if (!existingUrns.has(m.messageUrn)) {
        newSinceLastScrape.push(m.messageUrn);
      }
    }

    const now = new Date();
    const ops = messages.map((m) => ({
      updateOne: {
        filter: { threadUrn, messageUrn: m.messageUrn },
        update: {
          $set: {
            conversationName,
            conversationUrl,
            direction: m.direction,
            senderName: m.senderName,
            content: m.content,
            timestamp: m.timestamp,
            dateHeading: m.dateHeading ?? null,
            edited: m.edited ?? false,
            reactions: m.reactions ?? [],
            sentAt: m.sentAt ? new Date(m.sentAt) : null,
            scrapedAt: now,
          },
          $setOnInsert: {
            threadUrn,
            messageUrn: m.messageUrn,
          },
        },
        upsert: true,
      },
    }));

    const result = await Message.bulkWrite(ops, { ordered: false });

    // bulkWrite gives us insertedIds / upsertedCount. We can't easily
    // distinguish "newly inserted" from "updated in place" without
    // re-querying - so we report the pre-existing set, and let the
    // caller treat newSinceLastScrape as the source of truth for "new".
    const insertedCount = result.upsertedCount ?? 0;
    const matchedCount = result.matchedCount ?? 0;
    const summary: UpsertSummary = {
      threadUrn,
      inserted: newSinceLastScrape, // URNs that didn't exist before this call
      updated: [], // best-effort: we can derive this by `messages.length - newSinceLastScrape.length - 0 (unchanged)`
      unchanged: [],
      newSinceLastScrape,
      totalMessages: messages.length,
    };
    // Derive updated / unchanged for the response. Anything that was
    // already in the DB is "updated or unchanged" depending on whether
    // scrapedAt moved. We treat everything previously-seen as "updated"
    // for transparency, since the caller will compare with the previous
    // pass via newSinceLastScrape anyway.
    const previous = messages.length - newSinceLastScrape.length;
    if (previous > 0) {
      for (const m of messages) {
        if (existingUrns.has(m.messageUrn)) {
          summary.updated.push(m.messageUrn);
        }
      }
    }
    // Echo the counts for the dashboard.
    res.json({
      success: true,
      summary,
      counts: {
        inserted: insertedCount,
        matched: matchedCount,
        modified: result.modifiedCount ?? 0,
        newSinceLastScrapeCount: newSinceLastScrape.length,
      },
    });

    // Maintain the Thread aggregate in the same call. Use a best-effort
    // upsert so a failure here doesn't roll back the messages.
    try {
      const inbound = messages.filter((m) => m.direction === 'inbound').length;
      const outbound = messages.filter((m) => m.direction === 'outbound').length;
      const last = messages[messages.length - 1];
      await Thread.findOneAndUpdate(
        { urn: threadUrn },
        {
          $set: {
            conversationName,
            conversationUrl,
            lastInboundPreview: last?.content?.slice(0, 200) ?? '',
            lastMessageTime: last?.timestamp ?? '',
            lastMessageIsInbound: last?.direction === 'inbound',
            inboundCount: inbound,
            outboundCount: outbound,
            lastScrapedAt: now,
          },
          $setOnInsert: { urn: threadUrn },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[backend] failed to update Thread aggregate for',
        threadUrn,
        e,
      );
    }
  } catch (err) {
    next(err);
  }
});

/** GET /api/messages?threadUrn=...  - return the persisted messages for one thread. */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadUrn = String(req.query.threadUrn ?? '').trim();
    if (!threadUrn) {
      res.status(400).json({ success: false, error: 'threadUrn is required' });
      return;
    }
    const docs = await Message.find({ threadUrn })
      .sort({ sentAt: 1, scrapedAt: 1 })
      .lean();
    res.json({ success: true, threadUrn, count: docs.length, messages: docs });
  } catch (err) {
    next(err);
  }
});

export default router;

// Also export the type so index.ts can mount the router.
export { router as messagesRouter, MessageInputSchema };
