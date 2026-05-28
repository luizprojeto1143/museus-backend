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
      
      // Mocks for financial data since we don't have a fully populated Booking/Payment table specifically for Roteiro yet
      const ecosystemVolume = 125430.00; 
      const platformRevenue = ecosystemVolume * 0.10; // 10% fee
      
      return res.json({
        totalProviders,
        totalProducts,
        totalPassports,
        ecosystemVolume,
        platformRevenue,
        recentActivity: [
          { type: 'NEW_PROVIDER', text: 'Restaurante Sabor Mineiro conectado ao Stripe.', time: '10 min atrás' },
          { type: 'BUNDLE_SOLD', text: 'Pacote "Tour Histórico + Almoço" vendido por R$ 150,00', time: '1h atrás' },
          { type: 'VIDEO_REVIEW', text: 'Nova avaliação em vídeo recebida para Guia Turístico.', time: '2h atrás' }
        ]
      });
    } catch (error) {
      console.error('Error fetching global stats:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Moderação de Vídeos (Reviews TikTok style)
  async getPendingVideoReviews(req: Request, res: Response) {
    try {
      // Mocked pending reviews for moderation
      const reviews = [
        { id: 'rev-1', providerName: 'Maria Guia', videoUrl: 'https://example.com/video1.mp4', rating: 5, status: 'PENDING' }
      ];
      return res.json(reviews);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
