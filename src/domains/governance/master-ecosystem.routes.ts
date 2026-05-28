import { Router } from 'express';
import { MasterEcosystemController } from './master-ecosystem.controller.js';

const router = Router({ mergeParams: true });

router.get('/stats', MasterEcosystemController.getGlobalStats);
router.get('/reviews/pending', MasterEcosystemController.getPendingVideoReviews);

export default router;
