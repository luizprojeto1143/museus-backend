import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// --- FAMILY PROFILES ---

// GET /family — List family profiles for a space
router.get('/profiles', async (req, res) => {
    try {
        const { spaceId } = req.query;
        if (!spaceId) return res.status(400).json({ message: 'spaceId obrigatório' });

        const profiles = await prisma.familyProfile.findMany({
            where: { spaceId: spaceId as string },
            include: { events: { orderBy: { year: 'asc' } } }
        });

        res.json(profiles);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar perfis de família' });
    }
});

// GET /family/profiles/:id — Get specific family profile
router.get('/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const profile = await prisma.familyProfile.findUnique({
            where: { id },
            include: { events: { orderBy: { year: 'asc' } } }
        });

        if (!profile) {
            return res.status(404).json({ message: 'Perfil de família não encontrado' });
        }

        res.json(profile);
    } catch (error) {
        console.error("Erro ao buscar perfil familiar:", error);
        res.status(500).json({ message: 'Erro interno ao buscar perfil' });
    }
});

// --- WORK SUBMISSIONS ---

// POST /submissions — Submit a new work for review (Visitor)
router.post('/submissions', authMiddleware, async (req, res) => {
    try {
        const { title, description, imageUrl, spaceId } = req.body;
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;

        const submission = await prisma.workSubmission.create({
            data: {
                title,
                description,
                imageUrl,
                spaceId: spaceId || undefined,
                userId,
                tenantId: tenantId!,
                status: 'PENDING'
            }
        });

        res.status(201).json(submission);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao enviar submissão' });
    }
});

// ADMIN: GET /submissions — List submissions for review
router.get('/submissions', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || req.user!.tenantId;
        const { status } = req.query;

        const submissions = await prisma.workSubmission.findMany({
            where: {
                tenantId: tenantId!,
                ...(status ? { status: status as string } : {})
            },
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });

        res.json(submissions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar submissões' });
    }
});

export default router;
