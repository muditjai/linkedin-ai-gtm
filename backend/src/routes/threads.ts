/**
 * `/api/threads` - list top-N most-recently-updated threads.
 *
 * The side panel uses this to render the "top 15 threads" list without
 * having to aggregate from the messages collection on every render.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { Thread } from '../models/Thread.js';

const router = Router();

/**
 * GET /api/threads?limit=15
 *   - returns the N most-recently-updated threads sorted by `lastScrapedAt`
 *     descending. `limit` is clamped to [1, 100].
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = Number(req.query.limit ?? 15);
    const limit = Math.min(100, Math.max(1, Number.isFinite(raw) ? raw : 15));

    const docs = await Thread.find()
      .sort({ lastScrapedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, count: docs.length, threads: docs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/threads/:urn  - one thread (404 if missing).
 */
router.get('/:urn', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const urn = decodeURIComponent(req.params.urn ?? '').trim();
    if (!urn) {
      res.status(400).json({ success: false, error: 'urn is required' });
      return;
    }
    const doc = await Thread.findOne({ urn }).lean();
    if (!doc) {
      res.status(404).json({ success: false, error: 'thread not found', urn });
      return;
    }
    res.json({ success: true, thread: doc });
  } catch (err) {
    next(err);
  }
});

export default router;
export { router as threadsRouter };
