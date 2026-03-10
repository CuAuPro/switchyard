import { Router } from 'express';

import authRoutes from './authRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import systemRoutes from './systemRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/services', serviceRoutes);
router.use('/system', systemRoutes);

export default router;
