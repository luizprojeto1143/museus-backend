import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Lista plantas de um tenant (público para visitantes)
router.get("/", async (req, res) => {
    try {
        const tenantId = req.query.tenantId as string | undefined;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        const floorPlans = await prisma.floorPlan.findMany({
            where: { tenantId },
            orderBy: { order: "asc" }
        });

        return res.json(floorPlans);
    } catch (err) {
        console.error("Erro listar plantas", err);
        return res.status(500).json({ message: "Erro ao listar plantas" });
    }
});

// Detalhe de uma planta
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const floorPlan = await prisma.floorPlan.findUnique({ where: { id } });

        if (!floorPlan) {
            return res.status(404).json({ message: "Planta não encontrada" });
        }

        return res.json(floorPlan);
    } catch (err) {
        console.error("Erro buscar planta", err);
        return res.status(500).json({ message: "Erro ao buscar planta" });
    }
});

// Criar planta (Admin/Master)
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const user = req.user!;
        const tenantId = user.role === Role.MASTER ? (req.body.tenantId as string) : user.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "tenantId é obrigatório" });
        }

        const { name, floor, imageUrl, order } = req.body;

        if (!name || !imageUrl) {
            return res.status(400).json({ message: "name e imageUrl são obrigatórios" });
        }

        // Auto-calcular ordem se não fornecida
        let finalOrder = order;
        if (finalOrder === undefined) {
            const count = await prisma.floorPlan.count({ where: { tenantId } });
            finalOrder = count;
        }

        const floorPlan = await prisma.floorPlan.create({
            data: {
                name,
                floor: floor ?? 0,
                imageUrl,
                order: finalOrder,
                tenantId
            }
        });

        return res.status(201).json(floorPlan);
    } catch (err) {
        console.error("Erro criar planta", err);
        return res.status(500).json({ message: "Erro ao criar planta" });
    }
});

// Atualizar planta (Admin/Master)
router.put("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, floor, imageUrl, order } = req.body;

        const floorPlan = await prisma.floorPlan.update({
            where: { id },
            data: {
                name,
                floor,
                imageUrl,
                order
            }
        });

        return res.json(floorPlan);
    } catch (err) {
        console.error("Erro atualizar planta", err);
        return res.status(500).json({ message: "Erro ao atualizar planta" });
    }
});

// Excluir planta (Admin/Master)
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.floorPlan.delete({ where: { id } });
        return res.status(204).send();
    } catch (err) {
        console.error("Erro excluir planta", err);
        return res.status(500).json({ message: "Erro ao excluir planta" });
    }
});

export default router;
