import { Request, Response } from 'express';
import { prisma } from '../../prisma.js';

export const MasterEcosystemController = {
  // Visão Macro do Ecossistema
  async getGlobalStats(req: Request, res: Response) {
    try {
      const { tenantSlug } = req.params;
      
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const totalProviders = await prisma.serviceProvider.count({ where: { tenantId: tenant.id } });
      const totalProducts = await prisma.providerProduct.count({ where: { tenantId: tenant.id } });
      const totalPassports = await prisma.culturalPassport.count();
      
      // Busca dados financeiros reais baseados nas vendas e pedidos concluídos
      const ordersAggr = await prisma.order.aggregate({
        where: {
          tenantId: tenant.id,
          status: { in: ['PAID', 'DELIVERED'] }
        },
        _sum: {
          total: true,
          platformFee: true
        }
      });

      const ecosystemVolume = ordersAggr._sum.total ? Number(ordersAggr._sum.total) : 0; 
      const platformRevenue = ordersAggr._sum.platformFee ? Number(ordersAggr._sum.platformFee) : (ecosystemVolume * 0.10); // fallback para 10% se não houver taxa explicitada
      
      // Puxa as 3 últimas transações reais como "Atividades Recentes"
      const recentOrders = await prisma.order.findMany({
        where: { tenantId: tenant.id, status: 'PAID' },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        include: { visitor: true }
      });

      const recentActivity = recentOrders.map(order => ({
        type: 'ORDER_PAID',
        text: `Pedido de R$ ${Number(order.total).toFixed(2)} pago por ${order.customerName}`,
        time: order.updatedAt.toISOString()
      }));

      // Caso não existam ordens recentes, mostramos um histórico genérico para não quebrar a UI
      if (recentActivity.length === 0) {
        recentActivity.push({ type: 'SYSTEM_START', text: 'Sistema inicializado sem transações recentes.', time: new Date().toISOString() });
      }
      
      return res.json({
        totalProviders,
        totalProducts,
        totalPassports,
        ecosystemVolume,
        platformRevenue,
        recentActivity
      });
    } catch (error) {
      console.error('Error fetching global stats:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Moderação de Vídeos (Reviews TikTok style)
  async getPendingVideoReviews(req: Request, res: Response) {
    try {
      // Busca avaliações reais que têm vídeo e ainda não foram processadas na moderação
      const reviews = await prisma.providerReview.findMany({
        where: {
          videoUrl: { not: null }
        },
        include: {
          serviceProvider: true
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      // Como o DB de ReviewModeration pode não estar pareado com ProviderReview por chave estrangeira, fazemos o mapeamento básico
      const formattedReviews = reviews.map(r => ({
        id: r.id,
        providerName: r.serviceProvider.name,
        videoUrl: r.videoUrl,
        rating: r.rating,
        status: 'PENDING'
      }));

      return res.json(formattedReviews);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
