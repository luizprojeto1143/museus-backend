import { Router } from 'express';
import { MasterEcosystemController } from './master-ecosystem.controller.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role } from '@prisma/client';

const router = Router({ mergeParams: true });

router.get('/stats', authMiddleware, requireRole([Role.MASTER]), MasterEcosystemController.getGlobalStats);
router.get('/reviews/pending', authMiddleware, requireRole([Role.MASTER]), MasterEcosystemController.getPendingVideoReviews);

export default router;
