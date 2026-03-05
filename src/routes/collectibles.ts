import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /collectibles — List cards for tenant (public)
router.get('/', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const cards = await prisma.collectibleCard.findMany({
            where: { tenantId },
            include: { _count: { select: { owners: true } } },
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
        const visitorId = req.user!.id;
        const cards = await prisma.visitorCard.findMany({
            where: { visitorId },
            include: { card: true },
            orderBy: { earnedAt: 'desc' }
        });
        res.json(cards);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar coleção' });
    }
});

// POST /collectibles — Create card (admin)
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { title, description, imageUrl, rarity, workId, totalMinted, xpReward } = req.body;
        const card = await prisma.collectibleCard.create({
            data: { title, description, imageUrl, rarity: rarity || 'COMMON', workId, totalMinted: totalMinted || 100, xpReward: xpReward || 10, tenantId }
        });
        res.status(201).json(card);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar card' });
    }
});

// POST /collectibles/earn/:cardId — Visitor earns a card
router.post('/earn/:cardId', authMiddleware, async (req, res) => {
    try {
        const { cardId } = req.params;
        const visitorId = req.user!.id;

        // Check if already owns
        const existing = await prisma.visitorCard.findUnique({
            where: { cardId_visitorId: { cardId, visitorId } }
        });
        if (existing) return res.status(409).json({ message: 'Você já possui este card' });

        // Check if card still available
        const card = await prisma.collectibleCard.findUnique({
            where: { id: cardId },
            include: { _count: { select: { owners: true } } }
        });
        if (!card) return res.status(404).json({ message: 'Card não encontrado' });
        if (card._count.owners >= card.totalMinted) return res.status(410).json({ message: 'Este card esgotou!' });

        const owned = await prisma.visitorCard.create({
            data: { cardId, visitorId },
            include: { card: true }
        });

        res.status(201).json({ message: `Card "${card.title}" conquistado!`, card: owned });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao registrar card' });
    }
});

// GET /collectibles/stats — Admin stats
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const [totalCards, totalOwned, byRarity] = await Promise.all([
            prisma.collectibleCard.count({ where: { tenantId } }),
            prisma.visitorCard.count({ where: { card: { tenantId } } }),
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
