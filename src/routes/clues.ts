import { Router } from "express";
import { prisma } from "../prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// Middleware de autenticação para todas as rotas
router.use(authMiddleware);

// GET /clues - Listar pistas (filtrar por tenantId do usuário ou query param se Master)
router.get("/", async (req, res) => {
    try {
        const user = req.user!;
        let tenantId = user.tenantId;

        if (user.role === Role.MASTER && req.query.tenantId) {
            tenantId = req.query.tenantId as string;
        }

        if (!tenantId) {
            return res.status(400).json({ message: "Tenant ID não identificado" });
        }

        const clues = await prisma.clue.findMany({
            where: { tenantId },
            orderBy: { order: "asc" },
            include: {
                work: {
                    select: { id: true, title: true }
                }
            }
        });

        return res.json(clues);
    } catch (err) {
        console.error("Erro listar pistas", err);
        return res.status(500).json({ message: "Erro ao listar pistas" });
    }
});

// POST /clues - Criar pista
router.post("/", requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { riddle, answer, order, workId, active } = req.body;
        const user = req.user!;
        const tenantId = user.tenantId || req.body.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: "Tenant ID obrigatório" });
        }

        if (!riddle || !answer) {
            return res.status(400).json({ message: "Charada e Resposta são obrigatórios" });
        }

        const clue = await prisma.clue.create({
            data: {
                riddle,
                answer,
                order: order || 0,
                active: active !== undefined ? active : true,
                workId: workId || null,
                tenantId
            }
        });

        return res.status(201).json(clue);
    } catch (err) {
        console.error("Erro criar pista", err);
        return res.status(500).json({ message: "Erro ao criar pista" });
    }
});

// PUT /clues/:id - Editar pista
router.put("/:id", requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const { riddle, answer, order, workId, active } = req.body;

        // Verificar se existe e pertence ao tenant
        const existing = await prisma.clue.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Pista não encontrada" });

        // Master pode editar de qualquer um, Admin só do seu
        if (req.user?.role !== Role.MASTER && existing.tenantId !== req.user?.tenantId) {
            return res.status(403).json({ message: "Acesso negado" });
        }

        const updated = await prisma.clue.update({
            where: { id },
            data: {
                riddle,
                answer,
                order,
                workId: workId || null,
                active
            }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Erro editar pista", err);
        return res.status(500).json({ message: "Erro ao editar pista" });
    }
});

// DELETE /clues/:id - Excluir pista
router.delete("/:id", requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.clue.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Pista não encontrada" });

        if (req.user?.role !== Role.MASTER && existing.tenantId !== req.user?.tenantId) {
            return res.status(403).json({ message: "Acesso negado" });
        }

        await prisma.clue.delete({ where: { id } });

        return res.status(204).send();
    } catch (err) {
        console.error("Erro excluir pista", err);
        return res.status(500).json({ message: "Erro ao excluir pista" });
    }
});

export default router;
