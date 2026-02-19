import { Router } from 'express';

import {
  deploy,
  getServices,
  patchService,
  postService,
  removeService,
  startEnv,
  stopEnv,
  switchEnv,
} from '../controllers/serviceController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getServices);
router.post('/', authenticate, authorize(['admin', 'operator']), postService);
router.patch('/:serviceId', authenticate, authorize(['admin', 'operator']), patchService);
router.post('/:serviceId/deployments', authenticate, authorize(['admin', 'operator']), deploy);
router.post('/:serviceId/switch', authenticate, authorize(['admin', 'operator']), switchEnv);
router.post('/:serviceId/environments/:label/start', authenticate, authorize(['admin', 'operator']), startEnv);
router.post('/:serviceId/environments/:label/stop', authenticate, authorize(['admin', 'operator']), stopEnv);
router.delete('/:serviceId', authenticate, authorize(['admin', 'operator']), removeService);

export default router;
