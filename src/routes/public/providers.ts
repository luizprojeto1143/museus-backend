import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// Endpoint público para detalhes de um prestador
router.get('/:id', async (req, res) => {
  try {
    const providerId = req.params.id;

    const provider = await prisma.serviceProvider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        document: false, // Ocultar dados sensíveis
        phone: true,
        email: true,
        address: true,
        tenantId: true,
      }
    });

    if (!provider) {
      return res.status(404).json({ message: 'Prestador não encontrado' });
    }

    // Mock services/reviews return since they might not be fully modeled in DB for providers yet
    // Or we could fetch related models if they exist. For now, return basic structure
    res.json({
      ...provider,
      type: "TOUR_GUIDE",
      description: "Prestador de Serviço Cultural Local",
      rating: 5.0,
      reviewsCount: 1,
      verified: true,
      coverUrl: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&auto=format&fit=crop",
      products: [],
      reviews: []
    });

  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar detalhes do prestador' });
  }
});

export default router;
