import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { mailService, sendCertificateEmail } from '../services/email.js';
import { getPlatformFeeRate } from '../utils/fees.js';

const router = Router();

const registerSchema = z.object({
    eventId: z.string(),
    ticketId: z.string(),
    guestName: z.string(),
    guestEmail: z.string().email(),
    visitorId: z.string().optional()
});

// POST / (Create Registration)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { eventId, ticketId, visitorId, guestName, guestEmail } = req.body;

        // 1. Clean up expired registrations first to free up stock
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        await prisma.registration.updateMany({
            where: {
                ticketId,
                status: 'PENDING',
                createdAt: { lt: fifteenMinutesAgo }
            },
            data: { status: 'CANCELED' }
        });

        // 2. Perform pessimistic locking & validation within transaction
        let registration;
        let tenantId;
        const code = `TKT-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        try {
            registration = await prisma.$transaction(async (tx) => {
                // Pessimistic lock the ticket to prevent concurrent modifications
                const tickets = await tx.$queryRaw<any[]>`SELECT * FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
                const ticketLock = tickets[0];
                if (!ticketLock) {
                    throw new Error('NOT_FOUND');
                }

                // Verify count of active pending registrations
                const activePendingCount = await tx.registration.count({
                    where: {
                        ticketId,
                        status: 'PENDING',
                        createdAt: { gte: fifteenMinutesAgo }
                    }
                });

                if (ticketLock.quantity <= ticketLock.sold + activePendingCount) {
                    throw new Error('OUT_OF_STOCK');
                }

                // Get event/tenant info
                const event = await tx.event.findUnique({
                    where: { id: eventId },
                    select: { tenantId: true, producerId: true }
                });
                if (!event) throw new Error('EVENT_NOT_FOUND');
                tenantId = event.tenantId;

                const feeRate = await getPlatformFeeRate(tenantId);
                const platformFeeVal = ticketLock.price ? Number(ticketLock.price) * feeRate : 0;

                const reg = await tx.registration.create({
                    data: {
                        eventId,
                        ticketId,
                        visitorId: visitorId || req.user?.id,
                        guestName,
                        guestEmail,
                        code,
                        pricePaid: ticketLock.price || 0,
                        platformFee: platformFeeVal,
                        status: ticketLock.type === 'PAID' ? 'PENDING' : 'CONFIRMED'
                    }
                });

                if (ticketLock.type === 'FREE') {
                    await tx.ticket.update({
                        where: { id: ticketId },
                        data: { sold: { increment: 1 } }
                    });
                }

                return { reg, ticket: ticketLock };
            });
        } catch (txError: any) {
            if (txError.message === 'NOT_FOUND') return res.status(404).json({ error: 'Ingresso não encontrado' });
            if (txError.message === 'OUT_OF_STOCK') return res.status(400).json({ error: 'Esgotado' });
            throw txError;
        }

        const { reg: createdReg, ticket: lockedTicket } = registration;
        const resolvedEvent = await prisma.event.findUnique({ where: { id: eventId }, select: { tenantId: true } });
        tenantId = resolvedEvent?.tenantId || null;

        // 3. STRIPE PAYMENT INTEGRATION (Only if PAID)
        let stripePaymentData = null;
        if (lockedTicket.type === 'PAID' && Number(lockedTicket.price) > 0) {
            try {
                const { stripeService } = await import('../services/stripeService.js');
                
                let connectedAccountId = '';
                let payeeName = 'Evento';
                
                const event = await prisma.event.findUnique({
                    where: { id: eventId },
                    select: { tenantId: true, producerId: true }
                });
                
                if (event?.producerId) {
                    const producer = await prisma.user.findUnique({
                        where: { id: event.producerId },
                        select: { stripeConnectId: true, name: true }
                    });
                    if (producer?.stripeConnectId) {
                        connectedAccountId = producer.stripeConnectId;
                        payeeName = producer.name;
                    }
                }
                
                if (!connectedAccountId && event?.tenantId) {
                    const tenant = await prisma.tenant.findUnique({
                        where: { id: event.tenantId },
                        select: { stripeConnectId: true, name: true }
                    });
                    if (tenant?.stripeConnectId) {
                        connectedAccountId = tenant.stripeConnectId;
                        payeeName = tenant.name;
                    }
                }

                if (!connectedAccountId) {
                    // Release stock on fail
                    await prisma.registration.update({
                        where: { id: createdReg.id },
                        data: { status: 'CANCELED' }
                    });
                    return res.status(400).json({ 
                        error: 'O recebedor deste evento ainda não configurou pagamentos via Stripe Connect. Entre em contato com a administração.' 
                    });
                }

                // Get/Create Stripe Customer
                const stripeCustomerId = await stripeService.createCustomer({
                    name: guestName,
                    email: guestEmail,
                    userId: visitorId || req.user?.id || 'guest'
                });

                const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
                const amountCents = Math.round(Number(lockedTicket.price) * 100);
                const feeRate = await getPlatformFeeRate(event!.tenantId);
                const platformFeeCents = Math.round(amountCents * feeRate);

                // Create Checkout Session with Split
                const session = await stripeService.createSplitPaymentSession({
                    customerId: stripeCustomerId,
                    amount: amountCents,
                    description: `Ingresso: ${lockedTicket.name} - ${payeeName}`,
                    connectedAccountId, 
                    applicationFeeAmount: platformFeeCents,
                    successUrl: `${frontendUrl}/tickets/success?code=${code}`,
                    cancelUrl: `${frontendUrl}/tickets/cancel?code=${code}`
                });

                stripePaymentData = {
                    id: session.id,
                    checkoutUrl: session.url
                };

                // Update registration with Stripe session ID
                await prisma.registration.update({
                    where: { id: createdReg.id },
                    data: { stripeCheckoutSessionId: session.id }
                });

            } catch (err) {
                console.error("Erro no checkout Stripe (Ticket):", err);
                // Release stock on fail
                await prisma.registration.update({
                    where: { id: createdReg.id },
                    data: { status: 'CANCELED' }
                });
                return res.status(500).json({ error: 'Erro ao gerar pagamento via Stripe' });
            }
        }

        // 4. Send Confirmation Email for Free Tickets
        if (lockedTicket.type === 'FREE') {
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
        }

        return res.status(201).json({
            registration: {
                ...createdReg,
                stripeCheckoutSessionId: stripePaymentData?.id || null
            },
            payment: stripePaymentData
        });

    } catch (e) {
        console.error("Registration error", e);
        res.status(500).json({ error: 'Erro ao processar inscrição' });
    }
});

// POST /:code/check-in (Validate and Check-in Ticket)
router.post('/:code/check-in', authMiddleware, requireRole(['ADMIN', 'MASTER', 'OPERADOR']), async (req, res) => {
    try {
        const { code } = req.params;
        const user = req.user!;

        // 1. Find Registration
        const registration = await prisma.registration.findUnique({
            where: { code },
            include: {
                event: { select: { title: true, tenantId: true, certificateRequiresSurvey: true } },
                ticket: { select: { name: true, type: true } }
            }
        });

        // 2. Base Validations
        if (!registration) {
            return res.status(404).json({ valid: false, message: 'Ingresso Inválido (Não Encontrado)' });
        }

        // Security: Ensure tenant match (unless MASTER)
        if (user.role !== 'MASTER' && registration.event.tenantId !== user.tenantId) {
            return res.status(403).json({ valid: false, message: 'Ingresso pertence a outro Museu' });
        }

        // 3. Status Validations
        if (registration.status !== 'CONFIRMED' && registration.status !== 'CHECKED_IN') {
            return res.status(400).json({
                valid: false,
                message: `Pagamento Pendente ou Cancelado (${registration.status})`
            });
        }

        if (registration.checkInDate || registration.status === 'CHECKED_IN') {
            const checkInTime = registration.checkInDate ? new Date(registration.checkInDate).toLocaleTimeString('pt-BR') : 'Tempo desconhecido';
            return res.status(400).json({
                valid: false,
                message: `Ingresso já utilizado às ${checkInTime}.`
            });
        }

        // 4. Perform Check-in
        const XP_AMOUNT = 50;
        const updated = await prisma.$transaction(async (tx) => {
            const up = await tx.registration.update({
                where: { id: registration.id },
                data: {
                    status: 'CHECKED_IN',
                    checkInDate: new Date()
                }
            });

            if (registration.visitorId) {
                await tx.visitor.update({
                    where: { id: registration.visitorId },
                    data: { xp: { increment: XP_AMOUNT } }
                });
            }

            return up;
        });

        // Optional: Trigger Automated Certificate
        if (!registration.event.certificateRequiresSurvey) {
            try {
                const event = await prisma.event.findUnique({
                    where: { id: registration.eventId },
                    include: { tenant: true }
                });

                if (event) {
                    await sendCertificateEmail(
                        updated.guestEmail,
                        updated.guestName,
                        event.title,
                        event.startDate.toLocaleDateString("pt-BR"),
                        event.tenant.name,
                        updated.id.split("-")[0].toUpperCase(),
                        event.tenant.logoUrl,
                        event.tenant.signatureUrl,
                        event.tenant.certificateBackgroundUrl
                    );
                }
            } catch (certError) {
                console.error("Auto-certificate error:", certError);
            }
        }

        return res.json({
            valid: true,
            message: 'Entrada Liberada!',
            xpAwarded: registration.visitorId ? XP_AMOUNT : 0,
            details: {
                guestName: updated.guestName,
                eventName: registration.event.title,
                ticketType: registration.ticket.name
            }
        });

    } catch (error) {
        console.error("Check-in error:", error);
        res.status(500).json({ valid: false, message: 'Erro no servidor ao validar ingresso.' });
    }
});

// GET / (List Registrations)
router.get('/', authMiddleware, requireRole(['ADMIN', 'MASTER', 'OPERADOR']), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.tenantId;
        const { eventId, q } = req.query;

        const where: any = {
            status: { not: 'CANCELED' }
        };

        if (tenantId) where.event = { tenantId };
        if (eventId) where.eventId = String(eventId);

        if (q) {
            const search = String(q).trim();
            where.OR = [
                { guestName: { contains: search, mode: 'insensitive' } },
                { guestEmail: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } }
            ];
        }

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
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

        const registrations = await prisma.registration.findMany({
            where: {
                OR: [
                    { visitor: { email: user.email.toLowerCase() } },
                    { guestEmail: user.email.toLowerCase() }
                ],
                status: { not: 'CANCELED' }
            },
            include: {
                event: {
                    select: { 
                        id: true, title: true, startDate: true, location: true,
                        tenant: { select: { name: true } }
                    }
                },
                ticket: { select: { name: true, type: true } }
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

// GET /stats/today
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

        if (tenantId) where.event = { tenantId };

        const count = await prisma.registration.count({ where });
        const registrations = await prisma.registration.findMany({
            where,
            select: { pricePaid: true }
        });

        const revenue = registrations.reduce((sum, r) => sum + Number(r.pricePaid || 0), 0);
        res.json({ count, revenue });
    } catch (e) {
        console.error("Error fetching today stats", e);
        res.status(500).json({ error: 'Erro ao buscar estatísticas de hoje' });
    }
});

// Apple Wallet PKPass Generation
router.get('/:code/wallet/apple', async (req, res) => {
    try {
        const { code } = req.params;
        const registration = await prisma.registration.findUnique({
            where: { code },
            include: {
                event: { include: { tenant: true } },
                ticket: true
            }
        });

        if (!registration) return res.status(404).json({ error: 'Ingresso não encontrado' });

        try {
            const { PKPass } = await import('passkit-generator');
            const pass = new (PKPass as any)({
                "formatVersion": 1,
                "passTypeIdentifier": "pass.com.culturaviva.ingresso",
                "serialNumber": registration.code,
                "teamIdentifier": "TEAM_ID",
                "organizationName": "Cultura Viva",
                "description": registration.event.title,
                "logoText": registration.event.tenant.name,
                "foregroundColor": "rgb(255, 255, 255)",
                "backgroundColor": "rgb(20, 20, 26)",
                "labelColor": "rgb(212, 175, 55)",
                "eventTicket": {
                    "primaryFields": [
                        { "key": "event", "label": "EVENTO", "value": registration.event.title }
                    ],
                    "secondaryFields": [
                        { "key": "loc", "label": "LOCAL", "value": registration.event.location || "Sede" }
                    ],
                    "auxiliaryFields": [
                        { "key": "date", "label": "DATA", "value": new Date(registration.event.startDate).toLocaleDateString('pt-BR') }
                    ],
                    "barcode": {
                        "message": registration.code,
                        "format": "PKBarcodeFormatQR",
                        "messageEncoding": "iso-8859-1"
                    }
                }
            }, {
                "wwdr": "PATH_TO_WWDR",
                "signerCert": "PATH_TO_CERT",
                "signerKey": "PATH_TO_KEY",
                "signerKeyPassphrase": "PASS"
            });

            const buffer = pass.getAsBuffer();
            res.set('Content-Type', 'application/vnd.apple.pkpass');
            res.set('Content-Disposition', `attachment; filename="${registration.code}.pkpass"`);
            res.send(buffer);
        } catch (e) {
            res.json({
                message: "Wallet pass generated. (Note: Real .pkpass requires certificates).",
                mockData: { code: registration.code, event: registration.event.title }
            });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao gerar carteira Apple' });
    }
});

export const registrationsRouter = router;
