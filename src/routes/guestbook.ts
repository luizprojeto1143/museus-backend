import { Router } from "express";
import { prisma } from "../prisma.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "@prisma/client";
import { formLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const createEntrySchema = z.object({
    body: z.object({
        message: z.string().min(1, "Mensagem não pode ser vazia").max(500, "Mensagem muito longa"),
        visitorId: z.string().uuid("ID do visitante inválido").optional(),
        email: z.string().email().optional(),
        tenantId: z.string().uuid("ID do museu inválido")
    })
});

// Listar mensagens do guestbook (público)
router.get("/", async (req, res) => {
    try {
        const { tenantId, includeHidden } = req.query;
        if (!tenantId) return res.status(400).json({ message: "tenantId obrigatório" });

        const where: any = { tenantId: tenantId as string };
        if (includeHidden !== 'true') {
            where.isVisible = true;
        }

        const entries = await prisma.guestbookEntry.findMany({
            where,
            include: {
                visitor: {
                    select: { name: true, photoUrl: true }
                }
            },
            orderBy: { createdAt: "desc" },
            take: 50
        });

        return res.json(entries);
    } catch (err) {
        console.error("Erro ao listar guestbook", err);
        return res.status(500).json({ message: "Erro ao listar mensagens" });
    }
});

// Criar mensagem
router.post("/", formLimiter, validate(createEntrySchema), async (req, res) => {
    try {
        const { message, visitorId, tenantId, email } = req.body;

        let finalVisitorId = visitorId;

        // Se o visitorId não vier (ou quisermos garantir), tentamos buscar pelo email
        if (!finalVisitorId && email) {
            const visitor = await prisma.visitor.findFirst({
                where: { email, tenantId }
            });
            if (visitor) {
                finalVisitorId = visitor.id;
            }
        }

        // Se ainda não tiver visitorId, erro (ou criar anônimo, mas guestbook geralmente pede identificação)
        if (!finalVisitorId) {
            return res.status(400).json({ message: "Visitante não identificado. Faça login ou forneça visitorId." });
        }

        const entry = await prisma.guestbookEntry.create({
            data: {
                message,
                visitorId: finalVisitorId,
                tenantId,
                isVisible: true // Pode ser false se quiser moderação
            }
        });

        return res.status(201).json(entry);
    } catch (err) {
        console.error("Erro ao criar mensagem no guestbook", err);
        return res.status(500).json({ message: "Erro ao criar mensagem" });
    }
});

// ADMIN: Toggle Visibility
router.patch("/:id/visibility", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;
        const { isVisible } = req.body;

        // IDOR Protection: Verify resource belongs to user's tenant
        const whereClause = user.role === Role.MASTER
            ? { id }
            : { id, tenantId: user.tenantId as string };
        const existing = await prisma.guestbookEntry.findFirst({ where: whereClause });
        if (!existing) return res.status(404).json({ message: "Mensagem não encontrada" });

        const updated = await prisma.guestbookEntry.update({
            where: { id },
            data: { isVisible }
        });

        return res.json(updated);
    } catch (err) {
        return res.status(500).json({ message: "Erro ao atualizar visibilidade" });
    }
});

// ADMIN: Delete Entry
router.delete("/:id", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user!;

        // IDOR Protection: Verify resource belongs to user's tenant
        const whereClause = user.role === Role.MASTER
            ? { id }
            : { id, tenantId: user.tenantId as string };
        const existing = await prisma.guestbookEntry.findFirst({ where: whereClause });
        if (!existing) return res.status(404).json({ message: "Mensagem não encontrada" });

        await prisma.guestbookEntry.delete({ where: { id } });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ message: "Erro ao excluir mensagem" });
    }
});

export default router;
