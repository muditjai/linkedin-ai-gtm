/**
 * `/api/feedback` - record user feedback on a draft + list prior feedback.
 *
 * Per AGENTS.md "Feedback Storage" - we save each piece of feedback
 * (score 1-5 + comment) so future model calls can use prior examples
 * for the same thread / person.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Feedback } from '../models/Feedback.js';

const router = Router();

const FeedbackBodySchema = z.object({
  threadUrn: z.string().min(1),
  messageUrn: z.string().default(''),
  draft: z.string().default(''),
  sentiment: z.string().default(''),
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().default(''),
  model: z.string().default(''),
});

/** POST /api/feedback  - upsert feedback keyed by (threadUrn, messageUrn). */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = FeedbackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.errors,
      });
      return;
    }
    const fb = parsed.data;
    // If messageUrn is empty we use threadUrn as a stable key. The
    // Feedback model indexes on threadUrn but not (threadUrn, messageUrn),
    // so we use findOneAndUpdate with a manual filter - the simplest
    // idempotency for a v1.
    const filter = fb.messageUrn
      ? { threadUrn: fb.threadUrn, messageUrn: fb.messageUrn }
      : { threadUrn: fb.threadUrn, draft: fb.draft };

    const doc = await Feedback.findOneAndUpdate(
      filter,
      {
        $set: {
          threadUrn: fb.threadUrn,
          messageUrn: fb.messageUrn,
          draft: fb.draft,
          sentiment: fb.sentiment,
          score: fb.score,
          comment: fb.comment,
          model: fb.model,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, feedback: doc });
  } catch (err) {
    next(err);
  }
});

/** GET /api/feedback?threadUrn=...  - list prior feedback for a thread. */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadUrn = String(req.query.threadUrn ?? '').trim();
    if (!threadUrn) {
      res.status(400).json({ success: false, error: 'threadUrn is required' });
      return;
    }
    const rows = await Feedback.find({ threadUrn })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({ success: true, count: rows.length, feedback: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
export { router as feedbackRouter };
