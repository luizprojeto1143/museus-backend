import { Request, Response } from 'express';
import { prisma } from '../../prisma.js';
import Stripe from 'stripe';

async function findProviderForRequest(req: Request, providerId?: string) {
  const user = (req as any).user;
  const { tenantSlug } = req.params;
  const tenant = tenantSlug ? await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) : null;

  if (providerId) {
    const provider = await prisma.serviceProvider.findUnique({ where: { id: providerId } });
    if (!provider) return null;
    if (tenant && provider.tenantId !== tenant.id) return null;
    if (provider.ownerId !== user.id && user.role !== 'MASTER') return null;
    return provider;
  }

  return prisma.serviceProvider.findFirst({
    where: {
      ownerId: user.id,
      ...(tenant ? { tenantId: tenant.id } : {})
    }
  });
}

export const ProviderDashboardController = {
  // --- Dashboard & Analytics ---
  async getDashboardStats(req: Request, res: Response) {
    try {
      const providerId = req.query.providerId as string;
      const provider = await findProviderForRequest(req, providerId);
      if (!provider) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Receita total baseada em transações concluídas
      const transactions = await prisma.transaction.aggregate({
        where: {
          payeeId: provider.id,
          status: { in: ['PAID', 'RELEASED'] }
        },
        _sum: {
          amount: true
        }
      });
      const totalRevenue = transactions._sum.amount ? Number(transactions._sum.amount) : 0;

      // Média real de avaliações
      const reviews = await prisma.providerReview.aggregate({
        where: { serviceProviderId: provider.id },
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
          serviceProviderId: provider.id,
          createdAt: { gte: today }
        }
      });

      const stats = {
        totalRevenue,
        activeProducts: await prisma.providerProduct.count({ where: { serviceProviderId: provider.id, active: true } }),
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

      const provider = await findProviderForRequest(req, serviceProviderId);
      if (!provider) {
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
          serviceProviderId: provider.id,
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

      const provider = await findProviderForRequest(req, providerId);
      if (!provider) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const products = await prisma.providerProduct.findMany({
        where: { serviceProviderId: provider.id }
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
      const { providerId } = req.body;

      const provider = await findProviderForRequest(req, providerId);
      if (!provider) return res.status(404).json({ error: 'Provider not found' });
      const owner = provider.ownerId ? await prisma.user.findUnique({ where: { id: provider.ownerId } }) : null;
      if (!owner) return res.status(404).json({ error: 'Provider owner not found' });

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
          email: owner.email,
          business_type: 'individual',
          business_profile: {
            name: provider.name,
            product_description: provider.description || 'Cultural Services'
          }
        });
        
        accountId = account.id;

        await prisma.serviceProvider.update({
          where: { id: provider.id },
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
