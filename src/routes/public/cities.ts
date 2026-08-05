import { Router } from 'express';
import { prisma } from '../../prisma';
import { TenantType } from '@prisma/client';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cities = await prisma.tenant.findMany({
      where: { type: { in: [TenantType.CITY, TenantType.SECRETARIA] } },
      orderBy: { name: 'asc' },
      take: limit,
      include: {
        _count: { select: { other_Tenant: true, equipamentoCulturals: true } }
      } as any
    });

    res.json(cities.map((city: any) => ({
      id: city.id,
      slug: city.slug,
      nome: city.name,
      estado: city.state || city.address || '',
      logoUrl: city.logoUrl,
      equipamentosCount: city._count?.equipamentoCulturals || city._count?.other_Tenant || 0
    })));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar cidades' });
  }
});

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
      city: tenant.name,
      state: "SP",
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
