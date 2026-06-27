import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { checkEntityOwnership, assertTenantOwnership } from "../utils/ownership.js";
import { syncLedgerEntry } from "../services/ledgerService.js";

const router = Router();

function isSeatValidInLayout(seatId: string, layout: any): boolean {
    if (!layout) return true; // se não houver layout configurado, assume válido como fallback
    
    // Se for um array de strings ou objetos
    if (Array.isArray(layout)) {
        return layout.some(item => {
            if (typeof item === 'string') return item === seatId;
            if (item && typeof item === 'object') return item.id === seatId || item.seatId === seatId;
            return false;
        });
    }
    
    // Se for um objeto com a chave seats ou rows
    if (typeof layout === 'object') {
        if (Array.isArray(layout.seats)) {
            return layout.seats.some((item: any) => {
                if (typeof item === 'string') return item === seatId;
                if (item && typeof item === 'object') return item.id === seatId || item.seatId === seatId;
                return false;
            });
        }
        if (Array.isArray(layout.rows)) {
            return layout.rows.some((row: any) => {
                if (row && Array.isArray(row.seats)) {
                    return row.seats.some((item: any) => {
                        if (typeof item === 'string') return item === seatId;
                        if (item && typeof item === 'object') return item.id === seatId || item.seatId === seatId;
                        return false;
                    });
                }
                return false;
            });
        }
    }
    
    return true;
}

router.use(authMiddleware, requireRole([Role.TEATRO, Role.ADMIN, Role.MASTER]));

// List Theater Sessions
router.get("/sessions", authMiddleware, async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        const sessions = await prisma.event.findMany({
            where: {
                tenantId,
                isTheaterSession: true,
                deletedAt: null
            },
            include: {
                space: true,
                _count: {
                    select: { theaterSeatReservations: true }
                }
            },
            orderBy: { startDate: "asc" }
        });

        return res.json(sessions);
    } catch (err) {
        console.error("Error fetching theater sessions", err);
        return res.status(500).json({ message: "Erro ao buscar sessões" });
    }
});

// Get Seats for a Session
router.get("/sessions/:id/seats", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const session = await assertTenantOwnership({ model: 'event', id, user: req.user! });

        if (!session.isTheaterSession) {
            return res.status(404).json({ message: "Sessão não encontrada" });
        }

        // Fetch space explicitly since checkEntityOwnership doesn't include it by default
        const space = session.spaceId ? await prisma.space.findUnique({ where: { id: session.spaceId } }) : null;
        session.space = space;

        const reservations = await prisma.theaterSeatReservation.findMany({
            where: { eventId: id }
        });

        return res.json({
            layout: session.space?.theaterLayout,
            reservations: reservations.map(r => ({
                seatId: r.seatId,
                status: r.status,
                visitorId: r.visitorId
            }))
        });
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error("Error fetching session seats", err);
        return res.status(500).json({ message: "Erro ao buscar assentos" });
    }
});

// Reserve Seats (Temporary)
router.post("/sessions/:id/reserve", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const session = await assertTenantOwnership({ model: 'event', id, user: req.user! });

        if (!session.isTheaterSession) {
            return res.status(404).json({ message: "Sessão não encontrada" });
        }

        const { seatIds } = z.object({ seatIds: z.array(z.string()).min(1, "Selecione pelo menos um assento") }).parse(req.body);

        // Validar assentos contra layout
        if (session.spaceId) {
            const space = await prisma.space.findUnique({ where: { id: session.spaceId } });
            if (space && space.theaterLayout) {
                const layout = space.theaterLayout;
                for (const seatId of seatIds) {
                    if (!isSeatValidInLayout(seatId, layout)) {
                        return res.status(400).json({ message: `Assento ${seatId} não existe no mapa da sala` });
                    }
                }
            }
        }

        // Transaction to prevent overbooking
        const result = await prisma.$transaction(async (tx) => {
            // Clean up expired reservations first
            await tx.theaterSeatReservation.deleteMany({
                where: {
                    eventId: id,
                    status: "RESERVED",
                    expiresAt: { lt: new Date() }
                }
            });

            // Find existing active reservations/sales
            const existing = await tx.theaterSeatReservation.findMany({
                where: {
                    eventId: id,
                    seatId: { in: seatIds }
                }
            });

            if (existing.length > 0) {
                throw new Error("Um ou mais assentos já estão reservados ou ocupados");
            }

            const reservations = await Promise.all(seatIds.map(seatId => 
                tx.theaterSeatReservation.create({
                    data: {
                        eventId: id,
                        seatId,
                        status: "RESERVED",
                        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 min
                    }
                })
            ));

            return reservations;
        });

        return res.json(result);
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }
});

// Finalize Sale (PDV)
router.post("/sessions/:id/sell", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const session = await assertTenantOwnership({ model: 'event', id, user: req.user! });

        if (!session.isTheaterSession) {
            return res.status(404).json({ message: "Sessão não encontrada" });
        }

        const { seatIds, paymentMethod, visitorId } = z.object({
            seatIds: z.array(z.string()).min(1, "Selecione pelo menos um assento"),
            paymentMethod: z.string(),
            visitorId: z.string().optional()
        }).parse(req.body);

        // Validar assentos contra layout
        if (session.spaceId) {
            const space = await prisma.space.findUnique({ where: { id: session.spaceId } });
            if (space && space.theaterLayout) {
                const layout = space.theaterLayout;
                for (const seatId of seatIds) {
                    if (!isSeatValidInLayout(seatId, layout)) {
                        return res.status(400).json({ message: `Assento ${seatId} não existe no mapa da sala` });
                    }
                }
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            // Clean up expired reservations first
            await tx.theaterSeatReservation.deleteMany({
                where: {
                    eventId: id,
                    status: "RESERVED",
                    expiresAt: { lt: new Date() }
                }
            });

            // Find existing active reservations/sales
            const existing = await tx.theaterSeatReservation.findMany({
                where: {
                    eventId: id,
                    seatId: { in: seatIds }
                }
            });

            const alreadySold = existing.filter(r => r.status === "SOLD");
            if (alreadySold.length > 0) {
                throw new Error(`Um ou mais assentos já foram vendidos: ${alreadySold.map(a => a.seatId).join(", ")}`);
            }

            // Validar se o assento já possui um visitorId reservado por outro fluxo e recusar a venda se o visitorId requisitado diferir
            const activeReservations = existing.filter(r => r.status === "RESERVED" && (r.expiresAt === null || r.expiresAt > new Date()));
            const reservationsWithDifferentOwner = activeReservations.filter(r => r.visitorId && r.visitorId !== visitorId);
            if (reservationsWithDifferentOwner.length > 0) {
                throw new Error(`Um ou mais assentos estão reservados por outro usuário: ${reservationsWithDifferentOwner.map(r => r.seatId).join(", ")}`);
            }

            // Buscar informações de comissão do tenant
            const tenant = await tx.tenant.findUnique({ where: { id: session.tenantId } });
            if (!tenant) throw new Error("Tenant não encontrado");

            // Buscar se existe algum ingresso pago associado à sessão
            const ticket = await tx.ticket.findFirst({
                where: { eventId: id, type: "PAID" }
            });

            const unitPrice = ticket ? Number(ticket.price) : 100.0;
            const totalAmount = seatIds.length * unitPrice;
            const feePercentage = tenant.feePercentage ?? 10.0;
            const totalFee = totalAmount * (feePercentage / 100);

            const isDigital = paymentMethod === "CARD" || paymentMethod === "PIX";

            if (isDigital) {
                // Update or create reservations as RESERVED for 30 minutes
                const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
                for (const seatId of seatIds) {
                    await tx.theaterSeatReservation.upsert({
                        where: { eventId_seatId: { eventId: id, seatId } },
                        update: { status: "RESERVED", visitorId, ticketId: ticket?.id, expiresAt },
                        create: { eventId: id, seatId, status: "RESERVED", visitorId, ticketId: ticket?.id, expiresAt }
                    });
                }

                // Resolve Connect account
                let connectedAccountId = '';
                if (session.producerId) {
                    const producer = await tx.user.findUnique({
                        where: { id: session.producerId },
                        select: { stripeConnectId: true }
                    });
                    if (producer?.stripeConnectId) {
                        connectedAccountId = producer.stripeConnectId;
                    }
                }
                if (!connectedAccountId && session.tenantId) {
                    const t = await tx.tenant.findUnique({
                        where: { id: session.tenantId },
                        select: { stripeConnectId: true }
                    });
                    if (t?.stripeConnectId) {
                        connectedAccountId = t.stripeConnectId;
                    }
                }

                if (!connectedAccountId) {
                    throw new Error("O recebedor deste evento ainda não configurou pagamentos via Stripe Connect.");
                }

                // Resolve/Create Stripe Customer
                const visitor = visitorId ? await tx.visitor.findUnique({ where: { id: visitorId } }) : null;
                const customerEmail = visitor?.email || req.user!.email;
                const customerName = visitor?.name || req.user!.name || "Theater Customer";

                return {
                    isDigital: true,
                    customerEmail,
                    customerName,
                    connectedAccountId,
                    totalAmount,
                    totalFee,
                    ticketId: ticket?.id
                };
            } else {
                // Update or create reservations as SOLD
                for (const seatId of seatIds) {
                    await tx.theaterSeatReservation.upsert({
                        where: { eventId_seatId: { eventId: id, seatId } },
                        update: { status: "SOLD", visitorId, ticketId: ticket?.id, expiresAt: null },
                        create: { eventId: id, seatId, status: "SOLD", visitorId, ticketId: ticket?.id }
                    });
                }

                // Criar a transação financeira da venda do ingresso do teatro
                const finTx = await tx.financialTransaction.create({
                    data: {
                        tenantId: session.tenantId,
                        type: "PAYMENT",
                        source: "THEATER",
                        amount: totalAmount,
                        fee: totalFee,
                        netAmount: totalAmount - totalFee,
                        status: "COMPLETED",
                        paymentMethod: paymentMethod || "CASH"
                    }
                });

                await syncLedgerEntry(tx, finTx.id);

                return { isDigital: false, success: true, amount: totalAmount, transactionId: finTx.id };
            }
        });

        if (result.isDigital) {
            const digitalResult = result as {
                isDigital: true;
                customerEmail: string;
                customerName: string;
                connectedAccountId: string;
                totalAmount: number;
                totalFee: number;
                ticketId?: string;
            };

            const { stripeService } = await import("../services/stripeService.js");
            const stripeCustomerId = await stripeService.createCustomer({
                name: digitalResult.customerName,
                email: digitalResult.customerEmail,
                userId: visitorId || req.user!.id
            });

            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
            const sessionCheckout = await stripeService.createSplitPaymentSession({
                customerId: stripeCustomerId,
                amount: Math.round(digitalResult.totalAmount * 100),
                description: `Ingressos Teatro: ${session.title} (Assentos: ${seatIds.join(", ")})`,
                connectedAccountId: digitalResult.connectedAccountId,
                applicationFeeAmount: Math.round(digitalResult.totalFee * 100),
                successUrl: `${frontendUrl}/theater/success?session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${frontendUrl}/theater/cancel`,
                metadata: {
                    type: "THEATER",
                    eventId: id,
                    seatIds: JSON.stringify(seatIds),
                    visitorId: visitorId || "",
                    tenantId: session.tenantId,
                    ticketId: digitalResult.ticketId || ""
                }
            });

            // Vínculo do Stripe Checkout Session ID com as reservas de assento
            await prisma.theaterSeatReservation.updateMany({
                where: {
                    eventId: id,
                    seatId: { in: seatIds },
                    status: "RESERVED"
                },
                data: {
                    stripeCheckoutSessionId: sessionCheckout.id
                }
            });

            return res.json({ success: true, checkoutUrl: sessionCheckout.url });
        }

        return res.json(result);
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }
});

// Theater Analytics
router.get("/analytics", authMiddleware, async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        
        const sessions = await prisma.event.findMany({
            where: { tenantId, isTheaterSession: true, deletedAt: null }
        });
        const sessionIds = sessions.map(s => s.id);

        const soldSeats = await prisma.theaterSeatReservation.count({
            where: { eventId: { in: sessionIds }, status: "SOLD" }
        });

        // Dynamic revenue calculation from FinancialTransaction with source="THEATER"
        const txs = await prisma.financialTransaction.findMany({
            where: {
                tenantId,
                source: "THEATER",
                status: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] }
            }
        });
        const txIds = txs.map(tx => tx.id);

        const completedRefunds = await prisma.refund.findMany({
            where: {
                transactionId: { in: txIds },
                status: "COMPLETED"
            }
        });

        // Map refunds to their transaction IDs
        const refundMap: Record<string, number> = {};
        for (const r of completedRefunds) {
            const txId = r.transactionId;
            refundMap[txId] = (refundMap[txId] || 0) + Number(r.amount);
        }

        let revenue = 0;
        for (const tx of txs) {
            const amount = Number(tx.amount);
            const refunded = refundMap[tx.id] || 0;
            revenue += Math.max(0, amount - refunded);
        }

        return res.json({
            totalTickets: soldSeats,
            revenue,
            occupancy: sessions.length > 0 ? Math.round((soldSeats / (sessions.length * 100)) * 100) : 0,
            activeSessions: sessions.length
        });
    } catch (err) {
        console.error("Error fetching theater analytics", err);
        return res.status(500).json({ message: "Erro ao buscar analytics" });
    }
});

// --- CAST & CREW ---

// List Members
router.get("/members", authMiddleware, async (req, res) => {
    try {
        const tenantId = req.user!.tenantId as string;
        const members = await prisma.theaterMember.findMany({
            where: { tenantId },
            orderBy: { name: "asc" }
        });
        return res.json(members);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao buscar elenco" });
    }
});

// Create/Update Member
router.post("/members", authMiddleware, async (req, res) => {
    try {
        const tenantId = req.user!.tenantId;
        const data = z.object({
            id: z.string().optional(),
            name: z.string(),
            role: z.string(),
            status: z.string().optional(),
            rating: z.number().optional(),
            tags: z.array(z.string()).optional(),
            phone: z.string().optional(),
            email: z.string().optional()
        }).parse(req.body);

        if (data.id) {
            await assertTenantOwnership({ model: 'theaterMember', id: data.id, user: req.user! });

            const updated = await prisma.theaterMember.update({
                where: { id: data.id },
                data: { ...data, tenantId: tenantId as string } as any
            });
            return res.json(updated);
        }

        const member = await prisma.theaterMember.create({
            data: { ...data, tenantId: tenantId as string } as any
        });
        return res.status(201).json(member);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error(err);
        return res.status(400).json({ message: "Dados inválidos" });
    }
});

// --- CUES (BACKSTAGE) ---

// Get Cues for a Session
router.get("/sessions/:id/cues", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'event', id, user: req.user! });

        const cues = await prisma.theaterCue.findMany({
            where: { eventId: id },
            orderBy: { order: "asc" }
        });
        return res.json(cues);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error(err);
        return res.status(500).json({ message: "Erro ao buscar cues" });
    }
});

// Create/Update Cue
router.post("/sessions/:id/cues", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await assertTenantOwnership({ model: 'event', id, user: req.user! });

        const data = z.object({
            id: z.string().optional(),
            type: z.string(),
            label: z.string(),
            desc: z.string().optional(),
            time: z.string(),
            order: z.number().optional()
        }).parse(req.body);

        if (data.id) {
            // Garantir que a cue a ser editada também pertence a este evento
            await assertTenantOwnership({ model: 'theaterCue', id: data.id, user: req.user! });

            const updated = await prisma.theaterCue.update({
                where: { id: data.id },
                data: { ...data, eventId: id } as any
            });
            return res.json(updated);
        }

        const cue = await prisma.theaterCue.create({
            data: { ...data, eventId: id } as any
        });
        return res.status(201).json(cue);
    } catch (err: any) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.error(err);
        return res.status(400).json({ message: "Dados inválidos" });
    }
});

export default router;
