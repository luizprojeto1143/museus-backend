import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { z } from "zod";
import { checkEntityOwnership } from "../utils/ownership.js";

const router = Router();

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
        const ownership = await checkEntityOwnership('event', id, req.user!);
        if (!ownership.success) return res.status(ownership.status).json({ message: ownership.message });
        const session = ownership.record;

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
    } catch (err) {
        console.error("Error fetching session seats", err);
        return res.status(500).json({ message: "Erro ao buscar assentos" });
    }
});

// Reserve Seats (Temporary)
router.post("/sessions/:id/reserve", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await checkEntityOwnership('event', id, req.user!);
        if (!ownership.success) return res.status(ownership.status).json({ message: ownership.message });
        const session = ownership.record;

        if (!session.isTheaterSession) {
            return res.status(404).json({ message: "Sessão não encontrada" });
        }

        const { seatIds } = z.object({ seatIds: z.array(z.string()) }).parse(req.body);

        // Transaction to prevent overbooking
        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.theaterSeatReservation.findMany({
                where: {
                    eventId: id,
                    seatId: { in: seatIds }
                }
            });

            if (existing.length > 0) {
                throw new Error("Um ou mais assentos já estão reservados");
            }

            const reservations = await Promise.all(seatIds.map(seatId => 
                tx.theaterSeatReservation.create({
                    data: {
                        eventId: id,
                        seatId,
                        status: "RESERVED",
                        expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 min
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
        const ownership = await checkEntityOwnership('event', id, req.user!);
        if (!ownership.success) return res.status(ownership.status).json({ message: ownership.message });
        const session = ownership.record;

        if (!session.isTheaterSession) {
            return res.status(404).json({ message: "Sessão não encontrada" });
        }

        const { seatIds, paymentMethod, visitorId } = z.object({
            seatIds: z.array(z.string()),
            paymentMethod: z.string(),
            visitorId: z.string().optional()
        }).parse(req.body);

        const result = await prisma.$transaction(async (tx) => {
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

            // Update or create reservations as SOLD
            for (const seatId of seatIds) {
                await tx.theaterSeatReservation.upsert({
                    where: { eventId_seatId: { eventId: id, seatId } },
                    update: { status: "SOLD", visitorId, ticketId: ticket?.id },
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

            return { success: true, amount: totalAmount, transactionId: finTx.id };
        });

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

        // Simplified revenue calculation
        const revenue = soldSeats * 100; // Placeholder for real price aggregation

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
    } catch (err) {
        console.error(err);
        return res.status(400).json({ message: "Dados inválidos" });
    }
});

// --- CUES (BACKSTAGE) ---

// Get Cues for a Session
router.get("/sessions/:id/cues", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await checkEntityOwnership('event', id, req.user!);
        if (!ownership.success) return res.status(ownership.status).json({ message: ownership.message });

        const cues = await prisma.theaterCue.findMany({
            where: { eventId: id },
            orderBy: { order: "asc" }
        });
        return res.json(cues);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao buscar cues" });
    }
});

// Create/Update Cue
router.post("/sessions/:id/cues", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await checkEntityOwnership('event', id, req.user!);
        if (!ownership.success) return res.status(ownership.status).json({ message: ownership.message });

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
            const cueOwnership = await checkEntityOwnership('theaterCue', data.id, req.user!);
            if (!cueOwnership.success) return res.status(cueOwnership.status).json({ message: cueOwnership.message });

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
    } catch (err) {
        console.error(err);
        return res.status(400).json({ message: "Dados inválidos" });
    }
});

export default router;
