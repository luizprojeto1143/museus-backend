import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { Role } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// List Rules
router.get('/', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const tenantId = req.user?.tenantId;
        const rules = await prisma.certificateRule.findMany({
            where: { tenantId },
            include: { actionTemplate: true },
            orderBy: { updatedAt: 'desc' }
        });
        return res.json(rules);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao listar regras" });
    }
});

// Create Rule
router.post('/', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const tenantId = req.user?.tenantId;
        const { name, triggerType, conditions, actionTemplateId, active } = req.body;

        const rule = await prisma.certificateRule.create({
            data: {
                name,
                triggerType,
                conditions,
                actionTemplateId,
                active,
                tenantId: tenantId!
            }
        });
        return res.status(201).json(rule);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao criar regra" });
    }
});

// Update Rule
router.put('/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user?.tenantId;
        const { name, triggerType, conditions, actionTemplateId, active } = req.body;

        const rule = await prisma.certificateRule.update({
            where: { id, tenantId },
            data: {
                name,
                triggerType,
                conditions,
                actionTemplateId,
                active
            }
        });
        return res.json(rule);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao atualizar regra" });
    }
});

// Delete Rule
router.delete('/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user?.tenantId;

        await prisma.certificateRule.delete({
            where: { id, tenantId }
        });
        return res.status(204).send();
    } catch (err) {
        return res.status(500).json({ message: "Erro ao excluir regra" });
    }
});

export default router;
