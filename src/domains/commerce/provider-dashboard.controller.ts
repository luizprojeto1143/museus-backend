import { Request, Response } from 'express';
import { prisma } from '../../prisma.js';

export const ProviderDashboardController = {
  // --- Dashboard & Analytics ---
  async getDashboardStats(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const providerId = req.query.providerId as string;

      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }

      // Mock Analytics data for now. In reality, we'd query Bookings/Purchases.
      const stats = {
        totalRevenue: 4500.50,
        activeProducts: await prisma.providerProduct.count({ where: { serviceProviderId: providerId } }),
        averageRating: 4.8,
        totalReviews: await prisma.providerReview.count({ where: { serviceProviderId: providerId } }),
        viewsToday: 142 // Mocked heatmap/views metric
      };

      return res.json(stats);
    } catch (error) {
      console.error('Error fetching provider stats:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // --- Products Management ---
  async createProduct(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const { name, description, price, imageUrl, serviceProviderId } = req.body;

      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const product = await prisma.providerProduct.create({
        data: {
          name,
          description,
          price,
          imageUrl,
          serviceProviderId,
          tenantId: tenant.id
        }
      });

      return res.status(201).json(product);
    } catch (error) {
      console.error('Error creating product:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  async getProducts(req: Request, res: Response) {
    try {
      const providerId = req.query.providerId as string;
      const products = await prisma.providerProduct.findMany({
        where: { serviceProviderId: providerId }
      });
      return res.json(products);
    } catch (error) {
      console.error('Error fetching products:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // --- Financial: Stripe Connect Onboarding ---
  async onboardStripe(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const { providerId } = req.body;

      const provider = await prisma.serviceProvider.findUnique({ where: { id: providerId } });
      if (!provider) return res.status(404).json({ error: 'Provider not found' });

      // In a real scenario, we would call:
      // const account = await stripe.accounts.create({ type: 'express' });
      // const accountLink = await stripe.accountLinks.create({ account: account.id, ... });
      // We simulate the flow here.

      // Mock setting the stripeAccountId
      const updatedProvider = await prisma.serviceProvider.update({
        where: { id: providerId },
        data: { stripeAccountId: `acct_simulated_${Date.now()}` }
      });

      return res.json({ 
        message: 'Stripe Onboarding URL Generated', 
        url: `https://connect.stripe.com/express/oauth/authorize?simulated=true`,
        provider: updatedProvider
      });
    } catch (error) {
      console.error('Error in Stripe onboarding:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
