import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

router.get('/profiles', async (req, res) => {
    try {
        const { spaceId, tenantId } = req.query;
        if (!spaceId && !tenantId) {
            return res.status(400).json({ message: 'spaceId ou tenantId obrigatorio' });
        }

        const profiles = await prisma.familyProfile.findMany({
            where: {
                ...(spaceId ? { spaceId: spaceId as string } : {}),
                ...(tenantId ? { tenantId: tenantId as string } : {})
            },
            include: { familyEvents: { orderBy: { year: 'asc' } } }
        });

        res.json(profiles);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar perfis de familia' });
    }
});

router.post('/profiles', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === 'MASTER' ? req.body.tenantId : user.tenantId;
        const { familyName, description, coverImageUrl, audioUrl, spaceId } = req.body;

        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatorio' });
        if (!familyName) return res.status(400).json({ message: 'familyName obrigatorio' });

        if (spaceId) {
            const space = await prisma.space.findFirst({ where: { id: spaceId, tenantId } });
            if (!space) return res.status(404).json({ message: 'Espaco nao encontrado neste tenant' });
        }

        const profile = await prisma.familyProfile.create({
            data: {
                familyName,
                description: description || null,
                coverImageUrl: coverImageUrl || null,
                audioUrl: audioUrl || null,
                spaceId: spaceId || null,
                tenantId
            }
        });

        res.status(201).json(profile);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar perfil de familia' });
    }
});

router.get('/profiles/:id', async (req, res) => {
    try {
        const profile = await prisma.familyProfile.findUnique({
            where: { id: req.params.id },
            include: { familyEvents: { orderBy: { year: 'asc' } } }
        });

        if (!profile) {
            return res.status(404).json({ message: 'Perfil de familia nao encontrado' });
        }

        res.json(profile);
    } catch (error) {
        console.error("Erro ao buscar perfil familiar:", error);
        res.status(500).json({ message: 'Erro interno ao buscar perfil' });
    }
});

router.post('/profiles/:id/events', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const profile = await prisma.familyProfile.findUnique({ where: { id: req.params.id } });
        if (!profile) return res.status(404).json({ message: 'Perfil de familia nao encontrado' });
        if (user.role !== 'MASTER' && profile.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissao' });
        }

        const { year, title, description, imageUrl, type, people } = req.body;
        if (!year || !title) return res.status(400).json({ message: 'year e title sao obrigatorios' });

        const event = await prisma.familyEvent.create({
            data: {
                familyProfileId: req.params.id,
                year: Number(year),
                title,
                description: description || null,
                imageUrl: imageUrl || null,
                type: type || 'OTHER',
                people: people || undefined
            }
        });

        res.status(201).json(event);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar evento familiar' });
    }
});

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
        res.status(500).json({ message: 'Erro ao enviar submissao' });
    }
});

router.get('/submissions', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
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
        res.status(500).json({ message: 'Erro ao buscar submissoes' });
    }
});

router.put('/submissions/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const { status } = req.body;
        if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ message: 'Status invalido' });
        }

        const submission = await prisma.workSubmission.findUnique({ where: { id: req.params.id } });
        if (!submission) return res.status(404).json({ message: 'Submissao nao encontrada' });
        if (user.role !== 'MASTER' && submission.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissao' });
        }

        const updated = await prisma.workSubmission.update({
            where: { id: req.params.id },
            data: {
                status,
                reviewedBy: user.id,
                reviewedAt: new Date()
            }
        });

        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar submissao' });
    }
});

export default router;
