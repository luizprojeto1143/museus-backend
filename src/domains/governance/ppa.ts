import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { checkEntityOwnership, assertTenantOwnership } from '../../utils/ownership.js';

const router = Router();

// GET /ppa — List goals
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        const year = parseInt(req.query.year as string) || new Date().getFullYear();
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const goals = await prisma.pPAGoal.findMany({
            where: { tenantId, year },
            orderBy: { createdAt: 'desc' }
        });
        res.json(goals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar metas' });
    }
});

// POST /ppa — Create goal
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { title, description, metric, targetValue, year, quarter } = req.body;
        const goal = await prisma.pPAGoal.create({
            data: { title, description, metric, targetValue, year, quarter, tenantId }
        });
        res.status(201).json(goal);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar meta' });
    }
});

// PATCH /ppa/:id — Update goal progress
router.patch('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'pPAGoal', id, user: req.user! });

        const { currentValue, status } = req.body;
        const goal = await prisma.pPAGoal.update({
            where: { id },
            data: {
                ...(currentValue !== undefined && { currentValue }),
                ...(status && { status })
            }
        });
        res.json(goal);
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar meta' });
    }
});

// DELETE /ppa/:id
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'pPAGoal', id, user: req.user! });

        await prisma.pPAGoal.delete({ where: { id } });
        res.json({ message: 'Meta excluída' });
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao excluir meta' });
    }
});

// GET /ppa/consolidated — Aggregate goals across child tenants
router.get('/consolidated', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const parentId = user.role === 'MASTER'
            ? ((req.query.tenantId as string) || user.tenantId)
            : user.tenantId;
        const year = parseInt(req.query.year as string) || new Date().getFullYear();

        if (!parentId) return res.status(400).json({ message: 'tenantId (parentId) obrigatório' });

        // Buscar todos os tenants filhos + o próprio pai
        const family = await prisma.tenant.findMany({
            where: {
                OR: [
                    { id: parentId },
                    { parentId: parentId }
                ]
            },
            select: { id: true, name: true }
        });

        const tenantIds = family.map(t => t.id);

        // Buscar todas as metas para esse grupo de tenants
        const goals = await prisma.pPAGoal.findMany({
            where: {
                tenantId: { in: tenantIds },
                year
            }
        });

        // Agrupar por título/métrica para consolidar? 
        // Ou apenas listar agrupado por tenant? 
        // Para o dashboard executivo, vamos consolidar por título se forem iguais, senão listar todas.
        const consolidated: Record<string, any> = {};

        goals.forEach(goal => {
            const key = `${goal.title}_${goal.metric}`;
            if (!consolidated[key]) {
                consolidated[key] = {
                    title: goal.title,
                    metric: goal.metric,
                    targetValue: 0,
                    currentValue: 0,
                    goals: []
                };
            }
            consolidated[key].targetValue += goal.targetValue;
            consolidated[key].currentValue += goal.currentValue;
            consolidated[key].goals.push({
                ...goal,
                tenantName: family.find(f => f.id === goal.tenantId)?.name
            });
        });

        res.json(Object.values(consolidated));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao consolidar metas' });
    }
});

export default router;
