import { Router } from 'express';

import authRoutes from './authRoutes.js';
import serviceRoutes from './serviceRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/services', serviceRoutes);

export default router;
