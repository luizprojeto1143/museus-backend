import { Request, Response } from 'express';
import { prisma } from '../../prisma.js';
import Stripe from 'stripe';
export const ProviderDashboardController = {
  // --- Dashboard & Analytics ---
  async getDashboardStats(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      const providerId = req.query.providerId as string;

      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }

      const provider = await prisma.serviceProvider.findUnique({ where: { id: providerId } });
      if (!provider || (provider.ownerId !== (req as any).user.id && (req as any).user.role !== 'MASTER')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Receita total baseada em transações concluídas
      const transactions = await prisma.transaction.aggregate({
        where: {
          payeeId: providerId,
          status: { in: ['PAID', 'RELEASED'] }
        },
        _sum: {
          amount: true
        }
      });
      const totalRevenue = transactions._sum.amount ? Number(transactions._sum.amount) : 0;

      // Média real de avaliações
      const reviews = await prisma.providerReview.aggregate({
        where: { serviceProviderId: providerId },
        _avg: { rating: true },
        _count: { id: true }
      });
      const averageRating = reviews._avg.rating ? Number(reviews._avg.rating.toFixed(1)) : 0;
      const totalReviews = reviews._count.id;

      // Agendamentos de hoje (substitui o 'viewsToday' mockado)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const bookingsToday = await prisma.booking.count({
        where: {
          serviceProviderId: providerId,
          createdAt: { gte: today }
        }
      });

      const stats = {
        totalRevenue,
        activeProducts: await prisma.providerProduct.count({ where: { serviceProviderId: providerId, active: true } }),
        averageRating,
        totalReviews,
        viewsToday: bookingsToday 
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

      const provider = await prisma.serviceProvider.findUnique({ where: { id: serviceProviderId } });
      if (!provider || (provider.ownerId !== (req as any).user.id && (req as any).user.role !== 'MASTER')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

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

      const provider = await prisma.serviceProvider.findUnique({ where: { id: providerId } });
      if (!provider || (provider.ownerId !== (req as any).user.id && (req as any).user.role !== 'MASTER')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

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

      const provider = await prisma.serviceProvider.findUnique({ where: { id: providerId }, include: { user: true } });
      if (!provider || !provider.user) return res.status(404).json({ error: 'Provider or owner not found' });
      if (provider.ownerId !== (req as any).user.id && (req as any).user.role !== 'MASTER') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Se não temos a chave do Stripe configurada, retornamos um erro claro ao invés de um mock
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ error: 'Stripe is not configured on the server.' });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      let accountId = provider.stripeAccountId;

      // Cria a conta conectada se ainda não existir
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email: provider.user.email,
          business_type: 'individual',
          business_profile: {
            name: provider.name,
            product_description: provider.description || 'Cultural Services'
          }
        });
        
        accountId = account.id;

        await prisma.serviceProvider.update({
          where: { id: providerId },
          data: { stripeAccountId: accountId }
        });
      }

      // Gera o link de onboarding
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/master/dashboard/finances`,
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/master/dashboard/finances`,
        type: 'account_onboarding',
      });

      return res.json({ 
        message: 'Stripe Onboarding URL Generated', 
        url: accountLink.url,
        provider: { ...provider, stripeAccountId: accountId }
      });
    } catch (error) {
      console.error('Error in Stripe onboarding:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
