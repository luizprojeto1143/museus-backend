import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { Prisma, Role } from "@prisma/client";

const router = Router();

// Listar agendamentos (para o Calendário Admin)
router.get("/", authMiddleware, async (req, res) => {
    try {
        const { year, month, tenantId } = req.query;
        const userRole = req.user?.role;

        // Se não for admin, filtrar apenas os próprios agendamentos do usuário (fallback) ou exigir tenantId
        const where: any = {
            tenantId: tenantId as string,
            status: { not: "CANCELLED" }
        };

        if (year && month) {
            const startDate = new Date(Number(year), Number(month) - 1, 1);
            const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);
            where.startTime = { gte: startDate, lte: endDate };
        }

        const bookings = await prisma.booking.findMany({
            where,
            include: {
                space: { select: { name: true, type: true } },
                user: { select: { name: true, email: true } }
            },
            orderBy: { startTime: "asc" }
        });

        return res.json(bookings);
    } catch (err) {
        console.error("Erro ao listar agendamentos", err);
        return res.status(500).json({ message: "Erro ao listar agendamentos" });
    }
});

// Listar meus agendamentos
router.get("/my", authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Não autorizado" });

        const bookings = await prisma.booking.findMany({
            where: { userId },
            include: { tenant: true, space: true },
            orderBy: { startTime: "asc" }
        });

        return res.json(bookings);
    } catch (err) {
        console.error("Erro ao listar agendamentos", err);
        return res.status(500).json({ message: "Erro ao listar agendamentos" });
    }
});

const createBookingSchema = z.object({
    body: z.object({
        date: z.string().datetime(),
        tenantId: z.string().uuid(),
        spaceId: z.string().uuid().optional(),
        startTime: z.string().datetime().optional(),
        endTime: z.string().datetime().optional(),
        purpose: z.string().optional()
    })
});

// Criar agendamento (Transaction Protected)
router.post("/", authMiddleware, validate(createBookingSchema), async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Não autorizado" });

        const { date, tenantId, spaceId, startTime, endTime, purpose } = req.body;
        const bookingDate = new Date(date);

        // 1. Validate Past Dates
        const now = new Date();
        if (bookingDate < now) {
            return res.status(400).json({ message: "Não é possível agendar datas no passado." });
        }

        // Space Booking Logic
        if (spaceId) {
            if (!startTime || !endTime || !purpose) {
                return res.status(400).json({ message: "Horário inicial, final e propósito são obrigatórios para reservar espaços." });
            }

            const start = new Date(startTime);
            const end = new Date(endTime);

            if (start >= end) {
                return res.status(400).json({ message: "Horário final deve ser maior que o inicial." });
            }

            // Check Space ownership and existence
            const space = await prisma.space.findUnique({
                where: { id: spaceId }
            });

            if (!space || space.tenantId !== tenantId) {
                return res.status(404).json({ message: "Espaço não encontrado." });
            }

            // Check Availability (Conflict detection)
            const conflicts = await prisma.booking.count({
                where: {
                    spaceId,
                    status: { not: "CANCELLED" },
                    AND: [
                        { startTime: { lt: end } },
                        { endTime: { gt: start } }
                    ]
                }
            });

            if (conflicts > 0) {
                return res.status(409).json({ message: "Espaço já reservado neste horário." });
            }

            // Create Booking
            const booking = await prisma.booking.create({
                data: {
                    userId,
                    tenantId,
                    spaceId,
                    date: bookingDate, // Still useful for quick date filtering
                    startTime: start,
                    endTime: end,
                    purpose,
                    status: "CONFIRMED"
                }
            });

            return res.status(201).json(booking);
        }

        // Regular Visitor Booking Logic (Existing)
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { openingHours: true, capacityPerHour: true }
        });

        let startHour = 9;
        let endHour = 17;

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

        const result = await prisma.$transaction(async (tx) => {
            const MAX_CAPACITY = tenant?.capacityPerHour || 50;

            const bookingsCount = await tx.booking.count({
                where: {
                    tenantId,
                    date: bookingDate,
                    status: "CONFIRMED",
                    spaceId: null // Only count regular visits
                }
            });

            if (bookingsCount >= MAX_CAPACITY) {
                throw new Error("CAPACITY_REACHED");
            }

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

const updateBookingSchema = z.object({
    body: z.object({
        spaceId: z.string().uuid().optional(),
        startTime: z.string().datetime().optional(),
        endTime: z.string().datetime().optional(),
        purpose: z.string().optional(),
        status: z.enum(["CONFIRMED", "CANCELLED", "PENDING"]).optional()
    })
});

// Atualizar agendamento
router.put("/:id", authMiddleware, validate(updateBookingSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const { spaceId, startTime, endTime, purpose, status } = req.body;

        const booking = await prisma.booking.findUnique({ where: { id } });
        if (!booking) return res.status(404).json({ message: "Reserva não encontrada" });

        // Permitir apenas dono ou admin
        if (booking.userId !== userId && userRole !== Role.ADMIN) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        // Se mudar horário ou espaço, validar conflitos
        const newSpaceId = spaceId || booking.spaceId;
        const newStart = startTime ? new Date(startTime) : booking.startTime;
        const newEnd = endTime ? new Date(endTime) : booking.endTime;

        if (newSpaceId && newStart && newEnd) {
            const conflicts = await prisma.booking.count({
                where: {
                    id: { not: id },
                    spaceId: newSpaceId,
                    status: { not: "CANCELLED" },
                    AND: [
                        { startTime: { lt: newEnd } },
                        { endTime: { gt: newStart } }
                    ]
                }
            });

            if (conflicts > 0) {
                return res.status(409).json({ message: "Espaço já reservado neste horário." });
            }
        }

        const updated = await prisma.booking.update({
            where: { id },
            data: {
                spaceId: spaceId ?? undefined,
                startTime: startTime ? new Date(startTime) : undefined,
                endTime: endTime ? new Date(endTime) : undefined,
                purpose: purpose ?? undefined,
                status: status ?? undefined
            },
            include: { space: true, user: true }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro ao atualizar reserva", err);
        return res.status(500).json({ message: "Erro ao atualizar reserva" });
    }
});

// Cancelar/Excluir agendamento
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        const userRole = req.user?.role;
        const { id } = req.params;
        const { hard } = req.query; // Se true, deleta do banco (apenas admin)

        const booking = await prisma.booking.findUnique({ where: { id } });

        if (!booking) {
            return res.status(404).json({ message: "Agendamento não encontrado" });
        }

        if (booking.userId !== userId && userRole !== Role.ADMIN) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        if (hard === "true" && userRole === Role.ADMIN) {
            await prisma.booking.delete({ where: { id } });
            return res.json({ message: "Agendamento excluído permanentemente" });
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

