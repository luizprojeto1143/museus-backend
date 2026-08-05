import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { checkEntityOwnership, assertTenantOwnership } from '../../utils/ownership.js';

const router = Router();

// GET /heritage — List intangible heritage (public)
router.get('/', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const items = await prisma.intangibleHeritage.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar patrimônio' });
    }
});

// POST /heritage — Create (admin)
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.role === 'MASTER' ? (req.body.tenantId as string | undefined) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { title, description, category, status, imageUrl, videoUrl, holders, region } = req.body;
        const item = await prisma.intangibleHeritage.create({
            data: { title, description, category, status, imageUrl, videoUrl, holders, region, tenantId }
        });
        res.status(201).json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar' });
    }
});

// PUT /heritage/:id
router.put('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'intangibleHeritage', id, user: req.user! });

        const { title, description, category, status, imageUrl, videoUrl, holders, region } = req.body;
        const item = await prisma.intangibleHeritage.update({
            where: { id },
            data: { title, description, category, status, imageUrl, videoUrl, holders, region }
        });
        res.json(item);
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar' });
    }
});

// DELETE /heritage/:id
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'intangibleHeritage', id, user: req.user! });

        await prisma.intangibleHeritage.delete({ where: { id } });
        res.json({ message: 'Excluído' });
    } catch (error: any) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error(error);
        res.status(500).json({ message: 'Erro ao excluir' });
    }
});

export default router;
