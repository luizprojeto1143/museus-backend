import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /memberships/plans — List plans (public)
router.get('/plans', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const plans = await prisma.membershipPlan.findMany({
            where: { tenantId, active: true },
            include: { _count: { select: { memberships: true } } },
            orderBy: { monthlyPrice: 'asc' }
        });
        res.json(plans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar planos' });
    }
});

// POST /memberships/plans — Create plan (admin)
router.post('/plans', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { name, description, monthlyPrice, yearlyPrice, benefits, badgeCode, shopDiscount } = req.body;
        const plan = await prisma.membershipPlan.create({
            data: { name, description, monthlyPrice, yearlyPrice, benefits, badgeCode, shopDiscount, tenantId }
        });
        res.status(201).json(plan);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar plano' });
    }
});

// GET /memberships — List memberships (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const memberships = await prisma.membership.findMany({
            where: { tenantId },
            include: { membershipPlan: { select: { name: true, monthlyPrice: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(memberships);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar assinantes' });
    }
});

// POST /memberships — Subscribe (visitor)
router.post('/', async (req, res) => {
    try {
        const { planId, visitorEmail, visitorName, tenantId } = req.body;
        if (!planId || !visitorEmail || !tenantId) return res.status(400).json({ message: 'Dados incompletos' });

        const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ message: 'Plano não encontrado' });

        const membership = await prisma.membership.create({
            data: { planId, visitorEmail, visitorName, tenantId, renewDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
        });
        res.status(201).json(membership);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar assinatura' });
    }
});

// GET /memberships/stats — Stats (admin)
router.get('/stats', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const [active, total, plans] = await Promise.all([
            prisma.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
            prisma.membership.count({ where: { tenantId } }),
            prisma.membershipPlan.findMany({ where: { tenantId }, include: { _count: { select: { memberships: true } } } })
        ]);
        const revenue = plans.reduce((sum, p) => sum + (Number(p.monthlyPrice) * p._count.memberships), 0);
        res.json({ active, total, mrr: revenue, plans });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar stats' });
    }
});

export default router;
