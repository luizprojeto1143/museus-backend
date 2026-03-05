import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

// POST /ticket-transfers — Request transfer
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { registrationId, toName, toEmail } = req.body;

        const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
        if (!registration) return res.status(404).json({ message: 'Inscrição não encontrada' });

        const newCode = `TRF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const transfer = await prisma.ticketTransfer.create({
            data: {
                registrationId,
                fromEmail: registration.guestEmail,
                toName,
                toEmail,
                newCode,
                status: 'COMPLETED',
                transferredAt: new Date()
            }
        });

        // Update registration
        await prisma.registration.update({
            where: { id: registrationId },
            data: { guestName: toName, guestEmail: toEmail, code: newCode }
        });

        res.status(201).json(transfer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao transferir ingresso' });
    }
});

// GET /ticket-transfers — List transfers (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const transfers = await prisma.ticketTransfer.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(transfers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao listar transferências' });
    }
});

export default router;
