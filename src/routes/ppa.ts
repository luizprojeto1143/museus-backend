import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /ppa — List goals
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
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
        const { currentValue, status } = req.body;
        const goal = await prisma.pPAGoal.update({
            where: { id },
            data: {
                ...(currentValue !== undefined && { currentValue }),
                ...(status && { status })
            }
        });
        res.json(goal);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar meta' });
    }
});

// DELETE /ppa/:id
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        await prisma.pPAGoal.delete({ where: { id: req.params.id } });
        res.json({ message: 'Meta excluída' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao excluir meta' });
    }
});

export default router;
