import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /community — List approved posts for a specific target (SPACE/WORK)
router.get('/', async (req, res) => {
    try {
        const { targetId } = req.query;
        if (!targetId) return res.status(400).json({ message: 'targetId obrigatório' });

        const posts = await prisma.communityPost.findMany({
            where: { targetId: targetId as string, status: 'APPROVED' },
            include: {
                user: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(posts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar posts da comunidade' });
    }
});

// POST /community — Submit a new post (Visitor/User)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { content, mediaUrl, targetType, targetId } = req.body;
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;

        if (!content || !targetType || !targetId) {
            return res.status(400).json({ message: 'Campos obrigatórios: content, targetType, targetId' });
        }

        const post = await prisma.communityPost.create({
            data: {
                content,
                mediaUrl,
                targetType,
                targetId,
                userId,
                tenantId: tenantId!,
                status: 'PENDING'
            }
        });

        res.status(201).json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar post' });
    }
});

// GET /community/admin — List posts for moderation (Admin)
router.get('/admin', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        const { status } = req.query; // PENDING, APPROVED, REJECTED

        const posts = await prisma.communityPost.findMany({
            where: {
                tenantId: tenantId!,
                ...(status ? { status: status as string } : {})
            },
            include: {
                user: { select: { name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(posts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar posts para moderação' });
    }
});

// PUT /community/:id/status — Moderate a post (Admin)
router.put('/:id/status', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ message: 'Status inválido' });
        }

        const post = await prisma.communityPost.update({
            where: { id },
            data: { status }
        });

        res.json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar status do post' });
    }
});

export default router;
