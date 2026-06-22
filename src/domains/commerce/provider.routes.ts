import { Router } from 'express';
import { ProviderDashboardController } from './provider-dashboard.controller.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role } from '@prisma/client';

const router = Router({ mergeParams: true });

router.use(authMiddleware, requireRole([Role.PRODUCER, Role.MASTER, Role.PRESTADOR]));

// Dashboard Analytics
router.get('/dashboard', ProviderDashboardController.getDashboardStats);

// Products
router.post('/products', ProviderDashboardController.createProduct);
router.get('/products', ProviderDashboardController.getProducts);

// Financial / Stripe Connect
router.post('/stripe/onboard', ProviderDashboardController.onboardStripe);

export default router;
