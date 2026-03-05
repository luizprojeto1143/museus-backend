import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const noteSchema = z.object({
    content: z.string().min(1),
    author: z.string().optional(),
    pinned: z.boolean().default(false),
    workId: z.string()
});

// GET /curator-notes?workId=xxx — Get notes for a work (public)
router.get('/', async (req, res) => {
    try {
        const { workId, tenantId } = req.query;

        if (!workId) {
            return res.status(400).json({ message: 'workId é obrigatório' });
        }

        const notes = await prisma.curatorNote.findMany({
            where: {
                workId: workId as string,
                ...(tenantId ? { tenantId: tenantId as string } : {})
            },
            orderBy: [
                { pinned: 'desc' },
                { createdAt: 'desc' }
            ]
        });

        res.json(notes);
    } catch (error) {
        console.error('Error fetching curator notes:', error);
        res.status(500).json({ message: 'Erro ao buscar notas' });
    }
});

// GET /curator-notes/all — List all notes for admin (paginated)
router.get('/all', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = (req.query.tenantId as string) || user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId obrigatório' });
        }

        const notes = await prisma.curatorNote.findMany({
            where: { tenantId },
            include: {
                work: { select: { id: true, title: true, imageUrl: true, room: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(notes);
    } catch (error) {
        console.error('Error fetching all curator notes:', error);
        res.status(500).json({ message: 'Erro ao buscar notas' });
    }
});

// POST /curator-notes — Create a note (Admin)
router.post('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const data = noteSchema.parse(req.body);
        const tenantId = user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId obrigatório' });
        }

        // Verify work belongs to tenant
        const work = await prisma.work.findFirst({
            where: { id: data.workId, tenantId }
        });

        if (!work) {
            return res.status(404).json({ message: 'Obra não encontrada' });
        }

        const note = await prisma.curatorNote.create({
            data: {
                content: data.content,
                author: data.author || user.name,
                pinned: data.pinned,
                workId: data.workId,
                tenantId
            }
        });

        res.status(201).json(note);
    } catch (error) {
        console.error('Error creating curator note:', error);
        res.status(500).json({ message: 'Erro ao criar nota' });
    }
});

// PUT /curator-notes/:id — Update a note
router.put('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        const { content, author, pinned } = req.body;

        const note = await prisma.curatorNote.update({
            where: { id },
            data: {
                ...(content !== undefined && { content }),
                ...(author !== undefined && { author }),
                ...(pinned !== undefined && { pinned })
            }
        });

        res.json(note);
    } catch (error) {
        console.error('Error updating curator note:', error);
        res.status(500).json({ message: 'Erro ao atualizar nota' });
    }
});

// DELETE /curator-notes/:id — Delete a note
router.delete('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.curatorNote.delete({ where: { id } });
        res.json({ message: 'Nota excluída' });
    } catch (error) {
        console.error('Error deleting curator note:', error);
        res.status(500).json({ message: 'Erro ao excluir nota' });
    }
});

export default router;
