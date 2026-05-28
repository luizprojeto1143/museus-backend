import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const reviewSchema = z.object({
    rating: z.number().min(1).max(5),
    comment: z.string().optional(),
    workId: z.string().optional(),
    eventId: z.string().optional()
});

// GET /reviews - List reviews for a work or event
router.get('/', async (req, res) => {
    try {
        const { workId, eventId, approved } = req.query;

        const where: any = {};
        if (workId) where.workId = workId;
        if (eventId) where.eventId = eventId;
        if (approved !== 'all') where.approved = approved === 'false' ? false : true;

        const reviews = await prisma.review.findMany({
            where,
            include: {
                visitor: {
                    select: { name: true, photoUrl: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        // Calculate average
        const avgRating = reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;

        res.json({
            reviews,
            averageRating: Math.round(avgRating * 10) / 10,
            totalReviews: reviews.length
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ message: 'Erro ao buscar avaliações' });
    }
});

// POST /reviews - Create a review
router.post('/', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const data = reviewSchema.parse(req.body);
        const { tenantId } = req.body;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId é obrigatório' });
        }

        // CRITICAL FIX: Find visitor by user's email
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId }
        });

        if (!visitor) {
            return res.status(404).json({ message: 'Perfil de visitante não encontrado' });
        }

        if (!data.workId && !data.eventId) {
            return res.status(400).json({ message: 'workId ou eventId é obrigatório' });
        }

        // Check for existing review
        if (data.workId) {
            const existing = await prisma.review.findUnique({
                where: { visitorId_workId: { visitorId: visitor.id, workId: data.workId } }
            });
            if (existing) {
                return res.status(409).json({ message: 'Você já avaliou esta obra' });
            }
        }

        const review = await prisma.review.create({
            data: {
                rating: data.rating,
                comment: data.comment,
                visitorId: visitor.id,
                workId: data.workId,
                eventId: data.eventId,
                approved: false // Requires moderation
            }
        });

        res.status(201).json(review);
    } catch (error) {
        console.error('Error creating review:', error);
        res.status(500).json({ message: 'Erro ao criar avaliação' });
    }
});

// PATCH /reviews/:id/approve - Approve a review (Admin)
router.patch('/:id/approve', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;

        const review = await prisma.review.update({
            where: { id },
            data: { approved: true }
        });

        res.json(review);
    } catch (error) {
        console.error('Error approving review:', error);
        res.status(500).json({ message: 'Erro ao aprovar avaliação' });
    }
});

// DELETE /reviews/:id - Delete a review (Admin or Owner)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const { tenantId } = req.query;

        const review = await prisma.review.findUnique({
            where: { id },
            include: { work: { select: { tenantId: true } } }
        });

        if (!review) {
            return res.status(404).json({ message: 'Avaliação não encontrada' });
        }

        // Admin/Master can always delete
        if (['ADMIN', 'MASTER'].includes(user.role || '')) {
            await prisma.review.delete({ where: { id } });
            return res.json({ message: 'Avaliação removida' });
        }

        // Find visitor to check ownership
        const reviewTenantId = tenantId as string || review.work?.tenantId;
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email.toLowerCase(), tenantId: reviewTenantId }
        });

        if (!visitor || review.visitorId !== visitor.id) {
            return res.status(403).json({ message: 'Sem permissão' });
        }

        await prisma.review.delete({ where: { id } });
        res.json({ message: 'Avaliação removida' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ message: 'Erro ao remover avaliação' });
    }
});

export default router;
