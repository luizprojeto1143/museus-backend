import { Router } from 'express';
import { prisma } from '../prisma.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { mailService, sendCertificateEmail } from '../services/email.js';

import { asaasService } from '../services/asaasService.js';

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

        // 1. Verify Ticket Stock and Get Event/Tenant Info
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { event: { select: { tenantId: true } } }
        });

        if (!ticket) return res.status(404).json({ error: 'Ingresso não encontrado' });
        if (ticket.quantity <= ticket.sold) return res.status(400).json({ error: 'Esgotado' });

        const tenantId = ticket.event.tenantId;

        // 2. Create Code
        const code = `TKT-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        // 3. ASAAS PAYMENT INTEGRATION (Only if PAID)
        let asaasPaymentData = null;
        if (ticket.type === 'PAID' && Number(ticket.price) > 0) {
            try {
                // Fetch Tenant Wallet ID
                const tenant = await prisma.tenant.findUnique({
                    where: { id: tenantId },
                    select: { asaasWalletId: true }
                });

                // Get/Create Customer
                const asaasCustomerId = await asaasService.createCustomer({
                    name: guestName,
                    email: guestEmail
                });

                // Config Split (5% platform, 95% museum)
                const split = [];
                if (process.env.ASAAS_PLATFORM_WALLET_ID) {
                    split.push({
                        walletId: process.env.ASAAS_PLATFORM_WALLET_ID,
                        percentualValue: 5
                    });
                }
                if (tenant?.asaasWalletId) {
                    split.push({
                        walletId: tenant.asaasWalletId, // Typo found in previous thoughts? Let's check common name
                        percentualValue: 95
                    });
                }

                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + 1);

                const payment = await asaasService.createPayment({
                    customer: asaasCustomerId,
                    billingType: 'PIX',
                    value: Number(ticket.price),
                    dueDate: dueDate.toISOString().split('T')[0],
                    description: `Ingresso: ${ticket.name} - ${code}`,
                    split: split.length > 0 ? split : undefined,
                    externalReference: code
                });

                // Get Pix Details
                const pixData = await asaasService.getPixQrCode(payment.id);
                asaasPaymentData = {
                    id: payment.id,
                    invoiceUrl: payment.invoiceUrl,
                    pixQrCode: pixData?.encodedImage,
                    pixPayload: pixData?.payload
                };

            } catch (err) {
                console.error("Erro no checkout Asaas (Ticket):", err);
                return res.status(500).json({ error: 'Erro ao gerar pagamento via Asaas' });
            }
        }

        // 4. Register Transaction (Transaction Protected)
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
                        pricePaid: ticket.price || 0,
                        platformFee: ticket.price ? Number(ticket.price) * 0.05 : 0,
                        status: ticket.type === 'PAID' ? 'PENDING' : 'CONFIRMED',
                        asaasPaymentId: asaasPaymentData?.id
                    }
                }),
                prisma.ticket.update({
                    where: { id: ticketId, sold: { lt: ticket.quantity } },
                    data: { sold: { increment: 1 } }
                })
            ]);

            // Fire and Forget Email (Free only, Paid usually after webhook but keep original logic)
            if (ticket.type === 'FREE') {
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
                registration,
                payment: asaasPaymentData
            });

        } catch (txError: any) {
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

// POST /:code/check-in (Validate and Check-in Ticket)
router.post('/:code/check-in', authMiddleware, requireRole(['ADMIN', 'MASTER']), async (req, res) => {
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

        // Optional: Trigger Automated Certificate if event is set for it
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
                // Non-blocking
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
                        id: true, 
                        title: true, 
                        startDate: true, 
                        location: true,
                        tenant: { select: { name: true } }
                    }
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

        // Automated Certificate Trigger
        if (!registration.event.certificateRequiresSurvey) {
            try {
                const eventWithTenant = await prisma.event.findUnique({
                    where: { id: registration.eventId },
                    include: { tenant: { select: { name: true } } }
                });
                await sendCertificateEmail(
                    result.updated.guestEmail,
                    result.updated.guestName,
                    registration.event.title,
                    registration.event.startDate.toLocaleDateString("pt-BR"),
                    eventWithTenant?.tenant.name || "Cultura Viva", 
                    result.updated.id.split("-")[0].toUpperCase(),
                    null, null, null
                );
            } catch (e) { console.error("Auto-cert error", e); }
        }

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
                        id: true, 
                        title: true, 
                        startDate: true, 
                        location: true,
                        tenant: { select: { name: true } }
                    }
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

        // Automated Certificate Trigger
        if (!registration.event.certificateRequiresSurvey) {
            try {
                const eventWithTenant = await prisma.event.findUnique({
                    where: { id: registration.eventId },
                    include: { tenant: { select: { name: true } } }
                });
                await sendCertificateEmail(
                    result.updated.guestEmail,
                    result.updated.guestName,
                    registration.event.title,
                    registration.event.startDate.toLocaleDateString("pt-BR"),
                    eventWithTenant?.tenant.name || "Cultura Viva", 
                    result.updated.id.split("-")[0].toUpperCase(),
                    null, null, null
                );
            } catch (e) { console.error("Auto-cert error", e); }
        }

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
            // Using passkit-generator to create Apple Wallet Pass
            const { PKPass } = await import('passkit-generator');
            const pass = new PKPass({
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
                // In production, you would load these from safe storage
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
            // Provide a mock pass for dev environment when certs are missing
            console.warn("[Wallet] Missing certs for real .pkpass, returning mock", e);
            res.json({
                message: "Wallet pass generated. (Note: Real .pkpass requires Apple Developer Certificates in backend).",
                mockData: { code: registration.code, event: registration.event.title }
            });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao gerar carteira Apple' });
    }
});

// Google Wallet Generic Pass Generation (Stub)
router.get('/:code/wallet/google', async (req, res) => {
    // Implementation for Google Wallet API
    res.status(501).json({ error: 'Not implemented yet' });
});

export const registrationsRouter = router;
