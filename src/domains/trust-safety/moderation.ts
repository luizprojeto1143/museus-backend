import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

function requestedTenantId(req: any) {
    return req.user!.role === 'MASTER' && req.query.tenantId
        ? (req.query.tenantId as string)
        : req.user!.tenantId;
}

// GET /moderation - List reviews with moderation status (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = requestedTenantId(req);
        const status = req.query.status as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });

        const reviews = await prisma.review.findMany({
            where: {
                OR: [
                    { work: { tenantId } },
                    { event: { tenantId } }
                ],
                ...(status === 'flagged' ? { comment: { not: null } } : {})
            },
            include: {
                work: { select: { id: true, title: true } },
                event: { select: { id: true, title: true } },
                visitor: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const reviewIds = reviews.map((review) => review.id);
        const moderations = await prisma.reviewModeration.findMany({
            where: { reviewId: { in: reviewIds } }
        });
        const modMap = new Map(moderations.map((moderation) => [moderation.reviewId, moderation]));

        res.json(reviews.map((review) => ({
            ...review,
            moderation: modMap.get(review.id) || null
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar moderacao' });
    }
});

// POST /moderation/:reviewId - Moderate a review
router.post('/:reviewId', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { isApproved, flagReason } = req.body;
        const tenantId = requestedTenantId(req);

        const review = await prisma.review.findUnique({
            where: { id: reviewId },
            include: {
                work: { select: { tenantId: true } },
                event: { select: { tenantId: true } }
            }
        });

        if (!review) return res.status(404).json({ message: 'Avaliacao nao encontrada' });

        const reviewTenantId = review.work?.tenantId || review.event?.tenantId;
        if (req.user!.role !== 'MASTER' && reviewTenantId !== tenantId) {
            return res.status(403).json({ message: 'Sem permissao para moderar esta avaliacao' });
        }

        const moderation = await prisma.reviewModeration.upsert({
            where: { reviewId },
            create: { reviewId, isApproved, flagReason, moderatedBy: req.user!.id, moderatedAt: new Date() },
            update: { isApproved, flagReason, moderatedBy: req.user!.id, moderatedAt: new Date() }
        });

        res.json(moderation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao moderar' });
    }
});

// GET /moderation/stats - Moderation statistics
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = requestedTenantId(req);
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });

        const tenantReviews = await prisma.review.findMany({
            where: {
                OR: [
                    { work: { tenantId } },
                    { event: { tenantId } }
                ]
            },
            select: { id: true }
        });
        const reviewIds = tenantReviews.map((review) => review.id);

        const [moderated, flagged, approved] = await Promise.all([
            prisma.reviewModeration.count({ where: { reviewId: { in: reviewIds } } }),
            prisma.reviewModeration.count({ where: { reviewId: { in: reviewIds }, isApproved: false } }),
            prisma.reviewModeration.count({ where: { reviewId: { in: reviewIds }, isApproved: true } })
        ]);

        res.json({
            totalReviews: reviewIds.length,
            moderated,
            flagged,
            approved,
            pending: reviewIds.length - moderated
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar stats' });
    }
});

export default router;
