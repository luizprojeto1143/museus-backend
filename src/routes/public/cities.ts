import { Router } from 'express';
import { prisma } from '../../prisma';

const router = Router();

router.get('/:id/dashboard', async (req, res) => {
  try {
    const tenantId = req.params.id;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });
    if (!tenant) return res.status(404).json({ message: 'Cidade não encontrada' });

    const activeEvents = await prisma.event.count({
      where: { tenantId, status: 'PUBLISHED' }
    });

    const totalVisitors = await prisma.visitor.count({
      where: { tenantId }
    });

    const totalProviders = await prisma.serviceProvider.count({
      where: { tenantId }
    });

    res.json({
      name: tenant.name,
      city: tenant.city,
      state: tenant.state,
      stats: {
        activeEvents,
        totalVisitors,
        totalProviders
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados da cidade' });
  }
});

export default router;
