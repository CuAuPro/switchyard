import { Router } from 'express';

import { getStats } from '../controllers/systemController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/stats', authenticate, getStats);

export default router;

