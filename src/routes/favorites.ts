import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper para descobrir o visitor correspondente ao usuário logado
async function getVisitorForUser(email: string, tenantId: string) {
    return prisma.visitor.findFirst({
        where: { email, tenantId }
    });
}

// GET /favorites - List all favorites for logged in visitor
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user?.email;
        const tenantId = req.user?.tenantId;
        if (!userEmail || !tenantId) return res.status(401).json({ message: 'Não autenticado' });

        const visitor = await getVisitorForUser(userEmail, tenantId);
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const favorites = await prisma.favorite.findMany({
            where: { visitorId: visitor.id },
            include: {
                work: { select: { id: true, title: true, artist: true, imageUrl: true } },
                trail: { select: { id: true, title: true, imageUrl: true } },
                event: { select: { id: true, title: true, description: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Format for frontend
        const formatted = favorites.map(f => {
            if (f.work) return { type: 'work', id: f.work.id, title: f.work.title, artist: f.work.artist, imageUrl: f.work.imageUrl };
            if (f.trail) return { type: 'trail', id: f.trail.id, title: f.trail.title, imageUrl: f.trail.imageUrl };
            if (f.event) return { type: 'event', id: f.event.id, title: f.event.title, artist: 'Evento' };
            return null;
        }).filter(Boolean);

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ message: 'Erro ao buscar favoritos' });
    }
});

// POST /favorites - Add item to favorites
router.post('/', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user?.email;
        const tenantId = req.user?.tenantId;
        const { type, itemId } = req.body;

        if (!userEmail || !tenantId) return res.status(401).json({ message: 'Nâo autenticado' });
        if (!type || !itemId) return res.status(400).json({ message: 'Tipo e ID obrigatórios' });

        const visitor = await getVisitorForUser(userEmail, tenantId);
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const whereClause: any = { visitorId: visitor.id };
        if (type === 'work') whereClause.workId = itemId;
        else if (type === 'trail') whereClause.trailId = itemId;
        else if (type === 'event') whereClause.eventId = itemId;
        else return res.status(400).json({ message: 'Tipo inválido' });

        const existing = await prisma.favorite.findFirst({ where: whereClause });
        if (existing) return res.status(409).json({ message: 'Já está nos favoritos' });

        const data: any = { visitorId: visitor.id };
        if (type === 'work') data.workId = itemId;
        else if (type === 'trail') data.trailId = itemId;
        else if (type === 'event') data.eventId = itemId;

        await prisma.favorite.create({ data });
        res.status(201).json({ message: 'Adicionado com sucesso' });
    } catch (error) {
        console.error('Error adding favorite:', error);
        res.status(500).json({ message: 'Erro ao adicionar favorito' });
    }
});

// DELETE /favorites/:type/:itemId - Remove item from favorites
router.delete('/:type/:itemId', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user?.email;
        const tenantId = req.user?.tenantId;
        const { type, itemId } = req.params;

        if (!userEmail || !tenantId) return res.status(401).json({ message: 'Não autenticado' });

        const visitor = await getVisitorForUser(userEmail, tenantId);
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado' });

        const whereClause: any = { visitorId: visitor.id };
        if (type === 'work') whereClause.workId = itemId;
        else if (type === 'trail') whereClause.trailId = itemId;
        else if (type === 'event') whereClause.eventId = itemId;
        else return res.status(400).json({ message: 'Tipo inválido' });

        const existing = await prisma.favorite.findFirst({ where: whereClause });
        if (!existing) return res.status(404).json({ message: 'Favorito não encontrado' });

        await prisma.favorite.delete({ where: { id: existing.id } });
        res.json({ message: 'Favorito removido' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        res.status(500).json({ message: 'Erro ao remover favorito' });
    }
});

// GET /favorites/check - Check if item is favorited (?type=...&id=...)
router.get('/check', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user?.email;
        const tenantId = req.user?.tenantId;
        const { type, id } = req.query;

        if (!userEmail || !tenantId || !type || !id) return res.json({ isFavorite: false });

        const visitor = await getVisitorForUser(userEmail, tenantId);
        if (!visitor) return res.json({ isFavorite: false });

        const whereClause: any = { visitorId: visitor.id };
        if (type === 'work') whereClause.workId = id;
        else if (type === 'trail') whereClause.trailId = id;
        else if (type === 'event') whereClause.eventId = id;

        const favorite = await prisma.favorite.findFirst({ where: whereClause });
        res.json({ isFavorite: !!favorite });
    } catch (error) {
        console.error('Error checking favorite:', error);
        res.json({ isFavorite: false });
    }
});

export default router;
