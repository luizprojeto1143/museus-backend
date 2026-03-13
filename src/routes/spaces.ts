import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role, Prisma } from "@prisma/client";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

const router = Router();

// Schema
const spaceSchema = z.object({
    body: z.object({
        name: z.string().min(1, "Nome é obrigatório"),
        description: z.string().optional(),
        capacity: z.number().int().positive().optional(),
        type: z.string().optional(),
        resources: z.array(z.string()).optional(), // Array of strings
        isBookable: z.boolean().optional(),
        imageUrl: z.string().url().optional().nullable(),
        equipamentoId: z.string().optional().nullable()
    })
});

// List Spaces
router.get("/", authMiddleware, async (req, res) => {
    try {
        const user = req.user!;
        const { equipamentoId } = req.query;

        const where: any = { tenantId: user.tenantId as string };
        if (equipamentoId) where.equipamentoId = equipamentoId as string;

        const spaces = await prisma.space.findMany({
            where,
            orderBy: { name: "asc" }
        });
        return res.json(spaces);
    } catch (err) {
        console.error("Error listing spaces", err);
        return res.status(500).json({ message: "Erro ao listar espaços" });
    }
});

// Get Single Space
router.get("/:id", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        const space = await prisma.space.findFirst({
            where: { id, tenantId: user.tenantId as string }
        });

        if (!space) return res.status(404).json({ message: "Espaço não encontrado" });

        return res.json(space);
    } catch (err) {
        console.error("Error getting space", err);
        return res.status(500).json({ message: "Erro ao buscar espaço" });
    }
});

// Create Space
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(spaceSchema), async (req, res) => {
    try {
        const user = req.user!;
        const { name, description, capacity, type, resources, isBookable, imageUrl } = req.body;

        const space = await prisma.space.create({
            data: {
                name,
                description,
                capacity: capacity || 10,
                type: type || "ROOM",
                resources: resources ?? Prisma.DbNull,
                isBookable: isBookable ?? true,
                imageUrl: imageUrl ?? undefined,
                tenantId: user.tenantId as string,
                equipamentoId: req.body.equipamentoId || null
            }
        });

        return res.status(201).json(space);
    } catch (err) {
        console.error("Error creating space", err);
        return res.status(500).json({ message: "Erro ao criar espaço" });
    }
});

// Update Space
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), validate(spaceSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const { name, description, capacity, type, resources, isBookable, imageUrl } = req.body;

        // Verify ownership
        const existing = await prisma.space.findFirst({ where: { id, tenantId: user.tenantId as string } });
        if (!existing) return res.status(404).json({ message: "Espaço não encontrado" });

        const space = await prisma.space.update({
            where: { id },
            data: {
                name,
                description,
                capacity,
                type,
                resources: resources ?? undefined,
                isBookable,
                imageUrl: imageUrl ?? undefined,
                equipamentoId: req.body.equipamentoId !== undefined ? req.body.equipamentoId : undefined
            }
        });

        return res.json(space);
    } catch (err) {
        console.error("Error updating space", err);
        return res.status(500).json({ message: "Erro ao atualizar espaço" });
    }
});

// Delete Space
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER, Role.PRODUCER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        // Verify ownership
        const existing = await prisma.space.findFirst({ where: { id, tenantId: user.tenantId as string } });
        if (!existing) return res.status(404).json({ message: "Espaço não encontrado" });

        await prisma.space.delete({ where: { id } });
        return res.status(204).send();
    } catch (err) {
        console.error("Error deleting space", err);
        return res.status(500).json({ message: "Erro ao excluir espaço" });
    }
});

// Check Availability (Simple range overlap check)
router.get("/:id/availability", authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { date, startTime, endTime } = req.query; // date in ISO YYYY-MM-DD
        const user = req.user!;

        if (!date) return res.status(400).json({ message: "Data é obrigatória" });

        // Ensure space exists
        const space = await prisma.space.findFirst({ where: { id, tenantId: user.tenantId as string } });
        if (!space) return res.status(404).json({ message: "Espaço não encontrado" });

        const searchDateStart = new Date(`${date}T00:00:00.000Z`);
        const searchDateEnd = new Date(`${date}T23:59:59.999Z`);

        const bookings = await prisma.booking.findMany({
            where: {
                spaceId: id,
                status: { not: "CANCELLED" },
                // Simple day check first, logic can be more complex for range overlap
                date: {
                    gte: searchDateStart,
                    lte: searchDateEnd
                }
            },
            select: {
                id: true,
                startTime: true,
                endTime: true,
                status: true
            }
        });

        return res.json({ available: true, bookings }); // Frontend checks constraints
    } catch (err) {
        console.error("Error checking availability", err);
        return res.status(500).json({ message: "Erro ao verificar disponibilidade" });
    }
});

export default router;
