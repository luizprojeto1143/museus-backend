import { Router } from "express";
import { prisma } from "../prisma.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

const router = Router();

const createEntrySchema = z.object({
    body: z.object({
        message: z.string().min(1, "Mensagem não pode ser vazia").max(500, "Mensagem muito longa"),
        visitorId: z.string().uuid("ID do visitante inválido"),
        tenantId: z.string().uuid("ID do museu inválido")
    })
});

// Listar mensagens do guestbook (público)
router.get("/", async (req, res) => {
    try {
        const { tenantId } = req.query;
        if (!tenantId) return res.status(400).json({ message: "tenantId obrigatório" });

        const entries = await (prisma as any).guestbookEntry.findMany({
            where: {
                tenantId: tenantId as string,
                isVisible: true
            },
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
router.post("/", validate(createEntrySchema), async (req, res) => {
    try {
        const { message, visitorId, tenantId } = req.body;

        const entry = await (prisma as any).guestbookEntry.create({
            data: {
                message,
                visitorId,
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

export default router;
