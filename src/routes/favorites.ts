import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /favorites - List all favorites for logged in visitor
router.get('/', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user?.id;
        if (!visitorId) {
            return res.status(401).json({ message: 'Usuário não autenticado' });
        }

        const favorites = await prisma.favorite.findMany({
            where: { visitorId },
            include: {
                work: {
                    select: {
                        id: true,
                        title: true,
                        artist: true,
                        imageUrl: true,
                        room: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(favorites);
    } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ message: 'Erro ao buscar favoritos' });
    }
});

// POST /favorites/:workId - Add work to favorites
router.post('/:workId', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user?.id;
        const { workId } = req.params;

        if (!visitorId) {
            return res.status(401).json({ message: 'Usuário não autenticado' });
        }

        // Check if already favorited
        const existing = await prisma.favorite.findUnique({
            where: {
                visitorId_workId: { visitorId, workId }
            }
        });

        if (existing) {
            return res.status(409).json({ message: 'Obra já está nos favoritos' });
        }

        const favorite = await prisma.favorite.create({
            data: { visitorId, workId },
            include: { work: true }
        });

        res.status(201).json(favorite);
    } catch (error) {
        console.error('Error adding favorite:', error);
        res.status(500).json({ message: 'Erro ao adicionar favorito' });
    }
});

// DELETE /favorites/:workId - Remove work from favorites
router.delete('/:workId', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user?.id;
        const { workId } = req.params;

        if (!visitorId) {
            return res.status(401).json({ message: 'Usuário não autenticado' });
        }

        await prisma.favorite.delete({
            where: {
                visitorId_workId: { visitorId, workId }
            }
        });

        res.json({ message: 'Favorito removido' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        res.status(500).json({ message: 'Erro ao remover favorito' });
    }
});

// GET /favorites/check/:workId - Check if work is favorited
router.get('/check/:workId', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user?.id;
        const { workId } = req.params;

        if (!visitorId) {
            return res.json({ isFavorite: false });
        }

        const favorite = await prisma.favorite.findUnique({
            where: {
                visitorId_workId: { visitorId, workId }
            }
        });

        res.json({ isFavorite: !!favorite });
    } catch (error) {
        console.error('Error checking favorite:', error);
        res.json({ isFavorite: false });
    }
});

export default router;
