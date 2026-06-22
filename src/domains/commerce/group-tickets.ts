import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// POST /group-tickets — Create group ticket request
router.post('/', async (req, res) => {
    try {
        const { groupName, totalTickets, contactName, contactEmail, contactPhone, eventId, tenantId, totalPrice } = req.body;
        if (!tenantId || !groupName || !totalTickets || !contactName || !contactEmail) {
            return res.status(400).json({ message: 'Campos obrigatórios: tenantId, groupName, totalTickets, contactName, contactEmail' });
        }
        const ticket = await prisma.groupTicket.create({
            data: { groupName, totalTickets, contactName, contactEmail, contactPhone, eventId, tenantId, totalPrice: totalPrice || 0 }
        });
        res.status(201).json(ticket);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao criar ingresso de grupo' });
    }
});

// GET /group-tickets — List (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = (req.user!.role === 'MASTER' && req.query.tenantId) ? (req.query.tenantId as string) : req.user!.tenantId;
        if (!tenantId) return res.status(400).json({ message: 'tenantId obrigatório' });
        const tickets = await prisma.groupTicket.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(tickets);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao buscar ingressos' });
    }
});

// PATCH /group-tickets/:id — Update status
router.patch('/:id', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const { status } = req.body;
        const ticket = await prisma.groupTicket.update({
            where: { id: req.params.id },
            data: { status }
        });
        res.json(ticket);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao atualizar' });
    }
});

export default router;
