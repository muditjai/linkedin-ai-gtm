/**
 * Express entry point for the LinkedIn AI GTM service backend.
 *
 * Wires:
 *   - helmet + compression + cors + morgan
 *   - rate limiting per IP
 *   - MongoDB connection (startup-time, not request-time)
 *   - /api/messages, /api/threads, /api/draft, /api/feedback, /api/agent
 *   - /health for k8s probes
 *   - central error handler (4-arg signature required by Express)
 *
 * Per AGENTS.md "No bugs": every dependency is a singleton, every
 * failure path returns JSON (never an HTML error page), and the
 * process exits non-zero on startup failure so the k8s pod's
 * crashLoopBackOff gives a clear "fix your secrets / config" signal.
 */

import express, {
  type Request,
  type Response,
  type ErrorRequestHandler,
} from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, hasDoInference } from './config/env.js';
import { connect, disconnect } from './config/db.js';
import { messagesRouter } from './routes/messages.js';
import { threadsRouter } from './routes/threads.js';
import { draftRouter } from './routes/draft.js';
import { feedbackRouter } from './routes/feedback.js';
import { agentRouter } from './routes/agent.js';

async function main(): Promise<void> {
  // Validate env + connect DB BEFORE we start accepting traffic. If
  // either fails, the process exits non-zero and k8s restarts the pod.
  await connect();

  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(
    morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'),
  );

  // Per-IP rate limit (per AGENTS.md "always prefer typed languages" -
  // a typed limiter is a small but real defence-in-depth).
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many requests' },
    }),
  );

  // --- Routes ---
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      status: 'ok',
      env: env.NODE_ENV,
      ai: {
        gemini: env.GEMINI_MODEL,
        doInference: hasDoInference() ? env.DO_INFERENCE_MODEL : 'disabled',
      },
    });
  });

  app.use('/api/messages', messagesRouter);
  app.use('/api/threads', threadsRouter);
  app.use('/api/draft', draftRouter);
  app.use('/api/feedback', feedbackRouter);
  app.use('/api/agent', agentRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // Central error handler. Express needs the 4-arg signature to
  // recognise this as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('[backend] Unhandled error:', err);
    const message =
      err instanceof Error ? err.message : 'Internal server error';
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: message });
    }
  };
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[backend] Listening on :${env.PORT} (env=${env.NODE_ENV}, ` +
        `gemini=${env.GEMINI_MODEL}, ` +
        `doInference=${hasDoInference() ? env.DO_INFERENCE_MODEL : 'disabled'})`,
    );
  });

  // Graceful shutdown - k8s sends SIGTERM and waits for the pod to
  // stop accepting traffic before killing.
  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[backend] ${signal} received, shutting down...`);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('[backend] HTTP server closed');
    });
    try {
      await disconnect();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[backend] Error during MongoDB disconnect:', e);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[backend] Fatal startup error:', err);
  process.exit(1);
});
