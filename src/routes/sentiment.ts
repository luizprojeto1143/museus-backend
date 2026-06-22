import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /sentiment/report — Generate sentiment analysis from reviews (Admin)
router.get('/report', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        const months = parseInt(req.query.months as string) || 3;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId obrigatório' });
        }

        const since = new Date();
        since.setMonth(since.getMonth() - months);

        // Fetch reviews with work info
        const reviews = await prisma.review.findMany({
            where: {
                work: { tenantId },
                createdAt: { gte: since }
            },
            include: {
                work: { select: { id: true, title: true, room: true } },
                visitor: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (reviews.length === 0) {
            return res.json({
                summary: {
                    total: 0,
                    avgRating: 0,
                    sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 }
                },
                byWork: [],
                byRoom: [],
                recentNegative: [],
                insights: []
            });
        }

        // Simple sentiment classification based on rating
        const classified = reviews.map(r => ({
            ...r,
            sentiment: r.rating >= 4 ? 'POSITIVE' : r.rating === 3 ? 'NEUTRAL' : 'NEGATIVE'
        }));

        const positive = classified.filter(r => r.sentiment === 'POSITIVE').length;
        const neutral = classified.filter(r => r.sentiment === 'NEUTRAL').length;
        const negative = classified.filter(r => r.sentiment === 'NEGATIVE').length;
        const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

        // Group by work
        const workMap = new Map<string, { title: string; ratings: number[]; comments: string[] }>();
        reviews.forEach(r => {
            if (!r.work) return;
            if (!workMap.has(r.work.id)) {
                workMap.set(r.work.id, { title: r.work.title, ratings: [], comments: [] });
            }
            const entry = workMap.get(r.work.id)!;
            entry.ratings.push(r.rating);
            if (r.comment) entry.comments.push(r.comment);
        });

        const byWork = Array.from(workMap.entries())
            .map(([id, data]) => ({
                workId: id,
                title: data.title,
                avgRating: Math.round((data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length) * 10) / 10,
                reviewCount: data.ratings.length,
                positiveCount: data.ratings.filter(r => r >= 4).length,
                negativeCount: data.ratings.filter(r => r <= 2).length
            }))
            .sort((a, b) => b.reviewCount - a.reviewCount);

        // Group by room
        const roomMap = new Map<string, number[]>();
        reviews.forEach(r => {
            const room = r.work?.room || 'Sem sala';
            if (!roomMap.has(room)) roomMap.set(room, []);
            roomMap.get(room)!.push(r.rating);
        });

        const byRoom = Array.from(roomMap.entries())
            .map(([room, ratings]) => ({
                room,
                avgRating: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10,
                reviewCount: ratings.length
            }))
            .sort((a, b) => a.avgRating - b.avgRating);

        // Recent negative reviews (for admin attention)
        const recentNegative = classified
            .filter(r => r.sentiment === 'NEGATIVE' && r.comment)
            .slice(0, 10)
            .map(r => ({
                workTitle: r.work?.title,
                room: r.work?.room,
                rating: r.rating,
                comment: r.comment,
                visitorName: r.visitor?.name,
                date: r.createdAt
            }));

        // Generate insights
        const insights: string[] = [];
        if (negative > positive) {
            insights.push('⚠️ Mais avaliações negativas que positivas neste período. Atenção especial necessária.');
        }
        const worstWork = byWork.find(w => w.avgRating < 3 && w.reviewCount >= 3);
        if (worstWork) {
            insights.push(`🔴 A obra "${worstWork.title}" tem média ${worstWork.avgRating} com ${worstWork.reviewCount} avaliações.`);
        }
        const bestWork = byWork.find(w => w.avgRating >= 4.5 && w.reviewCount >= 3);
        if (bestWork) {
            insights.push(`🌟 A obra "${bestWork.title}" é destaque com média ${bestWork.avgRating}.`);
        }
        const worstRoom = byRoom.find(r => r.avgRating < 3 && r.reviewCount >= 3);
        if (worstRoom) {
            insights.push(`📍 A sala "${worstRoom.room}" tem média baixa (${worstRoom.avgRating}). Considere investigar.`);
        }

        res.json({
            summary: {
                total: reviews.length,
                avgRating: Math.round(avgRating * 10) / 10,
                sentimentBreakdown: { positive, neutral, negative },
                positivePct: Math.round((positive / reviews.length) * 100),
                neutralPct: Math.round((neutral / reviews.length) * 100),
                negativePct: Math.round((negative / reviews.length) * 100)
            },
            byWork: byWork.slice(0, 15),
            byRoom,
            recentNegative,
            insights
        });
    } catch (error) {
        console.error('Error generating sentiment report:', error);
        res.status(500).json({ message: 'Erro ao gerar análise de sentimento' });
    }
});

export default router;
