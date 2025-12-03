import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

const router = Router();

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

        const bookings = await (prisma as any).booking.findMany({
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

// Criar agendamento
router.post("/", authMiddleware, validate(createBookingSchema), async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Não autorizado" });

        const { date, tenantId } = req.body;

        // Verificar se já existe agendamento no mesmo horário (regra simples)
        const existing = await (prisma as any).booking.findFirst({
            where: {
                tenantId,
                date: new Date(date),
                status: "CONFIRMED"
            }
        });

        // Regra de negócio simplificada: permitir múltiplos por horário por enquanto, 
        // mas em produção teria limite de capacidade.

        const booking = await (prisma as any).booking.create({
            data: {
                userId,
                tenantId,
                date: new Date(date),
                status: "CONFIRMED"
            }
        });

        return res.status(201).json(booking);
    } catch (err) {
        console.error("Erro ao criar agendamento", err);
        return res.status(500).json({ message: "Erro ao criar agendamento" });
    }
});

// Cancelar agendamento
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        const booking = await (prisma as any).booking.findUnique({ where: { id } });

        if (!booking) {
            return res.status(404).json({ message: "Agendamento não encontrado" });
        }

        if (booking.userId !== userId) {
            return res.status(403).json({ message: "Sem permissão" });
        }

        await (prisma as any).booking.update({
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
