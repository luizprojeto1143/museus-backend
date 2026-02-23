import { Router } from "express";
import { prisma } from "../prisma.js";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { formLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Schema for validation
const contactSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    subject: z.string().optional(),
    message: z.string().min(5),
    tenantId: z.string().optional()
});

// PUBLIC: Send Contact Request
// SECURITY: Rate Limit added to prevent spam (CRIT-004)
router.post("/", formLimiter, async (req, res) => {
    try {
        const data = contactSchema.parse(req.body);

        const contact = await prisma.contactRequest.create({
            data: {
                name: data.name,
                email: data.email,
                subject: data.subject || "General",
                message: data.message,
                tenantId: data.tenantId,
                status: "NEW"
            }
        });

        return res.status(201).json(contact);
    } catch (err: unknown) {
        console.error("Error saving contact", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        return res.status(400).json({ message: "Erro ao enviar mensagem", error: errorMessage });
    }
});

// MASTER/ADMIN: List Messages
// Assuming master role check is handled by middleware
router.get("/", authMiddleware, requireRole(["MASTER", "ADMIN"]), async (req, res) => {
    try {
        const messages = await prisma.contactRequest.findMany({
            orderBy: { createdAt: "desc" }
        });
        return res.json(messages);
    } catch (err) {
        console.error("Error fetching messages", err);
        return res.status(500).json({ message: "Erro ao buscar mensagens" });
    }
});

// MASTER/ADMIN: Update Status
router.patch("/:id", authMiddleware, requireRole(["MASTER", "ADMIN"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // Expecting { status: "READ" | "ARCHIVED" }

        const updated = await prisma.contactRequest.update({
            where: { id },
            data: { status }
        });

        return res.json(updated);
    } catch (err) {
        console.error("Error updating message", err);
        return res.status(500).json({ message: "Erro ao atualizar mensagem" });
    }
});

export default router;
