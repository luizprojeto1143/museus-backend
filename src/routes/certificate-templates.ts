import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { Role } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// List Templates
router.get('/', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant ID required" });

        const templates = await prisma.certificateTemplate.findMany({
            where: { tenantId: tenantId as string },
            orderBy: { updatedAt: 'desc' }
        });
        return res.json(templates);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao listar templates" });
    }
});

// Create Template
router.post('/', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const tenantId = req.user?.tenantId;
        const { name, backgroundUrl, elements, dimensions } = req.body;

        const template = await prisma.certificateTemplate.create({
            data: {
                name,
                backgroundUrl,
                elements,
                dimensions,
                tenantId: tenantId!
            }
        });
        return res.status(201).json(template);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao criar template" });
    }
});

// Update Template
router.put('/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant ID required" });

        const { name, backgroundUrl, elements, dimensions } = req.body;

        const template = await prisma.certificateTemplate.update({
            where: { id, tenantId: tenantId as string },
            data: {
                name,
                backgroundUrl,
                elements,
                dimensions
            }
        });
        return res.json(template);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao atualizar template" });
    }
});

// Delete Template
router.delete('/:id', authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(400).json({ message: "Tenant ID required" });

        await prisma.certificateTemplate.delete({
            where: { id, tenantId: tenantId as string }
        });
        return res.status(204).send();
    } catch (err) {
        return res.status(500).json({ message: "Erro ao excluir template" });
    }
});

export default router;
