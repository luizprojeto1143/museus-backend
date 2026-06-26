import { Router } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { Role } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { checkEntityOwnership } from '../../utils/ownership.js';

const router = Router();

// List Rules
router.get('/', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant ID required" });

        const rules = await prisma.certificateRule.findMany({
            where: { tenantId: tenantId as string },
            include: { certificateTemplate: true },
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
        const check = await checkEntityOwnership('certificateRule', id, req.user!);
        if (!check.success) return res.status(check.status).json({ message: check.message });

        const { name, triggerType, conditions, actionTemplateId, active } = req.body;

        const rule = await prisma.certificateRule.update({
            where: { id },
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
        const check = await checkEntityOwnership('certificateRule', id, req.user!);
        if (!check.success) return res.status(check.status).json({ message: check.message });

        await prisma.certificateRule.delete({
            where: { id }
        });
        return res.status(204).send();
    } catch (err) {
        return res.status(500).json({ message: "Erro ao excluir regra" });
    }
});

export default router;
