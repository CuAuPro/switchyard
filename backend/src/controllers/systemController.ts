import { Response } from 'express';

import { getSystemStats } from '../services/systemStats.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export const getStats = async (_req: AuthenticatedRequest, res: Response) => {
  const stats = await getSystemStats();
  res.json(stats);
};

