import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { mailService } from '../services/email.js';

const router = Router();

const registerSchema = z.object({
    ticketId: z.string(),
    guestName: z.string(),
    guestEmail: z.string().email(),
    visitorId: z.string().optional()
});

// POST / (Create Registration)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { eventId, ticketId, visitorId, guestName, guestEmail } = req.body;

        // 1. Verify Ticket Stock
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) return res.status(404).json({ error: 'Ingresso não encontrado' });
        if (ticket.quantity <= ticket.sold) return res.status(400).json({ error: 'Esgotado' });

        // 2. Create Code
        const code = `TKT-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        // 3. Register Transaction
        // RACE CONDITION FIX: Use atomic update with condition to prevent overselling
        try {
            const [registration] = await prisma.$transaction([
                prisma.registration.create({
                    data: {
                        eventId,
                        ticketId,
                        visitorId: visitorId || req.user?.id,
                        guestName,
                        guestEmail,
                        code,
                        status: 'CONFIRMED'
                    }
                }),
                prisma.ticket.update({
                    where: { id: ticketId, sold: { lt: ticket.quantity } }, // Atomic Check
                    data: { sold: { increment: 1 } }
                })
            ]);

            // ... continue with email ...

            // Send Email Async (Fire and Forget)
            const eventData = await prisma.event.findUnique({
                where: { id: eventId },
                select: { title: true, startDate: true, location: true }
            });
            const eventTitle = eventData?.title || "Evento";
            const eventDate = eventData?.startDate ? new Date(eventData.startDate).toLocaleDateString('pt-BR', {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            }) : undefined;
            const eventLocation = eventData?.location || undefined;

            mailService.sendTicketEmail(guestEmail, eventTitle, guestName, code, eventDate, eventLocation);

            return res.status(201).json(registration);

        } catch (txError: any) {
            // Prisma error P2025 means "Record to update not found", implying condition failed (Sold Out)
            if (txError.code === 'P2025') {
                return res.status(400).json({ error: 'Esgotado (Race Condition Protected)' });
            }
            throw txError;
        }


    } catch (e) {
        console.error("Registration error", e);
        res.status(500).json({ error: 'Erro ao processar inscrição' });
    }
});

// GET / (List Registrations - Audience/CRM)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        const { eventId, q } = req.query;

        const where: any = {
            status: { not: 'CANCELED' }
        };

        if (tenantId) {
            where.event = { tenantId };
        }
        if (eventId) {
            where.eventId = String(eventId);
        }

        if (q) {
            const search = String(q).trim();
            where.OR = [
                { guestName: { contains: search, mode: 'insensitive' } },
                { guestEmail: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
                { visitor: { name: { contains: search, mode: 'insensitive' } } },
                { visitor: { email: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50; // Higher default for registrations
        const skip = (page - 1) * limit;

        const [registrations, total] = await Promise.all([
            prisma.registration.findMany({
                where,
                include: {
                    event: { select: { title: true } },
                    ticket: { select: { name: true } },
                    visitor: { select: { name: true, email: true, photoUrl: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: skip
            }),
            prisma.registration.count({ where })
        ]);

        res.json({
            data: registrations,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error("Error fetching registrations", e);
        res.status(500).json({ error: 'Erro ao buscar participantes' });
    }
});

// GET /my-registrations
router.get('/my-registrations', authMiddleware, async (req, res) => {
    try {
        const user = req.user!;

        // Find visitor profile
        const visitor = await prisma.visitor.findFirst({
            where: { email: user.email, tenantId: user.tenantId || undefined }
        });

        if (!visitor) return res.json([]);

        const registrations = await prisma.registration.findMany({
            where: {
                visitorId: visitor.id,
                status: { not: 'CANCELED' }
            },
            include: {
                event: {
                    select: { id: true, title: true, startDate: true, location: true }
                },
                ticket: {
                    select: { name: true, type: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(registrations);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao buscar inscrições' });
    }
});

// GET /registrations/:code
router.get('/:code', async (req, res) => {
    const { code } = req.params;
    const registration = await prisma.registration.findUnique({
        where: { code },
        include: { event: true, ticket: true }
    });
    if (!registration) return res.status(404).json({ error: 'Not found' });
    res.json(registration);
});

// POST /registrations/checkin (Admin/Scanner)
router.post('/checkin', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
    const { code } = req.body;
    try {
        const registration = await prisma.registration.findFirst({
            where: { code },
            include: { event: true }
        });

        if (!registration) return res.status(404).json({ error: 'Ingresso não encontrado' });

        if (registration.status === 'CHECKED_IN') {
            return res.status(400).json({ error: 'Participante já fez check-in', registration });
        }

        const XP_AMOUNT = 50;

        // Use transaction to ensure check-in + XP update happen atomically
        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.registration.update({
                where: { id: registration.id },
                data: {
                    status: 'CHECKED_IN',
                    checkInDate: new Date()
                }
            });

            let xpAwarded = 0;
            if (registration.visitorId) {
                await tx.visitor.update({
                    where: { id: registration.visitorId },
                    data: { xp: { increment: XP_AMOUNT } }
                });
                xpAwarded = XP_AMOUNT;
            }

            return { updated, xpAwarded };
        });

        res.json({ success: true, registration: result.updated, xpAwarded: result.xpAwarded });
    } catch (error) {
        console.error("Check-in error:", error);
        res.status(500).json({ error: 'Check-in failed' });
    }
});

// GET /stats/today (Producer Dashboard)
router.get('/stats/today', authMiddleware, requireRole(['ADMIN', 'MASTER', 'PRODUCER']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;

        if (!tenantId && user.role !== 'MASTER') {
            return res.status(400).json({ error: 'Tenant ID required' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const where: any = {
            createdAt: { gte: today },
            status: { not: 'CANCELED' }
        };

        if (tenantId) {
            where.event = { tenantId };
        }

        const count = await prisma.registration.count({ where });

        // Calculate revenue today
        const registrations = await prisma.registration.findMany({
            where,
            select: { pricePaid: true }
        });

        const revenue = registrations.reduce((sum, r) => sum + Number(r.pricePaid || 0), 0);

        res.json({
            count,
            revenue
        });
    } catch (e) {
        console.error("Error fetching today stats", e);
        res.status(500).json({ error: 'Erro ao buscar estatísticas de hoje' });
    }
});

export const registrationsRouter = router;
