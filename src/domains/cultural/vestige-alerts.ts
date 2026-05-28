import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware, requireRole } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

// GET /vestige-alerts - Listar alertas de um tenant
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) return res.status(400).json({ message: "tenantId é obrigatório" });

    const alerts = await (prisma as any).vestigeAlert.findMany({
      where: { 
        tenantId: tenantId as string,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json(alerts);
  } catch (err) {
    console.error("Erro ao listar alertas:", err);
    return res.status(500).json({ message: "Erro ao listar alertas" });
  }
});

// POST /vestige-alerts - Criar alerta (Admin only)
router.post("/", authMiddleware, requireRole([Role.ADMIN, Role.MASTER]), async (req, res) => {
  try {
    const { tenantId, titulo, mensagem, tipo, link, expiresAt } = req.body;
    
    const alert = await (prisma as any).vestigeAlert.create({
      data: {
        tenantId,
        titulo,
        mensagem,
        tipo: tipo || "URGENTE",
        link,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    return res.status(201).json(alert);
  } catch (err) {
    console.error("Erro ao criar alerta:", err);
    return res.status(500).json({ message: "Erro ao criar alerta" });
  }
});

export default router;
