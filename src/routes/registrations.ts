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
                where: { id: ticketId },
                data: { sold: { increment: 1 } }
            })
        ]);

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

        res.status(201).json(registration);
    } catch (e) {
        console.error("Registration error", e);
        res.status(500).json({ error: 'Erro ao processar inscrição' });
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

        const updated = await prisma.registration.update({
            where: { id: registration.id },
            data: {
                status: 'CHECKED_IN',
                checkInDate: new Date()
            }
        });

        // Gamification Hook: Award XP
        if (registration.visitorId) {
            try {
                // Award 50 XP for attending an event
                // Check if we have a service or direct DB call. Assuming direct for now or logic similar to trails
                const XP_AMOUNT = 50;

                // Update visitor XP
                await prisma.visitor.update({
                    where: { id: registration.visitorId },
                    data: {
                        xp: { increment: XP_AMOUNT }
                    }
                });

                // Create Achievement/History Log if needed
                // await prisma.achievementLog.create(...)
            } catch (e) {
                console.error("Failed to award XP", e);
            }
        }

        res.json({ success: true, registration: updated, xpAwarded: 50 });
    } catch (error) {
        res.status(500).json({ error: 'Check-in failed' });
    }
});

export const registrationsRouter = router;
