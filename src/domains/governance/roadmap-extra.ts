import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// --- TIMELINE ---

// GET /timeline — List events for a specific space
router.get('/events', async (req, res) => {
    try {
        const { spaceId } = req.query;
        if (!spaceId) return res.status(400).json({ message: 'spaceId obrigatório' });

        const events = await prisma.timelineEvent.findMany({
            where: { spaceId: spaceId as string },
            orderBy: { year: 'asc' }
        });

        res.json(events);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar linha do tempo' });
    }
});

// ADMIN: POST /timeline — Create timeline event
router.post('/events', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { spaceId, year, title, description, imageUrl, people, tenantId: requestedTenantId } = req.body;
        const tenantId = req.user!.role === 'MASTER' ? requestedTenantId : req.user!.tenantId!;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });

        const space = await prisma.space.findFirst({
            where: { id: spaceId, tenantId },
            select: { id: true }
        });
        if (!space) return res.status(404).json({ message: 'Espaco nao encontrado neste tenant' });

        const event = await prisma.timelineEvent.create({
            data: {
                spaceId,
                year,
                title,
                description,
                imageUrl,
                people,
                tenantId
            }
        });
        res.status(201).json(event);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar evento na linha do tempo' });
    }
});

// --- ROUTES ---

// GET /routes — List all routes for a tenant
router.get('/', async (req, res) => {
    try {
        const { tenantId } = req.query;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const routes = await prisma.route.findMany({
            where: { tenantId: tenantId as string },
            include: { routeStops: true }
        });

        res.json(routes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar rotas' });
    }
});

// GET /routes/:id — Get route details with stops
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const route = await prisma.route.findUnique({
            where: { id },
            include: {
                routeStops: {
                    orderBy: { order: 'asc' }
                }
            }
        });
        res.json(route);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar detalhes da rota' });
    }
});

// ADMIN: POST /routes — Create a new route
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { name, description, imageUrl, stops } = req.body;
        const tenantId = req.user!.tenantId;

        const route = await prisma.route.create({
            data: {
                name,
                description,
                imageUrl,
                tenantId: tenantId!,
                routeStops: {
                    create: stops.map((s: any) => ({
                        order: s.order,
                        targetType: s.targetType,
                        targetId: s.targetId,
                        latitude: s.latitude,
                        longitude: s.longitude
                    }))
                }
            },
            include: { routeStops: true }
        });

        res.status(201).json(route);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar rota' });
    }
});

export default router;
