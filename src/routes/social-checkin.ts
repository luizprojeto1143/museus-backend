import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /social-checkin — Visitor checks in
router.post('/', authMiddleware, async (req, res) => {
    try {
        const visitorId = req.user!.id;
        const tenantId = req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const { message, emoji } = req.body;
        const checkin = await prisma.socialCheckin.create({
            data: { visitorId, tenantId, message, emoji: emoji || '🏛️' }
        });
        res.status(201).json(checkin);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao registrar check-in' });
    }
});

// GET /social-checkin — Recent check-ins (public feed)
router.get('/', async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const checkins = await prisma.socialCheckin.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 30
        });
        res.json(checkins);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro' });
    }
});

export default router;
