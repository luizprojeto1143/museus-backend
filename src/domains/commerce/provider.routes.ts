import { Router } from 'express';
import { ProviderDashboardController } from './provider-dashboard.controller.js';

const router = Router({ mergeParams: true });

// Dashboard Analytics
router.get('/dashboard', ProviderDashboardController.getDashboardStats);

// Products
router.post('/products', ProviderDashboardController.createProduct);
router.get('/products', ProviderDashboardController.getProducts);

// Financial / Stripe Connect
router.post('/stripe/onboard', ProviderDashboardController.onboardStripe);

export default router;
