/**
 * `/api/threads` - thread aggregation + context-source routes.
 *
 * The side panel uses these endpoints to:
 *   - Render the "top N" thread list (most-recently-updated first).
 *   - Pull a single thread's profile aggregate.
 *   - Pull per-thread "context sources" (LinkedIn profile, company info,
 *     email history, common connections, social posts, interests, etc.)
 *     so the AI has richer context for drafting replies.
 *
 * Per AGENTS.md Phase 3: most context sources are not yet wired to live
 * data (we don't have a LinkedIn scraper beyond messages, an email
 * integration, or a social-post aggregator). The endpoint therefore
 * returns deterministic stubs derived from the thread's persisted
 * conversationName so the side panel UI is fully functional - we can
 * swap each stub for a real implementation later without changing the
 * route shape.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { Thread } from '../models/Thread.js';
import { Message } from '../models/Message.js';

const router = Router();

/* ---------------------------------------------------------------------------
 * Types
 *
 * Kept inline (not in a shared types file) because this is the only place
 * that mints the context-source payload. The extension mirrors them in
 * `extension/src/modules/api.ts`.
 * ------------------------------------------------------------------------- */

interface LinkedInProfileSource {
  kind: 'linkedin_profile';
  available: boolean;
  name: string;
  headline: string;
  location: string;
  profileUrl: string;
  /** Bullet-list of "About" snippet lines. Empty until the scraper is wired up. */
  about: string[];
  /** Top-of-profile experience rows. */
  experience: Array<{
    title: string;
    company: string;
    duration: string;
  }>;
}

interface CompanySource {
  kind: 'company';
  available: boolean;
  name: string;
  industry: string;
  size: string;
  website: string;
  description: string;
}

interface EmailSource {
  kind: 'email';
  available: boolean;
  /** Last email exchange summary (most recent first). */
  history: Array<{
    subject: string;
    from: string;
    sentAt: string;
    snippet: string;
  }>;
}

interface CommonConnectionSource {
  kind: 'common_connections';
  available: boolean;
  /** People connected to BOTH the user and the recipient. */
  people: Array<{
    name: string;
    headline: string;
    profileUrl: string;
  }>;
}

interface SocialPostSource {
  kind: 'social_posts';
  available: boolean;
  posts: Array<{
    platform: 'linkedin' | 'twitter' | 'facebook' | 'other';
    author: string;
    postedAt: string;
    snippet: string;
    url: string;
  }>;
}

interface InterestSource {
  kind: 'interests';
  available: boolean;
  /** Top-of-list interests extracted from posts / profile / messages. */
  tags: string[];
  /** Whether this recipient is on the user's "prioritise known" list. */
  prioritised: boolean;
}

interface FeedbackSource {
  kind: 'feedback';
  available: boolean;
  /** Last few user feedback rows for this thread (for few-shot prompting). */
  recent: Array<{
    score: number;
    comment: string;
    createdAt: string;
  }>;
}

type ContextSource =
  | LinkedInProfileSource
  | CompanySource
  | EmailSource
  | CommonConnectionSource
  | SocialPostSource
  | InterestSource
  | FeedbackSource;

interface ContextSourcesResponse {
  success: boolean;
  urn: string;
  conversationName: string;
  sources: ContextSource[];
  /** Unix-ms timestamp the payload was assembled (helps cache-busting on the client). */
  assembledAt: number;
}

/* ---------------------------------------------------------------------------
 * Stub builders
 *
 * Real implementations will go behind these functions; keeping them as
 * small named helpers makes the wiring site obvious when we replace them.
 * ------------------------------------------------------------------------- */

function buildLinkedInProfileStub(name: string): LinkedInProfileSource {
  return {
    kind: 'linkedin_profile',
    available: true,
    name,
    headline: 'Headline not yet scraped',
    location: 'Location not yet scraped',
    profileUrl: '',
    about: [],
    experience: [],
  };
}

function buildCompanyStub(name: string): CompanySource {
  return {
    kind: 'company',
    available: true,
    name: name ? `${name}'s current company` : 'Current company',
    industry: 'Unknown',
    size: 'Unknown',
    website: '',
    description: '',
  };
}

function buildEmailStub(): EmailSource {
  return {
    kind: 'email',
    available: false,
    history: [],
  };
}

function buildCommonConnectionsStub(): CommonConnectionSource {
  return {
    kind: 'common_connections',
    available: false,
    people: [],
  };
}

function buildSocialPostsStub(): SocialPostSource {
  return {
    kind: 'social_posts',
    available: false,
    posts: [],
  };
}

/**
 * Naive interest extractor: pull lowercase alpha tokens from the last
 * 10 inbound messages, drop the noise words, and keep the top 5 by
 * frequency. Real implementation will mix in profile / post data.
 */
function extractInterestsFromMessages(
  messages: Array<{ content: string; direction: 'inbound' | 'outbound' }>,
): string[] {
  const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with',
    'that', 'this', 'have', 'has', 'was', 'were', 'they', 'them',
    'from', 'will', 'would', 'could', 'should', 'about', 'what',
    'when', 'where', 'which', 'who', 'how', 'any', 'all', 'can',
    'just', 'like', 'than', 'then', 'now', 'yes', 'yeah', 'ok',
    'okay', 'sure', 'thanks', 'thank', 'please', 'great', 'good',
  ]);
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.direction !== 'inbound') continue;
    const tokens = m.content.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
    for (const t of tokens) {
      if (STOPWORDS.has(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function buildInterestStub(
  messages: Array<{ content: string; direction: 'inbound' | 'outbound' }>,
): InterestSource {
  const tags = extractInterestsFromMessages(messages);
  return {
    kind: 'interests',
    available: tags.length > 0,
    tags,
    prioritised: false,
  };
}

/* ---------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------- */

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

/**
 * GET /api/threads/:urn/context
 *   - Aggregates context sources for the side panel.
 *   - Returns a deterministic stub for every kind so the client can
 *     always render a complete panel; sources that aren't wired to real
 *     data come back with `available: false`.
 *   - 404 if the thread doesn't exist - the UI distinguishes "no data
 *     yet" from "no thread at all" via this status code.
 */
router.get(
  '/:urn/context',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const urn = decodeURIComponent(req.params.urn ?? '').trim();
      if (!urn) {
        res.status(400).json({ success: false, error: 'urn is required' });
        return;
      }
      const thread = await Thread.findOne({ urn }).lean();
      if (!thread) {
        res
          .status(404)
          .json({ success: false, error: 'thread not found', urn });
        return;
      }

      // Pull the last 25 messages for the interest extractor + the
      // feedback rows from the dedicated collection for the feedback
      // source. We use `.select` projections because these payloads are
      // already small and we don't want to drag the entire message body
      // through the wire when only a snippet is needed.
      const recentMessages = await Message.find({ threadUrn: urn })
        .sort({ sentAt: -1, scrapedAt: -1 })
        .limit(25)
        .select({ content: 1, direction: 1, _id: 0 })
        .lean();

      const { Feedback } = await import('../models/Feedback.js');
      const recentFeedback = await Feedback.find({ threadUrn: urn })
        .sort({ createdAt: -1 })
        .limit(3)
        .select({ score: 1, comment: 1, createdAt: 1, _id: 0 })
        .lean();

      const feedbackSource: FeedbackSource = {
        kind: 'feedback',
        available: recentFeedback.length > 0,
        recent: recentFeedback.map((f) => {
          // Mongoose `lean()` returns `NativeDate` for Date fields; the
          // extension expects ISO strings. Cast to `unknown` first so
          // TypeScript accepts the conversion in both directions.
          const created = (f as unknown as { createdAt?: unknown }).createdAt;
          let createdAt = '';
          if (created instanceof Date) {
            createdAt = created.toISOString();
          } else if (typeof created === 'string' && created.length > 0) {
            createdAt = created;
          }
          return {
            score: (f as { score?: number }).score ?? 0,
            comment: (f as { comment?: string }).comment ?? '',
            createdAt,
          };
        }),
      };

      const sources: ContextSource[] = [
        buildLinkedInProfileStub(thread.conversationName ?? ''),
        buildCompanyStub(thread.conversationName ?? ''),
        buildEmailStub(),
        buildCommonConnectionsStub(),
        buildSocialPostsStub(),
        buildInterestStub(
          recentMessages.map((m) => ({
            content: (m as { content?: string }).content ?? '',
            direction:
              ((m as { direction?: string }).direction as
                | 'inbound'
                | 'outbound') ?? 'inbound',
          })),
        ),
        feedbackSource,
      ];

      const payload: ContextSourcesResponse = {
        success: true,
        urn,
        conversationName: thread.conversationName ?? '',
        sources,
        assembledAt: Date.now(),
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
export { router as threadsRouter };