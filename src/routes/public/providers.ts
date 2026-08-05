import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const providerId = req.params.id;

    const provider = await prisma.serviceProvider.findUnique({
      where: { id: providerId },
      include: {
        providerProducts: {
          where: { active: true },
          orderBy: { createdAt: 'desc' }
        },
        providerReviews: {
          orderBy: { createdAt: 'desc' },
          take: 12
        }
      }
    });

    if (!provider || !provider.active) {
      return res.status(404).json({ message: 'Prestador nao encontrado' });
    }

    const ratings = provider.providerReviews.map(review => review.rating);
    const rating = ratings.length > 0
      ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
      : 0;

    res.json({
      id: provider.id,
      type: provider.type,
      name: provider.name,
      phone: provider.phone,
      email: provider.email,
      website: provider.website,
      address: provider.address,
      tenantId: provider.tenantId,
      description: provider.description,
      rating: Number(rating.toFixed(1)),
      reviewsCount: provider.providerReviews.length,
      verified: provider.verified,
      coverUrl: provider.coverUrl,
      products: provider.providerProducts.map(product => ({
        id: product.id,
        name: product.name,
        description: product.description,
        desc: product.description,
        price: Number(product.price),
        imageUrl: product.imageUrl,
      })),
      reviews: provider.providerReviews.map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        videoUrl: review.videoUrl,
      })),
    });
  } catch (error) {
    console.error('Erro ao carregar detalhes do prestador publico', error);
    res.status(500).json({ message: 'Erro ao carregar detalhes do prestador' });
  }
});

router.post('/:id/checkout', authMiddleware, async (req, res) => {
  try {
    const providerId = req.params.id;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Nao autenticado' });

    const product = await prisma.providerProduct.findFirst({
      where: {
        id: req.body.productId,
        serviceProviderId: providerId,
        active: true,
      },
      include: { serviceProvider: true }
    });

    if (!product || !product.serviceProvider.active) {
      return res.status(404).json({ message: 'Produto do prestador nao encontrado' });
    }

    const booking = await prisma.booking.create({
      data: {
        userId,
        tenantId: product.tenantId,
        serviceProviderId: providerId,
        date: new Date(),
        purpose: `Solicitacao de servico: ${product.name}`,
        status: 'REQUESTED',
      }
    });

    return res.status(201).json({
      success: true,
      bookingId: booking.id,
      status: booking.status,
      message: 'Solicitacao registrada para acompanhamento do prestador.'
    });
  } catch (error) {
    console.error('Erro ao registrar solicitacao do prestador', error);
    res.status(500).json({ message: 'Erro ao registrar solicitacao do prestador' });
  }
});

export default router;
