import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// GET /museum-battle/ranking — Monthly ranking of all museums
router.get('/ranking', async (req, res) => {
    try {
        const month = (req.query.month as string) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        const battles = await prisma.museumBattle.findMany({
            where: { month },
            orderBy: { score: 'desc' }
        });

        // Fetch tenant names
        const tenantIds = battles.map(b => b.tenantId);
        const tenants = await prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true, logoUrl: true }
        });
        const tenantMap = new Map(tenants.map(t => [t.id, t]));

        const ranking = battles.map((b, idx) => {
            const tenant = tenantMap.get(b.tenantId);
            return {
                rank: idx + 1,
                tenantId: b.tenantId,
                name: tenant?.name || 'Museu',
                logo: tenant?.logoUrl,
                score: b.score,
                visitors: b.totalVisitors,
                events: b.totalEvents,
                reviews: b.totalReviews,
                avgRating: b.avgRating
            };
        });

        res.json({ month, ranking });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar ranking' });
    }
});

// POST /museum-battle/calculate — Recalculate monthly scores (master only)
router.post('/calculate', authMiddleware, requireRole(['MASTER']), async (req, res) => {
    try {
        const month = (req.body.month as string) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        const [year, monthNum] = month.split('-').map(Number);
        const startDate = new Date(year, monthNum - 1, 1);
        const endDate = new Date(year, monthNum, 0);

        // Get all tenants
        const tenants = await prisma.tenant.findMany({ select: { id: true } });

        for (const tenant of tenants) {
            const [visitors, events, reviews] = await Promise.all([
                prisma.visitor.count({ where: { tenantId: tenant.id, createdAt: { gte: startDate, lte: endDate } } }),
                prisma.event.count({ where: { tenantId: tenant.id, startDate: { gte: startDate, lte: endDate } } }),
                prisma.review.count({ where: { work: { tenantId: tenant.id }, createdAt: { gte: startDate, lte: endDate } } })
            ]);

            const avgRatingResult = await prisma.review.aggregate({
                where: { work: { tenantId: tenant.id }, createdAt: { gte: startDate, lte: endDate } },
                _avg: { rating: true }
            });
            const avgRating = avgRatingResult._avg.rating || 0;

            // Score formula: visitors*1 + events*10 + reviews*5 + avgRating*20
            const score = visitors + (events * 10) + (reviews * 5) + Math.round(avgRating * 20);

            await prisma.museumBattle.upsert({
                where: { tenantId_month: { tenantId: tenant.id, month } },
                create: { tenantId: tenant.id, month, totalVisitors: visitors, totalEvents: events, totalReviews: reviews, avgRating: Math.round(avgRating * 10) / 10, score },
                update: { totalVisitors: visitors, totalEvents: events, totalReviews: reviews, avgRating: Math.round(avgRating * 10) / 10, score }
            });
        }

        // Update ranks
        const allBattles = await prisma.museumBattle.findMany({
            where: { month },
            orderBy: { score: 'desc' }
        });

        for (let i = 0; i < allBattles.length; i++) {
            await prisma.museumBattle.update({
                where: { id: allBattles[i].id },
                data: { rank: i + 1 }
            });
        }

        res.json({ message: `Ranking calculado para ${month}`, total: tenants.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao calcular ranking' });
    }
});

export default router;
