import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /moderation — List reviews with moderation status (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        const status = req.query.status as string; // "pending", "flagged", "approved"
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const reviews = await prisma.review.findMany({
            where: { work: { tenantId }, ...(status === 'flagged' ? { comment: { not: null } } : {}) },
            include: {
                work: { select: { id: true, title: true } },
                visitor: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        // Get moderation records
        const reviewIds = reviews.map(r => r.id);
        const moderations = await prisma.reviewModeration.findMany({
            where: { reviewId: { in: reviewIds } }
        });
        const modMap = new Map(moderations.map(m => [m.reviewId, m]));

        const enriched = reviews.map(r => ({
            ...r,
            moderation: modMap.get(r.id) || null
        }));

        res.json(enriched);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar moderação' });
    }
});

// POST /moderation/:reviewId — Moderate a review
router.post('/:reviewId', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { isApproved, flagReason } = req.body;
        const moderatedBy = req.user!.id;

        const moderation = await prisma.reviewModeration.upsert({
            where: { reviewId },
            create: { reviewId, isApproved, flagReason, moderatedBy, moderatedAt: new Date() },
            update: { isApproved, flagReason, moderatedBy, moderatedAt: new Date() }
        });

        res.json(moderation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao moderar' });
    }
});

// GET /moderation/stats — Moderation statistics
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });

        const totalReviews = await prisma.review.count({ where: { work: { tenantId } } });
        const moderated = await prisma.reviewModeration.count({ where: { reviewId: { not: undefined } } });
        const flagged = await prisma.reviewModeration.count({ where: { isApproved: false } });
        const approved = await prisma.reviewModeration.count({ where: { isApproved: true } });

        res.json({ totalReviews, moderated, flagged, approved, pending: totalReviews - moderated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar stats' });
    }
});

export default router;
