/**
 * REST routes — used for initial data fetching and health checks.
 * All mutations go through WebSocket; REST is read-only + health.
 */

import { Router, Request, Response } from 'express';
import { getAllTasks } from '../services/taskService';
import { connectionCount } from '../websocket/broadcaster';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    connections: connectionCount(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/tasks', async (_req: Request, res: Response) => {
  try {
    const tasks = await getAllTasks();
    res.json({ tasks });
  } catch (err) {
    console.error('[REST] GET /tasks failed:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

export default router;
