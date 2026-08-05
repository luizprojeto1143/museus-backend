import { Router } from 'express';
import { Role } from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../middleware/auth.js';

const router = Router();

// POST /ticket-transfers - Request transfer
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { registrationId, toName, toEmail } = req.body;

        const registration = await prisma.registration.findUnique({
            where: { id: registrationId },
            include: { event: { select: { tenantId: true } } }
        });

        if (!registration) {
            return res.status(404).json({ message: 'Inscricao nao encontrada' });
        }

        const user = req.user!;
        const isTenantAdmin = user.role === Role.ADMIN || user.role === Role.COLLABORATOR;

        if (user.role !== Role.MASTER && isTenantAdmin && registration.event.tenantId !== user.tenantId) {
            return res.status(403).json({ message: 'Sem permissao para transferir este ingresso' });
        }

        if (user.role !== Role.MASTER && !isTenantAdmin) {
            const visitor = await prisma.visitor.findFirst({
                where: {
                    email: user.email.toLowerCase(),
                    tenantId: registration.event.tenantId
                },
                select: { id: true }
            });

            const ownsByVisitor = Boolean(visitor && registration.visitorId === visitor.id);
            const ownsByGuestEmail = registration.guestEmail?.toLowerCase() === user.email.toLowerCase();

            if (!ownsByVisitor && !ownsByGuestEmail) {
                return res.status(403).json({ message: 'Sem permissao para transferir este ingresso' });
            }
        }

        const newCode = `TRF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const transfer = await prisma.$transaction(async (tx) => {
            const created = await tx.ticketTransfer.create({
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

            await tx.registration.update({
                where: { id: registrationId },
                data: { guestName: toName, guestEmail: toEmail, code: newCode }
            });

            return created;
        });

        res.status(201).json(transfer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao transferir ingresso' });
    }
});

// GET /ticket-transfers - List transfers (admin)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const tenantId = req.user!.role === Role.MASTER
            ? (req.query.tenantId as string | undefined)
            : req.user!.tenantId;

        const registrationIds = tenantId
            ? await prisma.registration.findMany({
                where: { event: { tenantId } },
                select: { id: true }
            })
            : null;

        const transfers = await prisma.ticketTransfer.findMany({
            where: registrationIds ? {
                registrationId: { in: registrationIds.map((registration) => registration.id) }
            } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        res.json(transfers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro ao listar transferencias' });
    }
});

export default router;
