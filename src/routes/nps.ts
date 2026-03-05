import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { z } from 'zod';
import { formLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const npsSchema = z.object({
    score: z.number().min(0).max(10),
    comment: z.string().optional(),
    visitorId: z.string().optional(),
    email: z.string().email().optional(),
    tenantId: z.string()
});

// POST /nps — Submit NPS response (public, rate-limited)
router.post('/', formLimiter, async (req, res) => {
    try {
        const data = npsSchema.parse(req.body);

        const response = await prisma.nPSResponse.create({
            data: {
                score: data.score,
                comment: data.comment,
                visitorId: data.visitorId,
                email: data.email,
                tenantId: data.tenantId
            }
        });

        res.status(201).json({ message: 'Obrigado pelo feedback!', id: response.id });
    } catch (error) {
        console.error('Error submitting NPS:', error);
        res.status(500).json({ message: 'Erro ao enviar avaliação' });
    }
});

// GET /nps/report — NPS dashboard data (Admin)
router.get('/report', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        const months = parseInt(req.query.months as string) || 6;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId obrigatório' });
        }

        const since = new Date();
        since.setMonth(since.getMonth() - months);

        const responses = await prisma.nPSResponse.findMany({
            where: {
                tenantId,
                createdAt: { gte: since }
            },
            orderBy: { createdAt: 'desc' }
        });

        const total = responses.length;
        if (total === 0) {
            return res.json({
                nps: 0,
                total: 0,
                promoters: 0,
                passives: 0,
                detractors: 0,
                distribution: Array(11).fill(0),
                recentComments: [],
                monthlyTrend: []
            });
        }

        // NPS Calculation
        const promoters = responses.filter(r => r.score >= 9).length;
        const passives = responses.filter(r => r.score >= 7 && r.score <= 8).length;
        const detractors = responses.filter(r => r.score <= 6).length;
        const nps = Math.round(((promoters - detractors) / total) * 100);

        // Score distribution (0-10)
        const distribution = Array(11).fill(0);
        responses.forEach(r => distribution[r.score]++);

        // Recent comments
        const recentComments = responses
            .filter(r => r.comment)
            .slice(0, 20)
            .map(r => ({
                score: r.score,
                comment: r.comment,
                date: r.createdAt
            }));

        // Monthly trend
        const monthlyMap = new Map<string, { scores: number[]; count: number }>();
        responses.forEach(r => {
            const key = `${r.createdAt.getFullYear()}-${String(r.createdAt.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyMap.has(key)) {
                monthlyMap.set(key, { scores: [], count: 0 });
            }
            const entry = monthlyMap.get(key)!;
            entry.scores.push(r.score);
            entry.count++;
        });

        const monthlyTrend = Array.from(monthlyMap.entries())
            .map(([month, data]) => {
                const p = data.scores.filter(s => s >= 9).length;
                const d = data.scores.filter(s => s <= 6).length;
                return {
                    month,
                    nps: Math.round(((p - d) / data.count) * 100),
                    count: data.count
                };
            })
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json({
            nps,
            total,
            promoters,
            passives,
            detractors,
            promoterPct: Math.round((promoters / total) * 100),
            passivePct: Math.round((passives / total) * 100),
            detractorPct: Math.round((detractors / total) * 100),
            distribution,
            recentComments,
            monthlyTrend
        });
    } catch (error) {
        console.error('Error generating NPS report:', error);
        res.status(500).json({ message: 'Erro ao gerar relatório NPS' });
    }
});

export default router;
