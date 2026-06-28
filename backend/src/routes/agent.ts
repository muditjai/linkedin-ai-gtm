/**
 * `/api/agent/decide` - STUB. The full LangGraph / DigitalOcean ADK
 * agent backend will be deployed as a separate service per AGENTS.md
 * "Agent Backend: LangGraph-based agent backend". This route exists so
 * the frontend can be wired up against the eventual URL without
 * needing a code change.
 *
 * For now it returns 501 Not Implemented with a clear message.
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

/** POST /api/agent/decide  - decision endpoint for the agent backend (stub). */
router.post('/decide', (req: Request, res: Response) => {
  void req;
  res.status(501).json({
    success: false,
    error:
      'Agent backend not yet wired up. The LangGraph / DigitalOcean ADK ' +
      'service will be deployed separately per AGENTS.md. For now use ' +
      '/api/draft for AI-suggested replies.',
    code: 'AGENT_NOT_IMPLEMENTED',
  });
});

/** GET /api/agent/status  - tiny readiness check (always 200 ok for now). */
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    status: 'agent-backend-not-deployed',
    message: 'LangGraph / DO ADK agent will be deployed separately.',
  });
});

export default router;
export { router as agentRouter };
