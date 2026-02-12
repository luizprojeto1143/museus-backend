import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { Prisma } from "@prisma/client";

const router = Router();

// TODO: Move this to Tenant settings in Database
const HOURLY_CAPACITY = 20;

const createBookingSchema = z.object({
    body: z.object({
        date: z.string().datetime({ message: "Data inválida (ISO 8601)" }),
        tenantId: z.string().uuid({ message: "ID do museu inválido" })
    })
});

// Listar meus agendamentos
router.get("/my", authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Não autorizado" });

        const bookings = await prisma.booking.findMany({
            where: { userId },
            include: { tenant: true },
            orderBy: { date: "asc" }
        });

        return res.json(bookings);
    } catch (err) {
        console.error("Erro ao listar agendamentos", err);
        return res.status(500).json({ message: "Erro ao listar agendamentos" });
    }
});

// Criar agendamento (Transaction Protected)
router.post("/", authMiddleware, validate(createBookingSchema), async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Não autorizado" });

        const { date, tenantId } = req.body;
        const bookingDate = new Date(date);

        // 1. Validate Past Dates
        const now = new Date();
        if (bookingDate < now) {
            return res.status(400).json({ message: "Não é possível agendar datas no passado." });
        }

        // 2. Validate Opening Hours (Dynamic from Tenant)
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { openingHours: true }
        });

        let startHour = 9;
        let endHour = 17;

        // Try to parse "09:00 - 18:00" format
        if (tenant?.openingHours) {
            const matches = tenant.openingHours.match(/(\d{2}):\d{2}\s*-\s*(\d{2}):\d{2}/);
            if (matches) {
                startHour = parseInt(matches[1]);
                endHour = parseInt(matches[2]);
            }
        }

        const hour = bookingDate.getHours();
        if (hour < startHour || hour >= endHour) {
            return res.status(400).json({ message: `Horário fora de funcionamento (${startHour}h às ${endHour}h).` });
        }

        // 3. Transaction for Consistency (Race Condition Fix)
        // We use Serializable isolation to ensure that concurrent reads of 'count' are safe.
        const result = await prisma.$transaction(async (tx) => {
            // Check Capacity (Increased default to 50)
            const MAX_CAPACITY = 50;

            const bookingsCount = await tx.booking.count({
                where: {
                    tenantId,
                    date: bookingDate, // Exact match on timestamp
                    status: "CONFIRMED"
                }
            });

            if (bookingsCount >= MAX_CAPACITY) {
                throw new Error("CAPACITY_REACHED");
            }

            // Create Booking
            return await tx.booking.create({
                data: {
                    userId,
                    tenantId,
                    date: bookingDate,
                    status: "CONFIRMED"
                }
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        return res.status(201).json(result);

    } catch (err: any) {
        if (err.message === "CAPACITY_REACHED") {
            return res.status(400).json({ message: "Horário esgotado." });
        }
        console.error("Erro ao criar agendamento", err);
        return res.status(500).json({ message: "Erro ao criar agendamento" });
    }
});

// Cancelar agendamento
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        const booking = await prisma.booking.findUnique({ where: { id } });

        if (!booking) {
            return res.status(404).json({ message: "Agendamento não encontrado" });
        }

        if (booking.userId !== userId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        await prisma.booking.update({
            where: { id },
            data: { status: "CANCELLED" }
        });

        return res.json({ message: "Agendamento cancelado" });
    } catch (err) {
        console.error("Erro ao cancelar agendamento", err);
        return res.status(500).json({ message: "Erro ao cancelar agendamento" });
    }
});

export default router;

