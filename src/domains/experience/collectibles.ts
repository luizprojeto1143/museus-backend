import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// GET /collectibles — List cards for tenant (public)
router.get('/', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const cards = await prisma.collectibleCard.findMany({
            where: { tenantId },
            include: { 
                _count: { select: { visitorCards: true } },
                work: { select: { imageUrl: true, title: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(cards);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar cards' });
    }
});

// GET /collectibles/my — Get visitor's collection
router.get('/my', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user!.email;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });

        const cards = await prisma.visitorCard.findMany({
            where: { visitorId: visitor.id },
            include: { 
                collectibleCard: {
                    include: { work: { select: { imageUrl: true, title: true } } }
                } 
            },
            orderBy: { earnedAt: 'desc' }
        });
        res.json(cards);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar coleção' });
    }
});

// POST /collectibles — Create card (admin/master)
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.role === 'MASTER' ? (req.body.tenantId || req.query.tenantId) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { title, description, imageUrl, rarity, workId, totalMinted, xpReward } = req.body;
        if (workId) {
            const work = await prisma.work.findFirst({ where: { id: workId, tenantId, deletedAt: null } });
            if (!work) return res.status(404).json({ message: 'Obra nao encontrada neste tenant' });
        }

        const card = await prisma.collectibleCard.create({
            data: { title, description, imageUrl, rarity: rarity || 'COMMON', workId, totalMinted: totalMinted || 100, xpReward: xpReward || 10, tenantId }
        });
        res.status(201).json(card);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar card' });
    }
});

router.post('/earn/:cardId', authMiddleware, async (req, res) => {
    try {
        const { cardId } = req.params;
        const userEmail = req.user!.email;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const visitor = await prisma.visitor.findFirst({ where: { email: userEmail, tenantId } });
        if (!visitor) return res.status(404).json({ message: 'Visitante não encontrado neste museu' });
        const visitorId = visitor.id;

        // Check if already owns
        const existing = await prisma.visitorCard.findUnique({
            where: { cardId_visitorId: { cardId, visitorId } },
            include: {
                collectibleCard: {
                    include: { work: { select: { imageUrl: true, title: true } } }
                }
            }
        });
        if (existing) {
            return res.json({
                message: 'Este fragmento ja esta anexado ao seu passaporte.',
                alreadyOwned: true,
                card: existing
            });
        }

        // Check if card still available
        const card = await prisma.collectibleCard.findFirst({
            where: { id: cardId, tenantId },
            include: { 
                _count: { select: { visitorCards: true } },
                work: { select: { imageUrl: true, title: true } }
            }
        });
        if (!card) return res.status(404).json({ message: 'Fragmento nao encontrado' });
        if (card._count.visitorCards >= card.totalMinted) return res.status(410).json({ message: 'Este fragmento esgotou!' });
        if (card.workId) {
            const stamp = await prisma.passportStamp.findUnique({
                where: { visitorId_workId: { visitorId, workId: card.workId } }
            });
            if (!stamp) {
                return res.status(403).json({ message: 'Escaneie o QR Code da obra para liberar este fragmento.' });
            }
        }

        const owned = await prisma.$transaction(async (tx) => {
            const created = await tx.visitorCard.create({
                data: { cardId, visitorId },
                include: {
                    collectibleCard: {
                        include: { work: { select: { imageUrl: true, title: true } } }
                    }
                }
            });

            if (card.xpReward > 0) {
                await tx.visitor.update({
                    where: { id: visitorId },
                    data: { xp: { increment: card.xpReward } }
                });
            }

            return created;
        });

        res.status(201).json({
            message: `Fragmento "${card.title}" anexado ao seu passaporte!`,
            alreadyOwned: false,
            xpGained: card.xpReward,
            card: owned
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao registrar card' });
    }
});

// GET /collectibles/stats — Admin stats
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        const card = await prisma.collectibleCard.findUnique({ where: { id: req.params.id } });
        if (!card) return res.status(404).json({ message: 'Card nao encontrado' });
        if (req.user!.role !== 'MASTER' && card.tenantId !== tenantId) return res.status(403).json({ message: 'Sem permissao' });

        await prisma.collectibleCard.delete({ where: { id: req.params.id } });
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao excluir card' });
    }
});

router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const [totalCards, totalOwned, byRarity] = await Promise.all([
            prisma.collectibleCard.count({ where: { tenantId } }),
            prisma.visitorCard.count({ where: { collectibleCard: { tenantId } } }),
            prisma.collectibleCard.groupBy({
                by: ['rarity'],
                where: { tenantId },
                _count: { id: true }
            })
        ]);
        res.json({ totalCards, totalOwned, byRarity: byRarity.map(r => ({ rarity: r.rarity, count: r._count.id })) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar stats' });
    }
});

export default router;
